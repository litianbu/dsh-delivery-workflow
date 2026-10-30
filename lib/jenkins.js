import { DeliveryError, redact, sleep, tail } from './util.js'

const TAG_RE = /^(test|prod)-([0-9a-f]{12})-(\d+)$/
const LOOSE_TAG_RE = /^(?:(.*)-)?(test|prod)(?:-([0-9a-f]{7,40}))?(?:-(\d+))?$/
// A cancelled or superseded build is not the same thing as a failed one: it
// usually means a newer build is coming, so it is a warning, not an error.
const ABORTED_RESULTS = new Set(['ABORTED', 'NOT_BUILT'])
// Jenkins timestamps have second granularity and the two clocks may differ;
// this is the tolerance used when a build number anchor is unavailable.
const TRIGGER_SLACK_MS = 5000

/**
 * Read an image tag into { tag, env, sha }.
 *
 * This deliberately does not reject anything. Projects name image tags
 * differently — web-test-7a3c647, latest-test, test-0123456789ab-42, or
 * something with no environment marker at all — so the only thing that can be
 * stated here is what the tag happens to contain. Whether that matches the
 * environment being deployed to is the caller's question, because only the
 * caller knows which environment it was asked for.
 */
export function parseImageTag(tag) {
  const value = String(tag ?? '')
  const lower = value.toLowerCase()
  const hits = []
  const re = /test|prod/g
  let match
  while ((match = re.exec(lower)) !== null) hits.push(match[0])
  const env = hits.length ? hits[hits.length - 1] : undefined
  const sha = /[0-9a-f]{7,40}/.exec(lower)
  return { tag: value, env, sha: sha ? sha[0] : undefined, buildNumber: undefined }
}

export function tagMatchesSha(tag, sha) {
  const parsed = parseImageTag(tag)
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
    const error = new DeliveryError(`Jenkins request failed: HTTP ${response.status} ${body}`, 'JENKINS_HTTP_ERROR')
    // Callers must tell "this queue item no longer exists" (final) apart from
    // "the network hiccuped" (retry). Without the status they retry a 404 until
    // the deadline while Jenkins has no build at all.
    error.status = response.status
    throw error
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
    const parsed = parseImageTag(token)
    scored.push({ tag: token, env: parsed.env, sha: parsed.sha, buildNumber: undefined, hasSha: Boolean(parsed.sha) })
  }
  if (scored.length === 0) return null
  const withSha = scored.filter((item) => item.hasSha)
  const pool = withSha.length ? withSha : scored
  const last = pool[pool.length - 1]
  return { tag: last.tag, env: last.env, sha: last.sha, buildNumber: last.buildNumber }
}

async function pollBuildUrl({ buildUrl, headers, deadline, intervalMs, expectedEnv, queuedOn404 }) {
  // Check first, decide afterwards: with waitSeconds=0 the deadline is already
  // in the past, and a click must still get one real answer from Jenkins.
  for (;;) {
    try {
      const build = await fetchJson(`${String(buildUrl).replace(/\/+$/, '')}/api/json`, headers)
      if (build?.building) {
        if (Date.now() + intervalMs > deadline) return { status: 'running', buildUrl, buildNumber: build?.number }
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
      const aborted = ABORTED_RESULTS.has(build?.result)
      const envWarning =
        parsed && expectedEnv && parsed.env !== expectedEnv
          ? `Build produced a ${parsed.env} tag while ${expectedEnv} was requested.`
          : undefined
      return {
        status: ok ? 'success' : (aborted ? 'aborted' : 'failed'),
        result: build?.result ?? 'UNKNOWN',
        buildNumber: build?.number,
        buildUrl,
        timestamp: build?.timestamp,
        tag: parsed?.tag,
        tagEnv: parsed?.env,
        tagSha: parsed?.sha,
        envWarning,
        consoleTail: tail(consoleText, 3000),
      }
    } catch (error) {
      // A build number that does not exist yet means it is still queued.
      if (queuedOn404 && error?.status === 404) {
        if (Date.now() + intervalMs > deadline) return { status: 'queued', buildUrl }
        await sleep(intervalMs)
        continue
      }
      // A build URL can briefly 404 right after the queue hands it over.
      if (Date.now() + intervalMs > deadline) return { status: 'running', buildUrl }
      await sleep(intervalMs)
    }
  }
}

async function lastBuildInfo({ baseUrl, headers }) {
  const body = await fetchJson(`${baseUrl}/api/json?tree=lastBuild[number,result,building,url,timestamp]`, headers)
  const last = body?.lastBuild
  if (!last?.url) return null
  return {
    number: Number(last.number) || 0,
    result: last.result ?? null,
    building: Boolean(last.building),
    buildUrl: new URL(last.url, baseUrl).toString(),
    timestamp: Number(last.timestamp) || 0,
  }
}

/**
 * Wait for the build this trigger created.
 *
 * Jenkins assigns a build number when the build STARTS, not when the item is
 * queued, so immediately after the POST `nextBuildNumber - 1` still points at
 * the PREVIOUS build. Polling that reported an old ABORTED result as this
 * trigger's outcome while the real build was still queued. Build numbers are
 * monotonic, so the number read before the POST is the reliable anchor; the
 * timestamp is only the fallback when that lookup failed.
 */
async function waitForTriggeredBuild({ baseUrl, headers, minNumber, sinceMs, deadline, intervalMs = 2000 }) {
  for (;;) {
    const last = await lastBuildInfo({ baseUrl, headers })
    if (last) {
      // A number >= the pre-POST anchor should mean "started after we
      // triggered", but a stale/absent anchor would otherwise adopt a build
      // that was already running — that is how an unrelated build gets reported
      // as this click's. Require it to have started around our trigger time too.
      const fresh = !last.timestamp || last.timestamp + TRIGGER_SLACK_MS >= Number(sinceMs)
      const byNumber = minNumber > 0 && last.number >= minNumber && fresh
      const byTime = minNumber <= 0 && fresh
      if (byNumber || byTime) return last
    }
    if (Date.now() + intervalMs > deadline) return null
    await sleep(intervalMs)
  }
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
  // Anything the job started after this instant belongs to this trigger.
  const triggeredAt = Date.now()
  // Read the number anchor BEFORE the POST: the job's next number is the number
  // our build will be given once Jenkins starts it.
  let nextNumber = 0
  try {
    const info = await fetchJson(`${baseUrl}/api/json?tree=nextBuildNumber`, headers)
    nextNumber = Number(info?.nextBuildNumber) || 0
  } catch {
    // Fall back to the timestamp check in waitForTriggeredBuild.
  }
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
  // Do not follow the queue item: this account gets 403 while the item is
  // pending and 404 once Jenkins starts it, so queue polling can never see the
  // build. Ask the job for the first build at/after our anchor instead; that is
  // the build this trigger created.
  const started = await waitForTriggeredBuild({
    baseUrl,
    headers,
    minNumber: nextNumber,
    sinceMs: triggeredAt,
    deadline,
  })
  if (!started) {
    return {
      status: 'queued',
      triggerUrl: redact(triggerUrl),
      queueUrl,
      params: Object.fromEntries(params),
      jobBase: baseUrl,
      waitSeconds: wait,
      nextBuildNumber: nextNumber || undefined,
    }
  }
  let build = await pollBuildUrl({
    buildUrl: started.buildUrl,
    headers,
    deadline,
    intervalMs: 2000,
    expectedEnv: env,
    queuedOn404: true,
  })
  // A cancelled build is often followed by the replacement build that actually
  // ran (Jenkins aborts the previous build when a newer one starts). Follow the
  // newer number instead of reporting the cancellation as this trigger's result.
  if (['queued', 'aborted'].includes(build.status) && started.number) {
    const newer = await waitForTriggeredBuild({
      baseUrl,
      headers,
      minNumber: started.number + 1,
      sinceMs: triggeredAt,
      deadline,
    })
    if (newer) {
      build = await pollBuildUrl({
        buildUrl: newer.buildUrl,
        headers,
        deadline,
        intervalMs: 2000,
        expectedEnv: env,
      })
    }
  }
  return {
    ...build,
    triggerUrl: redact(triggerUrl),
    queueUrl,
    params: Object.fromEntries(params),
    jobBase: baseUrl,
  }
}

/**
 * The newest build of one job, or null when it is older than `sinceMs`.
 * A queue item disappears the moment Jenkins starts building it, which leaves
 * the caller holding a dead queue URL. This is how that case recovers: the job
 * itself knows what it just started.
 */
export async function latestBuild({ job, sinceMs }) {
  const settings = jenkinsSettings()
  if (!settings.configured) return null
  const headers = await authHeaders(settings.base, settings.user, settings.token)
  const url = `${jobBase(settings.base, job.job ?? job)}/api/json?tree=lastBuild[number,result,building,url,timestamp]`
  try {
    const body = await fetchJson(url, headers)
    const last = body?.lastBuild
    if (!last || !last.url) return null
    if (sinceMs && Number(last.timestamp) + 1000 < Number(sinceMs)) return null
    return {
      number: last.number,
      result: last.result,
      building: Boolean(last.building),
      buildUrl: new URL(last.url, settings.base).toString(),
      timestamp: last.timestamp,
    }
  } catch {
    // Recovery is best effort: a failed lookup must not masquerade as a result.
    return null
  }
}

/**
 * Poll an already-triggered build. Pass buildUrl once Jenkins reported one, or
 * queueUrl while the item is still queued. waitSeconds=0 checks once.
 */
export async function pollBuild({ buildUrl, queueUrl, env, job, sinceMs, waitSeconds = 120 }) {
  const settings = jenkinsSettings()
  if (!settings.configured) {
    throw new DeliveryError('Jenkins is not configured for polling.', 'JENKINS_NOT_CONFIGURED')
  }
  const base = settings.base
  const headers = await authHeaders(base, settings.user, settings.token)
  const wait = Math.max(0, Math.min(Number(waitSeconds) || 0, 600))
  const deadline = Date.now() + wait * 1000
  let target = buildUrl ? new URL(buildUrl, base).toString() : ''
  if (!target) {
    // The queue item endpoint answers 403 while pending and 404 once started
    // for this account, so it cannot be followed. Ask the job which build it
    // started after our trigger instead.
    const last = job && sinceMs ? await latestBuild({ job, sinceMs }) : null
    if (last) {
      target = last.buildUrl
    } else {
      // Nothing identifiable yet: still queued, or the pointer is untrustworthy.
      return { status: 'queued', queueUrl: queueUrl ? new URL(queueUrl, base).toString() : null }
    }
  }
  return pollBuildUrl({
    buildUrl: target,
    headers,
    deadline,
    intervalMs: 2000,
    expectedEnv: env,
  })
}