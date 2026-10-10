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
 * 本文件一行写操作都没有：只读事件、生成待办。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { APP_BASE } from './binding-request-items'

export type AutoPublishItemKind =
  | 'auto_publish_stalled'
  | 'auto_publish_unknown_outcome'
  | 'auto_publish_unarmed'

const NZ_TZ = 'Pacific/Auckland'

/** 授权后超过这么久还没有任何尝试记录 = 发布器没跑起来。 */
const WATCHDOG_GRACE_MS = 2 * 60 * 60 * 1000

/** 只看最近这几天的尝试：更早的要么已经处理过，要么已经没意义。 */
const ATTEMPT_LOOKBACK_DAYS = 1

/** 这些状态是「要人看」的。 */
const ATTENTION_STATUSES = new Set(['failed_final', 'unknown_outcome', 'missed_window'])

/** 被发布前检查拦下、但原因代码以这个开头的，价格闸待办已经覆盖，不在这里重复。 */
const PRICE_REASON_PREFIX = 'PRICE_'

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
  date: string
  status: string
  reason_code: string | null
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
    date,
    status: str(value.status),
    reason_code: typeof value.reason_code === 'string' ? value.reason_code : null,
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
  // 被发布前检查拦下的：价格闸待办已经覆盖 PRICE_ 开头的，不在这里重复。
  if (row.reason_code && row.reason_code.startsWith(PRICE_REASON_PREFIX)) return false
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

/** 一个客户攒下来的、要人看的尝试。 */
interface ClientAttempts {
  clientId: string
  hasUnknownOutcome: boolean
  dates: string[]
  reasons: string[]
}

/** 把要人看的尝试按客户归拢，一个客户一条。 */
function groupAttempts(rows: AttemptRow[]): ClientAttempts[] {
  const byClient = new Map<string, ClientAttempts>()
  for (const row of rows) {
    if (!needsAttention(row)) continue
    const cur = byClient.get(row.client_id) ?? {
      clientId: row.client_id,
      hasUnknownOutcome: false,
      dates: [],
      reasons: [],
    }
    if (row.status === 'unknown_outcome') cur.hasUnknownOutcome = true
    if (!cur.dates.includes(row.date)) cur.dates.push(row.date)
    const reason = reasonWords(row)
    if (!cur.reasons.includes(reason)) cur.reasons.push(reason)
    byClient.set(row.client_id, cur)
  }
  return Array.from(byClient.values())
}

/** 一条「尝试要人看」的待办。 */
function buildAttemptItem(
  agg: ClientAttempts,
  clientName: string,
): ManualItem {
  const dates = agg.dates.slice().sort().join('、')
  const count = agg.dates.length
  if (agg.hasUnknownOutcome) {
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

export async function pushAutoPublishItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (clientId: string) => string,
  opts: { live: boolean },
): Promise<void> {
  const today = nzDate(now)
  const tomorrow = addDays(today, 1)
  const since = addDays(today, -ATTEMPT_LOOKBACK_DAYS)

  // ---- Source 1: attempts needing attention --------------------------------
  const { data: attemptData, error: attemptError } = await supabase
    .from('daily_plan_auto_publish_attempts')
    .select('client_id, date, status, reason_code')
    .gte('date', since)
  if (attemptError) {
    throw new Error('auto-publish-items: attempts read failed: ' + attemptError.message)
  }

  const attempts: AttemptRow[] = []
  for (const row of (attemptData ?? []) as unknown[]) {
    const narrowed = narrowAttempt(row)
    if (narrowed) attempts.push(narrowed)
  }

  for (const agg of groupAttempts(attempts)) {
    items.push(buildAttemptItem(agg, nameOf(agg.clientId)))
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
