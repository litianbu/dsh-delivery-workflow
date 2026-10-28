// HTTP API surface for the delivery page.
//
// The client half is a browser module: it cannot call Host services, so page
// data and page actions travel over HTTP exactly like the shipped market
// plugin does (`webServer.register` + plain `fetch`).
//
// Route space: /delivery/*
//   GET  /delivery/api/state?workspace=<abs path>   -> page payload
//   POST /delivery/api/action                       -> { action, ...args }
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const PREFIX = '/delivery'
const MAX_BODY = 1 << 20

function sendJson(response, status, body) {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  response.end(text)
}

function sendError(response, status, code, message) {
  sendJson(response, status, { ok: false, error: { code, message } })
}

async function readBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY) throw Object.assign(new Error('request body too large'), { code: 'BODY_TOO_LARGE' })
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  const raw = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(raw)
  } catch {
    throw Object.assign(new Error('request body is not valid JSON'), { code: 'BODY_NOT_JSON' })
  }
}

/** Read one `<runs>/<id>/run.json`, tolerating a partially written file. */
async function readRun(file) {
  try {
    const raw = await readFile(file, 'utf8')
    const run = JSON.parse(raw)
    if (!run || typeof run !== 'object' || typeof run.id !== 'string') return null
    return run
  } catch {
    return null
  }
}

/**
 * Runs live under `<workspace>/.delivery/runs/<runId>/run.json`.
 * A missing directory is the normal first-run state, not an error.
 */
async function listRuns(workspace) {
  const dir = join(workspace, '.delivery', 'runs')
  let names
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const runs = []
  for (const name of names) {
    if (name.startsWith('.')) continue
    const run = await readRun(join(dir, name, 'run.json'))
    if (run) runs.push(run)
  }
  runs.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  return runs
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Page payload.
 *
 * `phase` is the single current stage plus the actions that stage allows; the
 * page deliberately does not draw a progress bar, because a delivery stays
 * open and re-runnable until someone marks it finished.
 */
/**
 * `config.projects` is a map keyed by project name in the shipped config format,
 * but plain arrays appear in older drafts, so accept both.
 */
function projectEntries(config) {
  const raw = config && config.projects
  if (Array.isArray(raw)) {
    return raw
      .filter((item) => item && typeof item === 'object')
      .map((item, index) => ({ name: item.name || 'project-' + index, path: item.path || '' }))
  }
  if (raw && typeof raw === 'object') {
    return Object.keys(raw).map((name) => {
      const value = raw[name]
      return { name, path: value && typeof value === 'object' ? value.path || '' : '' }
    })
  }
  return []
}

/** Environment names come from each project's envBranches map. */
function envNames(config) {
  const names = new Set()
  for (const entry of projectEntries(config)) {
    const raw = config && config.projects
    const value = Array.isArray(raw) ? null : raw && raw[entry.name]
    const branches = value && value.envBranches
    if (branches && typeof branches === 'object') Object.keys(branches).forEach((env) => names.add(env))
  }
  if (!names.size) Object.keys((config && config.defaults && config.defaults.envBranches) || {}).forEach((env) => names.add(env))
  return Array.from(names)
}

export async function buildState(workspace) {
  const configFile = join(workspace, '.delivery', 'config.json')
  const hasConfig = await exists(configFile)
  const checks = [
    { name: 'workspace', status: (await exists(workspace)) ? 'ok' : 'error', detail: workspace },
    { name: 'config', status: hasConfig ? 'ok' : 'warn', detail: hasConfig ? configFile : 'missing .delivery/config.json' },
  ]

  let config = null
  if (hasConfig) {
    try {
      config = JSON.parse(await readFile(configFile, 'utf8'))
      const projects = projectEntries(config)
      checks.push({
        name: 'projects',
        status: projects.length ? 'ok' : 'warn',
        detail: projects.map((p) => p.name).join(', ') || 'no projects configured',
      })
    } catch (error) {
      checks.push({ name: 'config', status: 'error', detail: String(error && error.message ? error.message : error) })
    }
  }

  return {
    ok: true,
    workspace,
    config: config
      ? {
          projects: projectEntries(config),
          envs: envNames(config),
        }
      : null,
    checks,
    runs: await listRuns(workspace),
  }
}

async function handleState(request, response, url) {
  const workspace = url.searchParams.get('workspace')
  if (!workspace) return sendError(response, 400, 'WORKSPACE_REQUIRED', 'query parameter `workspace` is required')
  sendJson(response, 200, await buildState(workspace))
}

async function handleAction(request, response) {
  const body = await readBody(request)
  const action = body && body.action
  if (typeof action !== 'string' || !action) {
    return sendError(response, 400, 'ACTION_REQUIRED', 'body.action is required')
  }
  // Actions are wired incrementally; an unknown action is a clear 400 rather
  // than a silent no-op, so a stale page cannot look like it worked.
  return sendError(response, 400, 'ACTION_UNSUPPORTED', `action "${action}" is not implemented yet`)
}

/**
 * Mount the delivery routes on the harness web server.
 * @param {{ webServer: { register(route: object): () => void } }} host
 * @returns {() => void} disposer, owned by the caller's effect
 */
export function mountDeliveryApi(host) {
  return host.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: async (request, response) => {
      try {
        const url = new URL(request.url || '/', 'http://localhost')
        const path = url.pathname.slice(PREFIX.length) || '/'

        if (path === '/api/state' && request.method === 'GET') return await handleState(request, response, url)
        if (path === '/api/action' && request.method === 'POST') return await handleAction(request, response)

        return sendError(response, 404, 'NOT_FOUND', `no route for ${request.method} ${url.pathname}`)
      } catch (error) {
        const code = error && error.code ? error.code : 'INTERNAL'
        const status = code === 'BODY_TOO_LARGE' || code === 'BODY_NOT_JSON' ? 400 : 500
        sendError(response, status, code, String(error && error.message ? error.message : error))
      }
    },
  })
}