import path from 'node:path'
import { DeliveryError, fileExists, readJson } from './util.js'

export function configPath(workspace) {
  return path.join(workspace, '.delivery', 'config.json')
}

export async function loadConfig(workspace) {
  const file = configPath(workspace)
  if (!(await fileExists(file))) {
    throw new DeliveryError(
      `Missing delivery config: ${file}. Copy config.example.json from the plugin bundle to .delivery/config.json and adjust the project paths.`,
      'CONFIG_MISSING',
    )
  }
  const raw = await readJson(file)
  return normalizeConfig(raw, workspace)
}

export function normalizeConfig(raw, workspace) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new DeliveryError('Delivery config must be a JSON object.', 'CONFIG_INVALID')
  }
  const defaults = {
    branchPrefix: 'feat/',
    envBranches: { test: 'test', prod: 'main' },
    timeoutMinutes: 30,
    ...(raw.defaults ?? {}),
  }
  const projects = {}
  for (const [name, value] of Object.entries(raw.projects ?? {})) {
    if (value === null || typeof value !== 'object' || typeof value.path !== 'string' || value.path.length === 0) {
      throw new DeliveryError(`Project "${name}" needs a non-empty path.`, 'CONFIG_INVALID')
    }
    const project = {
      ...value,
      name,
      path: path.isAbsolute(value.path) ? value.path : path.resolve(workspace, value.path),
      envBranches: { ...defaults.envBranches, ...(value.envBranches ?? {}) },
      setup: Array.isArray(value.setup) ? value.setup : [],
      checks: Array.isArray(value.checks) ? value.checks : [],
    }
    projects[name] = project
  }
  if (Object.keys(projects).length === 0) {
    throw new DeliveryError('Delivery config has no projects.', 'CONFIG_INVALID')
  }
  return {
    ...raw,
    workspace,
    defaults,
    projects,
    groups: raw.groups ?? {},
  }
}

/**
 * Resolve a project selection from explicit names and/or a group. Both are
 * additive so a caller can extend a group without repeating every name.
 */
export function resolveProjectNames(config, { projects, group } = {}) {
  const names = []
  if (group) {
    const members = config.groups?.[group]
    if (!Array.isArray(members)) {
      throw new DeliveryError(`Unknown project group "${group}". Known groups: ${Object.keys(config.groups ?? {}).join(', ') || '(none)'}`, 'GROUP_UNKNOWN')
    }
    names.push(...members)
  }
  if (Array.isArray(projects)) names.push(...projects)
  const unique = [...new Set(names)]
  for (const name of unique) {
    if (!config.projects[name]) {
      throw new DeliveryError(`Unknown project "${name}". Known projects: ${Object.keys(config.projects).join(', ')}`, 'PROJECT_UNKNOWN')
    }
  }
  return unique
}

export function projectOrThrow(config, name) {
  const project = config.projects[name]
  if (!project) {
    throw new DeliveryError(`Unknown project "${name}". Known projects: ${Object.keys(config.projects).join(', ')}`, 'PROJECT_UNKNOWN')
  }
  return project
}

export function branchFor(project, env) {
  const branch = project.envBranches?.[env]
  if (!branch) {
    throw new DeliveryError(`Project "${project.name}" has no branch configured for env "${env}".`, 'BRANCH_UNKNOWN')
  }
  return branch
}