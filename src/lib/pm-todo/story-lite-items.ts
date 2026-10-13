/**
 * 今日待办里的「Story 自动发布没发出去 / 不知道发没发出去 / 授权了却什么都没发生」。
 *
 * 数据来源：`story_items`（每条 Story 的发布状态）和 `story_packs`（PM 点过的「授权这个周包」）。
 *
 * 拉模式：直接查库，事件丢了、进程重启了，待办照样出得来。
 *
 * 三条通道，各管一件事：
 *
 * 1. **不确定有没有发出去**（`story_unknown_outcome`）—— 系统不确定某条 Story 发没发出去。
 *    为防重复发布，系统不会自动重试，只能人打开客户主页看一眼。这条**不设日期下限**：
 *    没人收口就会一直挂着，必须一直出现直到有人确认。
 *
 * 2. **没发出去**（`story_stalled`）—— 某条 Story 被拦 / 被平台拒绝 / 时间已过没补发。
 *    只看最近 14 天：更早的已经没意义。
 *
 * 3. **看门狗**（`story_unarmed`）—— 周包授权了、到点了，但库里连一条演练记录都没有。
 *    这说明发布器根本没跑起来（定时任务没跑 / 开关没开），而不是「跑了但失败」。
 *    没有这条，一个静默死掉的发布器可以一直不吭声。
 *
 * 本文件一行写操作都没有：只读事件、生成待办。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { APP_BASE } from './binding-request-items'

const NZ_TZ = 'Pacific/Auckland'

/** 巡检每 10 分钟跑一次；到点超过这么久还没有任何记录 = 发布器没跑起来。 */
const WATCHDOG_GRACE_MS = 60 * 60 * 1000

/**
 * 「不确定有没有发出去」只提醒到这么久为止：Story 发出 24 小时后自己消失，再过 12 小时
 * 「到底发没发」已经没有意义，也没有别的办法销号 —— 不设这条界线它会永远挂在待办里。
 */
const UNKNOWN_WINDOW_MS = 36 * 60 * 60 * 1000

/** 发布器每 10 分钟会写一次检查结果；超过这么久没写 = 发布器死了。 */
const SWEEP_ALIVE_MS = 30 * 60 * 1000

/** 「失败 / 时间已过」类只看最近这些天：更早的已经没意义。 */
const STALLED_LOOKBACK_DAYS = 14

/** 这些状态是「没发出去」的。 */
const STALLED_STATUSES = new Set(['FAILED', 'BLOCKED', 'MISSED'])

/** A person took this story out on purpose (reason code starts with this): that is not a failure to chase. */
const REMOVED_BY_PERSON_PREFIX = 'PM_REMOVED'

/** True for a plain object (not null, not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A string, or '' for anything else. */
function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** YYYY-MM-DD `days` calendar days before `iso` (UTC date arithmetic, no timezone drift). */
function addDays(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`)
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10)
}

/** YYYY-MM-DD of `now` in Pacific/Auckland. */
function nzDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: NZ_TZ }).format(now)
}

/** `M月D日 HH:mm` of an ISO timestamp in Pacific/Auckland; '' when unparseable. */
function nzStamp(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: NZ_TZ,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(t))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('month')}月${get('day')}日 ${get('hour')}:${get('minute')}`
}

function clientHref(clientId: string): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}`
}

/** 一行 `story_items`（只声明这条待办用得到的列）。 */
interface StoryItemRow {
  client_id: string
  status: string
  slot_at: string
  reason_code: string | null
  last_check_at: string | null
  claimed_at: string | null
}

/** 一行 `story_packs`（只声明这条待办用得到的列）。 */
interface StoryPackRow {
  id: string
  client_id: string
  authorized_at: string | null
  expires_at: string | null
  revoked_at: string | null
}

/** Narrow one story_items row; returns null when it has no usable client/slot. */
function narrowItem(value: unknown): StoryItemRow | null {
  if (!isRecord(value)) return null
  const clientId = str(value.client_id)
  const slotAt = str(value.slot_at)
  if (!clientId || !slotAt) return null
  return {
    client_id: clientId,
    status: str(value.status),
    slot_at: slotAt,
    reason_code: typeof value.reason_code === 'string' ? value.reason_code : null,
    last_check_at: typeof value.last_check_at === 'string' ? value.last_check_at : null,
    claimed_at: typeof value.claimed_at === 'string' ? value.claimed_at : null,
  }
}

/** Narrow one story_packs row; returns null when it has no usable id/client. */
function narrowPack(value: unknown): StoryPackRow | null {
  if (!isRecord(value)) return null
  const id = str(value.id)
  const clientId = str(value.client_id)
  if (!id || !clientId) return null
  return {
    id,
    client_id: clientId,
    authorized_at: typeof value.authorized_at === 'string' ? value.authorized_at : null,
    expires_at: typeof value.expires_at === 'string' ? value.expires_at : null,
    revoked_at: typeof value.revoked_at === 'string' ? value.revoked_at : null,
  }
}

/** 把一条 Story 的原因说成人话。 */
function reasonWords(row: StoryItemRow): string {
  if (row.status === 'MISSED') return '发布时间已过，没有补发'
  if (row.status === 'FAILED') return 'Facebook 拒绝了这条'
  if (row.status === 'BLOCKED') {
    return `被发布前检查拦住了（原因代码 ${row.reason_code ?? '未标注'}）`
  }
  return `发布没成功（状态 ${row.status}）`
}

/** 一个客户攒下来的「不确定有没有发出去」的 Story。 */
interface ClientUnknown {
  clientId: string
  stamps: string[]
}

/** 一个客户攒下来的「没发出去」的 Story。 */
interface ClientStalled {
  clientId: string
  stamps: string[]
  reasons: string[]
}

/** 把「不确定」按客户归拢：只提醒到 Story 过期后 12 小时（再往后没有意义）。 */
function groupUnknown(rows: StoryItemRow[], now: Date): ClientUnknown[] {
  const groups = new Map<string, ClientUnknown>()
  for (const row of rows) {
    if (row.status !== 'UNKNOWN_OUTCOME') continue
    // 窗口从「进入不确定状态」（抢占时刻）起算；发布器停摆很久才恢复时，按计划时间算会一条都不报
    const anchor = Date.parse(row.claimed_at ?? row.slot_at)
    if (Number.isNaN(anchor) || now.getTime() - anchor > UNKNOWN_WINDOW_MS) continue
    const cur = groups.get(row.client_id) ?? { clientId: row.client_id, stamps: [] }
    const stamp = nzStamp(row.slot_at)
    if (stamp && !cur.stamps.includes(stamp)) cur.stamps.push(stamp)
    groups.set(row.client_id, cur)
  }
  return Array.from(groups.values())
}

/** 把「没发出去」按客户归拢：只看最近 14 天。 */
function groupStalled(rows: StoryItemRow[], now: Date): ClientStalled[] {
  const cutoff = addDays(nzDate(now), -STALLED_LOOKBACK_DAYS)
  const groups = new Map<string, ClientStalled>()
  for (const row of rows) {
    if (!STALLED_STATUSES.has(row.status)) continue
    if (row.reason_code?.startsWith(REMOVED_BY_PERSON_PREFIX)) continue
    if (row.slot_at.slice(0, 10) < cutoff) continue
    const cur = groups.get(row.client_id) ?? { clientId: row.client_id, stamps: [], reasons: [] }
    const stamp = nzStamp(row.slot_at)
    if (stamp && !cur.stamps.includes(stamp)) cur.stamps.push(stamp)
    const reason = reasonWords(row)
    if (!cur.reasons.includes(reason)) cur.reasons.push(reason)
    groups.set(row.client_id, cur)
  }
  return Array.from(groups.values())
}

/** 一条「不确定有没有发出去」的待办。 */
function buildUnknownItem(agg: ClientUnknown, clientName: string): ManualItem {
  const stamps = agg.stamps.slice().sort().join('、')
  const count = agg.stamps.length
  return {
    kind: 'story_unknown_outcome',
    client_id: agg.clientId,
    client_name: clientName,
    what:
      `${clientName} 有 ${count} 条 Story（时间 ${stamps}）系统不确定有没有发出去 —— ` +
      `为防重复发布，系统不会自动重试，只能人看一眼到底发没发。`,
    how:
      '打开客户的 Facebook 主页看 Story；如果发出去了就不用管（24 小时后自己消失），' +
      '没发出去就回我一句，我来登记。',
    href: clientHref(agg.clientId),
  }
}

/** 一条「没发出去」的待办。 */
function buildStalledItem(agg: ClientStalled, clientName: string): ManualItem {
  const stamps = agg.stamps.slice().sort().join('、')
  const count = agg.stamps.length
  const reasons = agg.reasons.join('；')
  return {
    kind: 'story_stalled',
    client_id: agg.clientId,
    client_name: clientName,
    what: `${clientName} 有 ${count} 条 Story（时间 ${stamps}）没能自动发出去：${reasons}。`,
    how: '打开预览页看每条的状态，要重发就回我一句，我来换一个新的周包。',
    href: clientHref(agg.clientId),
  }
}

/** 一条「授权了却什么都没发生」的待办。 */
function buildUnarmedItem(clientId: string, clientName: string, live: boolean): ManualItem {
  const tail = live
    ? '但库里没有任何发布或演练记录，说明发布器根本没跑起来。'
    : '但自动发布现在是演练模式（不会真发），而且连演练记录都没有，说明发布器没跑起来。'
  return {
    kind: 'story_unarmed',
    client_id: clientId,
    client_name: clientName,
    what: `${clientName} 已授权的 Story 周包到点了，${tail}`,
    how: '回我一句，我来查定时任务和开关。',
    href: clientHref(clientId),
  }
}

/** 读 `story_items` 里要人看的行；读失败要抛，不能当成「没有」。 */
async function readStoryItems(supabase: SupabaseClient): Promise<StoryItemRow[]> {
  const { data, error } = await supabase
    .from('story_items')
    .select('client_id, status, slot_at, reason_code, last_check_at, claimed_at')
    .in('status', ['UNKNOWN_OUTCOME', 'FAILED', 'BLOCKED', 'MISSED'])
  if (error) throw new Error('story-lite-items: items read failed: ' + error.message)
  const rows: StoryItemRow[] = []
  for (const row of (data ?? []) as unknown[]) {
    const narrowed = narrowItem(row)
    if (narrowed) rows.push(narrowed)
  }
  return rows
}

/**
 * 读「已授权、没撤销」的周包（过期的也要读：发布器整周没跑、包过期了，告警不能跟着消失）；读失败要抛。
 */
async function readAuthorizedPacks(supabase: SupabaseClient): Promise<StoryPackRow[]> {
  const { data, error } = await supabase
    .from('story_packs')
    .select('id, client_id, authorized_at, expires_at, revoked_at')
    .not('authorized_at', 'is', null)
    .is('revoked_at', null)
  if (error) throw new Error('story-lite-items: packs read failed: ' + error.message)
  const rows: StoryPackRow[] = []
  for (const row of (data ?? []) as unknown[]) {
    const narrowed = narrowPack(row)
    if (narrowed) rows.push(narrowed)
  }
  return rows
}

/**
 * 看门狗：已授权的周包里，到点超过 1 小时、还卡在 PENDING / CLAIMED、而且发布器最近 30 分钟没写过检查记录的 Story。
 * 「最近 30 分钟写过检查记录」说明发布器活着（演练模式下 PENDING 本来就不会变）；不依赖「从没检查过」，
 * 所以发布器跑过一次再死掉也会报。
 */
async function findUnarmedClients(
  supabase: SupabaseClient,
  packs: StoryPackRow[],
  now: Date,
): Promise<string[]> {
  const dueBefore = new Date(now.getTime() - WATCHDOG_GRACE_MS).toISOString()
  const lookback = new Date(now.getTime() - STALLED_LOOKBACK_DAYS * 86_400_000).toISOString()
  const aliveAfter = now.getTime() - SWEEP_ALIVE_MS
  const clients: string[] = []
  for (const pack of packs) {
    // 过期的包发布器不再扫：只有「从没检查过」才算没动静，否则演练包过期后会天天误报
    const packExpired = pack.expires_at !== null && Date.parse(pack.expires_at) <= now.getTime()
    const { data, error } = await supabase
      .from('story_items')
      .select('client_id, slot_at, last_check_at')
      .eq('pack_id', pack.id)
      .in('status', ['PENDING', 'CLAIMED'])
      .lt('slot_at', dueBefore)
    if (error) throw new Error('story-lite-items: watchdog read failed: ' + error.message)
    const stuck = ((data ?? []) as unknown[]).filter((row) => {
      if (!isRecord(row)) return false
      if (str(row.slot_at) < lookback) return false
      const checkedAt = typeof row.last_check_at === 'string' ? Date.parse(row.last_check_at) : NaN
      if (Number.isNaN(checkedAt)) return true
      return !packExpired && checkedAt < aliveAfter
    })
    if (stuck.length > 0 && !clients.includes(pack.client_id)) clients.push(pack.client_id)
  }
  return clients
}

export async function pushStoryLiteItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (clientId: string) => string,
  opts: { live: boolean },
): Promise<void> {
  // ---- Source 1: 不确定有没有发出去（只提醒到 Story 过期后 12 小时） --------
  const storyItems = await readStoryItems(supabase)
  for (const agg of groupUnknown(storyItems, now)) {
    items.push(buildUnknownItem(agg, nameOf(agg.clientId)))
  }

  // ---- Source 2: 没发出去（只看最近 14 天） --------------------------------
  for (const agg of groupStalled(storyItems, now)) {
    items.push(buildStalledItem(agg, nameOf(agg.clientId)))
  }

  // ---- Source 3: 看门狗 ----------------------------------------------------
  const packs = await readAuthorizedPacks(supabase)
  for (const clientId of await findUnarmedClients(supabase, packs, now)) {
    items.push(buildUnarmedItem(clientId, nameOf(clientId), opts.live))
  }
}
