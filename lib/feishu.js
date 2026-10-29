// Minimal Feishu (Lark) document reader for the delivery workflow.
//
// A self-built Feishu app reads a requirement document with tenant credentials:
//   POST /auth/v3/tenant_access_token/internal  -> tenant_access_token
//   GET  /wiki/v2/spaces/get_node?token=<wiki>  -> obj_token / obj_type
//   GET  /docx/v1/documents/<id>/raw_content    -> plain text
//
// A wiki link is a node in a knowledge base, so its token must be exchanged for
// the real document token before the content can be read.
//
// Credentials come from FEISHU_APP_ID / FEISHU_APP_SECRET, or from
// ~/.dsh/private/feishu.json (mode 600) as { "appId": ..., "appSecret": ... }.
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DeliveryError } from './util.js'

const API = 'https://open.feishu.cn/open-apis'
const TOKEN_SAFETY_MS = 60 * 1000
let cachedToken = null

function hintFor(code) {
  switch (String(code)) {
    case '99991663':
    case '99991661':
      return '把应用加为该文档的协作者：文档右上角「···」→ 添加协作者 → 搜索应用名。'
    case '99991672':
    case '1770001':
    case '99991679':
      return '应用缺少读取文档的权限：在飞书开放平台给应用添加 docx:document:readonly，然后发布版本。'
    case '131006':
    case '131005':
      return '文档不存在，或应用没有该知识库/文件夹的访问权限。'
    case '10003':
    case '10014':
      return 'app_id / app_secret 不正确，请检查飞书开放平台的应用凭证。'
    default:
      return ''
  }
}

function missingCredentials(file) {
  return new DeliveryError(
    'missing Feishu credentials: set FEISHU_APP_ID / FEISHU_APP_SECRET, or create ' +
      file +
      ' with {"appId":"...","appSecret":"..."}',
    'FEISHU_NO_CREDENTIALS',
  )
}

export async function readCredentials() {
  const envId = process.env.FEISHU_APP_ID
  const envSecret = process.env.FEISHU_APP_SECRET
  if (envId && envSecret) return { appId: envId, appSecret: envSecret }

  const file = path.join(os.homedir(), '.dsh', 'private', 'feishu.json')
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    throw missingCredentials(file)
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new DeliveryError(file + ' is not valid JSON', 'FEISHU_NO_CREDENTIALS')
  }
  if (!parsed.appId || !parsed.appSecret) {
    throw new DeliveryError(file + ' needs both appId and appSecret', 'FEISHU_NO_CREDENTIALS')
  }
  return { appId: parsed.appId, appSecret: parsed.appSecret }
}

async function tenantToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value

  const { appId, appSecret } = await readCredentials()
  const res = await fetch(API + '/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  })
  const body = await res.json().catch(() => null)
  if (!body || body.code !== 0 || !body.tenant_access_token) {
    const code = body ? body.code : 'HTTP ' + res.status
    const message = (body && body.msg) || res.statusText || ''
    const hint = hintFor(code)
    throw new DeliveryError(
      'Feishu auth failed (code ' + code + '): ' + message + (hint ? ' - ' + hint : ''),
      'FEISHU_AUTH_FAILED',
    )
  }
  const ttl = Math.max(60, Number(body.expire) || 7200) * 1000
  cachedToken = { value: body.tenant_access_token, expiresAt: Date.now() + ttl - TOKEN_SAFETY_MS }
  return cachedToken.value
}

export function parseDocLink(input) {
  const url = String(input || '').trim()
  const match = /feishu\.cn\/(wiki|docx|docs|sheets|base|mindnotes)\/([A-Za-z0-9_-]+)/.exec(url)
  if (!match) {
    throw new DeliveryError('not a Feishu document link: ' + url, 'FEISHU_LINK_INVALID')
  }
  return { kind: match[1], token: match[2] }
}

async function getJson(url, token, what) {
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } })
  const body = await res.json().catch(() => null)
  if (!body) {
    throw new DeliveryError('Feishu returned no JSON for ' + what + ' (HTTP ' + res.status + ')', 'FEISHU_BAD_RESPONSE')
  }
  if (body.code !== 0) {
    const hint = hintFor(body.code)
    throw new DeliveryError(
      'Feishu ' + what + ' failed (code ' + body.code + '): ' + (body.msg || '') + (hint ? ' - ' + hint : ''),
      'FEISHU_REQUEST_FAILED',
    )
  }
  return body.data || {}
}

export async function resolveDocument(input) {
  const link = parseDocLink(input)
  const url = String(input).trim()
  if (link.kind !== 'wiki') return { token: link.token, kind: link.kind, title: '', url }

  const token = await tenantToken()
  const data = await getJson(
    API + '/wiki/v2/spaces/get_node?token=' + encodeURIComponent(link.token),
    token,
    'wiki node lookup',
  )
  const node = data.node || {}
  if (!node.obj_token) {
    throw new DeliveryError('Feishu wiki node has no obj_token', 'FEISHU_WIKI_EMPTY')
  }
  return { token: node.obj_token, kind: node.obj_type || 'docx', title: node.title || '', url }
}

export async function readDocument(input) {
  const resolved = await resolveDocument(input)
  if (resolved.kind !== 'docx') {
    throw new DeliveryError(
      'only Feishu docx documents can be read; this link points at "' + resolved.kind + '"',
      'FEISHU_DOC_UNSUPPORTED',
    )
  }
  const token = await tenantToken()
  const data = await getJson(
    API + '/docx/v1/documents/' + encodeURIComponent(resolved.token) + '/raw_content',
    token,
    'document read',
  )
  const content = String(data.content || '')
  if (!content.trim()) {
    throw new DeliveryError('Feishu document is empty', 'FEISHU_DOC_EMPTY')
  }
  return {
    title: resolved.title,
    token: resolved.token,
    url: resolved.url,
    content,
    chars: content.length,
    fetchedAt: new Date().toISOString(),
  }
}

export function requirementMarkdown(doc, meta) {
  const extra = meta || {}
  const lines = ['# ' + (doc.title || 'Feishu requirement'), '', '- source: ' + doc.url, '- token: ' + doc.token]
  if (extra.requirementId) lines.push('- requirement: ' + extra.requirementId)
  if (extra.runId) lines.push('- run: ' + extra.runId)
  lines.push('- fetched: ' + doc.fetchedAt)
  lines.push('- chars: ' + doc.chars)
  lines.push('', '---', '')
  return lines.join('\n') + doc.content
}

export default { parseDocLink, readCredentials, resolveDocument, readDocument, requirementMarkdown }
