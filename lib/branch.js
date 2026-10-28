// Git branch helpers for a delivery run.
//
// Everything here fails loudly: a missing base branch or a worktree with
// uncommitted changes to tracked files is an error, never a silent fallback,
// because the delivery record must not claim a branch that does not exist.
import { DeliveryError, runShell, shellQuote } from './util.js'

const BRANCH_NAME = /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/

async function git(repoPath, args) {
  return runShell(`git -C ${shellQuote(repoPath)} ${args}`, { timeoutMs: 60000 })
}

/**
 * Local branches, the current one, and the worktree state of one repository.
 * Read-only: the page calls this to fill the "基于 <branch>" selector.
 */
export async function listBranches(repoPath) {
  const head = await git(repoPath, 'rev-parse --abbrev-ref HEAD')
  if (head.code !== 0) {
    throw new DeliveryError(`not a git repository: ${repoPath} (${String(head.stderr).trim()})`, 'REPO_INVALID')
  }
  const current = String(head.stdout).trim()
  const refs = await git(repoPath, "for-each-ref --format='%(refname:short)' refs/heads/")
  if (refs.code !== 0) {
    throw new DeliveryError(`cannot list branches of ${repoPath}: ${String(refs.stderr).trim()}`, 'REPO_INVALID')
  }
  const local = String(refs.stdout)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const status = await git(repoPath, 'status --porcelain')
  const dirtyFiles = String(status.stdout)
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter(Boolean)
  // Untracked entries ("?? path") do not block `git checkout -b`, so they are
  // reported but not treated as a blocker.
  const blocking = dirtyFiles.filter((line) => !line.startsWith('??'))
  return { path: repoPath, current, local, dirtyFiles, blocking }
}

/**
 * Create (or switch to) `name` starting from `base`.
 * Refuses when tracked files have uncommitted changes, because switching would
 * carry that work into the new branch silently.
 */
export async function createBranch({ repoPath, base, name }) {
  if (!name || !BRANCH_NAME.test(name)) {
    throw new DeliveryError(`invalid branch name: ${JSON.stringify(name)}`, 'BRANCH_NAME_INVALID')
  }
  const info = await listBranches(repoPath)
  if (info.blocking.length) {
    throw new DeliveryError(
      `worktree of ${repoPath} has uncommitted changes to tracked files; refusing to switch branches:\n${info.blocking.join('\n')}`,
      'WORKTREE_DIRTY',
    )
  }
  if (!info.local.includes(base)) {
    throw new DeliveryError(
      `base branch "${base}" does not exist in ${repoPath}; available: ${info.local.join(', ') || '(none)'}`,
      'BASE_UNKNOWN',
    )
  }
  if (info.local.includes(name)) {
    const switched = await git(repoPath, `checkout ${shellQuote(name)}`)
    if (switched.code !== 0) {
      throw new DeliveryError(`cannot switch to ${name}: ${String(switched.stderr).trim()}`, 'BRANCH_CHECKOUT_FAILED')
    }
    return { branch: name, base, created: false, switched: true, previous: info.current }
  }
  const created = await git(repoPath, `checkout -b ${shellQuote(name)} ${shellQuote(base)}`)
  if (created.code !== 0) {
    throw new DeliveryError(
      `cannot create branch ${name} from ${base}: ${String(created.stderr).trim()}`,
      'BRANCH_CREATE_FAILED',
    )
  }
  return { branch: name, base, created: true, switched: true, previous: info.current }
}
