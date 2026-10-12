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

/** 「失败 / 时间已过」类只看最近这些天：更早的已经没意义。 */
const STALLED_LOOKBACK_DAYS = 14

/** 这些状态是「没发出去」的。 */
const STALLED_STATUSES = new Set(['FAILED', 'BLOCKED', 'MISSED'])

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

/** 把「不确定」按客户归拢：不设日期下限，没人收口就一直挂着。 */
function groupUnknown(rows: StoryItemRow[]): ClientUnknown[] {
  const groups = new Map<string, ClientUnknown>()
  for (const row of rows) {
    if (row.status !== 'UNKNOWN_OUTCOME') continue
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
    .select('client_id, status, slot_at, reason_code, last_check_at')
    .in('status', ['UNKNOWN_OUTCOME', 'FAILED', 'BLOCKED', 'MISSED'])
  if (error) throw new Error('story-lite-items: items read failed: ' + error.message)
  const rows: StoryItemRow[] = []
  for (const row of (data ?? []) as unknown[]) {
    const narrowed = narrowItem(row)
    if (narrowed) rows.push(narrowed)
  }
  return rows
}

/** 读「已授权、没撤销、没过期」的周包；读失败要抛。 */
async function readLivePacks(supabase: SupabaseClient, now: Date): Promise<StoryPackRow[]> {
  const { data, error } = await supabase
    .from('story_packs')
    .select('id, client_id, authorized_at, expires_at, revoked_at')
    .not('authorized_at', 'is', null)
    .is('revoked_at', null)
    .gt('expires_at', now.toISOString())
  if (error) throw new Error('story-lite-items: packs read failed: ' + error.message)
  const rows: StoryPackRow[] = []
  for (const row of (data ?? []) as unknown[]) {
    const narrowed = narrowPack(row)
    if (narrowed) rows.push(narrowed)
  }
  return rows
}

/** 看门狗：已授权的周包里，到点超过 1 小时、还没任何检查记录的 PENDING Story。 */
async function findUnarmedClients(
  supabase: SupabaseClient,
  packs: StoryPackRow[],
  now: Date,
): Promise<string[]> {
  const dueBefore = new Date(now.getTime() - WATCHDOG_GRACE_MS).toISOString()
  const clients: string[] = []
  for (const pack of packs) {
    const { data, error } = await supabase
      .from('story_items')
      .select('client_id')
      .eq('pack_id', pack.id)
      .eq('status', 'PENDING')
      .is('last_check_at', null)
      .lt('slot_at', dueBefore)
    if (error) throw new Error('story-lite-items: watchdog read failed: ' + error.message)
    if ((data ?? []).length === 0) continue
    if (!clients.includes(pack.client_id)) clients.push(pack.client_id)
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
  // ---- Source 1: 不确定有没有发出去（不设日期下限） -------------------------
  const storyItems = await readStoryItems(supabase)
  for (const agg of groupUnknown(storyItems)) {
    items.push(buildUnknownItem(agg, nameOf(agg.clientId)))
  }

  // ---- Source 2: 没发出去（只看最近 14 天） --------------------------------
  for (const agg of groupStalled(storyItems, now)) {
    items.push(buildStalledItem(agg, nameOf(agg.clientId)))
  }

  // ---- Source 3: 看门狗 ----------------------------------------------------
  const packs = await readLivePacks(supabase, now)
  for (const clientId of await findUnarmedClients(supabase, packs, now)) {
    items.push(buildUnarmedItem(clientId, nameOf(clientId), opts.live))
  }
}
