// End-to-end check of the env switch against a throwaway workspace: the action
// must move the pointer, keep the other environment's build and merge records,
// and be reversible.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const { actions } = await import('../lib/actions.js')
const { loadRun } = await import('../lib/run.js')

const workspace = await mkdtemp(path.join(tmpdir(), 'delivery-env-'))
const projectDir = path.join(workspace, 'app')
await mkdir(projectDir, { recursive: true })
await mkdir(path.join(workspace, '.delivery', 'runs', 'r-1'), { recursive: true })

await writeFile(
  path.join(workspace, '.delivery', 'config.json'),
  JSON.stringify({
    schemaVersion: 1,
    defaults: { branchPrefix: 'feat/', envBranches: { test: 'test', prod: 'main' } },
    projects: {
      app: {
        path: projectDir,
        envBranches: { test: 'test', prod: 'main' },
        deploy: {
          test: { runner: 'notebook', notebookUrl: 'http://example/notebook', timeoutSeconds: 60 },
          prod: { runner: 'notebook', notebookUrl: 'http://example/notebook', timeoutSeconds: 60 },
        },
      },
    },
  }, null, 2),
)

await writeFile(
  path.join(workspace, '.delivery', 'runs', 'r-1', 'run.json'),
  JSON.stringify({
    schemaVersion: 1,
    id: 'r-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    requirement: { id: 'req-1', title: 'demo', docUrl: '', docUrls: [] },
    env: 'test',
    group: '',
    projects: ['app'],
    branch: 'feat/req-1-demo',
    phases: {
      intake: { status: 'passed' },
      init: { status: 'passed' },
      develop: { status: 'passed' },
      verify: { status: 'passed' },
      build: { status: 'passed' },
      deploy: { status: 'pending' },
      accept: { status: 'pending' },
      report: { status: 'pending' },
    },
    builds: { app: { env: 'test', tag: 'test-abc123-1', status: 'success' } },
    merges: { app: { project: 'app', env: 'test', target: 'test', status: 'merged' } },
  }, null, 2),
)

const toProd = await actions.env({ workspace, run: 'r-1', env: 'prod' })
assert.equal(toProd.ok, true, toProd.summary)
assert.equal(toProd.data.env, 'prod')
assert.equal(toProd.data.previous, 'test')
console.log('### switched test -> prod')
console.log(toProd.summary)

let run = await loadRun(workspace, 'r-1')
assert.equal(run.env, 'prod')
assert.equal(run.builds.app.test.tag, 'test-abc123-1', 'the test build must survive the switch')
assert.equal(run.merges.app.test.target, 'test', 'the test merge must survive the switch')

const noop = await actions.env({ workspace, run: 'r-1', env: 'prod' })
assert.equal(noop.data.changed, false)

const backToTest = await actions.env({ workspace, run: 'r-1', env: 'test' })
assert.equal(backToTest.ok, true)
run = await loadRun(workspace, 'r-1')
assert.equal(run.env, 'test')
assert.equal(run.builds.app.test.tag, 'test-abc123-1')
console.log('### switched back prod -> test, both records intact')

// prod build written under its own key while the run sits on test
const { setBuildRecord } = await import('../lib/records.js')
setBuildRecord(run, 'app', 'prod', { env: 'prod', tag: 'prod-abc123-9', status: 'success' })
assert.equal(run.builds.app.test.tag, 'test-abc123-1')
assert.equal(run.builds.app.prod.tag, 'prod-abc123-9')
console.log('### both environments keep their own build')

await actions.env({ workspace, run: 'r-1', env: 'bogus' }).then(
  () => { throw new Error('an unknown env must be refused') },
  (error) => assert.match(String(error.message), /test or prod/),
)
console.log('### unknown environment refused')
console.log('ENV SWITCH OK')