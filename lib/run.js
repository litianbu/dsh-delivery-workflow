import { readdir } from 'node:fs/promises'
import path from 'node:path'
import {
  DeliveryError,
  appendJsonLine,
  assertSafeId,
  ensureDir,
  fileExists,
  makeRunId,
  nowIso,
  readJson,
  slugify,
  writeJson,
} from './util.js'

export const PHASES = ['intake', 'init', 'develop', 'verify', 'build', 'deploy', 'accept', 'report']

// Phases that only start once the code has been written. Seeing any of them
// move is what ends develop (see updatePhase).
const HANDOFF_PHASES = ['verify', 'build', 'deploy', 'accept', 'report']

export function runsRoot(workspace) {
  return path.join(workspace, '.delivery', 'runs')
}

export function runDir(workspace, id) {
  return path.join(runsRoot(workspace), assertSafeId(id, 'run id'))
}

/**
 * Every Feishu link the user pasted, de-duplicated. `docUrl` stays the first
 * entry so older runs and the intake summary keep working.
 */
function collectDocs(docUrls, docUrl) {
  const out = []
  const push = (value) => {
    const text = String(value ?? '').trim()
    if (text && !out.includes(text)) out.push(text)
  }
  push(docUrl)
  if (Array.isArray(docUrls)) docUrls.forEach(push)
  return out
}

export async function createRun(workspace, options) {
  const {
    requirementId,
    title,
    docUrl = '',
    docUrls,
    projects,
    env = 'test',
    group = '',
    branch,
    branchPrefix = 'feat/',
  } = options
  if (!requirementId || !title) throw new DeliveryError('new needs requirementId and title.', 'ARGS_INVALID')
  if (!Array.isArray(projects) || projects.length === 0) {
    throw new DeliveryError('new needs at least one project (or a group).', 'ARGS_INVALID')
  }
  const id = makeRunId(requirementId)
  const defaultBranch = `${branchPrefix}${slugify(requirementId, 'req')}-${slugify(title, 'change').slice(0, 40)}`
  const createdAt = nowIso()
  const run = {
    schemaVersion: 1,
    id,
    createdAt,
    updatedAt: createdAt,
    requirement: { id: requirementId, title, docUrl, docUrls: collectDocs(docUrls, docUrl) },
    env,
    group,
    projects,
    branch: branch || defaultBranch,
    phases: Object.fromEntries(
      PHASES.map((phase) => [phase, phase === 'intake' ? { status: 'running', startedAt: createdAt } : { status: 'pending' }]),
    ),
    artifacts: {},
  }
  const dir = runDir(workspace, id)
  await ensureDir(path.join(dir, 'spec'))
  await writeJson(path.join(dir, 'run.json'), run)
  await appendJsonLine(path.join(dir, 'events.ndjson'), {
    at: createdAt,
    type: 'run/created',
    requirementId,
    projects,
    env,
    branch: run.branch,
  })
  return run
}

export async function loadRun(workspace, id) {
  const dir = runDir(workspace, id)
  const file = path.join(dir, 'run.json')
  if (!(await fileExists(file))) throw new DeliveryError(`Run "${id}" not found at ${file}.`, 'RUN_NOT_FOUND')
  return readJson(file)
}

export async function saveRun(workspace, run) {
  run.updatedAt = nowIso()
  await writeJson(path.join(runDir(workspace, run.id), 'run.json'), run)
  return run
}

export async function appendEvent(workspace, run, event) {
  await appendJsonLine(path.join(runDir(workspace, run.id), 'events.ndjson'), { at: nowIso(), ...event })
}

export async function updatePhase(workspace, run, phase, patch) {
  if (!PHASES.includes(phase)) {
    throw new DeliveryError(`Unknown phase "${phase}". Known phases: ${PHASES.join(', ')}`, 'PHASE_UNKNOWN')
  }
  const current = run.phases[phase] ?? { status: 'pending' }
  const next = { ...current, ...patch, updatedAt: nowIso() }
  if (patch.status === 'running' && !next.startedAt) next.startedAt = nowIso()
  if (patch.status === 'passed' || patch.status === 'failed') next.endedAt = nowIso()
  run.phases[phase] = next

  // develop starts the moment the delivery is created (see newAction), so it
  // needs an owner for its end as well. The first later phase to move means the
  // change has been handed off, which is exactly when development is done.
  const develop = run.phases.develop
  if (phase !== 'develop' && HANDOFF_PHASES.includes(phase) && develop && develop.status === 'running') {
    const endedAt = nowIso()
    const ended = { ...develop, status: 'passed', note: develop.note || `handed off to ${phase}`, updatedAt: endedAt, endedAt }
    if (!ended.startedAt) ended.startedAt = endedAt
    run.phases.develop = ended
    await appendEvent(workspace, run, { type: 'phase/develop', ...ended })
  }

  await saveRun(workspace, run)
  await appendEvent(workspace, run, { type: `phase/${phase}`, ...next })
  return next
}

export async function listRuns(workspace, limit = 20) {
  const root = runsRoot(workspace)
  if (!(await fileExists(root))) return []
  const entries = await readdir(root, { withFileTypes: true })
  const runs = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const file = path.join(root, entry.name, 'run.json')
    if (!(await fileExists(file))) continue
    try {
      runs.push(await readJson(file))
    } catch {
      // A half-written run directory should not hide the healthy ones.
    }
  }
  return runs
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit)
}

export function phaseLine(run) {
  return PHASES.map((phase) => {
    const entry = run.phases?.[phase] ?? { status: 'pending' }
    return `${phase}=${entry.status}`
  }).join(' ')
}