import { DeliveryError, redact, runShell, shellQuote, sleep, tail } from './util.js'

function substitute(value, vars) {
  return String(value).replace(/\{(tag|env|namespace)\}/g, (_, key) => vars[key] ?? '')
}

function scriptCommand(script, args) {
  const quoted = [script, ...args].map(shellQuote).join(' ')
  return /\.sh$/i.test(String(script)) ? `bash ${quoted}` : quoted
}

/**
 * Turn one deploy env config into an executable plan. Nothing is executed here.
 * A missing SSH host or remotePath yields a blocked plan with a copyable
 * command instead of guessing at a cluster.
 */
export function buildDeployPlan({ project, env, tag, apply = false }) {
  const config = project.deploy?.[env]
  if (!config) {
    throw new DeliveryError(`Project "${project.name}" has no deploy config for env "${env}".`, 'DEPLOY_CONFIG_MISSING')
  }
  const step = apply && config.apply ? config.apply : !apply && config.preview ? config.preview : config
  const vars = { tag, env, namespace: config.namespace ?? '' }
  const rawCommands = step.commands ?? config.commands
  const commands = Array.isArray(rawCommands)
    ? rawCommands.map((value) => substitute(String(value), vars)).filter(Boolean)
    : []
  const expect = (step.expect ?? config.expect ?? []).map((value) => String(value))
  const script = substitute(step.script ?? config.script ?? '', vars)
  if (!script && commands.length === 0) {
    throw new DeliveryError(`Deploy config for "${project.name}/${env}" has no script and no commands.`, 'DEPLOY_CONFIG_INVALID')
  }
  const args = (step.args ?? config.args ?? []).map((arg) => substitute(arg, vars))
  const runner = config.runner ?? 'ssh'
  const remotePath = substitute(config.remotePath ?? project.path, vars)
  const host = config.host ?? ''
  const remoteScript = commands.length ? commands.join(' && ') : scriptCommand(script, args)
  const timeoutSeconds = Number(config.timeoutSeconds ?? 300)
  const healthUrl = config.healthUrl ? substitute(config.healthUrl, vars) : ''
  const namespace = config.namespace ?? ''
  const result = {
    env,
    tag,
    commands,
    expect,
    runner,
    script,
    args,
    remotePath,
    namespace,
    healthUrl,
    timeoutSeconds,
    kind: runner,
    command: '',
  }
  if (runner === 'local') {
    result.command = remoteScript
    return result
  }
  if (runner === 'notebook') {
    const remote = `cd ${shellQuote(remotePath)} && ${remoteScript}`
    const notebookUrl = config.notebookUrl ?? ''
    result.kind = 'notebook'
    result.command = remote
    result.notebookUrl = notebookUrl
    result.reason = notebookUrl
      ? `Run this command in a terminal of this Kubeflow notebook, then check the health endpoint: ${notebookUrl}`
      : 'Run this command in a terminal on a host with kubectl access, then check the health endpoint.'
    return result
  }
  if (runner === 'ssh') {
    const remote = `cd ${shellQuote(remotePath)} && ${remoteScript}`
    if (!host) {
      result.kind = 'blocked'
      result.command = `ssh <deploy-host> ${shellQuote(remote)}`
      result.reason = 'No deploy.host configured for this env. Run the command on a host with kubectl/kubeconfig access, or set deploy.host and retry.'
      return result
    }
    result.kind = 'ssh'
    result.command = `ssh -o BatchMode=yes ${shellQuote(host)} ${shellQuote(remote)}`
    return result
  }
  throw new DeliveryError(`Unknown deploy runner "${runner}". Use "ssh", "local" or "notebook".`, 'DEPLOY_CONFIG_INVALID')
}

export async function executeDeploy({ project, plan, dryRun = false }) {
  if (dryRun) return { plan, executed: false, dryRun: true }
  if (plan.kind === 'blocked') return { plan, executed: false, blocked: true }
  if (plan.kind === 'notebook') return { plan, executed: false, manual: true }
  const result = await runShell(plan.command, {
    cwd: project.path,
    timeoutMs: Math.max(30, Number(plan.timeoutSeconds) || 300) * 1000,
  })
  return { plan, executed: true, result }
}

/**
 * Probe an HTTP health endpoint until it succeeds or the configured window
 * expires. A failed probe is reported, never turned into an automatic
 * rollback: rollback remains an explicit human decision.
 */
export async function checkHealth(url, { timeoutSeconds = 300, intervalMs = 5000 } = {}) {
  if (!url) return { ok: true, skipped: true, attempts: 0 }
  const deadline = Date.now() + Math.max(1, Number(timeoutSeconds) || 300) * 1000
  let attempts = 0
  let last = null
  while (Date.now() < deadline) {
    attempts += 1
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      const body = tail(await response.text(), 400)
      last = { status: response.status, body }
      if (response.ok) return { ok: true, attempts, url: redact(url), last }
    } catch (error) {
      last = { error: redact(error?.message ?? String(error)) }
    }
    await sleep(intervalMs)
  }
  return { ok: false, attempts, url: redact(url), last }
}