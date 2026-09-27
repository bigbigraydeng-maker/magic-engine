import { parse as parseYaml } from 'yaml'
import { parseRef, LEDGER_REF_HELP } from './refs'
import { LEDGER_OWNERS, LEDGER_STATUSES, REF_KINDS_BY_FIELD, type LedgerEntry, type LedgerOwner, type LedgerParseResult, type LedgerStatus, type LedgerWarning } from './types'

type RefField = keyof typeof REF_KINDS_BY_FIELD

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// 10 位以上连续数字像账户号，台账只写指针不抄正文
const ACCOUNT_RE = /\d{10,}/

export const MAX_BODY_LINES = 5
export const BODY_RULE_ROLLOUT = '2026-09-29'
const BODY_VERBOSE_THRESHOLD = 20

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

/** 校验指向字段的写法与类型白名单，返回第一个不合规的字段名 */
function firstBadRef(obj: Record<string, unknown>): RefField | null {
  for (const [key, kinds] of Object.entries(REF_KINDS_BY_FIELD) as [RefField, readonly string[]][]) {
    const value = str(obj, key)
    if (value === null) continue
    const ref = parseRef(value)
    if (ref === null || !(kinds as readonly string[]).includes(ref.kind)) return key
  }
  return null
}

/** 状态与各日期/指向字段的搭配规则，返回第一条违规说明 */
function statusShapeError(raw: Record<string, unknown>, status: string): string | null {
  const decidedOn = str(raw, 'decided_on') as string
  const doneOn = str(raw, 'done_on')
  const doneRef = str(raw, 'done_ref')
  const verifiedRef = str(raw, 'verified_ref')
  const lastChecked = str(raw, 'last_checked')

  if (status === 'decided' && (doneOn !== null || doneRef !== null || verifiedRef !== null)) {
    return 'status 为 decided 时不能填 done_on / done_ref / verified_ref'
  }
  if (doneOn !== null && doneOn < decidedOn) return 'done_on 不能早于 decided_on'
  if (status === 'verified' || status === 'failed') {
    if (lastChecked === null) return `status 为 ${status} 时必须填 last_checked`
    if (doneOn !== null && lastChecked < doneOn) return 'last_checked 不能早于 done_on'
    if (verifiedRef !== null && verifiedRef === doneRef) {
      return 'verified_ref 不能跟 done_ref 是同一个——证据不能是"做的那个 PR"本身'
    }
  }
  return null
}

/** 文件头的字段级校验（缺字段 / id / status / owner / 指向 / 日期 / done 与 verified 必填），返回第一条违规说明 */
function headerError(raw: Record<string, unknown>, file: string): string | null {
  const missing = firstMissing(raw, ['id', 'title', 'status', 'owner', 'decided_on', 'source', 'verify_how'])
  if (missing !== null) return `缺少字段 ${missing}`

  const id = str(raw, 'id') as string
  if (id !== file.replace(/\.md$/, '')) return 'id 跟文件名对不上'

  const status = str(raw, 'status') as string
  if (!LEDGER_STATUSES.includes(status as LedgerStatus)) {
    return 'status 只能是 decided/done/verified/failed'
  }
  const owner = str(raw, 'owner') as string
  if (!LEDGER_OWNERS.includes(owner as LedgerOwner)) {
    return 'owner 只能是 pm/agent'
  }

  const badRef = firstBadRef(raw)
  if (badRef !== null) {
    return `${badRef} 格式不对或类型不允许（${LEDGER_REF_HELP}；${badRef} 只准 ${REF_KINDS_BY_FIELD[badRef].join('/')}）`
  }

  const badDate = firstBadDate(raw, ['decided_on', 'verify_by', 'done_on', 'last_checked'])
  if (badDate !== null) return `${badDate} 不是 YYYY-MM-DD`

  return requiredByStatusError(raw, status)
}

/** 按 status 校验 done_on / done_ref / verified_ref 的必填，返回第一条违规说明 */
function requiredByStatusError(raw: Record<string, unknown>, status: string): string | null {
  const doneOn = str(raw, 'done_on')
  const doneRef = str(raw, 'done_ref')
  const verifiedRef = str(raw, 'verified_ref')
  if (status !== 'decided' && (doneOn === null || doneRef === null)) {
    return `status 为 ${status} 时必须填 done_on 和 done_ref`
  }
  if ((status === 'verified' || status === 'failed') && verifiedRef === null) {
    return `status 为 ${status} 时必须填 verified_ref`
  }
  return null
}

export function parseLedgerFile(file: string, text: string): LedgerParseResult {
  const normalised = text.replace(/\r\n/g, '\n')
  const split = splitFrontmatter(normalised)
  if (split === null) return fail(file, '缺少文件头（--- ... ---）')

  if (ACCOUNT_RE.test(normalised)) {
    return fail(file, '文件里有 10 位以上连续数字（像账户号），台账只写指针')
  }

  let raw: unknown
  try {
    raw = parseYaml(split.yaml)
  } catch {
    return fail(file, '文件头不是键值对')
  }
  if (!isPlainObject(raw)) return fail(file, '文件头不是键值对')

  const headerProblem = headerError(raw, file)
  if (headerProblem !== null) return fail(file, headerProblem)

  const status = str(raw, 'status') as string
  const shapeError = statusShapeError(raw, status)
  if (shapeError !== null) return fail(file, shapeError)

  const body = split.body.trim()
  const warnings: LedgerWarning[] = []

  const bodyLines = body === '' ? 0 : body.split('\n').length
  const decidedOn = str(raw, 'decided_on') as string
  if (bodyLines > MAX_BODY_LINES) {
    if (decidedOn >= BODY_RULE_ROLLOUT) {
      return fail(file, `正文 ${bodyLines} 行，超过上限 ${MAX_BODY_LINES} 行（README 规则）`)
    }
    const msg = bodyLines > BODY_VERBOSE_THRESHOLD
      ? `正文 ${bodyLines} 行，超过上限 ${MAX_BODY_LINES} 行。超过 20 行的细节建议移到 docs/audits/，台账只留指针`
      : `正文 ${bodyLines} 行，超过上限 ${MAX_BODY_LINES} 行（上线前的老卡，只提示不拦）`
    warnings.push({ file, message: msg })
  }

  const entry: LedgerEntry = {
    id: str(raw, 'id') as string,
    title: str(raw, 'title') as string,
    status: status as LedgerStatus,
    owner: str(raw, 'owner') as LedgerOwner,
    decidedOn,
    source: str(raw, 'source') as string,
    verifyBy: str(raw, 'verify_by'),
    verifyHow: str(raw, 'verify_how') as string,
    doneOn: str(raw, 'done_on'),
    doneRef: str(raw, 'done_ref'),
    verifiedRef: str(raw, 'verified_ref'),
    lastChecked: str(raw, 'last_checked'),
    checkNote: str(raw, 'check_note'),
    body,
  }
  return { ok: true, entry, warnings }
}
