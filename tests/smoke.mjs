import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { actions } from '../lib/actions.js'

const workspace = '/tmp/dsh-delivery-workspace'
const fixture = '/tmp/dsh-delivery-fixture'
const repo = path.join(fixture, 'repo')
const remote = path.join(fixture, 'remote.git')

function sh(command, cwd) {
  const response = spawnSync('/bin/bash', ['-lc', command], { cwd, encoding: 'utf8' })
  if (response.status !== 0) {
    throw new Error(`command failed (${response.status}): ${command}\n${response.stdout}\n${response.stderr}`)
  }
  return `${response.stdout ?? ''}`.trim()
}

function currentBranch() {
  return sh('git rev-parse --abbrev-ref HEAD', repo)
}

function setupFixture() {
  fs.rmSync(workspace, { recursive: true, force: true })
  fs.rmSync(fixture, { recursive: true, force: true })
  fs.mkdirSync(path.join(workspace, '.delivery'), { recursive: true })
  fs.mkdirSync(fixture, { recursive: true })

  sh(`git init --bare ${JSON.stringify(remote)}`)
  sh(`git clone ${JSON.stringify(remote)} ${JSON.stringify(repo)}`)
  sh('git config user.email delivery-test@example.com', repo)
  sh('git config user.name Delivery Test', repo)
  fs.writeFileSync(path.join(repo, 'README.md'), '# fixture\n')
  sh('git add README.md && git commit -m "initial"', repo)
  sh('git branch -M main', repo)
  sh('git push -u origin main', repo)
  sh('git checkout -b test', repo)
  sh('git push -u origin test', repo)
  sh('git checkout main', repo)

  const config = {
    schemaVersion: 1,
    defaults: { branchPrefix: 'feat/', envBranches: { test: 'test', prod: 'main' }, timeoutMinutes: 5 },
    projects: {
      fixture: {
        path: repo,
        envBranches: { test: 'test', prod: 'main' },
        setup: ['echo setup-ok'],
        checks: [
          { name: 'echo', run: 'echo check-ok', required: true, timeoutMinutes: 2 },
          {
            name: 'feature-branch',
            run: 'test "$(git rev-parse --abbrev-ref HEAD)" = "feat/tongxi-1-fixture-change"',
            required: true,
            timeoutMinutes: 2,
          },
        ],
        jenkins: {
          test: { job: 'fixture-test', params: { DEPLOY_ENV: 'test' } },
          prod: { job: 'fixture-prod', params: { DEPLOY_ENV: 'prod' } },
        },
        deploy: {
          test: {
            runner: 'local',
            script: '/usr/bin/true',
            args: ['test', '{tag}'],
            healthUrl: '',
            timeoutSeconds: 5,
          },
          prod: {
            runner: 'local',
            preview: { script: '/bin/echo', args: ['preview', '{tag}'] },
            apply: { script: '/usr/bin/true', args: ['{tag}', '--apply'] },
            healthUrl: '',
            timeoutSeconds: 5,
          },
        },
      },
    },
    groups: { fixture: ['fixture'] },
  }
  fs.writeFileSync(path.join(workspace, '.delivery', 'config.json'), `${JSON.stringify(config, null, 2)}\n`)
}

function show(label, outcome) {
  console.log(`\n### ${label} (ok=${outcome.ok})`)
  console.log(outcome.summary)
}

async function main() {
  setupFixture()

  const doctor = await actions.doctor({ workspace })
  assert.equal(doctor.ok, true, doctor.summary)
  show('doctor', doctor)

  const created = await actions.new({
    workspace,
    requirementId: 'TONGXI-1',
    title: 'Fixture change',
    projects: ['fixture'],
    env: 'test',
  })
  assert.equal(created.ok, true, created.summary)
  const run = created.data.run
  show('new', created)

  const withQuestion = await actions.intake({
    workspace,
    run,
    requirement: {
      id: 'TONGXI-1',
      title: 'Fixture change',
      acceptance: ['All required checks pass'],
      openQuestions: ['Which export format?'],
    },
    testCases: [{ id: 'TC-001', module: 'fixture', priority: 'P0', expected: 'works' }],
  })
  assert.equal(withQuestion.ok, true, withQuestion.summary)
  await assert.rejects(
    () => actions.phase({ workspace, run, phase: 'intake', status: 'passed', note: 'approve' }),
    /open question/i,
  )
  console.log('\n### intake gate rejects unresolved open questions: ok')

  const intake = await actions.intake({
    workspace,
    run,
    requirement: {
      id: 'TONGXI-1',
      title: 'Fixture change',
      acceptance: ['All required checks pass'],
      openQuestions: [],
    },
    testCases: [{ id: 'TC-001', module: 'fixture', priority: 'P0', expected: 'works' }],
  })
  assert.equal(intake.ok, true, intake.summary)
  const approved = await actions.phase({
    workspace,
    run,
    phase: 'intake',
    status: 'passed',
    note: 'test approval',
    approver: 'smoke test',
  })
  assert.equal(approved.ok, true, approved.summary)
  show('intake + phase', intake)

  const before = currentBranch()
  const dry = await actions.init({ workspace, run, dryRun: true })
  assert.equal(dry.ok, true, dry.summary)
  assert.equal(currentBranch(), before, 'dry-run must not switch branches')
  show('init dry-run', dry)

  const initialized = await actions.init({ workspace, run })
  assert.equal(initialized.ok, true, initialized.summary)
  assert.equal(currentBranch(), 'feat/tongxi-1-fixture-change')
  show('init', initialized)

  fs.writeFileSync(path.join(repo, 'feature.txt'), 'feature\n')
  sh('git add feature.txt && git commit -m "feature work"', repo)

  const verified = await actions.verify({ workspace, run })
  assert.equal(verified.ok, true, verified.summary)
  show('verify', verified)

  await assert.rejects(
    () => actions.build({ workspace, run, tag: `test-${'0'.repeat(12)}-1` }),
    /not merged/i,
  )
  console.log('\n### build gate rejects an unmerged feature branch: ok')

  sh('git checkout test', repo)
  sh('git merge --ff-only feat/tongxi-1-fixture-change', repo)
  sh('git push origin test', repo)
  sh('git checkout feat/tongxi-1-fixture-change', repo)
  const sha = sh('git rev-parse --short=12 origin/test', repo)

  await assert.rejects(
    () => actions.build({ workspace, run, tag: `test-${'0'.repeat(12)}-1` }),
    /does not match/i,
  )
  console.log('### build gate rejects a tag with the wrong SHA: ok')

  const tag = `test-${sha}-1`
  const built = await actions.build({ workspace, run, tag })
  assert.equal(built.ok, true, built.summary)
  show('build (manual record)', built)

  const dryDeploy = await actions.deploy({ workspace, run, env: 'test', tag, dryRun: true })
  assert.equal(dryDeploy.data.status, 'dry-run')
  show('deploy dry-run', dryDeploy)

  const deployed = await actions.deploy({ workspace, run, env: 'test', tag })
  assert.equal(deployed.ok, true, deployed.summary)
  show('deploy test', deployed)

  const prodTag = `prod-${sha}-7`
  const preview = await actions.deploy({ workspace, run, env: 'prod', tag: prodTag, force: true })
  assert.equal(preview.ok, true, preview.summary)
  assert.equal(preview.data.status, 'previewed')
  show('prod preview', preview)

  await assert.rejects(
    () => actions.deploy({ workspace, run, env: 'prod', tag: prodTag, force: true, apply: true }),
    /confirm/i,
  )
  console.log('### prod apply rejects a missing confirmation: ok')

  const applied = await actions.deploy({
    workspace,
    run,
    env: 'prod',
    tag: prodTag,
    force: true,
    apply: true,
    confirm: `DEPLOY prod fixture ${prodTag}`,
  })
  assert.equal(applied.ok, true, applied.summary)
  show('prod apply', applied)

  const reported = await actions.report({ workspace, run })
  assert.equal(reported.ok, true, reported.summary)
  assert.ok(fs.existsSync(reported.data.path), reported.data.path)
  show('report', reported)

  const single = await actions.status({ workspace, run })
  assert.equal(single.data.run.phases.deploy.status, 'passed')
  show('status (one run)', single)

  const created2 = await actions.new({
    workspace,
    requirementId: 'TONGXI-2',
    title: 'Dirty check',
    projects: ['fixture'],
    env: 'test',
  })
  fs.writeFileSync(path.join(repo, 'dirty.txt'), 'uncommitted\n')
  const dirty = await actions.init({ workspace, run: created2.data.run })
  assert.equal(dirty.ok, false)
  assert.match(dirty.summary, /dirty/i)
  fs.rmSync(path.join(repo, 'dirty.txt'))
  show('init rejects a dirty worktree', dirty)

  const list = await actions.status({ workspace })
  assert.match(list.summary, new RegExp(run))
  show('status (all runs)', list)

  console.log('\nSMOKE TEST PASSED')
}

main().catch((error) => {
  console.error('\nSMOKE TEST FAILED')
  console.error(error)
  process.exit(1)
})