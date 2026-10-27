import { execFile } from 'node:child_process'
import { access, appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export class DeliveryError extends Error {
  constructor(message, code = 'DELIVERY_ERROR') {
    super(message)
    this.name = 'DeliveryError'
    this.code = code
  }
}

export function nowIso() {
  return new Date().toISOString()
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function tail(text, max = 4000) {
  const value = String(text ?? '')
  if (value.length <= max) return value
  return `[... ${value.length - max} chars omitted ...]\n${value.slice(-max)}`
}

export function limitText(text, max = 6000) {
  return tail(text, max)
}

/**
 * Remove credentials from anything that will be shown to the model or written
 * into a run artifact. This is intentionally broad: false positives are
 * harmless, leaked tokens are not.
 */
export function redact(text) {
  return String(text ?? '')
    .replace(/\b(AUTHORIZATION|COOKIE|PASSWORD|SECRET|TOKEN|API[_-]?KEY)(\s*[:=]\s*)\S+/gi, '$1$2<redacted>')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer <redacted>')
    .replace(/([?&](?:token|access_token|api_key|apikey)=)[^&\s]+/gi, '$1<redacted>')
}

export function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

/**
 * Run a shell command without throwing on a non-zero exit. The caller decides
 * whether the exit code is fatal; this keeps command output available for the
 * run record and the model.
 */
export function runShell(command, { cwd, timeoutMs = 600000, env = {} } = {}) {
  const started = Date.now()
  return new Promise((resolve) => {
    execFile(
      '/bin/bash',
      ['-lc', command],
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 20 * 1024 * 1024,
        env: { ...process.env, ...env },
      },
      (error, stdout, stderr) => {
        const code = typeof error?.code === 'number' ? error.code : error ? 1 : 0
        resolve({
          command,
          cwd,
          code,
          signal: error?.signal ?? null,
          timedOut: Boolean(error?.killed),
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          durationMs: Date.now() - started,
        })
      },
    )
  })
}

export async function fileExists(file) {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true })
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (fallback !== undefined) return fallback
    throw new DeliveryError(`Cannot read JSON ${file}: ${error.message}`, 'INVALID_JSON')
  }
}

export async function writeJson(file, value) {
  await ensureDir(path.dirname(file))
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export async function appendJsonLine(file, value) {
  await ensureDir(path.dirname(file))
  await appendFile(file, `${JSON.stringify(value)}\n`, 'utf8')
}

export function slugify(value, fallback = 'run') {
  const text = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return text || fallback
}

export function makeRunId(requirementId) {
  const date = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `${stamp}-${slugify(requirementId, 'run')}`
}

export function assertSafeId(value, label = 'id') {
  if (!/^[A-Za-z0-9._-]+$/.test(String(value ?? ''))) {
    throw new DeliveryError(`Invalid ${label}: ${JSON.stringify(value)}`, 'INVALID_ID')
  }
  return String(value)
}