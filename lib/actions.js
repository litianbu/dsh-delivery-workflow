import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { branchFor, configPath, loadConfig, projectOrThrow, resolveProjectNames } from './config.js'
import { buildDeployPlan, checkHealth, executeDeploy } from './deploy.js'
import { jenkinsJobFor, jenkinsSettings, pollBuild, tagMatchesSha, triggerBuild, validateTag } from './jenkins.js'
import { appendEvent, createRun, listRuns, loadRun, phaseLine, runDir, saveRun, updatePhase } from './run.js'
import {
  DeliveryError,
  ensureDir,
  fileExists,
  nowIso,
  readJson,
  redact,
  runShell,
  shellQuote,
  tail,
  writeJson,
} from './util.js'

const PHASE_STATUSES = ['pending', 'running', 'passed', 'failed', 'blocked', 'skipped']

function result(summary, data = {}, ok = true) {
  return { ok, summary, data }
}

function table(headers, rows) {
  const all = [headers, ...rows]
  const widths = headers.map((_, index) => Math.max(...all.map((row) => String(row[index] ?? '').length)))
  return all.map((row) => row.map((cell, index) => String(cell ?? '').padEnd(widths[index])).join('  ')).join('\n')
}

function safeCwd(ctx, exec) {
  try {
    if (exec?.agent) return ctx.workingDirectory.get(exec.agent.session)
  } catch {
    // Fall back to the host process directory below.
  }
  return process.cwd()
}

function resolveWorkspace(args, exec, ctx) {
  const base = safeCwd(ctx, exec)
  return args.workspace ? path.resolve(base, args.workspace) : base
}

async function loadContext(args, exec, ctx, { requireRun = false } = {}) {
  const workspace = resolveWorkspace(args, exec, ctx)
  const config = await loadConfig(workspace)
  const run = args.run ? await loadRun(workspace, args.run) : null
  if (requireRun && !run) {
    throw new DeliveryError('This action needs run=<run id>. Use delivery status to list runs.', 'RUN_REQUIRED')
  }
  return { workspace, config, run }
}

function requireRun(run) {
  if (!run) throw new DeliveryError('This action needs run=<run id>. Use delivery status to list runs.', 'RUN_REQUIRED')
  return run
}

function selectedProjectNames(args, config, run) {
  if ((args.projects?.length ?? 0) > 0 || args.group) {
    const names = resolveProjectNames(config, { projects: args.projects, group: args.group })
    if (names.length === 0) throw new DeliveryError('No projects selected.', 'PROJECTS_EMPTY')
    return names
  }
  if (!run) throw new DeliveryError('No projects selected and no run given.', 'PROJECTS_EMPTY')
  return run.projects
}

function singleProjectName(args, run) {
  requireRun(run)
  if (args.project) return args.project
  if (run.projects.length === 1) return run.projects[0]
  throw new DeliveryError('This run contains multiple projects; pass project=<name>.', 'PROJECT_REQUIRED')
}

async function writeArtifact(workspace, run, relative, value) {
  const file = path.join(runDir(workspace, run.id), relative)
  await writeJson(file, value)
  return file
}

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------

export async function doctor(args, exec, ctx) {
  const workspace = resolveWorkspace(args, exec, ctx)
  const checks = []
  const add = (name, status, detail) => checks.push({ name, status, detail: redact(detail ?? '') })

  add('node', /^v(2[2-9]|[3-9][0-9])\./.test(process.version) ? 'ok' : 'warn', process.version)

  const git = await runShell('git --version')
  add('git', git.code === 0 ? 'ok' : 'fail', git.code === 0 ? git.stdout.trim() : git.stderr.trim())
  const ssh = await runShell('ssh -V')
  add('ssh', ssh.code === 0 ? 'ok' : 'warn', ssh.code === 0 ? ssh.stderr.trim() : ssh.stderr.trim())

  let config = null
  try {
    config = await loadConfig(workspace)
    add('config', 'ok', configPath(workspace))
  } catch (error) {
    add('config', 'fail', error.message)
  }

  if (config) {
    for (const project of Object.values(config.projects)) {
      const exists = await fileExists(project.path)
      add(`project:${project.name}`, exists ? 'ok' : 'fail', project.path)
      if (!exists) continue
      const repo = await runShell('git rev-parse --is-inside-work-tree', { cwd: project.path })
      add(`git:${project.name}`, repo.code === 0 && repo.stdout.trim() === 'true' ? 'ok' : 'fail', project.path)
      if (repo.code !== 0) continue
      const status = await runShell('git status --porcelain', { cwd: project.path })
      add(
        `clean:${project.name}`,
        status.code === 0 && status.stdout.trim().length === 0 ? 'ok' : 'warn',
        status.code !== 0 ? status.stderr.trim() : status.stdout.trim() ? 'dirty worktree; init will refuse unless allowDirty=true' : 'clean',
      )
      const remote = await runShell('git remote get-url origin', { cwd: project.path })
      add(`remote:${project.name}`, remote.code === 0 ? 'ok' : 'warn', remote.code === 0 ? remote.stdout.trim() : 'no origin remote')
      add(
        `checks:${project.name}`,
        project.checks.length > 0 ? 'ok' : 'warn',
        `${project.checks.length} check(s)`,
      )
      add(
        `deploy:${project.name}`,
        project.deploy ? 'ok' : 'warn',
        project.deploy ? Object.keys(project.deploy).join(', ') : 'no deploy config',
      )
    }
    const jenkins = jenkinsSettings()
    add(
      'jenkins',
      jenkins.configured ? 'ok' : 'warn',
      jenkins.configured ? 'credentials present' : 'JENKINS_URL/JENKINS_USER/JENKINS_API_TOKEN not set; use a manual build record',
    )
  }

  const kubeconfig = path.join(process.env.HOME ?? '', '.kube', 'config')
  const hasKubeconfig = await fileExists(kubeconfig)
  add(
    'kubeconfig',
    hasKubeconfig ? 'ok' : 'warn',
    hasKubeconfig
      ? 'local kubeconfig present'
      : 'no local kubeconfig; configure deploy.runner=ssh, deploy.runner=notebook, or run the printed command on a cluster host',
  )

  const blockers = checks.filter((check) => check.status === 'fail')
  const summary = [
    `Delivery doctor — ${workspace}`,
    '',
    table(['check', 'status', 'detail'], checks.map((check) => [check.name, check.status, check.detail])),
    '',
    blockers.length > 0
      ? `Blocked: ${blockers.map((check) => check.name).join(', ')}`
      : 'Ready. Create a run with action=new, then fetch the Feishu document and call action=intake.',
  ].join('\n')
  return result(summary, { workspace, checks }, blockers.length === 0)
}

// ---------------------------------------------------------------------------
// new / intake / phase
// ---------------------------------------------------------------------------

export async function newAction(args, exec, ctx) {
  const workspace = resolveWorkspace(args, exec, ctx)
  const config = await loadConfig(workspace)
  if (!args.requirementId || !args.title) {
    throw new DeliveryError('new needs requirementId and title.', 'ARGS_INVALID')
  }
  const projects = resolveProjectNames(config, { projects: args.projects, group: args.group })
  if (projects.length === 0) {
    throw new DeliveryError('new needs at least one project (or group).', 'PROJECTS_EMPTY')
  }
  const env = args.env ?? 'test'
  if (!['test', 'prod'].includes(env)) throw new DeliveryError('env must be test or prod.', 'ENV_INVALID')
  const run = await createRun(workspace, {
    requirementId: args.requirementId,
    title: args.title,
    docUrl: args.docUrl ?? '',
    projects,
    env,
    group: args.group ?? '',
    branch: args.branch,
    branchPrefix: config.defaults.branchPrefix,
  })
  const summary = [
    `Created run ${run.id}.`,
    `Requirement: ${run.requirement.id} — ${run.requirement.title}`,
    `Env: ${run.env}  Branch: ${run.branch}`,
    `Projects: ${run.projects.join(', ')}`,
    '',
    'Next: fetch the Feishu document with the browser tools, normalize requirement.json and testcases.json, then call action=intake.',
  ].join('\n')
  return result(summary, { run: run.id, branch: run.branch, projects: run.projects })
}

function validateRequirement(requirement) {
  if (requirement === null || typeof requirement !== 'object' || Array.isArray(requirement)) {
    throw new DeliveryError('intake needs requirement=<object>.', 'ARGS_INVALID')
  }
  if (!requirement.id || !requirement.title) {
    throw new DeliveryError('requirement needs id and title.', 'REQUIREMENT_INVALID')
  }
  if (!Array.isArray(requirement.acceptance) || requirement.acceptance.length === 0) {
    throw new DeliveryError('requirement needs a non-empty acceptance array.', 'REQUIREMENT_INVALID')
  }
  if (!Array.isArray(requirement.openQuestions)) requirement.openQuestions = []
  return requirement
}

function validateTestCases(cases, { allowEmpty = false } = {}) {
  if (!Array.isArray(cases)) throw new DeliveryError('testCases must be an array.', 'TESTCASES_INVALID')
  if (cases.length === 0 && !allowEmpty) {
    throw new DeliveryError('testCases is empty. Add cases or pass allowNoTestCases=true explicitly.', 'TESTCASES_INVALID')
  }
  const seen = new Set()
  for (const item of cases) {
    if (item === null || typeof item !== 'object' || !item.id) {
      throw new DeliveryError('Every test case needs an id.', 'TESTCASES_INVALID')
    }
    if (seen.has(item.id)) throw new DeliveryError(`Duplicate test case id "${item.id}".`, 'TESTCASES_INVALID')
    seen.add(item.id)
  }
  return cases
}

export async function intake(args, exec, ctx) {
  const { workspace, run } = await loadContext(args, exec, ctx, { requireRun: true })
  const requirement = validateRequirement({
    ...args.requirement,
    docUrl: args.requirement?.docUrl ?? run.requirement.docUrl,
    fetchedAt: args.requirement?.fetchedAt ?? nowIso(),
  })
  const cases = validateTestCases(args.testCases ?? [], { allowEmpty: Boolean(args.allowNoTestCases) })

  const requirementFile = await writeArtifact(workspace, run, 'spec/requirement.json', requirement)
  const testcasesFile = await writeArtifact(workspace, run, 'spec/testcases.json', {
    schemaVersion: 1,
    requirementId: requirement.id,
    cases,
  })

  run.requirement.docUrl = requirement.docUrl ?? run.requirement.docUrl
  run.artifacts.requirement = 'spec/requirement.json'
  run.artifacts.testcases = 'spec/testcases.json'
  await saveRun(workspace, run)
  await updatePhase(workspace, run, 'intake', {
    status: 'running',
    note: 'spec written; awaiting user approval',
  })

  const open = requirement.openQuestions
  const summary = [
    `Intake spec written for ${run.id}.`,
    `Acceptance items: ${requirement.acceptance.length}; test cases: ${cases.length}.`,
    open.length > 0
      ? `Open questions (${open.length}): ${open.map((q) => (typeof q === 'string' ? q : q.question ?? JSON.stringify(q))).join(' | ')}`
      : 'No open questions recorded.',
    '',
    'Review the spec with the user. When approved, call action=phase phase=intake status=passed note="user approved intake".',
    `Files: ${requirementFile} , ${testcasesFile}`,
  ].join('\n')
  return result(summary, {
    run: run.id,
    acceptance: requirement.acceptance.length,
    testCases: cases.length,
    openQuestions: open,
    needsApproval: true,
  })
}

export async function phase(args, exec, ctx) {
  const { workspace, run } = await loadContext(args, exec, ctx, { requireRun: true })
  if (!args.phase) throw new DeliveryError('phase needs phase=<name>.', 'ARGS_INVALID')
  if (!args.status || !PHASE_STATUSES.includes(args.status)) {
    throw new DeliveryError(`phase needs status in ${PHASE_STATUSES.join(', ')}.`, 'ARGS_INVALID')
  }
  if (args.status === 'passed' && !args.note) {
    throw new DeliveryError('A passed phase needs note=<approval or evidence>.', 'NOTE_REQUIRED')
  }
  if (args.phase === 'intake' && args.status === 'passed') {
    const spec = await readJson(path.join(runDir(workspace, run.id), 'spec', 'requirement.json'), null)
    if (spec?.openQuestions?.length) {
      throw new DeliveryError(`Cannot approve intake: ${spec.openQuestions.length} open question(s) remain.`, 'OPEN_QUESTIONS')
    }
  }
  const entry = await updatePhase(workspace, run, args.phase, {
    status: args.status,
    note: args.note ?? '',
    approver: args.approver ?? '',
  })
  return result(`Phase ${args.phase} is ${entry.status} for ${run.id}.`, { run: run.id, phase: args.phase, entry })
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

function commandRow(command, response) {
  return {
    command: response?.command ?? command,
    code: response?.code ?? null,
    timedOut: Boolean(response?.timedOut),
    durationMs: response?.durationMs ?? null,
    stdout: tail(redact(response?.stdout ?? ''), 1000),
    stderr: tail(redact(response?.stderr ?? ''), 1000),
  }
}

async function branchCheckoutCommand(project, branch) {
  const local = await runShell(`git rev-parse --verify --quiet ${shellQuote(`refs/heads/${branch}`)}`, { cwd: project.path })
  if (local.code === 0) return `git checkout ${shellQuote(branch)}`
  const remote = await runShell(`git rev-parse --verify --quiet ${shellQuote(`refs/remotes/origin/${branch}`)}`, { cwd: project.path })
  if (remote.code === 0) return `git checkout -b ${shellQuote(branch)} --track ${shellQuote(`origin/${branch}`)}`
  return `git checkout -b ${shellQuote(branch)}`
}

export async function init(args, exec, ctx) {
  const { workspace, config, run } = await loadContext(args, exec, ctx, { requireRun: true })
  const names = selectedProjectNames(args, config, run)
  const env = args.env ?? run.env ?? 'test'
  const branch = args.branch ?? run.branch
  const dryRun = Boolean(args.dryRun)
  const keepGoing = Boolean(args.keepGoing)
  const skipSetup = Boolean(args.skipSetup)
  const allowDirty = Boolean(args.allowDirty)
  const defaultTimeout = Number(config.defaults.timeoutMinutes ?? 30)
  const rows = []
  const details = {}
  let failures = 0

  for (const name of names) {
    const project = projectOrThrow(config, name)
    const base = branchFor(project, env)
    const timeoutMs = defaultTimeout * 60_000
    const startedAt = nowIso()
    const steps = []
    let status = 'passed'
    let detail = 'initialized'
    let failed = false
    const fail = (message) => {
      status = 'failed'
      detail = message
      if (!failed) failures += 1
      failed = true
    }

    if (dryRun) {
      const commands = [
        { step: 'status', command: 'git status --porcelain' },
        { step: 'fetch', command: 'git fetch --prune origin' },
        { step: 'checkout-base', command: `git checkout ${shellQuote(base)}` },
        { step: 'pull-base', command: `git pull --ff-only origin ${shellQuote(base)}` },
        { step: 'branch', command: `${await branchCheckoutCommand(project, branch)}   # uses the current local/remote state` },
        ...project.setup.map((command, index) => ({ step: `setup-${index + 1}`, command })),
      ]
      details[name] = { status: 'dry-run', base, branch, commands }
      rows.push([name, base, branch, 'dry-run', `${commands.length} command(s)`])
      continue
    }

    const statusProbe = await runShell('git status --porcelain', { cwd: project.path })
    steps.push({ step: 'status', ...commandRow('git status --porcelain', statusProbe) })
    if (statusProbe.code !== 0) {
      fail(statusProbe.stderr.trim() || 'git status failed')
    } else if (statusProbe.stdout.trim() && !allowDirty) {
      fail('dirty worktree; commit or stash changes first (or pass allowDirty=true)')
    }

    if (!failed) {
      const fetch = await runShell('git fetch --prune origin', { cwd: project.path, timeoutMs })
      steps.push({ step: 'fetch', ...commandRow('git fetch --prune origin', fetch) })
      if (fetch.code !== 0) fail(fetch.stderr.trim() || 'git fetch failed')
    }

    if (!failed) {
      const checkout = await runShell(`git checkout ${shellQuote(base)}`, { cwd: project.path, timeoutMs })
      steps.push({ step: 'checkout-base', ...commandRow(`git checkout ${shellQuote(base)}`, checkout) })
      if (checkout.code !== 0) fail(checkout.stderr.trim() || `git checkout ${base} failed`)
    }

    if (!failed) {
      const pull = await runShell(`git pull --ff-only origin ${shellQuote(base)}`, { cwd: project.path, timeoutMs })
      steps.push({ step: 'pull-base', ...commandRow(`git pull --ff-only origin ${shellQuote(base)}`, pull) })
      if (pull.code !== 0) fail(pull.stderr.trim() || `git pull ${base} failed`)
    }

    if (!failed) {
      const branchCommand = await branchCheckoutCommand(project, branch)
      const branchResult = await runShell(branchCommand, { cwd: project.path, timeoutMs })
      steps.push({ step: 'branch', ...commandRow(branchCommand, branchResult) })
      if (branchResult.code !== 0) fail(branchResult.stderr.trim() || `git checkout ${branch} failed`)
    }

    if (!failed && !skipSetup) {
      for (const [index, command] of project.setup.entries()) {
        const setup = await runShell(command, { cwd: project.path, timeoutMs })
        steps.push({ step: `setup-${index + 1}`, ...commandRow(command, setup) })
        if (setup.code !== 0) {
          fail(`setup failed: ${command}`)
          break
        }
      }
    }

    let head = ''
    if (!failed) {
      const headResult = await runShell('git rev-parse HEAD', { cwd: project.path })
      head = headResult.stdout.trim()
    }

    const record = {
      project: name,
      env,
      base,
      branch,
      status,
      detail,
      head,
      startedAt,
      endedAt: nowIso(),
      steps,
    }
    await writeArtifact(workspace, run, path.join('init', `${name}.json`), record)
    details[name] = record
    rows.push([name, base, branch, status, failed ? detail : head.slice(0, 12)])
    if (failed && !keepGoing) break
  }

  if (!dryRun) {
    run.artifacts.init = 'init/'
    await saveRun(workspace, run)
    await updatePhase(workspace, run, 'init', {
      status: failures > 0 ? 'failed' : 'passed',
      note: failures > 0 ? `${failures} project(s) failed` : `${names.length} project(s) initialized on ${branch}`,
    })
  }

  const summary = [
    `Init ${dryRun ? 'dry-run ' : ''}for ${run.id} (env=${env}, branch=${branch}).`,
    table(['project', 'base', 'branch', 'status', 'detail'], rows),
    failures > 0 ? `${failures} project(s) failed${keepGoing ? '' : '; stopped at the first failure'}.` : '',
  ]
    .filter(Boolean)
    .join('\n')
  return result(summary, { run: run.id, env, branch, dryRun, failures, details }, failures === 0)
}

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

async function runChecks(project, defaultTimeoutMinutes) {
  if (!Array.isArray(project.checks) || project.checks.length === 0) {
    return { rows: [], failed: true, note: 'no checks configured' }
  }
  const rows = []
  let failed = false
  for (const check of project.checks) {
    if (!check?.run) continue
    const timeoutMinutes = Number(check.timeoutMinutes ?? defaultTimeoutMinutes) || 30
    const response = await runShell(check.run, { cwd: project.path, timeoutMs: timeoutMinutes * 60_000 })
    const passed = response.code === 0 && !response.timedOut
    const required = check.required !== false
    rows.push({
      name: check.name ?? check.run,
      required,
      passed,
      code: response.code,
      timedOut: Boolean(response.timedOut),
      durationMs: response.durationMs,
      output: tail(redact(`${response.stdout}\n${response.stderr}`), 1500),
    })
    if (!passed && required) failed = true
  }
  return { rows, failed: failed || rows.length === 0 }
}

async function secretScan(project) {
  const response = await runShell('git diff --no-ext-diff --unified=0 HEAD', { cwd: project.path })
  if (response.code !== 0) return { clean: true, skipped: true, hits: [] }
  const text = `${response.stdout}\n${response.stderr}`
  const patterns = [
    { name: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
    { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
    { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36}\b/ },
    { name: 'openai-key', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
    { name: 'hardcoded-secret', re: /(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*['"][^'"]{8,}['"]/i },
  ]
  const hits = patterns.filter((pattern) => pattern.re.test(text)).map((pattern) => pattern.name)
  return {
    clean: hits.length === 0,
    skipped: false,
    hits,
    evidence: hits.length > 0 ? tail(redact(text), 1500) : '',
  }
}

export async function verify(args, exec, ctx) {
  const { workspace, config, run } = await loadContext(args, exec, ctx, { requireRun: true })
  const names = selectedProjectNames(args, config, run)
  const defaultTimeout = Number(config.defaults.timeoutMinutes ?? 30)
  const rows = []
  const details = {}
  let failures = 0

  for (const name of names) {
    const project = projectOrThrow(config, name)
    const current = await runShell('git rev-parse --abbrev-ref HEAD', { cwd: project.path })
    const currentBranch = current.stdout.trim()
    const branchOk = current.code === 0 && currentBranch === run.branch
    const checks = await runChecks(project, defaultTimeout)
    const secrets = await secretScan(project)
    const status = branchOk && !checks.failed && secrets.clean ? 'passed' : 'failed'
    if (status === 'failed') failures += 1
    const record = {
      project: name,
      branch: run.branch,
      currentBranch,
      branchOk,
      status,
      checks: checks.rows,
      checksNote: checks.note ?? '',
      secrets,
      verifiedAt: nowIso(),
    }
    await writeArtifact(workspace, run, path.join('verify', `${name}.json`), record)
    details[name] = record
    rows.push([
      name,
      `${checks.rows.filter((check) => check.passed).length}/${checks.rows.length}`,
      `${checks.rows.filter((check) => check.required && !check.passed).length}`,
      secrets.clean ? (secrets.skipped ? 'skipped' : 'clean') : secrets.hits.join(','),
      branchOk ? 'yes' : `no (${currentBranch || 'detached'})`,
      status,
    ])
  }

  run.artifacts.verify = 'verify/'
  await saveRun(workspace, run)
  await updatePhase(workspace, run, 'verify', {
    status: failures > 0 ? 'failed' : 'passed',
    note: failures > 0 ? `${failures} project(s) failed verification` : `${names.length} project(s) verified`,
  })

  const summary = [
    `Verification for ${run.id} (branch=${run.branch}).`,
    table(['project', 'checks', 'required-fail', 'secrets', 'branch', 'status'], rows),
    failures > 0 ? `${failures} project(s) failed.` : 'All required checks passed and no secret-like diff was found.',
  ].join('\n')
  return result(summary, { run: run.id, failures, details }, failures === 0)
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

async function resolveBuildRef(project, buildBranch, run) {
  const fetch = await runShell('git fetch --prune origin', { cwd: project.path, timeoutMs: 120_000 })
  if (fetch.code !== 0) {
    throw new DeliveryError(`Cannot fetch origin in ${project.path}: ${tail(redact(fetch.stderr), 800)}`, 'BUILD_FETCH_FAILED')
  }
  let ref = `origin/${buildBranch}`
  let resolved = await runShell(`git rev-parse --verify --quiet ${shellQuote(ref)}`, { cwd: project.path })
  if (resolved.code !== 0) {
    ref = buildBranch
    resolved = await runShell(`git rev-parse --verify --quiet ${shellQuote(ref)}`, { cwd: project.path })
  }
  if (resolved.code !== 0) {
    throw new DeliveryError(`Cannot resolve build branch "${buildBranch}" in ${project.path}.`, 'BUILD_BRANCH_MISSING')
  }
  if (run.branch !== buildBranch) {
    const ancestor = await runShell(
      `git merge-base --is-ancestor ${shellQuote(run.branch)} ${shellQuote(ref)}`,
      { cwd: project.path },
    )
    if (ancestor.code !== 0) {
      throw new DeliveryError(
        `Feature branch "${run.branch}" is not merged into "${ref}". Merge/PR it into ${buildBranch} before building.`,
        'BRANCH_NOT_MERGED',
      )
    }
  }
  const shaResult = await runShell(`git rev-parse --short=12 ${shellQuote(ref)}`, { cwd: project.path })
  if (shaResult.code !== 0) {
    throw new DeliveryError(`Cannot resolve the SHA of "${ref}".`, 'BUILD_SHA_MISSING')
  }
  return { ref, sha: shaResult.stdout.trim() }
}

function manualBuildInstructions(project, env, buildBranch, base) {
  let job
  try {
    job = jenkinsJobFor(project, env)
  } catch {
    job = { job: `<jenkins-job-for-${project.name}-${env}>`, params: {} }
  }
  const segments = String(job.job)
    .split('/')
    .filter(Boolean)
    .map((segment) => `job/${encodeURIComponent(segment)}`)
  const url = base ? `${base}/${segments.join('/')}` : ''
  const params = { ...(job.params ?? {}), ...(job.branchParam ? { [job.branchParam]: buildBranch } : {}) }
  return [
    `Manual build required for ${project.name} (${env}).`,
    url ? `Open ${url}` : `Open Jenkins job "${job.job}"`,
    `Parameters: ${JSON.stringify(params)}`,
    `Build branch: ${buildBranch}`,
    'After the build succeeds, call action=build project=<name> tag=<image tag> buildUrl=<build url>. The tag must match ^(test|prod)-[0-9a-f]{12}-[0-9]+$ and its SHA prefix must match the build branch head.',
  ].join('\n')
}

async function recordBuild({ workspace, run, project, env, tag, sha, buildBranch, buildUrl, source, consoleTail }) {
  const parsed = validateTag(tag)
  const record = {
    project: project.name,
    env,
    tag,
    tagEnv: parsed.env,
    sha,
    buildBranch,
    source,
    buildUrl: redact(buildUrl ?? ''),
    consoleTail: consoleTail ? tail(redact(consoleTail), 3000) : '',
    recordedAt: nowIso(),
  }
  run.build = record
  await writeArtifact(workspace, run, 'build.json', record)
  await saveRun(workspace, run)
  await updatePhase(workspace, run, 'build', { status: 'passed', note: `${source} build ${tag}` })
  return record
}

export async function build(args, exec, ctx) {
  const { workspace, config, run } = await loadContext(args, exec, ctx, { requireRun: true })
  const projectName = singleProjectName(args, run)
  const project = projectOrThrow(config, projectName)
  const env = args.env ?? run.env ?? 'test'
  const buildBranch = branchFor(project, env)

  if (args.tag) {
    const parsed = validateTag(args.tag)
    if (parsed.env !== env) throw new DeliveryError(`Tag ${args.tag} is for ${parsed.env}, not ${env}.`, 'TAG_ENV_MISMATCH')
    const { sha } = await resolveBuildRef(project, buildBranch, run)
    if (!tagMatchesSha(args.tag, sha)) {
      throw new DeliveryError(
        `Tag ${args.tag} does not match ${buildBranch} head ${sha}. Refusing to record a build whose SHA prefix is wrong.`,
        'TAG_SHA_MISMATCH',
      )
    }
    await recordBuild({
      workspace,
      run,
      project,
      env,
      tag: args.tag,
      sha,
      buildBranch,
      buildUrl: args.buildUrl,
      source: 'manual',
    })
    return result(
      `Recorded manual build ${args.tag} for ${project.name} (${buildBranch} @ ${sha}).`,
      { run: run.id, tag: args.tag, sha, buildBranch },
      true,
    )
  }

  const { sha } = await resolveBuildRef(project, buildBranch, run)

  if (args.buildUrl) {
    const polled = await pollBuild({ buildUrl: args.buildUrl, env, waitSeconds: args.waitSeconds ?? 120 })
    if (polled.status === 'success') {
      if (!polled.tag || !tagMatchesSha(polled.tag, sha)) {
        throw new DeliveryError(`Build succeeded but did not yield the expected tag for ${sha}.`, 'BUILD_TAG_MISSING')
      }
      await recordBuild({
        workspace,
        run,
        project,
        env,
        tag: polled.tag,
        sha,
        buildBranch,
        buildUrl: polled.buildUrl,
        source: 'jenkins',
        consoleTail: polled.consoleTail,
      })
      return result(`Build succeeded: ${polled.tag}.`, { run: run.id, ...polled })
    }
    if (polled.status === 'failed') {
      await updatePhase(workspace, run, 'build', { status: 'failed', note: `Jenkins result ${polled.result ?? 'FAILURE'}` })
      return result(`Jenkins build failed (${polled.result ?? 'FAILURE'}).`, { run: run.id, ...polled }, false)
    }
    run.build = { status: polled.status, buildUrl: polled.buildUrl, checkedAt: nowIso() }
    await saveRun(workspace, run)
    await updatePhase(workspace, run, 'build', { status: 'running', note: `Jenkins build still ${polled.status}` })
    return result(`Jenkins build is still ${polled.status}: ${polled.buildUrl ?? args.buildUrl}. Poll again with action=build buildUrl=<url>.`, {
      run: run.id,
      status: polled.status,
      buildUrl: polled.buildUrl,
    })
  }

  if (args.manual || !jenkinsSettings().configured) {
    const summary = manualBuildInstructions(project, env, buildBranch, jenkinsSettings().base)
    await updatePhase(workspace, run, 'build', { status: 'blocked', note: 'manual build required' })
    return result(summary, { run: run.id, status: 'blocked', project: project.name, env, buildBranch }, false)
  }

  try {
    const response = await triggerBuild({
      project,
      env,
      branch: buildBranch,
      waitSeconds: args.waitSeconds ?? 120,
    })
    if (response.status === 'success') {
      if (!response.tag || !tagMatchesSha(response.tag, sha)) {
        throw new DeliveryError(`Build succeeded but did not yield the expected tag for ${sha}.`, 'BUILD_TAG_MISSING')
      }
      if (response.tagEnv !== env) {
        throw new DeliveryError(`Build produced ${response.tagEnv} tag ${response.tag} for ${env}.`, 'TAG_ENV_MISMATCH')
      }
      await recordBuild({
        workspace,
        run,
        project,
        env,
        tag: response.tag,
        sha,
        buildBranch,
        buildUrl: response.buildUrl,
        source: 'jenkins',
        consoleTail: response.consoleTail,
      })
      return result(`Jenkins build succeeded: ${response.tag}.`, { run: run.id, ...response })
    }
    if (response.status === 'failed') {
      await updatePhase(workspace, run, 'build', { status: 'failed', note: `Jenkins result ${response.result ?? 'FAILURE'}` })
      return result(`Jenkins build failed (${response.result ?? 'FAILURE'}).`, { run: run.id, ...response }, false)
    }
    run.build = {
      status: response.status,
      buildUrl: response.buildUrl,
      queueUrl: response.queueUrl,
      checkedAt: nowIso(),
    }
    await saveRun(workspace, run)
    await updatePhase(workspace, run, 'build', { status: 'running', note: `Jenkins build ${response.status}` })
    return result(
      `Jenkins build is ${response.status}. Poll again with action=build buildUrl=${response.buildUrl ?? response.queueUrl ?? '<url>'}.`,
      { run: run.id, ...response },
    )
  } catch (error) {
    if (error.code === 'JENKINS_NOT_CONFIGURED') {
      const summary = manualBuildInstructions(project, env, buildBranch, '')
      await updatePhase(workspace, run, 'build', { status: 'blocked', note: 'Jenkins credentials missing' })
      return result(summary, { run: run.id, status: 'blocked', project: project.name, env }, false)
    }
    throw error
  }
}

// ---------------------------------------------------------------------------
// deploy
// ---------------------------------------------------------------------------

async function deployRecordPath(workspace, run, env) {
  return path.join(runDir(workspace, run.id), 'deploy', `${env}.json`)
}

export async function deploy(args, exec, ctx) {
  const { workspace, config, run } = await loadContext(args, exec, ctx, { requireRun: true })
  const projectName = singleProjectName(args, run)
  const project = projectOrThrow(config, projectName)
  const env = args.env ?? run.env ?? 'test'
  if (!['test', 'prod'].includes(env)) throw new DeliveryError('env must be test or prod.', 'ENV_INVALID')
  const target = project.deploy?.[env]
  if (!target) throw new DeliveryError(`Project "${projectName}" has no deploy config for ${env}.`, 'DEPLOY_CONFIG_MISSING')

  const recordFile = await deployRecordPath(workspace, run, env)
  const previous = await readJson(recordFile, null)
  const rollback = Boolean(args.rollback)
  let tag = args.tag
  if (rollback) {
    if (!previous?.previousTag) {
      throw new DeliveryError(`No previous tag recorded for ${projectName}/${env}; cannot roll back automatically.`, 'ROLLBACK_UNAVAILABLE')
    }
    tag = previous.previousTag
  }
  if (!tag) throw new DeliveryError('deploy needs tag=<image tag> or rollback=true.', 'ARGS_INVALID')
  const parsed = validateTag(tag)
  if (parsed.env !== env) throw new DeliveryError(`Tag ${tag} is for ${parsed.env}, not ${env}.`, 'TAG_ENV_MISMATCH')
  if (!rollback && run.build?.tag && tag !== run.build.tag && !args.force) {
    throw new DeliveryError(`Tag ${tag} does not match the recorded build ${run.build.tag}. Pass force=true only for a deliberate override.`, 'TAG_BUILD_MISMATCH')
  }

  const confirmation = `DEPLOY ${env} ${projectName} ${tag}`
  const apply = Boolean(args.apply)
  if (target.preview && !apply) {
    const plan = buildDeployPlan({ project, env, tag, apply: false })
    if (args.dryRun) {
      return result(`Dry run preview for ${projectName}/${env}:\n${redact(plan.command)}`, {
        run: run.id,
        status: 'dry-run',
        tag,
        command: redact(plan.command),
        runner: plan.runner,
      })
    }
    if (plan.kind === 'blocked') {
      await updatePhase(workspace, run, 'deploy', { status: 'blocked', note: 'deploy host missing (preview)' })
      return result(`Deploy preview is blocked:\n${redact(plan.command)}\n${plan.reason}`, {
        run: run.id,
        status: 'blocked',
        tag,
        command: redact(plan.command),
      }, false)
    }
    if (plan.kind === 'notebook') {
      await updatePhase(workspace, run, 'deploy', { status: 'blocked', note: 'awaiting manual preview in notebook' })
      return result(`Deploy preview needs a terminal:\n${redact(plan.command)}\n${plan.reason}`, {
        run: run.id,
        status: 'manual',
        tag,
        runner: plan.runner,
        notebookUrl: plan.notebookUrl ?? '',
        command: redact(plan.command),
      }, false)
    }
    const execution = await executeDeploy({ project, plan })
    const record = {
      project: projectName,
      env,
      tag,
      previousTag: previous?.tag ?? null,
      phase: 'preview',
      runner: plan.runner,
      command: redact(plan.command),
      exitCode: execution.result?.code ?? null,
      stdout: tail(redact(execution.result?.stdout ?? ''), 3000),
      stderr: tail(redact(execution.result?.stderr ?? ''), 3000),
      executedAt: nowIso(),
    }
    await writeArtifact(workspace, run, path.join('deploy', `${env}-preview.json`), record)
    if ((execution.result?.code ?? 1) !== 0) {
      await updatePhase(workspace, run, 'deploy', { status: 'failed', note: 'prod preview failed' })
      return result(`Preview failed for ${projectName}/${env} (exit ${execution.result?.code}).`, { run: run.id, ...record }, false)
    }
    await updatePhase(workspace, run, 'deploy', { status: 'running', note: 'prod preview complete; apply still required' })
    return result(
      `Preview complete for ${projectName}/${env}. Review the diff, then re-run with apply=true and confirm="${confirmation}".`,
      { run: run.id, status: 'previewed', tag, command: redact(plan.command) },
    )
  }

  if (env === 'prod' && args.confirm !== confirmation) {
    throw new DeliveryError(`Production deploy requires confirm exactly: "${confirmation}"`, 'CONFIRM_REQUIRED')
  }

  const plan = buildDeployPlan({ project, env, tag, apply })
  if (args.dryRun) {
    return result(`Dry run deploy for ${projectName}/${env}:\n${redact(plan.command)}`, {
      run: run.id,
      status: 'dry-run',
      tag,
      runner: plan.runner,
      command: redact(plan.command),
    })
  }
  if (plan.kind === 'blocked') {
    await updatePhase(workspace, run, 'deploy', { status: 'blocked', note: 'deploy host missing' })
    return result(`Deploy is blocked:\n${redact(plan.command)}\n${plan.reason}`, {
      run: run.id,
      status: 'blocked',
      tag,
      command: redact(plan.command),
    }, false)
  }

  if (plan.kind === 'notebook') {
    await updatePhase(workspace, run, 'deploy', { status: 'blocked', note: 'awaiting manual deploy in notebook' })
    return result(`Deploy needs a terminal:\n${redact(plan.command)}\n${plan.reason}`, {
      run: run.id,
      status: 'manual',
      tag,
      runner: plan.runner,
      notebookUrl: plan.notebookUrl ?? '',
      namespace: plan.namespace,
      healthUrl: plan.healthUrl,
      command: redact(plan.command),
    }, false)
  }

  const execution = await executeDeploy({ project, plan })
  const health = await checkHealth(plan.healthUrl, { timeoutSeconds: plan.timeoutSeconds })
  const record = {
    project: projectName,
    env,
    tag,
    previousTag: previous?.tag ?? null,
    rollback,
    runner: plan.runner,
    command: redact(plan.command),
    exitCode: execution.result?.code ?? null,
    timedOut: Boolean(execution.result?.timedOut),
    stdout: tail(redact(execution.result?.stdout ?? ''), 4000),
    stderr: tail(redact(execution.result?.stderr ?? ''), 4000),
    health,
    healthUrl: plan.healthUrl,
    namespace: plan.namespace,
    executedAt: nowIso(),
  }
  await writeArtifact(workspace, run, path.join('deploy', `${env}.json`), record)
  run.artifacts.deploy = `deploy/${env}.json`
  await saveRun(workspace, run)

  if ((execution.result?.code ?? 1) !== 0) {
    await updatePhase(workspace, run, 'deploy', { status: 'failed', note: `deploy command exit ${execution.result?.code}` })
    return result(`Deploy command failed for ${projectName}/${env} (exit ${execution.result?.code}).`, { run: run.id, ...record }, false)
  }
  if (!health.ok) {
    await updatePhase(workspace, run, 'deploy', { status: 'failed', note: 'health check failed; no automatic rollback' })
    return result(
      `Deploy command finished but health check failed. No automatic rollback was attempted. Inspect ${plan.healthUrl}.`,
      { run: run.id, ...record },
      false,
    )
  }
  await updatePhase(workspace, run, 'deploy', { status: 'passed', note: `${env} deploy ${tag}${rollback ? ' (rollback)' : ''}` })
  return result(
    `Deployed ${tag} to ${projectName}/${env}${health.skipped ? ' (health check not configured)' : '; health check passed'}.`,
    { run: run.id, ...record },
  )
}

// ---------------------------------------------------------------------------
// report / status
// ---------------------------------------------------------------------------

export async function report(args, exec, ctx) {
  const { workspace, config, run } = await loadContext(args, exec, ctx, { requireRun: true })
  const dir = runDir(workspace, run.id)
  const requirement = await readJson(path.join(dir, 'spec', 'requirement.json'), null)
  const testcases = await readJson(path.join(dir, 'spec', 'testcases.json'), null)
  const buildRecord = await readJson(path.join(dir, 'build.json'), null)
  const deployRecord = await readJson(path.join(dir, 'deploy', `${run.env}.json`), null)

  const initRecords = {}
  const verifyRecords = {}
  for (const project of run.projects) {
    initRecords[project] = await readJson(path.join(dir, 'init', `${project}.json`), null)
    verifyRecords[project] = await readJson(path.join(dir, 'verify', `${project}.json`), null)
  }

  const lines = [
    `# Delivery report — ${run.requirement.id}: ${run.requirement.title}`,
    '',
    `- Run: ${run.id}`,
    `- Created: ${run.createdAt}`,
    `- Environment: ${run.env}`,
    `- Branch: ${run.branch}`,
    `- Projects: ${run.projects.join(', ')}`,
    `- Feishu source: ${run.requirement.docUrl || '(not recorded)'}`,
    '',
    '## Phases',
    '',
    '| Phase | Status | Note |',
    '| --- | --- | --- |',
    ...phaseLine(run)
      .split(' ')
      .map((item) => {
        const [phase, status] = item.split('=')
        const note = run.phases?.[phase]?.note ?? ''
        return `| ${phase} | ${status} | ${note.replace(/\|/g, '\\|')} |`
      }),
    '',
    '## Requirement',
    '',
    requirement
      ? `- Acceptance items: ${requirement.acceptance?.length ?? 0}\n- Open questions: ${requirement.openQuestions?.length ?? 0}`
      : '- requirement.json not found',
    '',
    '## Projects',
    '',
    '| Project | Init | Verify |',
    '| --- | --- | --- |',
    ...run.projects.map((project) => {
      const init = initRecords[project]
      const verify = verifyRecords[project]
      return `| ${project} | ${init?.status ?? 'missing'} | ${verify?.status ?? 'missing'} |`
    }),
    '',
    '## Build',
    '',
    buildRecord
      ? `- Tag: ${buildRecord.tag}\n- SHA: ${buildRecord.sha}\n- Branch: ${buildRecord.buildBranch}\n- Source: ${buildRecord.source}\n- URL: ${buildRecord.buildUrl || '(not recorded)'}`
      : '- No build recorded',
    '',
    '## Deploy',
    '',
    deployRecord
      ? `- Tag: ${deployRecord.tag}\n- Previous tag: ${deployRecord.previousTag ?? '(none)'}\n- Exit: ${deployRecord.exitCode}\n- Health: ${deployRecord.health?.ok ? 'passed' : deployRecord.health?.skipped ? 'not configured' : 'failed'}\n- Rollback: ${deployRecord.rollback ? 'yes' : 'no'}`
      : '- No deploy recorded',
    '',
    '## Test cases',
    '',
    testcases?.cases?.length
      ? `- ${testcases.cases.length} case(s): ${testcases.cases.map((testcase) => testcase.id).join(', ')}`
      : '- No test cases recorded',
    '',
    '## Open questions',
    '',
    requirement?.openQuestions?.length
      ? requirement.openQuestions.map((question) => `- ${typeof question === 'string' ? question : question.question ?? JSON.stringify(question)}`).join('\n')
      : '- None recorded',
    '',
  ]

  const reportPath = path.join(dir, 'report.md')
  await ensureDir(path.dirname(reportPath))
  await writeFile(reportPath, `${lines.join('\n')}\n`, 'utf8')
  run.artifacts.report = 'report.md'
  await saveRun(workspace, run)
  await updatePhase(workspace, run, 'report', { status: 'passed', note: 'report.md written' })
  return result(`Wrote ${reportPath}.`, { run: run.id, path: reportPath })
}

export async function status(args, exec, ctx) {
  const workspace = resolveWorkspace(args, exec, ctx)
  if (args.run) {
    const run = await loadRun(workspace, args.run)
    const rows = []
    for (const [phase, entry] of Object.entries(run.phases ?? {})) {
      rows.push([phase, entry.status ?? 'pending', entry.note ?? ''])
    }
    const summary = [
      `Run ${run.id}: ${run.requirement.id} — ${run.requirement.title}`,
      `Env: ${run.env}  Branch: ${run.branch}  Projects: ${run.projects.join(', ')}`,
      `Created: ${run.createdAt}  Updated: ${run.updatedAt}`,
      '',
      table(['phase', 'status', 'note'], rows),
    ].join('\n')
    return result(summary, { run })
  }

  const runs = await listRuns(workspace, 20)
  if (runs.length === 0) {
    return result(`No delivery runs under ${path.join(workspace, '.delivery', 'runs')}. Start with action=new.`, { runs: [] })
  }
  const rows = runs.map((run) => [
    run.id,
    `${run.requirement.id}`,
    run.env,
    run.branch,
    phaseLine(run),
    run.updatedAt,
  ])
  return result(
    [`Delivery runs in ${workspace}`, '', table(['run', 'requirement', 'env', 'branch', 'phases', 'updated'], rows)].join('\n'),
    { runs },
  )
}

export async function close(args, exec, ctx) {
  const { workspace, run } = await loadContext(args, exec, ctx, { requireRun: true })
  if (run.closed) {
    return result(`Run ${run.id} is already finished.`, { run: run.id, closed: true })
  }
  const note = args.note ?? ''
  run.closed = true
  run.closedAt = nowIso()
  await saveRun(workspace, run)
  await appendEvent(workspace, run, { type: 'run/closed', note })
  return result(
    [
      `Run ${run.id} marked finished${note ? ' (' + note + ')' : ''}.`,
      'Nothing was deleted: the record stays under .delivery/runs and moves to the 已完成 section.',
    ].join('\n'),
    { run: run.id, closed: true },
  )
}

export const actions = {
  doctor,
  new: newAction,
  intake,
  phase,
  init,
  verify,
  build,
  deploy,
  report,
  status,
  close,
}