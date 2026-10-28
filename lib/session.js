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
  if (opts.cwd) request.cwd = opts.cwd
  const created = await service.create(request)
  const sessionId = created && created.sessionId
  if (!sessionId) {
    throw new DeliveryError('session service returned no session id.', 'SESSION_CREATE_FAILED')
  }
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
  return { sessionId, titled }
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