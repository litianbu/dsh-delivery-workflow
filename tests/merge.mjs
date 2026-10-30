import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { actions } from '../lib/actions.js'
import { loadRun } from '../lib/run.js'

/**
 * Merge is the only step that writes to the repositories and pushes, so it gets
 * its own end-to-end fixture: two projects whose test branches are deliberately
 * different (`test` and `develop`). That is the mistake this test exists to
 * catch — merging every project into the same branch.
 */

const workspace = '/tmp/dsh-merge-workspace'
const fixture = '/tmp/dsh-merge-fixture'

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

function currentBranch(repo) {
  return sh('git rev-parse --abbrev-ref HEAD', repo)
}

function makeRepo(name, envBranch) {
  const remote = path.join(fixture, `${name}.git`)
  const repo = path.join(fixture, name)
  sh(`git init --bare ${q(remote)}`)
  sh(`git clone ${q(remote)} ${q(repo)}`)
  sh('git config user.email merge-test@example.com', repo)
  sh('git config user.name Merge Test', repo)
  fs.writeFileSync(path.join(repo, 'README.md'), '# fixture\n')
  sh('git add README.md && git commit -m initial', repo)
  sh('git branch -M main', repo)
  sh('git push -u origin main', repo)
  sh(`git checkout -b ${envBranch}`, repo)
  sh(`git push -u origin ${envBranch}`, repo)
  sh('git checkout main', repo)
  return { repo, remote, envBranch }
}

function setupFixture() {
  fs.rmSync(workspace, { recursive: true, force: true })
  fs.rmSync(fixture, { recursive: true, force: true })
  fs.mkdirSync(path.join(workspace, '.delivery'), { recursive: true })
  fs.mkdirSync(fixture, { recursive: true })

  const alpha = makeRepo('alpha', 'test')
  const beta = makeRepo('beta', 'develop')

  const config = {
    schemaVersion: 1,
    defaults: { branchPrefix: 'feat/', envBranches: { test: 'test', prod: 'main' }, timeoutMinutes: 5 },
    projects: {
      alpha: { path: alpha.repo, envBranches: { test: 'test', prod: 'main' } },
      beta: { path: beta.repo, envBranches: { test: 'develop', prod: 'main' } },
    },
    groups: { all: ['alpha', 'beta'] },
  }
  fs.writeFileSync(path.join(workspace, '.delivery', 'config.json'), `${JSON.stringify(config, null, 2)}\n`)
  return { alpha, beta }
}

async function main() {
  const { alpha, beta } = setupFixture()

  const created = await actions.new({
    workspace,
    requirementId: 'MERGE-1',
    title: 'Merge fixture',
    projects: ['alpha', 'beta'],
    env: 'test',
    createBranch: true,
  })
  assert.equal(created.ok, true, created.summary)
  const runId = created.data.run
  const branch = created.data.branch
  assert.ok(runId, 'new must return the run id')
  assert.ok(branch, 'new must return the branch name')
  console.log(`\n### new multi-project run ${runId} branch=${branch}`)
  assert.equal(currentBranch(alpha.repo), branch)
  assert.equal(currentBranch(beta.repo), branch)

  // One commit per project, so both merges have something real to carry.
  for (const [repo, file] of [[alpha.repo, 'alpha.txt'], [beta.repo, 'beta.txt']]) {
    fs.writeFileSync(path.join(repo, file), `${file}\n`)
    sh(`git add ${file} && git commit -m ${q(`feature ${file}`)}`, repo)
  }

  const merged = await actions.merge({ workspace, run: runId })
  assert.equal(merged.ok, true, merged.summary)
  console.log('\n### merge two projects into their own env branches')
  console.log(merged.summary)

  const alphaRecord = merged.data.merges.alpha
  const betaRecord = merged.data.merges.beta
  assert.equal(alphaRecord.target, 'test')
  assert.equal(betaRecord.target, 'develop')
  assert.equal(alphaRecord.status, 'merged')
  assert.equal(betaRecord.status, 'merged')
  assert.equal(alphaRecord.pushed, true)
  assert.equal(betaRecord.pushed, true)
  assert.match(alphaRecord.mergeCommit, /^[0-9a-f]{12}$/)
  assert.match(betaRecord.mergeCommit, /^[0-9a-f]{12}$/)

  // The feature branch is now contained in the correct target, and only there.
  sh(`git merge-base --is-ancestor ${q(branch)} origin/test`, alpha.repo)
  sh(`git merge-base --is-ancestor ${q(branch)} origin/develop`, beta.repo)
  assert.equal(sh('git show origin/test:alpha.txt', alpha.repo), 'alpha.txt')
  assert.equal(sh('git show origin/develop:beta.txt', beta.repo), 'beta.txt')

  // Nothing was merged into the other project's branch or into main.
  assert.ok(!sh('git branch -r', alpha.repo).includes('origin/develop'))
  assert.ok(!sh('git branch -r', beta.repo).includes('origin/test'))
  assert.equal(sh('git rev-parse main', alpha.repo), sh('git rev-parse origin/main', alpha.repo))
  assert.equal(sh('git rev-parse main', beta.repo), sh('git rev-parse origin/main', beta.repo))

  // The work tree is restored to the feature branch, ready for more work.
  assert.equal(currentBranch(alpha.repo), branch)
  assert.equal(currentBranch(beta.repo), branch)

  // Re-running is a no-op, not a second merge commit.
  const again = await actions.merge({ workspace, run: runId })
  assert.equal(again.ok, true, again.summary)
  assert.equal(again.data.merges.alpha.status, 'noop')
  assert.equal(again.data.merges.beta.status, 'noop')
  console.log('### second merge is a no-op: ok')

  const persisted = await loadRun(workspace, runId)
  assert.equal(persisted.merges.alpha.status, 'noop')
  assert.ok(fs.existsSync(path.join(workspace, '.delivery', 'runs', runId, 'merge.json')))
  assert.ok(fs.existsSync(path.join(workspace, '.delivery', 'runs', runId, 'merge', 'alpha.json')))

  // A dirty tracked file stops the merge before anything is touched.
  fs.writeFileSync(path.join(alpha.repo, 'README.md'), '# dirty\n')
  const dirty = await actions.merge({ workspace, run: runId })
  assert.equal(dirty.ok, false)
  assert.equal(dirty.data.merges.alpha.code, 'MERGE_WORKTREE_DIRTY')
  assert.equal(dirty.data.merges.beta, undefined, 'the next project must not be attempted after a failure')
  assert.equal(sh('git rev-parse --abbrev-ref HEAD', alpha.repo), branch)
  sh('git checkout -- README.md', alpha.repo)
  console.log('### dirty worktree is refused before touching git: ok')

  // A conflict is left in the working tree on the target branch for a human.
  sh('git checkout test', alpha.repo)
  fs.writeFileSync(path.join(alpha.repo, 'README.md'), '# fixture\ntest side\n')
  sh('git add README.md && git commit -m "test side"', alpha.repo)
  sh('git push origin test', alpha.repo)
  sh(`git checkout ${q(branch)}`, alpha.repo)
  fs.writeFileSync(path.join(alpha.repo, 'README.md'), '# fixture\nfeature side\n')
  sh('git add README.md && git commit -m "feature side"', alpha.repo)

  const conflict = await actions.merge({ workspace, run: runId, project: 'alpha' })
  assert.equal(conflict.ok, false)
  const conflictRecord = conflict.data.merges.alpha
  assert.equal(conflictRecord.code, 'MERGE_CONFLICT')
  assert.ok(conflictRecord.conflictFiles.includes('README.md'))
  assert.equal(currentBranch(alpha.repo), 'test', 'a conflict leaves the repo on the target branch')
  sh('git rev-parse -q --verify MERGE_HEAD', alpha.repo)
  console.log('### conflict is left in the working tree: ok')
  console.log(conflict.summary)

  // Leave the fixture usable even if later assertions failed.
  sh('git merge --abort', alpha.repo)
  sh(`git checkout ${q(branch)}`, alpha.repo)

  console.log('\nMERGE TEST PASSED')
}

main().catch((error) => {
  console.error('\nMERGE TEST FAILED')
  console.error(error)
  process.exit(1)
})