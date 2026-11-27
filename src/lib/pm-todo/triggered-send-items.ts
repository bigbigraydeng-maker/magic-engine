/**
 * ME 自己发出的信（触发型发信账本 `triggered_sends`）出了要人看的事 → 今日待办。
 * 设计：docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §4.1–4.3、§6.5、§17「P2-2c-3」、§17.4 / §17.7「留给之三」。
 *
 * ## 六类，每个客户每类合成一条（只写封数，不写客人姓名、邮箱：待办会进汇总信、进日志）
 *  1. 结果不明（`unknown_outcome`）还没人标 —— 发信服务那一下没给准话，可能已经发出去了；人标过就离开这个状态；
 *  2. 近 7 天硬退信（`bounced` + `bounce_kind='permanent'`）—— 这个地址收不到信；
 *  3. 近 7 天被投诉（`complained`）—— 一封都算，最急；
 *  4. 发出超过 30 分钟一条回执都没有（`sent` 且 `last_event_type` 为空；回执一到就会写它，`receipt.ts`）——
 *     人标的「已发出」（`reason_code='sent_confirmed'`）本来就不会有回执，不算（§17.7 留给之三 ②）；
 *  5. 近 2 天发信钥匙出错（`failed` + `reason_code='provider_account_error'`，`send-core.ts`）—— 这一轮已经停发；
 *  6. 近 7 天系统自己撤了授权（`revoked_by='system:<代号>'`，`SUPERSEDED` 除外：那是换了一份新提案，不用拍板）——
 *     拍板卡：要不要重新授权（§4.1、§4.3）。
 *
 * ## 纪律
 * 只读，一行写操作都没有。只算真发的行（彩排 `shadow` 行不算，`isLiveScope`）。
 * 读不到 ≠ 没有事：任何一处读失败都留一条 `triggered_send_check_failed`（开发的活），不假装是零；
 * 一次读满上限时写「至少 N 封」，不把截断说成确数。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isLiveScope, isTriggerKey, triggerProfile, WELCOME_TRIGGER } from '@/lib/messaging/triggered-send/trigger-scope'
import { APP_BASE } from './binding-request-items'
import type { ManualItem } from './manual-item-types'

export type TriggeredSendItemKind =
  /** 结果不明、还没人标「已发出 / 没发出」 */
  | 'triggered_send_unknown_outcome'
  /** 近 7 天硬退信 */
  | 'triggered_send_hard_bounced'
  /** 近 7 天被投诉 */
  | 'triggered_send_complained'
  /** 发出超过 30 分钟一条回执都没有 */
  | 'triggered_send_receipts_missing'
  /** 近 2 天发信钥匙出错，这一轮已停发 */
  | 'triggered_send_account_error'
  /** 系统自己撤了自动发信的授权：要不要重新授权（拍板卡） */
  | 'triggered_send_system_revoked'
  /** 这一栏今天没算出来（开发的活） */
  | 'triggered_send_check_failed'

const MINUTE_MS = 60_000
const DAY_MS = 86_400_000
export const RECENT_DAYS = 7
export const ACCOUNT_ERROR_DAYS = 2
export const RECEIPT_GRACE_MINUTES = 30
/** 一次最多读这么多行；读满了就说「至少」。 */
export const READ_LIMIT = 1000
const SENT_CONFIRMED = 'sent_confirmed'
const ACCOUNT_ERROR_REASON = 'provider_account_error'
const SYSTEM_PREFIX = 'system:'
const SUPERSEDED = 'SUPERSEDED'

/** 账本里这条待办读的列：没有地址，没有姓名。 */
export interface LedgerRow {
  clientId: string
  triggerKey: string
  dedupeScope: string
  status: string
  reasonCode: string | null
  bounceKind: string | null
  sentAt: string | null
  lastEventType: string | null
  updatedAt: string
  /** When the last receipt's event happened (bounce / complaint time); null when no receipt moved the row. */
  lastEventAt: string | null
}

export interface RevokedAuthRow {
  clientId: string
  triggerKey: string
  revokedBy: string
  revokedAt: string
}

export const LEDGER_CATEGORIES = ['unknown', 'hardBounced', 'complained', 'receiptsMissing', 'accountError'] as const
export type LedgerCategory = (typeof LEDGER_CATEGORIES)[number]

export interface CategoryCount {
  total: number
  /** trigger_key → 封数 */
  byTrigger: Record<string, number>
  /** 那一次读满了上限：实际可能更多。 */
  atLeast: boolean
}

export type ClientLedgerCounts = Partial<Record<LedgerCategory, CategoryCount>>

function ageMs(iso: string | null, now: Date): number {
  if (iso === null) return Number.NaN
  return now.getTime() - Date.parse(iso)
}

function within(iso: string | null, now: Date, days: number): boolean {
  const age = ageMs(iso, now)
  return !Number.isNaN(age) && age <= days * DAY_MS
}

/** 纯：一行该归哪一类（不归任何一类 = null）。查询已经按类过滤过，这里再判一次，口径只在这一处。 */
export function classifyLedgerRow(r: LedgerRow, now: Date): LedgerCategory | null {
  if (!isLiveScope(r.dedupeScope)) return null
  if (r.status === 'unknown_outcome') return 'unknown'
  if (r.status === 'bounced') return r.bounceKind === 'permanent' && within(r.lastEventAt ?? r.updatedAt, now, RECENT_DAYS) ? 'hardBounced' : null
  if (r.status === 'complained') return within(r.lastEventAt ?? r.updatedAt, now, RECENT_DAYS) ? 'complained' : null
  if (r.status === 'sent') {
    if (r.lastEventType !== null || r.reasonCode === SENT_CONFIRMED) return null
    const age = ageMs(r.sentAt, now)
    return !Number.isNaN(age) && age > RECEIPT_GRACE_MINUTES * MINUTE_MS && age <= RECENT_DAYS * DAY_MS ? 'receiptsMissing' : null
  }
  if (r.status === 'failed' && r.reasonCode === ACCOUNT_ERROR_REASON) return within(r.updatedAt, now, ACCOUNT_ERROR_DAYS) ? 'accountError' : null
  return null
}

/**
 * 纯：按客户、按类数封数。`truncated` = 读满上限的那几类（那几类的数写「至少」）。
 * 同一行出现在两次读取里只算一次（按 id 去重由调用方做；这里按传进来的行数）。
 */
export function countLedgerProblems(rows: readonly LedgerRow[], now: Date, truncated: ReadonlySet<LedgerCategory> = new Set()): Map<string, ClientLedgerCounts> {
  const out = new Map<string, ClientLedgerCounts>()
  for (const r of rows) {
    const cat = classifyLedgerRow(r, now)
    if (cat === null) continue
    const counts = out.get(r.clientId) ?? {}
    const c = counts[cat] ?? { total: 0, byTrigger: {}, atLeast: truncated.has(cat) }
    c.total += 1
    c.byTrigger[r.triggerKey] = (c.byTrigger[r.triggerKey] ?? 0) + 1
    counts[cat] = c
    out.set(r.clientId, counts)
  }
  return out
}

export interface SystemRevocation {
  clientId: string
  triggerKey: string
  /** 去重后的撤销代号，按出现顺序。 */
  codes: string[]
  latestAt: string
}

/** 纯：系统自己撤的授权（不含 SUPERSEDED、不含人撤的），按客户 + 信的种类合并，只看近 7 天。 */
export function systemRevocations(rows: readonly RevokedAuthRow[], now: Date): SystemRevocation[] {
  const byKey = new Map<string, SystemRevocation>()
  for (const r of rows) {
    if (!r.revokedBy.startsWith(SYSTEM_PREFIX)) continue
    const code = r.revokedBy.slice(SYSTEM_PREFIX.length)
    if (code === SUPERSEDED || code.length === 0 || !within(r.revokedAt, now, RECENT_DAYS)) continue
    const key = `${r.clientId}\u0000${r.triggerKey}`
    const found = byKey.get(key) ?? { clientId: r.clientId, triggerKey: r.triggerKey, codes: [], latestAt: r.revokedAt }
    if (!found.codes.includes(code)) found.codes.push(code)
    if (Date.parse(r.revokedAt) > Date.parse(found.latestAt)) found.latestAt = r.revokedAt
    byKey.set(key, found)
  }
  return [...byKey.values()]
}

// ── 文案 ──────────────────────────────────────────────────────────────────

const REVOKE_REASON_TEXT: Readonly<Record<string, string>> = {
  GATE_CHANGED: '发信前要过的那套检查升级了，你当初批的是旧的那一套',
  TEMPLATE_CHANGED: '信的内容被改过，跟你批的那一版不一样了',
  RULE_INVALID: '授权里存的发信规则系统读不懂了（被改坏，或系统升级后对不上）',
  HEALTH_BREAKER: '最近 30 天退信太多或有客人投诉，超过了我们自己定的安全线',
  PROVIDER_FAILURE: '发信服务连着拒收了 3 封信',
}

export function revokeReasonText(code: string): string {
  return REVOKE_REASON_TEXT[code] ?? `系统代号 ${code}，开发窗口可以查是什么意思`
}

function letterLabel(triggerKey: string): string {
  return isTriggerKey(triggerKey) ? triggerProfile(triggerKey).label : '自动发的信'
}

/** 「3 封（欢迎信 2 封、AI 跟进信 1 封）」；只有一种信时不加括号，写成「3 封欢迎信」。 */
export function countPhrase(c: CategoryCount): string {
  const n = `${c.atLeast ? '至少 ' : ''}${c.total} 封`
  const parts = Object.entries(c.byTrigger)
  if (parts.length === 1) return `${n}${letterLabel(parts[0]?.[0] ?? '')}`
  return `${n}自动发的信（${parts.map(([k, v]) => `${letterLabel(k)} ${v} 封`).join('、')}）`
}

function clientPath(clientId: string, rest: string): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}/crm/${rest}`
}

/** 欢迎信有自己的授权页（能标「已发出 / 没发出」、能授权、能撤销）；其它种类的信先去「自动发信」页看。 */
export function lettersHref(clientId: string, triggerKeys: readonly string[]): string {
  const onlyWelcome = triggerKeys.length > 0 && triggerKeys.every((k) => k === WELCOME_TRIGGER)
  return clientPath(clientId, onlyWelcome ? 'welcome-letter' : 'auto-letters')
}

/** 失败那条落在开发欠账栏。 */
export const DEV_DEBT_HREF = `${APP_BASE}/dashboard/admin/cron-health#dev-debt`

// ── 待办条目 ──────────────────────────────────────────────────────────────

interface ItemBase {
  clientId: string
  clientName: string
}

function hasOther(c: CategoryCount): boolean {
  return Object.keys(c.byTrigger).some((k) => k !== WELCOME_TRIGGER)
}

function unknownItem(b: ItemBase, c: CategoryCount): ManualItem {
  const how =
    '点链接打开欢迎信那一页的「② 最近发送」，结果不明的排在最前面。先去发信服务后台按时间找这封信，或直接问客人收没收到，' +
    '再在那一封上点「已发出」或「没发出」（点「没发出」= 系统以后不会再自动给这位客人发这封信，要销售自己写）。核对之前别让销售再手发一封。'
  const otherHow = hasOther(c)
    ? '其中 AI 跟进信页面上还标不了：先别重发，在发信开发窗口说一句「核对 AI 跟进信结果不明的那几封」。'
    : ''
  return {
    kind: 'triggered_send_unknown_outcome',
    client_id: b.clientId,
    client_name: b.clientName,
    what: `${b.clientName} 有 ${countPhrase(c)}不知道发没发出去，要人核对。发信服务那一下没给准话，信可能已经到了客人手里，系统不会自己重发`,
    how: `${how}${otherHow}`,
    href: lettersHref(b.clientId, Object.keys(c.byTrigger)),
  }
}

function hardBouncedItem(b: ItemBase, c: CategoryCount): ManualItem {
  return {
    kind: 'triggered_send_hard_bounced',
    client_id: b.clientId,
    client_name: b.clientName,
    what: `${b.clientName} 近 7 天有 ${countPhrase(c)}被退回来了（邮箱地址不存在或收不了信）。这些客人没收到信，以后发给这个地址也收不到`,
    how:
      '请转给客户的销售：点链接看「最近发送」里标「退信」的那几位，点「看客人」进资料页，打电话或发 WhatsApp 问一个能用的邮箱，' +
      '改好记一笔。退信超过授权时你批的安全线，系统会自动停发（安全线在「欢迎信自动发送」页的规则摘要里）。',
    href: lettersHref(b.clientId, Object.keys(c.byTrigger)),
  }
}

function complainedItem(b: ItemBase, c: CategoryCount): ManualItem {
  return {
    kind: 'triggered_send_complained',
    client_id: b.clientId,
    client_name: b.clientName,
    what:
      `${b.clientName} 近 7 天有 ${countPhrase(c)}被客人点了「垃圾邮件 / 投诉」。一封都算急事：投诉多了会连累这个客户所有邮件进垃圾箱，` +
      '投诉次数到了授权时你批的安全线，系统会自动停掉自动发信',
    how:
      '点链接看「最近发送」里标「投诉」的那几位。系统已经把投诉的人记成邮件退订，自动信不会再发给他；请转告客户的销售也别再给他发邮件。' +
      '再看一眼这封信的内容和发信时间是不是让人反感，要改信或先停发就回我一句「停发」或「改信」。',
    href: lettersHref(b.clientId, Object.keys(c.byTrigger)),
  }
}

function receiptsMissingItem(b: ItemBase, c: CategoryCount): ManualItem {
  return {
    kind: 'triggered_send_receipts_missing',
    client_id: b.clientId,
    client_name: b.clientName,
    what:
      `${b.clientName} 近 7 天有 ${countPhrase(c)}发出超过 30 分钟，还没有送达或退信的回执（送没送到、退没退信都不知道）。` +
      '回执断了，退信和投诉也会看不见，自动停发的安全线跟着失灵',
    how:
      '开发窗口查：1. 发信服务后台这几封的事件有没有推过来（回执地址配没配对）；2. ME 收回执的接口和处理回执的后台任务有没有报错；' +
      '3. 账本里这几封的消息号是不是空的。修好前看「最近发送」页，别把「没回执」当成「送到了」。',
    href: lettersHref(b.clientId, Object.keys(c.byTrigger)),
  }
}

function accountErrorItem(b: ItemBase, c: CategoryCount): ManualItem {
  return {
    kind: 'triggered_send_account_error',
    client_id: b.clientId,
    client_name: b.clientName,
    what:
      `${b.clientName} 近 2 天有 ${countPhrase(c)}因为发信账号的钥匙出错没发出去（钥匙失效、被删，或发信域名没验证通过）。` +
      '出错那一轮系统已经停了，后面的客人也收不到',
    how:
      '1. 打开发信服务后台，看这个客户用的那把钥匙还在不在、发信域名是不是「已验证」；2. 钥匙不对就新建一把，自己粘进 Render 的环境变量，' +
      '再手动部署一次（Render 改变量不会自己重新部署）；3. 第二天看「最近发送」有没有恢复。',
    href: lettersHref(b.clientId, Object.keys(c.byTrigger)),
  }
}

const LEDGER_BUILDERS: Readonly<Record<LedgerCategory, (b: ItemBase, c: CategoryCount) => ManualItem>> = {
  unknown: unknownItem,
  hardBounced: hardBouncedItem,
  complained: complainedItem,
  receiptsMissing: receiptsMissingItem,
  accountError: accountErrorItem,
}

/** 纯：一个客户的账本问题 → 待办（按 LEDGER_CATEGORIES 的顺序，没有的类不出条）。 */
export function buildLedgerItems(clientId: string, clientName: string, counts: ClientLedgerCounts): ManualItem[] {
  const out: ManualItem[] = []
  for (const cat of LEDGER_CATEGORIES) {
    const c = counts[cat]
    if (c !== undefined && c.total > 0) out.push(LEDGER_BUILDERS[cat]({ clientId, clientName }, c))
  }
  return out
}

/** 纯：系统撤了授权 → 拍板卡。 */
export function buildRevocationItem(r: SystemRevocation, clientName: string): ManualItem {
  const label = letterLabel(r.triggerKey)
  const reasons = r.codes.map(revokeReasonText).join('；')
  const welcome = r.triggerKey === WELCOME_TRIGGER
  const how = welcome
    ? '点链接打开欢迎信那一页：先看原因是不是已经处理好（信的内容对不对、退信投诉是不是查清了）。要恢复就让发信开发窗口提一份新提案，你在这一页看过再点「授权」；不恢复就什么都不用点，自动发信保持停着。'
    : `${label}的授权还没有页面上的按钮：要恢复就在发信开发窗口说一句「重新提${label}的授权」，提好后由你本人批；不恢复就什么都不用做，自动发信保持停着。`
  return {
    kind: 'triggered_send_system_revoked',
    client_id: r.clientId,
    client_name: clientName,
    what: `系统自动停了 ${clientName} 的${label}自动发送（原因：${reasons}），要你决定要不要重新授权。停着期间新客人不会自动收到这封信`,
    how,
    href: lettersHref(r.clientId, [r.triggerKey]),
  }
}

// ── 读库（只读）─────────────────────────────────────────────────────────

const LEDGER_COLUMNS = 'id, client_id, trigger_key, dedupe_scope, status, reason_code, bounce_kind, sent_at, last_event_type, last_event_at, updated_at'

interface LedgerRead extends LedgerRow {
  id: string
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function toLedgerRow(v: unknown): LedgerRead | null {
  if (typeof v !== 'object' || v === null) return null
  const r = v as Record<string, unknown>
  const id = str(r.id)
  const clientId = str(r.client_id)
  const status = str(r.status)
  const updatedAt = str(r.updated_at)
  if (id === null || clientId === null || status === null || updatedAt === null) return null
  return {
    id,
    clientId,
    triggerKey: str(r.trigger_key) ?? '',
    dedupeScope: str(r.dedupe_scope) ?? '',
    status,
    reasonCode: str(r.reason_code),
    bounceKind: str(r.bounce_kind),
    sentAt: str(r.sent_at),
    lastEventType: str(r.last_event_type),
    updatedAt,
    lastEventAt: str(r.last_event_at),
  }
}

function toRevokedRow(v: unknown): RevokedAuthRow | null {
  if (typeof v !== 'object' || v === null) return null
  const r = v as Record<string, unknown>
  const clientId = str(r.client_id)
  const revokedBy = str(r.revoked_by)
  const revokedAt = str(r.revoked_at)
  if (clientId === null || revokedBy === null || revokedAt === null) return null
  return { clientId, triggerKey: str(r.trigger_key) ?? '', revokedBy, revokedAt }
}

export interface TriggeredSendSnapshot {
  ledger: LedgerRow[]
  /** 读满上限的那几类。 */
  truncated: Set<LedgerCategory>
  revoked: RevokedAuthRow[]
}

/** 取数依赖：测试里注入假的，生产走默认实现。任何一处读失败都抛（调用方留「没算出来」待办）。 */
export interface TriggeredSendDeps {
  load: (supabase: SupabaseClient, clientIds: readonly string[], now: Date) => Promise<TriggeredSendSnapshot>
}

interface ReadResult {
  data: unknown[] | null
  error: { message: string } | null
}

/** 一类一次查询；数据库这边先过滤，`classifyLedgerRow` 再判一次。 */
async function readCategory(supabase: SupabaseClient, ids: readonly string[], now: Date, cat: LedgerCategory): Promise<ReadResult> {
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()
  const q = supabase.from('triggered_sends').select(LEDGER_COLUMNS).in('client_id', [...ids]).neq('dedupe_scope', 'shadow')
  switch (cat) {
    case 'unknown':
      return q.eq('status', 'unknown_outcome').limit(READ_LIMIT)
    case 'hardBounced':
      return q.eq('status', 'bounced').eq('bounce_kind', 'permanent').gte('last_event_at', ago(RECENT_DAYS * DAY_MS)).limit(READ_LIMIT)
    case 'complained':
      // By when the bounce / complaint happened, not when the row was last touched (魏征 P2-5, 子牙 P2-4).
      return q.eq('status', 'complained').gte('last_event_at', ago(RECENT_DAYS * DAY_MS)).limit(READ_LIMIT)
    case 'receiptsMissing':
      return q
        .eq('status', 'sent')
        .is('last_event_type', null)
        .lte('sent_at', ago(RECEIPT_GRACE_MINUTES * MINUTE_MS))
        .gte('sent_at', ago(RECENT_DAYS * DAY_MS))
        .limit(READ_LIMIT)
    case 'accountError':
      return q.eq('status', 'failed').eq('reason_code', ACCOUNT_ERROR_REASON).gte('updated_at', ago(ACCOUNT_ERROR_DAYS * DAY_MS)).limit(READ_LIMIT)
  }
}

async function readLedger(supabase: SupabaseClient, ids: readonly string[], now: Date): Promise<{ rows: LedgerRow[]; truncated: Set<LedgerCategory> }> {
  const results = await Promise.all(LEDGER_CATEGORIES.map(async (cat) => ({ cat, res: await readCategory(supabase, ids, now, cat) })))
  const byId = new Map<string, LedgerRow>()
  const truncated = new Set<LedgerCategory>()
  for (const { cat, res } of results) {
    if (res.error) throw new Error(`账本（${cat}）：${res.error.message}`)
    const data: unknown[] = Array.isArray(res.data) ? res.data : []
    if (data.length >= READ_LIMIT) truncated.add(cat)
    for (const raw of data) {
      const row = toLedgerRow(raw)
      if (row !== null) byId.set(row.id, row)
    }
  }
  return { rows: [...byId.values()], truncated }
}

async function readRevoked(supabase: SupabaseClient, ids: readonly string[], now: Date): Promise<RevokedAuthRow[]> {
  const { data, error } = await supabase
    .from('triggered_send_authorizations')
    .select('client_id, trigger_key, revoked_by, revoked_at')
    .in('client_id', [...ids])
    .like('revoked_by', `${SYSTEM_PREFIX}%`)
    .neq('revoked_by', `${SYSTEM_PREFIX}${SUPERSEDED}`)
    .gte('revoked_at', new Date(now.getTime() - RECENT_DAYS * DAY_MS).toISOString())
    .limit(READ_LIMIT)
  if (error) throw new Error(`授权表：${error.message}`)
  const out: RevokedAuthRow[] = []
  for (const raw of Array.isArray(data) ? data : []) {
    const row = toRevokedRow(raw)
    if (row !== null) out.push(row)
  }
  return out
}

export const defaultTriggeredSendDeps: TriggeredSendDeps = {
  async load(supabase, clientIds, now) {
    if (clientIds.length === 0) return { ledger: [], truncated: new Set(), revoked: [] }
    const [ledger, revoked] = await Promise.all([readLedger(supabase, clientIds, now), readRevoked(supabase, clientIds, now)])
    return { ledger: ledger.rows, truncated: ledger.truncated, revoked }
  },
}

function errorSnippet(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.length > 120 ? `${msg.slice(0, 120)}…` : msg
}

/** 纯：快照 → 全部待办（客户按 ids 的顺序；不在 ids 里的客户不出条）。 */
export function buildTriggeredSendItems(snap: TriggeredSendSnapshot, ids: readonly string[], now: Date, nameOf: (id: string) => string): ManualItem[] {
  const counts = countLedgerProblems(snap.ledger, now, snap.truncated)
  const revocations = systemRevocations(snap.revoked, now)
  const out: ManualItem[] = []
  for (const id of ids) {
    const name = nameOf(id)
    for (const r of revocations) if (r.clientId === id) out.push(buildRevocationItem(r, name))
    const c = counts.get(id)
    if (c !== undefined) out.push(...buildLedgerItems(id, name, c))
  }
  return out
}

/**
 * 调用方在 `loadManualItems` 里挂 `.catch` 只是第二道保险：读失败在这里就变成一条待办，不靠日志。
 * 所有客户一次读（六次查询），读不到就整栏一条「没算出来」—— 不按客户拆，免得一处故障刷出十几条。
 */
export async function pushTriggeredSendItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  ids: string[],
  now: Date,
  nameOf: (id: string) => string,
  deps: TriggeredSendDeps = defaultTriggeredSendDeps,
): Promise<void> {
  try {
    const snap = await deps.load(supabase, ids, now)
    items.push(...buildTriggeredSendItems(snap, ids, now, nameOf))
  } catch (err) {
    items.push({
      kind: 'triggered_send_check_failed',
      client_id: '',
      client_name: '',
      what:
        `「ME 自己发出的信」这一栏今天没算出来（${errorSnippet(err)}）。这时候看不到这条，不等于没有结果不明、退信、投诉或被系统停掉的自动发信`,
      how: '开发窗口查发信账本（triggered_sends）和授权表（triggered_send_authorizations）哪一处读失败；修好前请打开各客户 CRM 里的「欢迎信」页和「自动发信」页自己看一眼。',
      href: DEV_DEBT_HREF,
    })
  }
}
