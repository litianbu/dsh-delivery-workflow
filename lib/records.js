// Build and merge records are stored per environment so one run can drive test
// and prod from the same card: switching environments must never let one side's
// Jenkins build or git merge overwrite the other side's history.
//
// Runs created before that dimension existed hold one flat record per project.
// Those are read as belonging to the run's current environment, and are moved
// into the keyed shape the first time a record is written.

/** A record that carries its own state, as opposed to an env-keyed container. */
export function isFlatRecord(entry) {
  return Boolean(entry && typeof entry === 'object'
    && (entry.tag || entry.status || entry.buildUrl || entry.queueUrl || entry.checkedAt))
}

/** A merge record that carries its own state. */
export function isFlatMerge(entry) {
  return Boolean(entry && typeof entry === 'object' && (entry.status || entry.target || entry.source))
}

/** The environment a stored record belongs to; older records carry no env. */
export function recordEnv(record, run) {
  return (record && record.env) || (run && run.env) || 'test'
}

/**
 * The build state of one project for one environment. `run.builds` is
 * authoritative; `run.build` stays the legacy single-project mirror the report
 * and the pre-refresh card still read.
 */
export function buildRecordFor(run, projectName, env) {
  const wanted = env || run.env || 'test'
  const builds = run.builds && typeof run.builds === 'object' ? run.builds : {}
  const entry = builds[projectName]
  if (entry && typeof entry === 'object') {
    if (isFlatRecord(entry)) return recordEnv(entry, run) === wanted ? entry : null
    return entry[wanted] || null
  }
  if (run.build && ((run.projects || []).length === 1 || run.build.project === projectName)) {
    return recordEnv(run.build, run) === wanted ? run.build : null
  }
  return null
}

/** Write the per-env project record and keep the legacy last-build mirror. */
export function setBuildRecord(run, projectName, env, record) {
  const wanted = env || run.env || 'test'
  run.builds = run.builds && typeof run.builds === 'object' ? run.builds : {}
  const entry = run.builds[projectName]
  const byEnv = {}
  if (entry && typeof entry === 'object') {
    // A flat record predates the env dimension: keep it under the run's current
    // environment instead of dropping the build that already happened.
    if (isFlatRecord(entry)) byEnv[recordEnv(entry, run)] = entry
    else Object.assign(byEnv, entry)
  }
  byEnv[wanted] = record
  run.builds[projectName] = byEnv
  run.build = record
  return record
}

/**
 * Move flat per-project records under the environment they were recorded in.
 * A switch is the one moment the old environment is known for certain, so the
 * stored shape is normalised there instead of waiting for the next write.
 */
export function adoptFlatRecords(run, env) {
  const target = env || run.env || 'test'
  for (const kind of ['builds', 'merges']) {
    const map = run[kind]
    if (!map || typeof map !== 'object') continue
    for (const [name, entry] of Object.entries(map)) {
      if (!entry || typeof entry !== 'object') continue
      const flat = kind === 'builds' ? isFlatRecord(entry) : isFlatMerge(entry)
      if (!flat) continue
      map[name] = { [(entry.env || target)]: entry }
    }
  }
  return run
}

/** The merge record of one project for one environment. */
export function mergeRecordFor(run, projectName, env) {
  const wanted = env || run.env || 'test'
  const merges = run.merges && typeof run.merges === 'object' ? run.merges : {}
  const entry = merges[projectName]
  if (!entry || typeof entry !== 'object') return null
  if (isFlatMerge(entry)) return entry
  return entry[wanted] || null
}

/** Store one merge record under its environment without dropping the others. */
export function setMergeRecord(run, projectName, env, record) {
  const wanted = env || run.env || 'test'
  run.merges = run.merges && typeof run.merges === 'object' ? run.merges : {}
  const entry = run.merges[projectName]
  const byEnv = {}
  if (entry && typeof entry === 'object') {
    if (isFlatMerge(entry)) byEnv[recordEnv(entry, run)] = entry
    else Object.assign(byEnv, entry)
  }
  byEnv[wanted] = record
  run.merges[projectName] = byEnv
  return record
}

/** Every merge record of the run, across all environments. */
export function allMergeRecords(run) {
  const merges = run.merges && typeof run.merges === 'object' ? run.merges : {}
  const out = []
  for (const entry of Object.values(merges)) {
    if (!entry || typeof entry !== 'object') continue
    if (isFlatMerge(entry)) {
      out.push(entry)
      continue
    }
    for (const record of Object.values(entry)) {
      if (record && typeof record === 'object') out.push(record)
    }
  }
  return out
}