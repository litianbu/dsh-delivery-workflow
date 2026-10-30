// Verifies the invisible run context: the session->run binding round-trips, the
// rendered facts carry everything the model must already know, and an ordinary
// conversation gets no section at all.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Redirect the registry before importing: configDir() reads this at call time.
process.env.XDG_CONFIG_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-config-'))

const ctxModule = await import('../lib/context.js')
const { rememberSession, recallSession, buildSectionText, registerDeliveryContext } = ctxModule

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-workspace-'))
const runId = '20261030-120000-tongxi-demo'
const runDir = path.join(workspace, '.delivery', 'runs', runId)
const requirementMd = path.join(runDir, 'spec', 'requirement.md')

fs.mkdirSync(path.join(runDir, 'spec'), { recursive: true })
fs.writeFileSync(path.join(workspace, '.delivery', 'config.json'), JSON.stringify({
  projects: {
    'tongxi-biomap': {
      path: '/Users/example/tongxi-biomap',
      jenkins: { test: { job: 'tongxi-biomap-test' }, prod: { job: 'tongxi-biomap-prod' } },
    },
  },
}))
fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({
  id: runId,
  title: '需求：新增登录页',
  env: 'test',
  branch: 'feat/TONGXI-9-login',
  projects: ['tongxi-biomap'],
  requirement: { id: 'TONGXI-9', title: '新增登录页', docUrl: 'https://biomap.feishu.cn/wiki/abc123' },
}))
fs.writeFileSync(requirementMd, '# 新增登录页\n\n正文\n')

test('the binding round-trips through the registry', () => {
  rememberSession('sess-1', { workspace, runId })
  const found = recallSession('sess-1')
  assert.equal(found.workspace, workspace)
  assert.equal(found.runId, runId)
  assert.equal(recallSession('sess-ordinary'), null)
})

test('the facts name the document, the local copy, the branch and the job', () => {
  const text = buildSectionText(workspace, runId)
  assert.ok(text.includes('https://biomap.feishu.cn/wiki/abc123'), 'document url')
  assert.ok(text.includes(requirementMd), 'local requirement path')
  assert.ok(text.includes('feat/TONGXI-9-login'), 'branch')
  assert.ok(text.includes('tongxi-biomap-test'), 'jenkins job')
  assert.ok(text.includes('/Users/example/tongxi-biomap'), 'project path')
  assert.ok(text.includes('never ask the user to paste the Feishu link'), 'behaviour line')
})

test('a deleted run renders nothing instead of a stale claim', () => {
  assert.equal(buildSectionText(workspace, 'no-such-run'), '')
})

test('only a bound conversation receives the section', async () => {
  const sections = []
  const scoped = { systemPrompt: { section: (value) => sections.push(value) } }
  let handler = null
  registerDeliveryContext({ on: (event, fn) => { if (event === 'agent/created') handler = fn } })
  assert.equal(typeof handler, 'function')

  // An ordinary conversation: no binding, so nothing is registered.
  await handler.call(scoped, { agent: { session: 'sess-ordinary' } })
  assert.equal(sections.length, 0)

  // The conversation opened for the run: one section, rendered from disk.
  await handler.call(scoped, { agent: { session: 'sess-1' } })
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'delivery-run')
  assert.equal(sections[0].order, 3000)
  assert.ok(sections[0].text().includes('TONGXI-9'))
})

test('a harness without an event bus does not fail activation', () => {
  assert.doesNotThrow(() => registerDeliveryContext({}))
})
