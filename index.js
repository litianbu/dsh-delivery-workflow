import { actions } from './lib/actions.js'
import { registerDeliveryContext } from './lib/context.js'
import { mountDeliveryApi } from './lib/api.js'
import { PHASES } from './lib/run.js'
import { limitText, redact } from './lib/util.js'

export const name = 'delivery-workflow'
// `systemPrompt` is declared so the agent-scoped section can be registered
// through a context-bound property read; see lib/context.js.
export const inject = ['tools', 'workingDirectory', 'systemPrompt']

const ACTIONS = ['doctor', 'new', 'intake', 'phase', 'init', 'merge', 'verify', 'build', 'deploy', 'report', 'status', 'close', 'remove', 'doc']
const PHASE_STATUSES = ['pending', 'running', 'passed', 'failed', 'blocked', 'skipped']

const parameters = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: {
      type: 'string',
      enum: ACTIONS,
      description: [
        'doctor: check config, repos, git/ssh and credentials; new: create a run;',
        'intake: validate and save the normalized requirement and test cases;',
        'phase: record approval/status for a phase; init: fetch, checkout and prepare projects;',
        'merge: merge the run branch into each project\'s own env branch and push it, before build;',
        'verify: run configured checks and a secret scan; build: trigger or record a Jenkins build;',
        'deploy: preview/apply an environment deploy and health check; report: write report.md;',
        'status: list runs or show one run;',
        'doc: read a Feishu requirement document by link (docUrl) — this is how the requirement text is fetched;',
        'never open the Feishu link with a browser, it needs a login and will only reach the sign-in page.',
      ].join(' '),
    },
    workspace: {
      type: 'string',
      description:
        'Workflow workspace containing .delivery/config.json. Absolute, or relative to the session working directory. Defaults to the session working directory.',
    },
    run: {
      type: 'string',
      description: 'Run id returned by new. Required for every action except doctor, new, and status without a run.',
    },
    projects: {
      type: 'array',
      items: { type: 'string' },
      description: 'Project names from config. Additive with group. init and verify default to the run projects.',
    },
    group: {
      type: 'string',
      description: 'Project group from the config. Additive with projects.',
    },
    env: {
      type: 'string',
      enum: ['test', 'prod'],
      description: 'Target environment. Defaults to the run environment, then test.',
    },
    branch: {
      type: 'string',
      description:
        'Feature branch. new defaults to <defaults.branchPrefix><requirementId>-<title>; init defaults to the run branch.',
    },
    requirementId: { type: 'string', description: 'new: stable requirement id, used for the run id and branch.' },
    title: { type: 'string', description: 'new: short requirement title.' },
    docUrl: { type: 'string', description: 'new/intake: Feishu document URL for provenance.' },
    requirement: {
      type: 'object',
      additionalProperties: true,
      description:
        'intake: normalized requirement with id, title, non-empty acceptance[], openQuestions[], and optional notes. Answers to openQuestions are mandatory before intake approval.',
    },
    testCases: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
      description:
        'intake: test cases with unique id, plus module, preconditions, steps, expected and priority. Map P0 cases to automated checks or manual evidence.',
    },
    allowNoTestCases: {
      type: 'boolean',
      description: 'intake: explicitly allow an empty testCases array. Use only with the user\'s agreement.',
    },
    phase: {
      type: 'string',
      enum: PHASES,
      description: 'phase: phase to update.',
    },
    status: {
      type: 'string',
      enum: PHASE_STATUSES,
      description: 'phase: new status. passed requires note and means a human or evidence gate accepted the phase.',
    },
    note: {
      type: 'string',
      description: 'phase: approval or evidence note. Required when status=passed.',
    },
    approver: { type: 'string', description: 'phase: who approved or supplied the evidence.' },
    dryRun: {
      type: 'boolean',
      description: 'init/deploy: return the commands without executing them or changing phase state.',
    },
    skipSetup: { type: 'boolean', description: 'init: skip the project setup commands.' },
    keepGoing: {
      type: 'boolean',
      description: 'init/merge: continue with the next project after a failure instead of stopping at the first one.',
    },
    allowDirty: {
      type: 'boolean',
      description:
        'init: allow a dirty worktree. Refused by default. The plugin never runs reset --hard, clean -fd, or deletes user changes.',
    },
    project: {
      type: 'string',
      description: 'merge/build/deploy: project name. Required by build/deploy when the run contains multiple projects; merge defaults to every project in the run.',
    },
    push: {
      type: 'boolean',
      description:
        'merge: push the merged target branch to origin (default true). Pass push=false only when a human will push; the build gate reads origin/<branch>, so an unpushed merge does not satisfy it.',
    },
    tag: {
      type: 'string',
      description:
        'build/deploy: the image tag, exactly as the build produced it — for example web-test-7a3c647, latest-test or test-0123456789ab-42. Any format is accepted; a tag that names an environment different from the one being deployed is rejected. For build, records a completed Jenkins build only after checking the feature branch is merged and any commit prefix matches the build branch head.',
    },
    manual: {
      type: 'boolean',
      description: 'build: skip Jenkins and return the manual build instructions and the exact tag-recording step.',
    },
    buildUrl: {
      type: 'string',
      description: 'build: poll an already-triggered Jenkins build instead of triggering a new one.',
    },
    queueUrl: {
      type: 'string',
      description: 'build: queue item URL to resolve when the build URL is not known yet.',
    },
    pollOnly: {
      type: 'boolean',
      description:
        'build: only observe an already-triggered build. Never starts a new Jenkins build, and resets state that can no longer be matched to a build.',
    },
    waitSeconds: {
      type: 'number',
      minimum: 0,
      maximum: 600,
      description:
        'build: seconds to wait for Jenkins (default 120); 0 performs a single check and returns immediately. A still-running build returns its URL for a later poll.',
    },
    rollback: {
      type: 'boolean',
      description: 'deploy: redeploy the previous tag recorded for this env. Never automatic.',
    },
    force: {
      type: 'boolean',
      description:
        'deploy: allow a tag that differs from the recorded build. Use only with explicit user approval; it bypasses the build-tag match.',
    },
    confirm: {
      type: 'string',
      description: 'deploy: exact production confirmation "DEPLOY prod <project> <tag>". Required for env=prod apply.',
    },
    apply: {
      type: 'boolean',
      description: 'deploy: run the apply step after a preview step (prod configs with preview/apply).',
    },
  },
}

const output = {
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['ok', 'summary'],
    properties: {
      ok: { type: 'boolean' },
      summary: { type: 'string' },
      data: { type: 'string' },
    },
  },
  render(_args, value) {
    return [{ type: 'text', text: value.data ? `${value.summary}\n\n${value.data}` : value.summary }]
  },
}

export function apply(ctx) {
  ctx.tools.register({
    name: 'delivery',
    description:
      'Operate a software delivery workflow for one requirement: intake, multi-project init, per-project merge into each environment branch, verification, Jenkins build, and Kubernetes deploy. Start with doctor and create a run with new; later actions need the run id. Verification is an optional self-check and does not gate build, and a prod deploy requires confirm="DEPLOY prod <project> <tag>". When this conversation was opened for a delivery run, the requirement document, local requirement text, branch and Jenkins job are already part of your context: use them directly and never ask the user to paste the Feishu link.',
    timeoutMs: 900_000,
    isConcurrencySafe: () => false,
    parameters,
    output,
    async execute(args, exec) {
      const handler = actions[args.action]
      if (!handler) {
        return { ok: false, summary: `Unknown delivery action: ${args.action}`, data: '' }
      }
      try {
        const outcome = await handler(args, exec, ctx)
        const data =
          outcome.data === undefined ? '' : limitText(JSON.stringify(outcome.data, null, 2), 12_000)
        return { ok: outcome.ok !== false, summary: String(outcome.summary ?? ''), data }
      } catch (error) {
        return {
          ok: false,
          summary: `delivery ${args.action} failed: ${redact(error?.message ?? String(error))}`,
          data: JSON.stringify({ code: error?.code ?? 'ERROR' }),
        }
      }
    },
  })
  ctx.logger?.info?.('delivery-workflow: registered the delivery tool')
  registerDeliveryContext(ctx)

  // Optional service: the Web page talks over HTTP. A CLI-only profile has no
  // web server, so the routes are skipped there instead of blocking activation.
  ctx.inject(['webServer'], (hostCtx) => {
    hostCtx.effect(() => mountDeliveryApi(hostCtx))
    hostCtx.logger?.info?.('delivery-workflow: mounted the /delivery routes')
  })
}
