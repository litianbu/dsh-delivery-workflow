// Feishu bitable (多维表格) reader for test cases.
//
// A case base is not a document: the cards live in a table whose id appears in
// the URL as ?table=tbl.... The link points at a wiki node, so that node must be
// exchanged for the real base token before any record can be read.
//
// The tables here hold human-executed cases (执行人员 / 实际结果 / 测试状态), so
// this module never pretends to run them. It reads the recorded outcome and
// groups it into buckets the delivery gate can reason about, because "not PASS"
// covers very different situations: a real failure, a case nobody executed, a
// case whose own text is wrong, and a feature explicitly out of scope.
import { DeliveryError } from './util.js'
import { tenantToken } from './feishu.js'

const API = 'https://open.feishu.cn/open-apis'
const PAGE_SIZE = 500

function text(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(', ')
  if (typeof value === 'object') {
    return text(value.text !== undefined ? value.text : value.name !== undefined ? value.name : value.email !== undefined ? value.email : '')
  }
  return ''
}

const FIELDS = {
  id: ['测试用例编号', '用例编号', '编号'],
  title: ['用例名称', '测试用例名称', '名称'],
  priority: ['优先级'],
  module: ['模块'],
  feature: ['功能'],
  testType: ['测试类型'],
  caseType: ['用例类型'],
  precondition: ['前置条件'],
  steps: ['测试步骤'],
  expected: ['预期结果'],
  result: ['实际结果'],
  status: ['测试状态'],
  defect: ['缺陷编号'],
  system: ['系统'],
  version: ['版本'],
}

function pick(fields, names) {
  if (!fields) return undefined
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(fields, name)) return fields[name]
  }
  return undefined
}

export function normalizeCase(record) {
  const fields = (record && record.fields) || {}
  const take = (names) => text(pick(fields, names))
  return {
    recordId: (record && (record.record_id || record.id)) || '',
    id: take(FIELDS.id),
    title: take(FIELDS.title),
    priority: take(FIELDS.priority),
    module: take(FIELDS.module),
    feature: take(FIELDS.feature),
    testType: take(FIELDS.testType),
    caseType: take(FIELDS.caseType),
    precondition: take(FIELDS.precondition),
    steps: take(FIELDS.steps),
    expected: take(FIELDS.expected),
    result: take(FIELDS.result),
    status: take(FIELDS.status),
    defect: take(FIELDS.defect),
    system: take(FIELDS.system),
    version: take(FIELDS.version),
  }
}

export function parseBaseLink(input) {
  const url = String(input || '').trim()
  if (!url) throw new DeliveryError('empty Feishu base link', 'FEISHU_BASE_LINK_INVALID')
  const wiki = /feishu\.cn\/wiki\/([A-Za-z0-9_-]+)/.exec(url)
  const base = /feishu\.cn\/base\/([A-Za-z0-9_-]+)/.exec(url)
  const table = /[?&]table=([A-Za-z0-9]+)/.exec(url)
  const app = wiki || base
  if (!app) throw new DeliveryError('not a Feishu base link: ' + url, 'FEISHU_BASE_LINK_INVALID')
  return { kind: wiki ? 'wiki' : 'base', appToken: app[1], tableId: table ? table[1] : '' }
}

async function apiGet(pathname, token) {
  const response = await fetch(API + pathname, { headers: { Authorization: 'Bearer ' + token } })
  const body = await response.json().catch(() => null)
  if (!body) {
    throw new DeliveryError('Feishu returned no JSON for ' + pathname + ' (HTTP ' + response.status + ')', 'FEISHU_BAD_RESPONSE')
  }
  if (body.code !== 0) {
    const hint =
      body.code === 99991663 || body.code === 99991661
        ? '把应用加为该多维表格的协作者。'
        : body.code === 99991672 || body.code === 1770001 || body.code === 99991679
          ? '应用缺少 bitable 读取权限：开放平台添加 bitable:app:readonly 后发布版本。'
          : ''
    throw new DeliveryError(
      'Feishu ' + pathname + ' failed (code ' + body.code + '): ' + (body.msg || '') + (hint ? ' - ' + hint : ''),
      'FEISHU_BASE_REQUEST_FAILED',
    )
  }
  return body.data || {}
}

export async function resolveBase(input) {
  const parsed = parseBaseLink(input)
  if (parsed.kind === 'base') {
    return { appToken: parsed.appToken, tableId: parsed.tableId, title: '' }
  }
  const token = await tenantToken()
  const data = await apiGet('/wiki/v2/spaces/get_node?token=' + encodeURIComponent(parsed.appToken), token)
  const node = data.node || {}
  if (node.obj_type !== 'bitable') {
    throw new DeliveryError(
      'this wiki node is "' + (node.obj_type || 'unknown') + '", not a bitable; point testCases at a 多维表格',
      'FEISHU_NOT_BITABLE',
    )
  }
  return { appToken: node.obj_token, tableId: parsed.tableId, title: node.title || '' }
}

export async function readTable(options) {
  const target = await resolveBase(options.url)
  const tableId = options.tableId || target.tableId
  if (!tableId) {
    throw new DeliveryError('testCases link has no ?table= id and none was configured', 'FEISHU_TABLE_ID_MISSING')
  }
  const token = await tenantToken()
  const cases = []
  let pageToken = ''
  for (let page = 0; page < 100; page += 1) {
    const pathname =
      '/bitable/v1/apps/' + encodeURIComponent(target.appToken) +
      '/tables/' + encodeURIComponent(tableId) +
      '/records?page_size=' + PAGE_SIZE +
      (pageToken ? '&page_token=' + encodeURIComponent(pageToken) : '')
    const data = await apiGet(pathname, token)
    for (const record of data.items || []) cases.push(normalizeCase(record))
    if (!data.has_more) break
    pageToken = data.page_token || ''
    if (!pageToken) break
  }
  return { appToken: target.appToken, tableId, title: target.title, cases }
}

const EQ_PASS = 'PASS'
const EQ_FAIL = 'FAIL'
const STATUS_BLOCKED = '阻塞'
const STATUS_TODO = '未执行'

export function summarizeCases(cases, options) {
  const settings = options || {}
  const wanted = Array.isArray(settings.requiredPriorities) && settings.requiredPriorities.length
    ? new Set(settings.requiredPriorities.map((value) => String(value).toUpperCase()))
    : null
  const ignored = new Set((settings.ignoreResults || ['本期不实现']).map((value) => String(value).trim()))
  const removable = new Set((settings.warnStatuses || ['用例有误']).map((value) => String(value).trim()))

  const buckets = {
    passed: [],
    failed: [],
    blocked: [],
    notRun: [],
    noResult: [],
    needsFix: [],
    ignored: [],
    unknown: [],
  }

  for (const item of cases) {
    if (wanted && !wanted.has(String(item.priority || '').toUpperCase())) continue
    const result = String(item.result || '').trim()
    const status = String(item.status || '').trim()
    if (ignored.has(result) || ignored.has(status)) buckets.ignored.push(item)
    else if (removable.has(status)) buckets.needsFix.push(item)
    else if (result.toUpperCase() === EQ_PASS) buckets.passed.push(item)
    else if (result.toUpperCase() === EQ_FAIL) buckets.failed.push(item)
    else if (status === STATUS_BLOCKED || /blocked/i.test(result)) buckets.blocked.push(item)
    else if (status === STATUS_TODO) buckets.notRun.push(item)
    else if (!result) buckets.noResult.push(item)
    else buckets.unknown.push(item)
  }

  const blocking = [].concat(buckets.failed, buckets.blocked, buckets.notRun, buckets.noResult, buckets.unknown)
  const counts = {}
  for (const key of Object.keys(buckets)) counts[key] = buckets[key].length
  counts.total = cases.filter((item) => !wanted || wanted.has(String(item.priority || '').toUpperCase())).length
  return { ok: blocking.length === 0, counts, blocking, buckets }
}

export function caseLine(item) {
  const label = item.id || item.recordId || '(无编号)'
  const bits = [label, item.title || '(无名称)']
  if (item.result) bits.push('结果=' + item.result)
  if (item.status) bits.push('状态=' + item.status)
  return bits.join(' | ')
}

export default { caseLine, normalizeCase, parseBaseLink, readTable, resolveBase, summarizeCases }
