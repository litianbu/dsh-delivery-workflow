import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { actions } from '../lib/actions.js'
import { loadRun } from '../lib/run.js'

/**
 * Multi-project build and deploy: every project has its own branch and image
 * tag, so a build/deploy must read the project's own record and never the last
 * one written. The fixture gives the two projects different env branches
 * (`test` / `develop`) and different build tags on purpose.
 */

const workspace = '/tmp/dsh-multi-workspace'
const fixture = '/tmp/dsh-multi-fixture'

function q(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function sh(command, cwd) {
  const response = spawnSync('/bin/bash', ['-lc', command], { cwd, encoding: 'utf8' })
  if (response.status !== 0) {
    throw new Error(`command failed (${response.status}): ${command}\n${response.stdout}\n${response.stderr}`)
  }
  return `${response.stdout ?? ''}`.trim()
}

function makeRepo(name, envBranch) {
  const remote = path.join(fixture, `${name}.git`)
  const repo = path.join(fixture, name)
  sh(`git init --bare ${q(remote)}`)
  sh(`git clone ${q(remote)} ${q(repo)}`)
  sh('git config user.email multi-test@example.com', repo)
  sh('git config user.name Multi Test', repo)
  fs.writeFileSync(path.join(repo, 'README.md'), '# fixture\n')
  sh('git add README.md && git commit -m initial', repo)
  sh('git branch -M main', repo)
  sh('git push -u origin main', repo)
  sh(`git checkout -b ${envBranch}`, repo)
  sh(`git push -u origin ${envBranch}`, repo)
  sh('git checkout main', repo)
  return { repo, envBranch }
}

function setupFixture() {
  fs.rmSync(workspace, { recursive: true, force: true })
  fs.rmSync(fixture, { recursive: true, force: true })
  fs.mkdirSync(path.join(workspace, '.delivery'), { recursive: true })
  fs.mkdirSync(fixture, { recursive: true })
  const alpha = makeRepo('alpha', 'test')
  const beta = makeRepo('beta', 'develop')
  const deploy = () => ({ runner: 'local', script: '/usr/bin/true', args: [], timeoutSeconds: 5 })
  const config = {
    schemaVersion: 1,
    defaults: { branchPrefix: 'feat/', envBranches: { test: 'test', prod: 'main' }, timeoutMinutes: 5 },
    projects: {
      alpha: { path: alpha.repo, envBranches: { test: 'test', prod: 'main' }, deploy: { test: deploy() } },
      beta: { path: beta.repo, envBranches: { test: 'develop', prod: 'main' }, deploy: { test: deploy() } },
    },
  }
  fs.writeFileSync(path.join(workspace, '.delivery', 'config.json'), `${JSON.stringify(config, null, 2)}\n`)
  return { alpha, beta }
}

async function main() {
  const { alpha, beta } = setupFixture()

  const created = await actions.new({
    workspace,
    requirementId: 'MULTI-1',
    title: 'Multi fixture',
    projects: ['alpha', 'beta'],
    env: 'test',
    createBranch: true,
  })
  assert.equal(created.ok, true, created.summary)
  const runId = created.data.run
  const branch = created.data.branch
  console.log(`\n### multi run ${runId} branch=${branch}`)
  for (const [repo, file] of [[alpha.repo, 'alpha.txt'], [beta.repo, 'beta.txt']]) {
    fs.writeFileSync(path.join(repo, file), `${file}\n`)
    sh(`git add ${file} && git commit -m ${q(`feature ${file}`)}`, repo)
  }
  const merged = await actions.merge({ workspace, run: runId })
  assert.equal(merged.ok, true, merged.summary)

  // A multi-project run cannot silently pick one project to build or deploy.
  await assert.rejects(() => actions.build({ workspace, run: runId }), /pass project/)
  await assert.rejects(() => actions.deploy({ workspace, run: runId }), /pass project/)
  console.log('### build/deploy without project is refused: ok')

  const alphaTag = `test-${sh('git rev-parse --short=12 origin/test', alpha.repo)}-1`
  const betaTag = `test-${sh('git rev-parse --short=12 origin/develop', beta.repo)}-1`
  const alphaBuild = await actions.build({ workspace, run: runId, project: 'alpha', tag: alphaTag })
  assert.equal(alphaBuild.ok, true, alphaBuild.summary)
  let run = await loadRun(workspace, runId)
  assert.equal(run.builds.alpha.tag, alphaTag)
  assert.equal(run.builds.beta, undefined)
  assert.equal(run.phases.build.status, 'running', 'one of two projects built is not a finished build phase')
  console.log('### alpha built; phase waits for beta: ok')

  const betaBuild = await actions.build({ workspace, run: runId, project: 'beta', tag: betaTag })
  assert.equal(betaBuild.ok, true, betaBuild.summary)
  run = await loadRun(workspace, runId)
  assert.equal(run.builds.beta.tag, betaTag)
  assert.equal(run.phases.build.status, 'passed')
  assert.ok(fs.existsSync(path.join(workspace, '.delivery', 'runs', runId, 'build', 'alpha.json')))
  assert.ok(fs.existsSync(path.join(workspace, '.delivery', 'runs', runId, 'build', 'beta.json')))
  console.log('### beta built; phase passed: ok')

  // Deploy alpha must use alpha's tag even though run.build (the legacy mirror)
  // now holds beta's record.
  const alphaPreview = await actions.deploy({ workspace, run: runId, project: 'alpha', dryRun: true })
  assert.equal(alphaPreview.ok, true, alphaPreview.summary)
  assert.equal(alphaPreview.data.tag, alphaTag)
  const alphaDeploy = await actions.deploy({ workspace, run: runId, project: 'alpha' })
  assert.equal(alphaDeploy.ok, true, alphaDeploy.summary)
  assert.ok(fs.existsSync(path.join(workspace, '.delivery', 'runs', runId, 'deploy', 'alpha-test.json')))
  assert.equal(JSON.parse(fs.readFileSync(path.join(workspace, '.delivery', 'runs', runId, 'deploy', 'alpha-test.json'), 'utf8')).tag, alphaTag)

  // A tag that belongs to the other project is refused, not silently deployed.
  await assert.rejects(
    () => actions.deploy({ workspace, run: runId, project: 'alpha', tag: betaTag }),
    /does not match the recorded build/,
  )

  const betaDeploy = await actions.deploy({ workspace, run: runId, project: 'beta' })
  assert.equal(betaDeploy.ok, true, betaDeploy.summary)
  assert.equal(JSON.parse(fs.readFileSync(path.join(workspace, '.delivery', 'runs', runId, 'deploy', 'beta-test.json'), 'utf8')).tag, betaTag)
  console.log('### per-project deploy records and tags: ok')

  const report = await actions.report({ workspace, run: runId })
  assert.equal(report.ok, true, report.summary)
  const markdown = fs.readFileSync(path.join(workspace, '.delivery', 'runs', runId, 'report.md'), 'utf8')
  assert.match(markdown, new RegExp(`\\| alpha \\|[^\\n]*${alphaTag}`))
  assert.match(markdown, new RegExp(`\\| beta \\|[^\\n]*${betaTag}`))
  assert.match(markdown, /\| alpha \| feat\/multi-1-multi-fixture \| test \| merged \|/)
  assert.match(markdown, /\| beta \| feat\/multi-1-multi-fixture \| develop \| merged \|/)
  console.log('### report keeps both projects apart: ok')

  // The notebook panel is fed by run.deployPlans[project][env]; keys must not
  // collide when two projects in one run deploy by hand.
  const configFile = path.join(workspace, '.delivery', 'config.json')
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  config.projects.beta.deploy.test = {
    runner: 'notebook',
    remotePath: '/opt/deploy',
    script: 'deploy.sh',
    args: ['{tag}'],
    notebookUrl: 'https://notebook.example/beta',
  }
  fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`)
  const betaManual = await actions.deploy({ workspace, run: runId, project: 'beta' })
  assert.equal(betaManual.ok, false)
  assert.equal(betaManual.data.status, 'manual')
  run = await loadRun(workspace, runId)
  assert.ok(run.deployPlans && run.deployPlans.beta && run.deployPlans.beta.test, 'beta plan lives under beta')
  assert.match(run.deployPlans.beta.test.command, new RegExp(betaTag))
  assert.equal(run.deployPlan.test.command, run.deployPlans.beta.test.command)
  assert.equal(run.deployPlans.alpha, undefined, 'alpha must not inherit beta notebook plan')
  console.log('### per-project notebook plans: ok')

  console.log('\nMULTI TEST PASSED')
}

main().catch((error) => {
  console.error('\nMULTI TEST FAILED')
  console.error(error)
  process.exit(1)
})