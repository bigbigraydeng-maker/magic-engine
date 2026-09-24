import { parse as parseYaml } from 'yaml'
import { LEDGER_OWNERS, LEDGER_STATUSES, type LedgerEntry, type LedgerOwner, type LedgerParseResult, type LedgerStatus } from './types'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// 10 位以上连续数字像账户号，台账只写指针不抄正文
const ACCOUNT_RE = /\d{10,}/

function fail(file: string, reason: string): LedgerParseResult {
  return { ok: false, error: { file, reason } }
}

/** 取一个去空白的字符串字段，非字符串或空白都算缺失 */
function str(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** 拆出文件头 YAML 块和正文；找不到闭合分隔符返回 null */
function splitFrontmatter(text: string): { yaml: string; body: string } | null {
  if (!text.startsWith('---\n')) return null
  const rest = text.slice(4)
  const close = rest.indexOf('\n---')
  if (close === -1) return null
  const after = rest.slice(close + 4)
  // 闭合符后要么是换行（正文另起），要么就是文件结尾
  if (after !== '' && !after.startsWith('\n')) return null
  return { yaml: rest.slice(0, close), body: after.replace(/^\n/, '') }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 校验必填字符串字段，返回第一个缺失的字段名 */
function firstMissing(obj: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    if (str(obj, key) === null) return key
  }
  return null
}

/** 校验日期字段格式，返回第一个格式不对的字段名 */
function firstBadDate(obj: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = str(obj, key)
    if (value !== null && !DATE_RE.test(value)) return key
  }
  return null
}

export function parseLedgerFile(file: string, text: string): LedgerParseResult {
  const split = splitFrontmatter(text)
  if (split === null) return fail(file, '缺少文件头（--- ... ---）')

  let raw: unknown
  try {
    raw = parseYaml(split.yaml)
  } catch {
    return fail(file, '文件头不是键值对')
  }
  if (!isPlainObject(raw)) return fail(file, '文件头不是键值对')

  const missing = firstMissing(raw, ['id', 'title', 'status', 'owner', 'decided_on', 'source', 'verify_how'])
  if (missing !== null) return fail(file, `缺少字段 ${missing}`)

  const id = str(raw, 'id') as string
  if (id !== file.replace(/\.md$/, '')) return fail(file, 'id 跟文件名对不上')

  const status = str(raw, 'status') as string
  if (!LEDGER_STATUSES.includes(status as LedgerStatus)) {
    return fail(file, 'status 只能是 decided/done/verified/failed')
  }
  const owner = str(raw, 'owner') as string
  if (!LEDGER_OWNERS.includes(owner as LedgerOwner)) {
    return fail(file, 'owner 只能是 pm/agent')
  }

  const badDate = firstBadDate(raw, ['decided_on', 'verify_by', 'done_on'])
  if (badDate !== null) return fail(file, `${badDate} 不是 YYYY-MM-DD`)

  const doneOn = str(raw, 'done_on')
  const doneRef = str(raw, 'done_ref')
  const verifiedRef = str(raw, 'verified_ref')
  if (status !== 'decided' && (doneOn === null || doneRef === null)) {
    return fail(file, `status 为 ${status} 时必须填 done_on 和 done_ref`)
  }
  if ((status === 'verified' || status === 'failed') && verifiedRef === null) {
    return fail(file, `status 为 ${status} 时必须填 verified_ref`)
  }

  const body = split.body.trim()
  if (ACCOUNT_RE.test(body)) {
    return fail(file, '正文里有 10 位以上连续数字（像账户号），台账只写指针')
  }

  const entry: LedgerEntry = {
    id,
    title: str(raw, 'title') as string,
    status: status as LedgerStatus,
    owner: owner as LedgerOwner,
    decidedOn: str(raw, 'decided_on') as string,
    source: str(raw, 'source') as string,
    verifyBy: str(raw, 'verify_by'),
    verifyHow: str(raw, 'verify_how') as string,
    doneOn,
    doneRef,
    verifiedRef,
    body,
  }
  return { ok: true, entry }
}
