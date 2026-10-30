// Opening a real DSH conversation for a delivery run.
//
// The page is served by the Host, so it uses the same service the GUI's own
// "new conversation" action uses: ctx.sessionController.create(). Nothing is
// simulated — a missing service or a rejected create is a loud error.
//
// The Host context is captured once by mountDeliveryApi() instead of being
// threaded through every action call, so a caller never has to pass it.
import { DeliveryError } from './util.js'

let hostContext = null

/** Remember the Host context so later action calls can reach Host services. */
export function setHostContext(ctx) {
  hostContext = ctx || null
}

/** The captured Host context, or null when the Host half is not mounted. */
export function getHostContext() {
  return hostContext
}

function sessionService(ctx) {
  const source = ctx || hostContext
  if (!source) return null
  if (typeof source.get === 'function') {
    const found = source.get('sessionController')
    if (found) return found
  }
  return source.sessionController || null
}

function workspaceService(ctx) {
  const source = ctx || hostContext
  if (!source) return null
  if (typeof source.get === 'function') {
    const found = source.get('workspaceRegistry')
    if (found) return found
  }
  return source.workspaceRegistry || null
}

// Workspace lookup is best-effort: it must never delay or block opening the
// conversation. A slow or wedged registry degrades to the plain-cwd behaviour
// instead of hanging the action until the client gives up and never navigates.
const WORKSPACE_LOOKUP_TIMEOUT_MS = 2500

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`workspace lookup timed out after ${ms}ms`))
    }, ms)
    if (timer && typeof timer.unref === 'function') timer.unref()
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/**
 * Create one ordinary Session (a new conversation) for this delivery.
 * `cwd` places it in the project working copy, exactly like the GUI does.
 */
export async function createDeliverySession(ctx, options) {
  const opts = options || {}
  const service = sessionService(ctx)
  if (!service || typeof service.create !== 'function') {
    throw new DeliveryError(
      'session service is unavailable in this Host; cannot open a new conversation.',
      'SESSION_UNAVAILABLE',
    )
  }
  const request = {}
  // A Session belongs to a Workspace, not to a bare cwd. Creating it with only
  // `cwd` leaves the conversation in whatever Workspace the window was showing,
  // so the project's Workspace stays empty. Resolve or create the Workspace that
  // owns this directory (registry.create is idempotent per canonical path) and
  // bind the Session to it.
  let workspaceId = null
  let workspaceBound = false
  let workspaceWarning = null
  if (opts.cwd) {
    const registry = workspaceService(ctx)
    if (!registry || typeof registry.create !== 'function') {
      workspaceWarning = 'workspace registry is unavailable; the conversation may open in the current workspace'
    } else {
      try {
        const workspace = await withTimeout(registry.create(opts.cwd), WORKSPACE_LOOKUP_TIMEOUT_MS)
        if (workspace && workspace.id) {
          request.workspaceId = workspace.id
          workspaceId = workspace.id
          workspaceBound = true
          // Deliberately no `cwd` next to `workspaceId`: the Workspace already
          // fixes the directory, and sending both made create() reject — which is
          // why the conversation stopped opening at all.
        } else {
          workspaceWarning = `workspace registry returned no workspace for ${opts.cwd}`
        }
      } catch (error) {
        workspaceWarning = `cannot bind a workspace for ${opts.cwd}: ${String(error && error.message ? error.message : error)}`
      }
    }
  }
  // Only fall back to a bare cwd when no Workspace could be bound.
  if (!workspaceBound && opts.cwd) request.cwd = opts.cwd
  // The harness builds the Agent *inside* create() and runs its `agent/created`
  // listeners before returning, so a binding recorded afterwards is always too
  // late. Pre-generating the id lets the caller persist the binding first.
  if (opts.sessionId) request.sessionId = opts.sessionId
  let created
  try {
    created = await service.create(request)
  } catch (error) {
    if (!opts.sessionId) throw error
    // A rejected id must not cost the user the conversation.
    delete request.sessionId
    created = await service.create(request)
  }
  const sessionId = created && created.sessionId
  if (!sessionId) {
    throw new DeliveryError('session service returned no session id.', 'SESSION_CREATE_FAILED')
  }
  // Binding happens through `workspaceId` plus the canonical `cwd`, which is what
  // the registry indexes membership by. No separate attach call: it is
  // speculative, and awaiting it is exactly what would delay the conversation.
  // Titling is a nicety: the conversation exists either way, so a rename
  // failure must not turn a created session into a reported error.
  let titled = false
  if (opts.title && typeof service.rename === 'function') {
    try {
      await service.rename({ sessionId, title: opts.title })
      titled = true
    } catch {
      titled = false
    }
  }
  // SessionCreateRequest has no initial-prompt field, so the requirement is
  // delivered as the conversation's first user message through session/prompt
  // (SessionPromptRequest: requestId, sessionId, mode, content).
  let prompted = false
  let promptError = null
  if (opts.openingMessage) {
    if (typeof service.prompt === 'function') {
      try {
        // prompt(request, signal): signal is a required second argument.
        // Omitting it crashed inside the host on signal.throwIfAborted(), so the
        // session opened empty and the model went exploring the project instead
        // of reading the requirement document.
        const controller = new AbortController()
        await service.prompt({
          requestId: opts.requestId || 'delivery-open-' + sessionId,
          sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: String(opts.openingMessage) }],
        }, controller.signal)
        prompted = true
      } catch (error) {
        promptError = String(error && error.message ? error.message : error)
      }
    } else {
      promptError = 'sessionController.prompt is not available in this build'
    }
  }

  return { sessionId, titled, prompted, promptError, workspaceId, workspaceBound, workspaceWarning }
}

/**
 * Resolve a configured project's checkout path. Tolerates both a name-keyed
 * map and an array of `{ name, path }` entries.
 */
export function projectPathOf(config, name) {
  const projects = (config && config.projects) || null
  if (!projects) return ''
  if (Array.isArray(projects)) {
    const found = projects.filter((item) => item && item.name === name)[0]
    return (found && found.path) || ''
  }
  const entry = projects[name]
  return (entry && entry.path) || ''
}