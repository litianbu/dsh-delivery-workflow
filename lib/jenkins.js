import { DeliveryError, redact, sleep, tail } from './util.js'

const TAG_RE = /^(test|prod)-([0-9a-f]{12})-(\d+)$/

export function validateTag(tag) {
  const value = String(tag ?? '')
  const match = TAG_RE.exec(value)
  if (!match) {
    throw new DeliveryError(
      `Invalid image tag ${JSON.stringify(value)}. Expected ^(test|prod)-[0-9a-f]{12}-[0-9]+$, for example test-0123456789ab-42.`,
      'TAG_INVALID',
    )
  }
  return { tag: value, env: match[1], sha: match[2], buildNumber: match[3] }
}

export function tagMatchesSha(tag, sha) {
  const parsed = validateTag(tag)
  return parsed.sha === String(sha).slice(0, 12)
}

export function jenkinsSettings() {
  const base = String(process.env.JENKINS_URL ?? '').replace(/\/+$/, '')
  const user = String(process.env.JENKINS_USER ?? '')
  const token = String(process.env.JENKINS_API_TOKEN ?? '')
  return { base, user, token, configured: Boolean(base && user && token) }
}

function jobBase(base, job) {
  const segments = String(job ?? '')
    .split('/')
    .filter(Boolean)
    .map((segment) => `job/${encodeURIComponent(segment)}`)
  if (segments.length === 0) throw new DeliveryError('Jenkins job name is empty.', 'JENKINS_CONFIG_INVALID')
  return `${base}/${segments.join('/')}`
}

export function jenkinsJobFor(project, env) {
  const job = project.jenkins?.[env]
  if (!job?.job) {
    throw new DeliveryError(`Project "${project.name}" has no Jenkins job for env "${env}".`, 'JENKINS_CONFIG_MISSING')
  }
  return job
}

async function authHeaders(base, user, token) {
  const headers = {
    Authorization: `Basic ${Buffer.from(`${user}:${token}`, 'utf8').toString('base64')}`,
  }
  try {
    const response = await fetch(`${base}/crumbIssuer/api/json`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    })
    if (response.ok) {
      const crumb = await response.json()
      if (crumb?.crumbRequestField && crumb?.crumb) headers[crumb.crumbRequestField] = crumb.crumb
    }
  } catch {
    // Jenkins instances with CSRF disabled return 404 here; the build POST is authoritative.
  }
  return headers
}

async function fetchJson(url, headers, timeoutMs = 20_000) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) {
    const body = redact((await response.text()).slice(0, 800))
    throw new DeliveryError(`Jenkins request failed: HTTP ${response.status} ${body}`, 'JENKINS_HTTP_ERROR')
  }
  return response.json()
}

export function parseTag(text) {
  const matches = [...String(text ?? '').matchAll(/\b(test|prod)-([0-9a-f]{12})-(\d+)\b/g)]
  if (matches.length === 0) return null
  const last = matches[matches.length - 1]
  return { tag: last[0], env: last[1], sha: last[2], buildNumber: last[3] }
}

async function pollQueue({ queueUrl, headers, deadline, intervalMs }) {
  while (Date.now() < deadline) {
    try {
      const queue = await fetchJson(queueUrl, headers)
      if (queue?.cancelled) return { status: 'cancelled', queueUrl }
      if (queue?.executable?.url) return { status: 'started', buildUrl: queue.executable.url }
    } catch {
      // A freshly queued item can briefly 404; keep polling.
    }
    await sleep(intervalMs)
  }
  return { status: 'queued', queueUrl }
}

async function pollBuildUrl({ buildUrl, headers, deadline, intervalMs, expectedEnv }) {
  while (Date.now() < deadline) {
    try {
      const build = await fetchJson(buildUrl, headers)
      if (build?.building) {
        await sleep(intervalMs)
        continue
      }
      let consoleText = ''
      try {
        const response = await fetch(`${buildUrl.replace(/\/+$/, '')}/consoleText`, {
          headers,
          signal: AbortSignal.timeout(20_000),
        })
        if (response.ok) consoleText = await response.text()
      } catch {
        // The result is still usable when the console endpoint is protected.
      }
      const parsed = parseTag(consoleText)
      const ok = build?.result === 'SUCCESS'
      const envWarning =
        parsed && expectedEnv && parsed.env !== expectedEnv
          ? `Build produced a ${parsed.env} tag while ${expectedEnv} was requested.`
          : undefined
      return {
        status: ok ? 'success' : 'failed',
        result: build?.result ?? 'UNKNOWN',
        buildNumber: build?.number,
        buildUrl,
        tag: parsed?.tag,
        tagEnv: parsed?.env,
        tagSha: parsed?.sha,
        envWarning,
        consoleTail: tail(consoleText, 3000),
      }
    } catch {
      await sleep(intervalMs)
    }
  }
  return { status: 'running', buildUrl }
}

/**
 * Trigger a parameterized Jenkins build and wait briefly for it. A build that
 * is still running is returned with its URL; the caller can poll it later
 * without re-triggering.
 */
export async function triggerBuild({ project, env, branch, waitSeconds = 120 }) {
  const job = jenkinsJobFor(project, env)
  const settings = jenkinsSettings()
  if (!settings.configured) {
    throw new DeliveryError(
      'Jenkins is not configured. Set JENKINS_URL, JENKINS_USER and JENKINS_API_TOKEN in the environment, or record a completed build with build tag=<tag>.',
      'JENKINS_NOT_CONFIGURED',
    )
  }
  const base = settings.base
  const baseUrl = jobBase(base, job.job)
  const params = new URLSearchParams(job.params ?? {})
  if (job.branchParam && branch) params.set(job.branchParam, branch)
  const triggerUrl = `${baseUrl}/buildWithParameters?${params.toString()}`
  const headers = await authHeaders(base, settings.user, settings.token)
  const response = await fetch(triggerUrl, {
    method: 'POST',
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  })
  if (![200, 201, 302].includes(response.status)) {
    const body = redact((await response.text()).slice(0, 1000))
    throw new DeliveryError(`Jenkins trigger failed: HTTP ${response.status} ${body}`, 'JENKINS_TRIGGER_FAILED')
  }
  const location = response.headers.get('location') ?? ''
  const queueUrl = location ? new URL(location, base).toString() : ''
  const wait = Math.max(0, Math.min(Number(waitSeconds) || 0, 600))
  if (!queueUrl) {
    return { status: 'unknown', triggerUrl: redact(triggerUrl), params: Object.fromEntries(params), jobBase: baseUrl }
  }
  const deadline = Date.now() + wait * 1000
  const queued = await pollQueue({ queueUrl, headers, deadline, intervalMs: 5000 })
  if (queued.status !== 'started') {
    return {
      status: queued.status,
      triggerUrl: redact(triggerUrl),
      queueUrl,
      params: Object.fromEntries(params),
      jobBase: baseUrl,
      waitSeconds: wait,
    }
  }
  const buildUrl = new URL(queued.buildUrl, base).toString()
  const build = await pollBuildUrl({ buildUrl, headers, deadline, intervalMs: 5000, expectedEnv: env })
  return {
    ...build,
    triggerUrl: redact(triggerUrl),
    queueUrl,
    params: Object.fromEntries(params),
    jobBase: baseUrl,
  }
}

/** Poll an already-triggered build, for example after triggerBuild returned running. */
export async function pollBuild({ buildUrl, env, waitSeconds = 120 }) {
  const settings = jenkinsSettings()
  if (!settings.configured) {
    throw new DeliveryError('Jenkins is not configured for polling.', 'JENKINS_NOT_CONFIGURED')
  }
  const base = settings.base
  const absolute = new URL(buildUrl, base).toString()
  const headers = await authHeaders(base, settings.user, settings.token)
  const wait = Math.max(0, Math.min(Number(waitSeconds) || 0, 600))
  return pollBuildUrl({
    buildUrl: absolute,
    headers,
    deadline: Date.now() + wait * 1000,
    intervalMs: 5000,
    expectedEnv: env,
  })
}