/**
 * 「交给 AI 跟进」页上有客人符合 AI 接手规则、在等人点放行，而最近几天没有人放行过 → 今日待办「要转给客户那边的」。
 *
 * ## 为什么要有这条
 * 放行要有人点。2026-11-28 查到 CTS 有 216 位在等，而 11-14 之后没有人点过，期间没有任何提醒。
 *
 * ## 纪律
 * 一行写操作都没有，不发信；只写人数和天数，不写客人姓名、邮箱、电话；
 * 「谁符合」用名单页同一套规则（decideAll），不另写一份；
 * 客户没配目录或没设合格客人阶段 = 没有这条；读不到 ≠ 没人在等：取数失败留一条
 * `ai_pickup_waiting_check_failed`（开发的活）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_PICKUP_CONFIG } from '@/lib/crm/ai-takeover/pickup'
import { decideAll, latestEnquiries, loadInputs, PickupNotConfiguredError } from '@/lib/crm/ai-takeover/pickup-run'
import { loadEmailSettings } from '@/lib/crm/email-templates/settings-store'
import { APP_BASE } from './binding-request-items'
import type { ManualItem } from './manual-item-types'

export type AiPickupWaitingItemKind =
  /** 有客人在等放行、最近几天没人放行 —— 一个客户合成一条 */
  | 'ai_pickup_waiting'
  /** 这一栏今天没算出来 —— 我们这边要查（开发的活） */
  | 'ai_pickup_waiting_check_failed'

/** 最近这么多天里有人放行过，就不提醒 —— 有人在点，不用催。 */
export const QUIET_DAYS = 2

export interface AiPickupWaiting {
  /** 符合 AI 接手规则、在等放行的客人数 */
  waiting: number
  /** 距上一次放行过了几天；null = 从来没有人放行过 */
  daysSinceRelease: number | null
}

function pickupHref(clientId: string): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}/crm/ai-pickup`
}

export function buildAiPickupWaitingItems(clientId: string, clientName: string, w: AiPickupWaiting): ManualItem[] {
  if (w.waiting <= 0) return []
  if (w.daysSinceRelease !== null && w.daysSinceRelease < QUIET_DAYS) return []
  const since =
    w.daysSinceRelease === null
      ? '还从来没有人放行过。'
      : `已经 ${w.daysSinceRelease} 天没有人放行了。`
  return [{
    kind: 'ai_pickup_waiting',
    client_id: clientId,
    client_name: clientName,
    what:
      `${clientName} 有 ${w.waiting} 位客人符合「交给 AI」的规则（询价 7 天没人打，或打了没接通），在等人点放行。` +
      since +
      '不放行，这些客人既不在员工的名单最前面，也收不到目录',
    how:
      '请转给客户的销售：点链接打开「交给 AI 跟进」，看一眼名单，点一次整批发送。' +
      '页面每天只放一批，发不了的会写原因；多的第二天接着放。',
    href: pickupHref(clientId),
  }]
}

/** 取数依赖，测试里注入假的，生产走默认实现。 */
export interface AiPickupWaitingDeps {
  /** 这个客户今天有几位在等、上次放行是几天前；null = 客户没有这份名单。读不到就抛。 */
  load: (supabase: SupabaseClient, clientId: string, now: Date) => Promise<AiPickupWaiting | null>
}

function daysSince(iso: string | undefined, now: Date): number | null {
  if (iso === undefined) return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  return Math.max(0, Math.floor((now.getTime() - ms) / 86_400_000))
}

export const defaultAiPickupWaitingDeps: AiPickupWaitingDeps = {
  async load(supabase, clientId, now) {
    const loaded = await loadEmailSettings(supabase, clientId)
    const catalogue = loaded.kind === 'ok' && loaded.settings.enabled ? loaded.settings.providers.catalogue : undefined
    if (catalogue === undefined) return null
    const leads = await latestEnquiries(supabase, clientId, now)
    if (leads.size === 0) return { waiting: 0, daysSinceRelease: null }
    let inputs: Awaited<ReturnType<typeof loadInputs>>
    try {
      inputs = await loadInputs(supabase, clientId, [...leads.keys()])
    } catch (err) {
      // 没设「哪些阶段算合格客人」的客户，名单页本身就不出名单：没有这条，不是取数失败。
      if (err instanceof PickupNotConfiguredError) return null
      throw err
    }
    const waiting = decideAll(inputs, leads, now, DEFAULT_PICKUP_CONFIG).length
    const { data, error } = await supabase
      .from('contact_automation_events')
      .select('created_at')
      .eq('client_id', clientId)
      .eq('kind', 'ai_takeover_on')
      .order('created_at', { ascending: false })
      .limit(1)
    if (error) throw new Error(error.message)
    const last = (data ?? [])[0] as { created_at?: string } | undefined
    return { waiting, daysSinceRelease: daysSince(last?.created_at, now) }
  },
}

function errorSnippet(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.length > 120 ? `${msg.slice(0, 120)}…` : msg
}

/** 调用方在 `loadManualItems` 里必须挂 `.catch`。逐个客户串行：一个客户取数失败不影响别的客户。 */
export async function pushAiPickupWaitingItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  ids: string[],
  now: Date,
  nameOf: (id: string) => string,
  deps: AiPickupWaitingDeps = defaultAiPickupWaitingDeps,
): Promise<void> {
  for (const id of ids) {
    const name = nameOf(id)
    try {
      const w = await deps.load(supabase, id, now)
      if (w !== null) items.push(...buildAiPickupWaitingItems(id, name, w))
    } catch (err) {
      items.push({
        kind: 'ai_pickup_waiting_check_failed',
        client_id: id,
        client_name: name,
        what: `${name}「符合交给 AI 的规则、在等放行」这一栏今天没算出来（${errorSnippet(err)}）。这时候没有这条提醒，不等于没有人在等`,
        how: '开发窗口查「交给 AI 跟进」名单的取数（询价、联系记录、发信记录、合格客人阶段设置、放行记录）哪一处读失败；修好前请员工自己打开「交给 AI 跟进」页看一眼。',
        href: pickupHref(id),
      })
    }
  }
}
