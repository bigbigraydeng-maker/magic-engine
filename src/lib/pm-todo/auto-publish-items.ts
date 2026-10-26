/**
 * 今日待办里的「自动发布没发出去 / 不知道发没发出去 / 授权了却什么都没发生」。
 *
 * 数据来源：`daily_plan_auto_publish_attempts`（每条帖子的发布尝试）和
 * `daily_plan_auto_publish_auth`（客户在发布面板里点过的「授权自动发布」）。
 *
 * 拉模式：直接查库，事件丢了、进程重启了，待办照样出得来。
 *
 * 两条通道，各管一件事：
 *
 * 1. **尝试要人看**（`auto_publish_stalled` / `auto_publish_unknown_outcome`）——
 *    某条帖子今天该发，但发失败了、或者系统不确定发没发出去。后者最要命：
 *    为防重复发布，系统不会自动重试，只能人打开客户主页看一眼到底有没有。
 *
 * 2. **看门狗**（`auto_publish_unarmed`）—— 客户授权了、日期也到了，但库里
 *    一条尝试记录都没有。这说明发布器根本没跑起来（定时任务没跑 / 开关没开 /
 *    还在演练模式），而不是「跑了但失败」。没有这条，一个静默死掉的发布器
 *    可以一直不吭声。
 *
 * 3. **记录对不上**（`auto_publish_record_conflict`）—— 尝试记录写着「已撤回」（墓碑），
 *    但该计划的发布回执里同一天又出现了一条比墓碑更晚发出的帖子。典型来路：自动发布器
 *    发出帖子之后才发现自己那行占位已被撤回墓碑顶掉，帖子发出去了却没处记账。
 *    这种帖子只存在于主页上，系统自己的记录里是「没发」，必须人去看一眼。
 *
 * 本文件一行写操作都没有：只读事件、生成待办。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { APP_BASE } from './binding-request-items'

export type AutoPublishItemKind =
  | 'auto_publish_stalled'
  | 'auto_publish_unknown_outcome'
  | 'auto_publish_unarmed'
  | 'auto_publish_record_conflict'

const NZ_TZ = 'Pacific/Auckland'

/** 授权后超过这么久还没有任何尝试记录 = 发布器没跑起来。 */
const WATCHDOG_GRACE_MS = 2 * 60 * 60 * 1000

/**
 * 「失败 / 时间已过」类只看最近这些天：更早的已经没意义。
 * 但「不确定有没有发出去」不受这个限制 —— 它没人收口就会一直挂在主页上，必须一直出现直到有人确认。
 */
const ATTEMPT_LOOKBACK_DAYS = 14

/** 这些状态是「要人看」的。 */
const ATTENTION_STATUSES = new Set(['failed_final', 'unknown_outcome', 'missed_window'])

/** True for a plain object (not null, not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A string, or '' for anything else. */
function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** YYYY-MM-DD of `now` in Pacific/Auckland. */
function nzDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: NZ_TZ }).format(now)
}

/** YYYY-MM-DD `days` calendar days after `iso` (UTC date arithmetic, no timezone drift). */
function addDays(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`)
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10)
}

function clientHref(clientId: string): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}`
}

/** 一行 `daily_plan_auto_publish_attempts`（只声明这条待办用得到的列）。 */
interface AttemptRow {
  client_id: string
  plan_id: string
  date: string
  status: string
  reason_code: string | null
  updated_at: string
}

/** 一行 `daily_plan_auto_publish_auth`（只声明这条待办用得到的列）。 */
interface AuthRow {
  client_id: string
  plan_id: string
  dates: string[]
  authorized_at: string
  activated_at: string | null
  expires_at: string | null
  revoked_at: string | null
}

/** Narrow one attempts row; returns null when it has no usable client/date. */
function narrowAttempt(value: unknown): AttemptRow | null {
  if (!isRecord(value)) return null
  const clientId = str(value.client_id)
  const date = str(value.date)
  if (!clientId || !date) return null
  return {
    client_id: clientId,
    plan_id: str(value.plan_id),
    date,
    status: str(value.status),
    reason_code: typeof value.reason_code === 'string' ? value.reason_code : null,
    updated_at: str(value.updated_at),
  }
}

/** Narrow one auth row; returns null when it has no usable client/plan. */
function narrowAuth(value: unknown): AuthRow | null {
  if (!isRecord(value)) return null
  const clientId = str(value.client_id)
  const planId = str(value.plan_id)
  if (!clientId || !planId) return null
  const rawDates = value.dates
  const dates: string[] = []
  if (Array.isArray(rawDates)) {
    for (const d of rawDates) {
      const s = str(d)
      if (s) dates.push(s)
    }
  }
  return {
    client_id: clientId,
    plan_id: planId,
    dates,
    authorized_at: str(value.authorized_at),
    activated_at: typeof value.activated_at === 'string' ? value.activated_at : null,
    expires_at: typeof value.expires_at === 'string' ? value.expires_at : null,
    revoked_at: typeof value.revoked_at === 'string' ? value.revoked_at : null,
  }
}

/** 这条尝试是不是「要人看」的。 */
function needsAttention(row: AttemptRow): boolean {
  // 撤回留下的记号不是故障，是人为撤下 —— 不出待办。
  if (row.status === 'blocked' && row.reason_code === 'RECALLED') return false
  if (ATTENTION_STATUSES.has(row.status)) return true
  if (row.status !== 'blocked') return false
  // 价格类拦截也要出：每日计划里的价格拦截没有别的待办覆盖（旧的价格闸待办扫的是另一张内容表，
  // 价格数字待办判的文本与发布出口不完全一样），豁免它 = 这些帖子永远发不出去却没人知道。
  return true
}

/** 把一条尝试的原因说成人话。 */
function reasonWords(row: AttemptRow): string {
  if (row.status === 'missed_window') return '发布时间已过，没有补发'
  if (row.status === 'failed_final') return '多次尝试仍失败'
  if (row.status === 'blocked') {
    return `被发布前检查拦住了（原因代码 ${row.reason_code ?? '未标注'}）`
  }
  return `发布没成功（状态 ${row.status}）`
}

/** 一个客户、一种待办攒下来的尝试。 */
interface ClientAttempts {
  clientId: string
  /** true = 「不确定有没有发出去」那一类；false = 其余（被拦 / 多次失败 / 时间已过）。 */
  unknownOutcome: boolean
  dates: string[]
  reasons: string[]
}

/** 把要人看的尝试按「客户 + 种类」归拢：不确定的单独一条，其余失败另一条，互不遮挡。 */
function groupAttempts(rows: AttemptRow[], today: string): ClientAttempts[] {
  const cutoff = addDays(today, -ATTEMPT_LOOKBACK_DAYS)
  const groups = new Map<string, ClientAttempts>()
  for (const row of rows) {
    if (!needsAttention(row)) continue
    const unknown = row.status === 'unknown_outcome'
    // 「不确定」不设日期下限；其余类型只看最近几天。
    if (!unknown && row.date < cutoff) continue
    const key = `${row.client_id}:${unknown ? 'unknown' : 'stalled'}`
    const cur = groups.get(key) ?? { clientId: row.client_id, unknownOutcome: unknown, dates: [], reasons: [] }
    if (!cur.dates.includes(row.date)) cur.dates.push(row.date)
    const reason = reasonWords(row)
    if (!cur.reasons.includes(reason)) cur.reasons.push(reason)
    groups.set(key, cur)
  }
  return Array.from(groups.values())
}

/** 一条「尝试要人看」的待办。 */
function buildAttemptItem(
  agg: ClientAttempts,
  clientName: string,
): ManualItem {
  const dates = agg.dates.slice().sort().join('、')
  const count = agg.dates.length
  if (agg.unknownOutcome) {
    return {
      kind: 'auto_publish_unknown_outcome',
      client_id: agg.clientId,
      client_name: clientName,
      what:
        `${clientName} 有 ${count} 条帖子（${dates}）系统不确定有没有发出去 —— ` +
        `为防重复发布，系统不会自动重试，只能人看一眼到底发没发。`,
      how:
        '打开客户的 Facebook 主页，看「已定时」和「已发布」里有没有这几个日期的帖子；' +
        `有就在发布面板里回我「已发出 ${agg.dates.slice().sort()[0]}」，没有就回我「没发出 ${agg.dates.slice().sort()[0]}」，我来登记。`,
      href: clientHref(agg.clientId),
    }
  }
  const reasons = agg.reasons.join('；')
  return {
    kind: 'auto_publish_stalled',
    client_id: agg.clientId,
    client_name: clientName,
    what:
      `${clientName} 有 ${count} 条帖子（${dates}）没能自动发出去：${reasons}。`,
    how: '打开链接里的发布面板看每条的状态，要重发或改日期就回我一句话。',
    href: clientHref(agg.clientId),
  }
}

/** 一条「授权了却什么都没发生」的待办。 */
function buildUnarmedItem(
  clientId: string,
  clientName: string,
  dates: string[],
  live: boolean,
): ManualItem {
  const dateList = dates.slice().sort().join('、')
  const tail = live
    ? '库里一条发布尝试记录都没有，说明发布器根本没跑起来。'
    : '自动发布现在还是演练模式（dry run），不会真的发出去，所以库里一条尝试记录都没有。'
  return {
    kind: 'auto_publish_unarmed',
    client_id: clientId,
    client_name: clientName,
    what: `${clientName} 已经授权自动发布，${dateList} 的帖子该发了，但${tail}`,
    how: '回我一句，我来查定时任务和开关。',
    href: clientHref(clientId),
  }
}

/** 一条「记录对不上」的待办。 */
function buildConflictItem(clientId: string, clientName: string, dates: string[]): ManualItem {
  const dateList = dates.slice().sort().join('、')
  return {
    kind: 'auto_publish_record_conflict',
    client_id: clientId,
    client_name: clientName,
    what:
      `${clientName} 的 ${dateList} 这几天，系统记录写着「已撤回」，但发布回执里之后又出现了一条新发出的帖子 —— ` +
      `主页上很可能有一条系统自己没记账的帖子。`,
    how:
      '打开客户的 Facebook 主页看这几天有没有帖子。如果是你撤回后手动重发的，在发布面板重新授权并点名「解除撤回」就能清掉这条；' +
      '如果不是你发的，回我一句，我来查是哪一次发布没记上。',
    href: clientHref(clientId),
  }
}

/** 回执里每个日期最近一条 `published[]` 的发出时间（毫秒）。 */
function publishedAtByDate(list: unknown): Map<string, number> {
  const out = new Map<string, number>()
  if (!Array.isArray(list)) return out
  for (const entry of list) {
    if (!isRecord(entry)) continue
    const date = str(entry.date)
    const at = Date.parse(str(entry.published_at))
    if (!date || Number.isNaN(at)) continue
    const prev = out.get(date)
    if (prev === undefined || at > prev) out.set(date, at)
  }
  return out
}

/** 墓碑 + 回执里更晚的发布 = 记录对不上；按客户归拢日期。读失败要抛，不能当成「没有冲突」。 */
async function findRecordConflicts(
  supabase: SupabaseClient,
  attempts: AttemptRow[],
  today: string,
): Promise<Map<string, string[]>> {
  const cutoff = addDays(today, -ATTEMPT_LOOKBACK_DAYS)
  const tombstones = attempts.filter(
    (a) => a.status === 'blocked' && a.reason_code === 'RECALLED' && a.plan_id !== '' && a.date >= cutoff,
  )
  const byClient = new Map<string, string[]>()
  if (tombstones.length === 0) return byClient

  const planIds = Array.from(new Set(tombstones.map((t) => t.plan_id)))
  const { data, error } = await supabase
    .from('social_plans')
    .select('id, publish_meta:plan_data->publish_meta')
    .in('id', planIds)
  if (error) throw new Error('auto-publish-items: receipt read failed: ' + error.message)

  const receipts = new Map<string, Map<string, number>>()
  for (const row of (data ?? []) as unknown[]) {
    if (!isRecord(row)) continue
    const meta = isRecord(row.publish_meta) ? row.publish_meta : {}
    receipts.set(str(row.id), publishedAtByDate(meta.published))
  }

  for (const t of tombstones) {
    const publishedAt = receipts.get(t.plan_id)?.get(t.date)
    const tombstonedAt = Date.parse(t.updated_at)
    if (publishedAt === undefined || Number.isNaN(tombstonedAt) || publishedAt <= tombstonedAt) continue
    const cur = byClient.get(t.client_id) ?? []
    if (!cur.includes(t.date)) cur.push(t.date)
    byClient.set(t.client_id, cur)
  }
  return byClient
}

export async function pushAutoPublishItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (clientId: string) => string,
  opts: { live: boolean },
): Promise<void> {
  const today = nzDate(now)
  const tomorrow = addDays(today, 1)

  // ---- Source 1: attempts needing attention --------------------------------
  const { data: attemptData, error: attemptError } = await supabase
    .from('daily_plan_auto_publish_attempts')
    .select('client_id, plan_id, date, status, reason_code, updated_at')
  if (attemptError) {
    throw new Error('auto-publish-items: attempts read failed: ' + attemptError.message)
  }

  const attempts: AttemptRow[] = []
  for (const row of (attemptData ?? []) as unknown[]) {
    const narrowed = narrowAttempt(row)
    if (narrowed) attempts.push(narrowed)
  }

  for (const agg of groupAttempts(attempts, today)) {
    items.push(buildAttemptItem(agg, nameOf(agg.clientId)))
  }

  // ---- Source 1b: tombstone says "recalled" but the receipt shows a later post ------
  for (const [clientId, dates] of Array.from((await findRecordConflicts(supabase, attempts, today)).entries())) {
    items.push(buildConflictItem(clientId, nameOf(clientId), dates))
  }

  // ---- Source 2: the watchdog ----------------------------------------------
  const { data: authData, error: authError } = await supabase
    .from('daily_plan_auto_publish_auth')
    .select('client_id, plan_id, dates, authorized_at, activated_at, expires_at, revoked_at')
    .is('revoked_at', null)
    .not('activated_at', 'is', null)
    .gt('expires_at', now.toISOString())
  if (authError) {
    throw new Error('auto-publish-items: auth read failed: ' + authError.message)
  }

  const grants: AuthRow[] = []
  for (const row of (authData ?? []) as unknown[]) {
    const narrowed = narrowAuth(row)
    if (narrowed) grants.push(narrowed)
  }

  // 看门狗只关心今天和明天的日期。
  const watchedDates = new Set([today, tomorrow])

  // 每个客户攒下「授权了但没尝试」的日期。
  const unarmedByClient = new Map<string, string[]>()

  for (const grant of grants) {
    // 查询已经过滤过一遍；这里再确认一次：只有「已激活、没撤销、没过期」的授权才值得盯。
    if (grant.revoked_at !== null || grant.activated_at === null) continue
    const expiresAt = grant.expires_at === null ? NaN : Date.parse(grant.expires_at)
    if (Number.isNaN(expiresAt) || expiresAt <= now.getTime()) continue
    const authorizedAt = Date.parse(grant.authorized_at)
    if (Number.isNaN(authorizedAt)) continue
    // 授权还不到 2 小时：给发布器一点时间，别急着报。
    if (now.getTime() - authorizedAt <= WATCHDOG_GRACE_MS) continue

    const watched = grant.dates.filter((d) => watchedDates.has(d))
    if (watched.length === 0) continue

    const { data: planAttemptData, error: planAttemptError } = await supabase
      .from('daily_plan_auto_publish_attempts')
      .select('date')
      .eq('plan_id', grant.plan_id)
      .in('date', watched)
    if (planAttemptError) {
      throw new Error('auto-publish-items: watchdog attempts read failed: ' + planAttemptError.message)
    }

    const attemptedDates = new Set<string>()
    for (const row of (planAttemptData ?? []) as unknown[]) {
      const d = str(isRecord(row) ? row.date : undefined)
      if (d) attemptedDates.add(d)
    }

    const missing = watched.filter((d) => !attemptedDates.has(d))
    if (missing.length === 0) continue

    const cur = unarmedByClient.get(grant.client_id) ?? []
    for (const d of missing) {
      if (!cur.includes(d)) cur.push(d)
    }
    unarmedByClient.set(grant.client_id, cur)
  }

  for (const [clientId, dates] of Array.from(unarmedByClient.entries())) {
    items.push(buildUnarmedItem(clientId, nameOf(clientId), dates, opts.live))
  }
}
