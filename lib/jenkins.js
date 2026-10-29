import { DeliveryError, redact, sleep, tail } from './util.js'

const TAG_RE = /^(test|prod)-([0-9a-f]{12})-(\d+)$/
const LOOSE_TAG_RE = /^(?:(.*)-)?(test|prod)(?:-([0-9a-f]{7,40}))?(?:-(\d+))?$/

export function validateTag(tag) {
  const value = String(tag ?? '')
  const lower = value.toLowerCase()
  // Projects name image tags differently: web-test-7a3c647, latest-test,
  // test-0123456789ab-42. What must hold is the ENV marker, because deploying
  // a prod tag into test is the mistake worth catching. A commit prefix is
  // recorded when the tag carries one; a moving tag simply has none.
  const hits = []
  const re = /test|prod/g
  let match
  while ((match = re.exec(lower)) !== null) hits.push(match[0])
  if (!hits.length) {
    throw new DeliveryError(
      `Invalid image tag ${JSON.stringify(value)}: it names no environment. The tag must contain "test" or "prod", for example web-test-7a3c647 or latest-test.`,
      'TAG_INVALID',
    )
  }
  const env = hits[hits.length - 1]
  const sha = /[0-9a-f]{7,40}/.exec(lower)
  return { tag: value, env: env, sha: sha ? sha[0] : undefined, buildNumber: undefined }
}

export function tagMatchesSha(tag, sha) {
  const parsed = validateTag(tag)
  // latest-test pins no commit: there is nothing to compare, and inventing a
  // match would turn an unprovable build into a fake green one.
  if (!parsed.sha) return true
  const head = String(sha ?? '')
  if (!head) return true
  return head.startsWith(parsed.sha) || parsed.sha === head.slice(0, parsed.sha.length)
}

// A desktop launch carries no useful environment, so credentials also live
// in a private file outside every repo (chmod 600). Env wins when present.
function fileJenkinsSettings() {
  try {
    const fs = process.getBuiltinModule('node:fs')
    const os = process.getBuiltinModule('node:os')
    const path = process.getBuiltinModule('node:path')
    const file = path.join(os.homedir(), '.config', 'delivery-workflow', 'jenkins.json')
    const conf = JSON.parse(fs.readFileSync(file, 'utf8'))
    return { base: String(conf.url || ''), user: String(conf.user || ''), token: String(conf.token || '') }
  } catch {
    return null
  }
}
export function jenkinsSettings() {
  const envBase = process.env.JENKINS_URL || ''
  const envUser = process.env.JENKINS_USER || ''
  const envToken = process.env.JENKINS_API_TOKEN || ''
  if (envBase && envUser && envToken) {
    return { base: envBase.replace(/\/+$/, ''), user: envUser, token: envToken, configured: true, source: 'env' }
  }
  const file = fileJenkinsSettings()
  if (file && file.base && file.user && file.token) {
    return { base: file.base.replace(/\/+$/, ''), user: file.user, token: file.token, configured: true, source: 'file' }
  }
  return { base: envBase.replace(/\/+$/, ''), user: envUser, token: envToken, configured: false, source: 'none' }
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
      // A crumb is bound to the session that issued it. Without carrying that
      // session cookie onto the POST, Jenkins answers 403 "No valid crumb".
      const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
      if (cookies.length) headers.cookie = cookies.map((c) => c.split(';')[0]).join('; ')
    } else if (response.status !== 404) {
      // CSRF-disabled instances answer 404 and need no crumb. Any other status
      // means the POST will fail with an opaque 403, so name the real cause.
      throw new DeliveryError(`Jenkins did not issue a CSRF crumb (HTTP ${response.status})`, 'CRUMB_UNAVAILABLE')
    }
  } catch (error) {
    if (error instanceof DeliveryError) throw error
    // A network failure here still leaves the build POST as authoritative.
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
  // Projects name image tags differently: web-test-7a3c647, latest-test,
  // test-0123456789ab-42. The env marker is what matters; a sha is optional and
  // recorded when present. Tags carrying a sha win over moving ones, because a
  // moving tag also appears in prose while the real artefact names its commit.
  const scored = []
  for (const match of String(text ?? '').matchAll(/\b[A-Za-z0-9][A-Za-z0-9._-]{3,79}\b/g)) {
    const token = match[0]
    if (!/(^|[-_])(test|prod)([-_]|$)/i.test(token)) continue
    let parsed
    try {
      parsed = validateTag(token)
    } catch {
      continue
    }
    scored.push({ tag: token, env: parsed.env, sha: parsed.sha, buildNumber: undefined, hasSha: Boolean(parsed.sha) })
  }
  if (scored.length === 0) return null
  const withSha = scored.filter((item) => item.hasSha)
  const pool = withSha.length ? withSha : scored
  const last = pool[pool.length - 1]
  return { tag: last.tag, env: last.env, sha: last.sha, buildNumber: last.buildNumber }
}

async function pollQueue({ queueUrl, headers, deadline, intervalMs }) {
  while (Date.now() < deadline) {
    try {
      const queue = await fetchJson(`${String(queueUrl).replace(/\/+$/, '')}/api/json`, headers)
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
      const build = await fetchJson(`${String(buildUrl).replace(/\/+$/, '')}/api/json`, headers)
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
// A run may pin its own Jenkins job, typed in when the requirement was created.
// Job names differ per project and a wrong one only surfaces as an opaque HTTP
// 404, so every caller resolves the job through this one place: the run's value
// wins over config.json, and config still supplies parameters the run did not set.
export function resolveJenkinsJob(project, env, override) {
  if (override && override.job) {
    let configured = null
    try {
      configured = jenkinsJobFor(project, env)
    } catch {
      // A project with no Jenkins config can still build when the run names a job.
      configured = null
    }
    return Object.assign({}, configured || {}, override)
  }
  return jenkinsJobFor(project, env)
}

export async function triggerBuild({ project, env, branch, waitSeconds = 120, jobOverride }) {
  const job = resolveJenkinsJob(project, env, jobOverride)
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
  const query = params.toString()
  // A job without parameters has no buildWithParameters endpoint; posting there
  // fails even with a valid crumb. Use /build when there is nothing to send.
  const triggerUrl = query ? `${baseUrl}/buildWithParameters` : `${baseUrl}/build`
  const headers = await authHeaders(base, settings.user, settings.token)
  // This job family is parameterized (Environment/Device), so a body-less POST
  // is rejected with 400 "Nothing is submitted"; values must be sent as form data.
  const form = Object.assign({}, headers, { 'content-type': 'application/x-www-form-urlencoded' })
  const response = await fetch(triggerUrl, {
    method: 'POST',
    headers: form,
    body: query || 'json={}',
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