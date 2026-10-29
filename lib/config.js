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

/**
 * Register a local directory as a project so every later phase (branches, init,
 * verify, build, deploy) can resolve it by name. The raw file is edited in place
 * and unknown top-level keys survive. The new project takes the config defaults
 * for env branches and gets empty setup/checks, so a directory with no build or
 * deploy settings yet fails loudly at those phases instead of inheriting another
 * project's commands.
 */
export async function registerProject(workspace, { path: rawPath, name } = {}) {
  const fs = await import('node:fs/promises')
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    throw new DeliveryError('A project needs a directory path.', 'PROJECT_PATH_REQUIRED')
  }
  const absolute = path.resolve(workspace, rawPath)
  const file = configPath(workspace)
  let raw
  try {
    raw = JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (error) {
    throw new DeliveryError(`Cannot read ${file}: ${String(error && error.message ? error.message : error)}`, 'CONFIG_MISSING')
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new DeliveryError(`Delivery config ${file} is not a JSON object.`, 'CONFIG_INVALID')
  }
  const projects = raw.projects && typeof raw.projects === 'object' && !Array.isArray(raw.projects) ? raw.projects : {}
  const existing = Object.entries(projects).find(([, value]) => value && typeof value === 'object'
    && typeof value.path === 'string' && path.resolve(workspace, value.path) === absolute)
  if (existing) return { name: existing[0], path: absolute, created: false }

  const defaults = raw.defaults && typeof raw.defaults === 'object' ? raw.defaults : {}
  const wanted = typeof name === 'string' && name.trim() ? name.trim() : path.basename(absolute)
  if (!wanted) throw new DeliveryError('Cannot derive a project name from that directory.', 'PROJECT_NAME_REQUIRED')
  let finalName = wanted
  let suffix = 2
  while (Object.prototype.hasOwnProperty.call(projects, finalName)) {
    finalName = `${wanted}-${suffix}`
    suffix += 1
  }

  projects[finalName] = {
    path: absolute,
    envBranches: { ...(defaults.envBranches ?? { test: 'test', prod: 'main' }) },
    setup: [],
    checks: [],
  }
  raw.projects = projects
  const temporary = `${file}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(raw, null, 2)}\n`, 'utf8')
  await fs.rename(temporary, file)
  return { name: finalName, path: absolute, created: true }
}

/**
 * Record the verify command for an already configured project.
 *
 * A directory registered from the creation form starts with `checks: []`, so a
 * manual verify run has nothing to execute and reports "no checks configured".
 * Recording one command lets the creation form close that gap. It is optional:
 * verify does not gate build.
 */
export async function saveProjectChecks(workspace, projectName, run) {
  const fs = await import('node:fs/promises')
  const command = typeof run === 'string' ? run.trim() : ''
  if (!command) throw new DeliveryError('A verify command cannot be empty.', 'CHECK_RUN_REQUIRED')
  const file = configPath(workspace)
  let raw
  try {
    raw = JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (error) {
    throw new DeliveryError(`Cannot read ${file}: ${String(error && error.message ? error.message : error)}`, 'CONFIG_MISSING')
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new DeliveryError(`Delivery config ${file} is not a JSON object.`, 'CONFIG_INVALID')
  }
  const projects = raw.projects && typeof raw.projects === 'object' && !Array.isArray(raw.projects) ? raw.projects : {}
  const target = projects[projectName]
  if (!target || typeof target !== 'object') {
    throw new DeliveryError(`Unknown project "${projectName}" in ${file}.`, 'PROJECT_UNKNOWN')
  }
  target.checks = [{ name: '验证', run: command, required: true }]
  const temporary = `${file}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(raw, null, 2)}\n`, 'utf8')
  await fs.rename(temporary, file)
  return { name: projectName, checks: target.checks }
}