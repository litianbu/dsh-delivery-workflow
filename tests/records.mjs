// One run drives both environments: switching to prod and building there must
// not erase the test build (or the test merge), and switching back must still
// find it. Older runs stored one flat record per project, which has to keep
// reading correctly instead of disappearing behind the new dimension.
import assert from 'node:assert/strict'
import test from 'node:test'

const { allMergeRecords, buildRecordFor, mergeRecordFor, setBuildRecord, setMergeRecord } = await import('../lib/records.js')

function run(overrides = {}) {
  return Object.assign({ id: 'r1', env: 'test', projects: ['app'], builds: {}, merges: {} }, overrides)
}

test('a legacy flat build record belongs to the current environment', () => {
  const r = run({ builds: { app: { tag: 'test-abc-1', status: 'success' } } })
  assert.equal(buildRecordFor(r, 'app', 'test').tag, 'test-abc-1')
  assert.equal(buildRecordFor(r, 'app', 'prod'), null)
})

test('a legacy flat record with an explicit env is not shown under the other one', () => {
  const r = run({ builds: { app: { tag: 'prod-abc-1', status: 'success', env: 'prod' } } })
  assert.equal(buildRecordFor(r, 'app', 'prod').tag, 'prod-abc-1')
  assert.equal(buildRecordFor(r, 'app', 'test'), null)
})

test('building on prod keeps the test build, and switching back finds it', () => {
  const r = run()
  setBuildRecord(r, 'app', 'test', { env: 'test', tag: 'test-abc-1', status: 'success' })
  setBuildRecord(r, 'app', 'prod', { env: 'prod', tag: 'prod-abc-1', status: 'success' })
  assert.equal(buildRecordFor(r, 'app', 'test').tag, 'test-abc-1')
  assert.equal(buildRecordFor(r, 'app', 'prod').tag, 'prod-abc-1')
  // the reverse direction is the same fact, not a new one
  assert.equal(buildRecordFor(r, 'app', 'test').tag, 'test-abc-1')
})

test('writing a keyed record migrates the flat one instead of dropping it', () => {
  const r = run({ builds: { app: { tag: 'test-abc-1', status: 'success' } } })
  setBuildRecord(r, 'app', 'prod', { env: 'prod', tag: 'prod-abc-2', status: 'success' })
  assert.equal(buildRecordFor(r, 'app', 'test').tag, 'test-abc-1')
  assert.equal(buildRecordFor(r, 'app', 'prod').tag, 'prod-abc-2')
})

test('one environment never answers for the other when it has no record', () => {
  const r = run()
  setBuildRecord(r, 'app', 'test', { env: 'test', tag: 'test-abc-1', status: 'success' })
  assert.equal(buildRecordFor(r, 'app', 'prod'), null)
})

test('projects stay independent: a prod build of one does not touch the other', () => {
  const r = run({ projects: ['app', 'web'] })
  setBuildRecord(r, 'app', 'test', { env: 'test', tag: 'test-app-1', status: 'success' })
  setBuildRecord(r, 'web', 'prod', { env: 'prod', tag: 'prod-web-1', status: 'success' })
  assert.equal(buildRecordFor(r, 'app', 'test').tag, 'test-app-1')
  assert.equal(buildRecordFor(r, 'web', 'test'), null)
  assert.equal(buildRecordFor(r, 'app', 'prod'), null)
  assert.equal(buildRecordFor(r, 'web', 'prod').tag, 'prod-web-1')
})

test('the legacy run.build mirror still answers for a single-project run', () => {
  const r = run({ build: { tag: 'test-abc-9', status: 'success' } })
  assert.equal(buildRecordFor(r, 'app', 'test').tag, 'test-abc-9')
})

test('merges are kept per environment, both directions', () => {
  const r = run()
  setMergeRecord(r, 'app', 'test', { project: 'app', env: 'test', target: 'test', status: 'merged' })
  setMergeRecord(r, 'app', 'prod', { project: 'app', env: 'prod', target: 'main', status: 'merged' })
  assert.equal(mergeRecordFor(r, 'app', 'test').target, 'test')
  assert.equal(mergeRecordFor(r, 'app', 'prod').target, 'main')
  assert.equal(mergeRecordFor(r, 'app', 'test').target, 'test')
})

test('a flat merge record is migrated, not overwritten', () => {
  const r = run({ merges: { app: { env: 'test', target: 'test', status: 'merged' } } })
  setMergeRecord(r, 'app', 'prod', { project: 'app', env: 'prod', target: 'main', status: 'merged' })
  assert.equal(mergeRecordFor(r, 'app', 'test').target, 'test')
  assert.equal(mergeRecordFor(r, 'app', 'prod').target, 'main')
})

test('allMergeRecords sees every environment, flat or keyed', () => {
  const flat = run({ merges: { app: { env: 'test', target: 'test', status: 'merged' } } })
  assert.equal(allMergeRecords(flat).length, 1)
  const keyed = run()
  setMergeRecord(keyed, 'app', 'test', { env: 'test', target: 'test', status: 'merged' })
  setMergeRecord(keyed, 'app', 'prod', { env: 'prod', target: 'main', status: 'merged' })
  assert.equal(allMergeRecords(keyed).length, 2)
  assert.deepEqual(allMergeRecords(keyed).map((m) => m.target).sort(), ['main', 'test'])
})

test('the env action is exported for the tool dispatcher', async () => {
  const { actions } = await import('../lib/actions.js')
  assert.equal(typeof actions.env, 'function')
  assert.equal(typeof actions.build, 'function')
  assert.equal(typeof actions.deploy, 'function')
})