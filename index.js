import { actions } from './lib/actions.js'
import { mountDeliveryApi } from './lib/api.js'
import { PHASES } from './lib/run.js'
import { limitText, redact } from './lib/util.js'

export const name = 'delivery-workflow'
export const inject = ['tools', 'workingDirectory']

const ACTIONS = ['doctor', 'new', 'intake', 'phase', 'init', 'verify', 'build', 'deploy', 'report', 'status']
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
        'verify: run configured checks and a secret scan; build: trigger or record a Jenkins build;',
        'deploy: preview/apply an environment deploy and health check; report: write report.md;',
        'status: list runs or show one run.',
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
      description: 'init: continue with the next project after a failure instead of stopping at the first one.',
    },
    allowDirty: {
      type: 'boolean',
      description:
        'init: allow a dirty worktree. Refused by default. The plugin never runs reset --hard, clean -fd, or deletes user changes.',
    },
    project: {
      type: 'string',
      description: 'build/deploy: project name. Required when the run contains multiple projects.',
    },
    tag: {
      type: 'string',
      description:
        'build/deploy: image tag matching ^(test|prod)-[0-9a-f]{12}-[0-9]+$. For build, records a completed Jenkins build only after checking the feature branch is merged and the SHA prefix matches the build branch head.',
    },
    manual: {
      type: 'boolean',
      description: 'build: skip Jenkins and return the manual build instructions and the exact tag-recording step.',
    },
    buildUrl: {
      type: 'string',
      description: 'build: poll an already-triggered Jenkins build instead of triggering a new one.',
    },
    waitSeconds: {
      type: 'number',
      minimum: 0,
      maximum: 600,
      description: 'build: seconds to wait for Jenkins (default 120). A still-running build returns its URL for a later poll.',
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
      'Operate a software delivery workflow for one requirement: intake, multi-project init, verification, Jenkins build, and Kubernetes deploy. Start with doctor and create a run with new; later actions need the run id. Verification is an optional self-check and does not gate build, and a prod deploy requires confirm="DEPLOY prod <project> <tag>".',
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

  // Optional service: the Web page talks over HTTP. A CLI-only profile has no
  // web server, so the routes are skipped there instead of blocking activation.
  ctx.inject(['webServer'], (hostCtx) => {
    hostCtx.effect(() => mountDeliveryApi(hostCtx))
    hostCtx.logger?.info?.('delivery-workflow: mounted the /delivery routes')
  })
}
