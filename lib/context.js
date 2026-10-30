// Delivery run context, injected as a system-prompt section.
//
// A delivery conversation must start already knowing which run it belongs to:
// the Feishu document URL, the branch, the project checkout and the Jenkins
// job. That used to be sent as a visible first message. It belongs in the
// system prompt instead — the model has it on every turn, and the conversation
// opens empty.
//
// The section is registered per Agent through `agent/created`, inside that
// Agent's own Cordis scope. A section registered in the Host scope would leak
// into every unrelated conversation, which is exactly why scoping matters.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Placed after the per-tool sections (the highest shipped order is 2900), so
// the run facts read last and closest to the user's request.
const SECTION_ORDER = 3000
const SECTION_NAME = 'delivery-run'

// Sessions whose section registration actually ran. The caller creates the
// conversation and then asks whether the injection happened, because a silent
// miss is otherwise indistinguishable from success — that ambiguity has already
// cost one debugging round.
const injected = new Set()

/** Whether this conversation got the run context, for the caller to report. */
export function wasInjected(sessionId) {
  const key = sessionKey(sessionId)
  return key ? injected.has(key) : false
}

function configDir() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return path.join(base, 'delivery-workflow')
}

function registryPath() {
  return path.join(configDir(), 'sessions.json')
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** Write JSON atomically so a crash cannot truncate the registry. */
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
  fs.renameSync(tmp, file)
}

// `agent.session` is normally a string, but the harness may hand out a record.
// Both spellings must resolve to the same registry key.
function sessionKey(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') return value.id || value.sessionId || ''
  return String(value)
}

/**
 * Remember which run a conversation was opened for. Written by the action that
 * creates the Session, read back when the Agent for that Session is created.
 */
export function rememberSession(sessionId, binding) {
  const key = sessionKey(sessionId)
  if (!key || !binding || !binding.workspace || !binding.runId) return
  try {
    const all = readJson(registryPath()) || {}
    all[key] = { workspace: binding.workspace, runId: binding.runId, at: new Date().toISOString() }
    writeJson(registryPath(), all)
  } catch {
    // The application registry is a convenience, never a gate: a conversation
    // that opened must not fail because this file could not be written.
  }
}

/** Drop a binding that never became a conversation. */
export function forgetSession(sessionId) {
  const key = sessionKey(sessionId)
  if (!key) return
  try {
    const all = readJson(registryPath()) || {}
    if (!(key in all)) return
    delete all[key]
    writeJson(registryPath(), all)
  } catch {
    // Best effort: a stale entry only means one learning-free conversation.
  }
}

/** The run a conversation belongs to, or null when it is an ordinary one. */
export function recallSession(sessionId) {
  const key = sessionKey(sessionId)
  if (!key) return null
  return (readJson(registryPath()) || {})[key] || null
}

function projectNames(run, config) {
  const configured = (config && config.projects) || {}
  const selected = Array.isArray(run && run.projects) ? run.projects : []
  const names = selected.map((item) => (item && typeof item === 'object' ? item.name : item)).filter(Boolean)
  return names.length ? names : Object.keys(configured)
}

function jenkinsOf(entry) {
  const jenkins = (entry && entry.jenkins) || null
  if (!jenkins) return []
  const out = []
  for (const env of Object.keys(jenkins)) {
    const job = jenkins[env]
    if (!job) continue
    const name = typeof job === 'string' ? job : job.job
    if (name) out.push(`${env}=${name}`)
  }
  return out
}

/**
 * Render the run facts. Read from disk on every assembly so a changed branch,
 * phase or build state is reflected without reopening the conversation.
 * Returns '' when the run is gone, which suppresses the section entirely.
 */
export function buildSectionText(workspace, runId) {
  const runDir = path.join(workspace, '.delivery', 'runs', runId)
  const run = readJson(path.join(runDir, 'run.json'))
  if (!run) return ''
  const config = readJson(path.join(workspace, '.delivery', 'config.json')) || {}
  const lines = [
    'This conversation was opened for one delivery run. The facts below are already established: use them directly and never ask the user to paste the Feishu link, the branch or the job name.',
    '',
    `- workspace: ${workspace}`,
    `- run: ${run.id || runId}`,
  ]
  if (run.title) lines.push(`- title: ${run.title}`)
  const docUrl = run.requirement && run.requirement.docUrl
  if (docUrl) lines.push(`- requirement document: ${docUrl}`)
  const requirementMd = path.join(runDir, 'spec', 'requirement.md')
  if (fs.existsSync(requirementMd)) lines.push(`- requirement text (already saved locally, read this file): ${requirementMd}`)
  if (run.branch) lines.push(`- branch: ${run.branch}`)
  const projects = projectNames(run, config)
  const configured = (config && config.projects) || {}
  for (const name of projects) {
    const entry = configured[name] || {}
    const parts = []
    if (entry.path) parts.push(entry.path)
    const jobs = jenkinsOf(entry)
    if (jobs.length) parts.push(`jenkins ${jobs.join(', ')}`)
    if (parts.length) lines.push(`- project ${name}: ${parts.join(' — ')}`)
  }
  lines.push('')
  lines.push(
    'When the user asks to analyse the requirement, start on it, or asks what it says, read the requirement text above (or fetch the Feishu document with the delivery tool, action doc) before answering. The delivery tool drives this run; pass its run id.',
  )
  return lines.join('\n')
}

// Resolve the prompt registry off a context.
//
// This must be a property read, never `ctx.get('systemPrompt')`: `section()`
// registers through `this.ctx` — the caller-bound context the property read
// produces — so a `get()` result carries the service's own context and would
// land in the global layer, showing one run's facts in every conversation.
// The read only works for a declared dependency, which is why `systemPrompt` is
// in this plugin's `inject` list.
function resolvePrompt(source) {
  if (!source) return null
  try {
    const prompt = source.systemPrompt
    if (prompt && typeof prompt.section === 'function') return prompt
  } catch {
    // Not a context that declares the dependency.
  }
  return null
}

/**
 * Register the injection hook. Called once from the Host half's apply().
 * The handler runs for every Agent; ordinary conversations have no binding and
 * are left untouched.
 */
export function registerDeliveryContext(ctx) {
  // A context without an event bus (a tool-only harness, or a unit-test double)
  // simply gets no injection instead of failing activation.
  if (typeof ctx.on !== 'function') return
  ctx.on('agent/created', function onAgentCreated(payload) {
    const agent = payload && payload.agent
    if (!agent) return
    try {
      // `agent.id` is the documented identity and equals `agent.session.id`;
      // `sessionKey` normalises either shape.
      const binding = recallSession(agent.id || agent.session)
      if (!binding) return
      // Prefer the handler's own scoped context: registering there is what makes
      // the section apply to this Agent alone.
      const candidates = [this, agent.ctx]
      let prompt = null
      for (const source of candidates) {
        prompt = resolvePrompt(source)
        if (prompt) break
      }
      if (!prompt) {
        ctx.logger?.warn?.('delivery-workflow: systemPrompt is unavailable; run context not injected')
        return
      }
      prompt.section({
        name: SECTION_NAME,
        order: SECTION_ORDER,
        text: () => buildSectionText(binding.workspace, binding.runId),
      })
      injected.add(sessionKey(agent.id || agent.session))
      ctx.logger?.info?.(`delivery-workflow: injected run ${binding.runId} into this conversation`)
    } catch (error) {
      // Injection is an enhancement: a failure here must never break the Agent.
      ctx.logger?.warn?.(`delivery-workflow: cannot inject the run context: ${error && error.message ? error.message : error}`)
    }
  })
}