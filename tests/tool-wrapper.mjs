// Exercises the bundle without a running DSH Agent: the registered tool
// definition (registration shape, execute() success/failure paths, render())
// and the optional webServer mount that publishes the /delivery routes.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { apply } from '../index.js'

let definition
// `inject(deps, callback)` is the only Cordis API the bundle uses besides
// tools/workingDirectory: the real Context calls the callback once the
// dependency is available, and never calls it in a host that has no such
// service. Recording the calls models that exactly, so the CLI-only shape
// stays testable and the web mount is exercised deliberately below.
const injections = []
const ctx = {
  tools: {
    register(value) {
      definition = value
    },
  },
  workingDirectory: {
    get() {
      return process.cwd()
    },
  },
  logger: { info() {} },
  inject(deps, callback) {
    injections.push({ deps, callback })
    return () => {}
  },
}

apply(ctx)

assert.ok(definition, 'apply() must register a tool')
assert.equal(injections.length, 1, 'apply() must declare exactly one injected mount')
assert.deepEqual(injections[0].deps, ['webServer'])

// A Host that does have a web server is what mounts the HTTP routes. A stub
// keeps the check honest without starting one: register() must be called with
// the /delivery prefix, and the effect must own the returned disposer.
const routes = []
const host = {
  webServer: {
    register(route) {
      routes.push(route)
      return () => {}
    },
  },
  effect(fn) {
    const dispose = fn()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  logger: { info() {} },
}
injections[0].callback(host)
assert.equal(routes.length, 1, 'the webServer mount must register one prefix route')
assert.equal(routes[0].kind, 'prefix')
assert.equal(routes[0].path, '/delivery')
assert.equal(typeof routes[0].handler, 'function')
assert.equal(definition.name, 'delivery')
assert.equal(definition.timeoutMs, 900_000)
assert.equal(definition.isConcurrencySafe(), false)
assert.deepEqual(definition.parameters.required, ['action'])
assert.equal(definition.parameters.properties.action.enum.length, 10)
assert.equal(definition.output.schema.required.includes('summary'), true)
assert.equal(definition.output.schema.properties.data.type, 'string')

const workspace = await mkdtemp(path.join(tmpdir(), 'dsh-delivery-wrapper-'))
const exec = { agent: { session: {} } }

try {
  await mkdir(path.join(workspace, '.delivery'), { recursive: true })
  await writeFile(
    path.join(workspace, '.delivery', 'config.json'),
    JSON.stringify({ projects: { fixture: { path: workspace } } }),
  )

  const status = await definition.execute({ action: 'status', workspace }, exec)
  assert.equal(status.ok, true, status.summary)
  assert.match(status.summary, /No delivery runs under/)
  assert.equal(JSON.parse(status.data).runs.length, 0)

  const rendered = definition.output.render({ action: 'status' }, status)
  assert.equal(rendered.length, 1)
  assert.equal(rendered[0].type, 'text')
  assert.ok(rendered[0].text.startsWith(status.summary))

  const unknown = await definition.execute({ action: 'not-an-action' }, exec)
  assert.equal(unknown.ok, false)
  assert.match(unknown.summary, /Unknown delivery action/)

  const empty = await definition.execute({ action: 'status', workspace: path.join(workspace, 'missing') }, exec)
  assert.equal(empty.ok, true, 'status tolerates a workspace without runs')
  assert.match(empty.summary, /No delivery runs under/)

  const missing = await definition.execute({ action: 'doctor', workspace: path.join(workspace, 'missing') }, exec)
  assert.equal(missing.ok, false)
  assert.match(missing.summary, /Missing delivery config/)
  assert.ok(missing.data.length > 0)

  const badRun = await definition.execute({ action: 'status', workspace, run: 'does-not-exist' }, exec)
  assert.equal(badRun.ok, false)
  assert.match(badRun.summary, /not found/)
  assert.equal(JSON.parse(badRun.data).code, 'RUN_NOT_FOUND')

  console.log('TOOL WRAPPER TEST PASSED')
} finally {
  await rm(workspace, { recursive: true, force: true })
}