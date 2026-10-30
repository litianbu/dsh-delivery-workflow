import path from 'node:path'
import { branchFor } from './config.js'
import { appendEvent, runDir, saveRun } from './run.js'
import { DeliveryError, fileExists, nowIso, runShell, shellQuote, tail, writeJson } from './util.js'

/**
 * Merge the run's feature branch into the branch each project builds from.
 *
 * The target is never guessed: it comes from `config.projects.<name>.envBranches`
 * through `branchFor`, so a project whose test branch is `develop` is merged into
 * `develop` while another project's test branch stays `test`. This step cannot
 * live in `deploy`: the image is produced by the build that runs after the merge,
 * so a merge performed at deploy time would never reach it.
 *
 * A conflict is deliberately left in the working tree (the repository stays on
 * the target branch in the middle of the merge) so a human can resolve it with
 * normal git commands. Nothing is reset, stashed or force-pushed.
 */

const GIT_ENV = {
  // Fail fast instead of blocking a GUI host on a credential or host-key prompt.
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
  GIT_OPTIONAL_LOCKS: '0',
}

const DEFAULT_TIMEOUT = 120_000

async function git(command, cwd, timeoutMs = DEFAULT_TIMEOUT) {
  return runShell(command, { cwd, timeoutMs, env: GIT_ENV })
}

async function refExists(repo, ref) {
  const out = await git(`git rev-parse --verify --quiet ${shellQuote(ref)}`, repo)
  return out.code === 0
}

async function shortSha(repo, ref) {
  const out = await git(`git rev-parse --short=12 ${shellQuote(ref)}`, repo)
  return out.code === 0 ? out.stdout.trim() : ''
}

async function currentBranch(repo) {
  const out = await git('git rev-parse --abbrev-ref HEAD', repo)
  return out.code === 0 ? out.stdout.trim() : ''
}

/**
 * Tracked changes only: an untracked build directory (`.venv`, `dist/`) is the
 * normal state of a working copy and must not block a merge. Files git would
 * overwrite still fail loudly on checkout, which is the right moment to stop.
 */
async function trackedChanges(repo) {
  const out = await git('git status --porcelain --untracked-files=no', repo)
  return out.code === 0 ? out.stdout.trim() : ''
}

async function mergeInProgress(repo) {
  const out = await git('git rev-parse --quiet --verify MERGE_HEAD', repo)
  return out.code === 0
}

async function conflictFiles(repo) {
  const out = await git('git diff --name-only --diff-filter=U', repo)
  return out.code === 0
    ? out.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
    : []
}

async function hasIdentity(repo) {
  const out = await git('git var GIT_COMMITTER_IDENT', repo)
  return out.code === 0 && out.stdout.trim().length > 0
}

function failed(record, code, message, extra = {}) {
  return { ...record, ...extra, status: 'failed', code, message, endedAt: nowIso() }
}

/**
 * Merge one project. Expected git problems become a failed record (so a
 * multi-project run can report every project); configuration mistakes throw,
 * because they cannot be fixed by retrying one project.
 */
export async function mergeProject({ run, project, env, push = true }) {
  const startedAt = nowIso()
  const repo = project?.path
  if (!repo) throw new DeliveryError(`project "${project?.name ?? '?'}" has no path configured.`, 'PROJECT_PATH_MISSING')
  const target = branchFor(project, env)
  const source = run.branch
  if (!source) throw new DeliveryError('The run has no feature branch recorded.', 'RUN_BRANCH_MISSING')
  if (source === target) throw new DeliveryError(`The feature branch and the merge target are both "${target}".`, 'MERGE_SAME_BRANCH')

  const record = {
    project: project.name,
    env,
    source,
    target,
    status: 'failed',
    code: '',
    message: '',
    mergeCommit: '',
    targetHead: '',
    pushed: false,
    pushError: '',
    conflictFiles: [],
    previousBranch: '',
    steps: [],
    startedAt,
    endedAt: '',
  }
  const step = (name, result) => {
    record.steps.push({
      step: name,
      command: result.command,
      code: result.code,
      output: result.code === 0 ? '' : tail(`${result.stderr}${result.stdout}`, 800),
    })
    return result
  }

  if (!(await fileExists(path.join(repo, '.git')))) {
    return failed(record, 'PROJECT_NOT_GIT', `${repo} is not a git work tree.`)
  }

  const previous = await currentBranch(repo)
  record.previousBranch = previous

  // A half-finished merge means a human is already resolving conflicts. Tell
  // them what is left instead of stacking a second merge on top.
  if (await mergeInProgress(repo)) {
    record.conflictFiles = await conflictFiles(repo)
    return failed(
      record,
      'MERGE_IN_PROGRESS',
      `A merge is already in progress in ${repo} on ${previous || 'a detached HEAD'}. Resolve it, then run "git add" and "git commit"; click 合并 again afterwards.`,
    )
  }

  const dirty = await trackedChanges(repo)
  if (dirty) {
    record.steps.push({ step: 'status', command: 'git status --porcelain --untracked-files=no', code: 0, output: tail(dirty, 1200) })
    return failed(
      record,
      'MERGE_WORKTREE_DIRTY',
      `${repo} has uncommitted tracked changes. Commit or stash them before merging; nothing was changed.`,
    )
  }

  if (!(await hasIdentity(repo))) {
    return failed(
      record,
      'MERGE_IDENTITY_MISSING',
      `${repo} has no git user.email/user.name, so git cannot create the merge commit. Set them and click 合并 again.`,
    )
  }

  const fetch = step('fetch', await git('git fetch --prune origin', repo))
  if (fetch.code !== 0) {
    return failed(record, 'MERGE_FETCH_FAILED', `git fetch origin failed in ${repo}: ${tail(fetch.stderr || fetch.stdout, 800)}`)
  }

  const localSource = await refExists(repo, `refs/heads/${source}`)
  const remoteSource = await refExists(repo, `refs/remotes/origin/${source}`)
  if (!localSource && !remoteSource) {
    return failed(
      record,
      'MERGE_SOURCE_MISSING',
      `Feature branch "${source}" was not found in ${repo} (neither locally nor on origin).`,
    )
  }
  const sourceRef = localSource ? source : `origin/${source}`

  const localTarget = await refExists(repo, `refs/heads/${target}`)
  const remoteTarget = await refExists(repo, `refs/remotes/origin/${target}`)
  if (!localTarget && !remoteTarget) {
    return failed(
      record,
      'MERGE_TARGET_MISSING',
      `Merge target "${target}" was not found in ${repo}. Check envBranches for this project.`,
    )
  }

  // Check out the target branch. A branch checked out in another worktree is a
  // hard git error; surface it as-is rather than guessing.
  const checkoutTarget = localTarget
    ? await git(`git checkout ${shellQuote(target)}`, repo)
    : await git(`git checkout -b ${shellQuote(target)} --track ${shellQuote(`origin/${target}`)}`, repo)
  step('checkout-target', checkoutTarget)
  if (checkoutTarget.code !== 0) {
    return failed(
      record,
      'MERGE_CHECKOUT_FAILED',
      `Cannot check out "${target}" in ${repo}: ${tail(checkoutTarget.stderr || checkoutTarget.stdout, 800)}`,
    )
  }

  // Track the newest remote state, but never invent a merge commit for a
  // diverged local branch: --ff-only fails loudly instead.
  if (remoteTarget) {
    const pull = step('pull-target', await git(`git pull --ff-only origin ${shellQuote(target)}`, repo))
    if (pull.code !== 0) {
      await git(`git checkout ${shellQuote(previous || source)}`, repo)
      return failed(
        record,
        'MERGE_PULL_FAILED',
        `Cannot fast-forward "${target}" in ${repo}: ${tail(pull.stderr || pull.stdout, 800)}`,
      )
    }
  }

  const ancestor = await git(`git merge-base --is-ancestor ${shellQuote(sourceRef)} HEAD`, repo)
  if (ancestor.code === 0) {
    record.status = 'noop'
    record.message = `"${source}" is already contained in "${target}".`
    record.targetHead = await shortSha(repo, 'HEAD')
  } else {
    const message = `Merge branch '${source}' into ${target}`
    const merge = step(
      'merge',
      await git(`git merge --no-ff -m ${shellQuote(message)} ${shellQuote(sourceRef)}`, repo, 180_000),
    )
    if (merge.code !== 0) {
      const conflicts = await conflictFiles(repo)
      if (conflicts.length) {
        // Leave the working tree in the merge state on purpose: the operator
        // resolves the files with normal git, there is nothing safe to automate.
        record.conflictFiles = conflicts
        record.targetHead = await shortSha(repo, 'HEAD')
        return failed(
          record,
          'MERGE_CONFLICT',
          `Merge conflict in ${repo} on "${target}". Resolve ${conflicts.join(', ')}, then "git add" + "git commit"; the merge is left in place.`,
        )
      }
      if (await mergeInProgress(repo)) await git('git merge --abort', repo)
      await git(`git checkout ${shellQuote(previous || source)}`, repo)
      return failed(
        record,
        'MERGE_FAILED',
        `git merge failed in ${repo}: ${tail(merge.stderr || merge.stdout, 1000)}`,
      )
    }
    record.mergeCommit = await shortSha(repo, 'HEAD')
    record.targetHead = record.mergeCommit
    record.status = 'merged'
  }

  if (push !== false) {
    const pushed = step('push', await git(`git push origin ${shellQuote(target)}`, repo, 180_000))
    if (pushed.code !== 0) {
      record.pushError = tail(pushed.stderr || pushed.stdout, 1200)
      // Leave the local target branch ahead of origin: that is the truth, and
      // the operator can push manually once credentials/permissions allow it.
      await restoreBranch(repo, previous, source, record)
      return failed(
        record,
        'MERGE_PUSH_FAILED',
        `Merged locally into "${target}", but "git push origin ${target}" failed: ${record.pushError}`,
      )
    }
    record.pushed = true
  }
  await restoreBranch(repo, previous, source, record)
  record.message = record.message || `Merged "${source}" into "${target}"${push === false ? ' (not pushed)' : ' and pushed'}.`
  record.endedAt = nowIso()
  return record
}

/**
 * Put the work tree back where the operator left it. A failed restore is a
 * warning, never a reason to call the merge a failure: the merge itself is done
 * and pushed.
 */
async function restoreBranch(repo, previous, source, record) {
  const restore = previous && previous !== 'HEAD' && previous !== record.target ? previous : source
  if (!restore || restore === record.target) return
  const out = await git(`git checkout ${shellQuote(restore)}`, repo)
  record.steps.push({ step: 'restore', command: out.command, code: out.code, output: out.code === 0 ? '' : tail(out.stderr, 500) })
  if (out.code !== 0) record.restoreWarning = `Could not switch back to "${restore}": ${tail(out.stderr, 500)}`
}

/**
 * Merge every project of a run, in config order. A conflict stops the loop (the
 * work tree is mid-merge and another project's branch work would be unrelated
 * noise); other failures stop it unless keepGoing is set.
 */
export async function mergeProjects({ workspace, run, projects, env, push = true, keepGoing = false }) {
  const merges = {}
  let failures = 0
  for (const project of projects) {
    let record
    try {
      record = await mergeProject({ run, project, env, push })
    } catch (error) {
      if (!(error instanceof DeliveryError)) throw error
      record = {
        project: project.name,
        env,
        source: run.branch,
        target: '',
        status: 'failed',
        code: error.code ?? 'MERGE_FAILED',
        message: error.message,
        mergeCommit: '',
        targetHead: '',
        pushed: false,
        pushError: '',
        conflictFiles: [],
        startedAt: nowIso(),
        endedAt: nowIso(),
        steps: [],
      }
    }
    merges[project.name] = record
    run.merges = run.merges && typeof run.merges === 'object' ? run.merges : {}
    run.merges[project.name] = record
    await writeJson(path.join(runDir(workspace, run.id), 'merge', `${project.name}.json`), record)
    await appendEvent(workspace, run, {
      type: record.status === 'failed' ? 'merge/failed' : 'merge/completed',
      project: project.name,
      env,
      source: record.source,
      target: record.target,
      status: record.status,
      code: record.code,
      mergeCommit: record.mergeCommit,
      pushed: record.pushed,
      conflicts: record.conflictFiles,
    })
    await saveRun(workspace, run)
    if (record.status === 'failed') {
      failures += 1
      if (record.code === 'MERGE_CONFLICT') break
      if (!keepGoing) break
    }
  }
  await writeJson(path.join(runDir(workspace, run.id), 'merge.json'), {
    env,
    branch: run.branch,
    at: nowIso(),
    projects: merges,
  })
  return { merges, failures }
}