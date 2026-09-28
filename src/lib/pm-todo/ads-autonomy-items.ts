/**
 * 「自治开关没同步到 Kernel」→ 下发到「需要你动手」（铁律 3 下半）。
 *
 * 同步 worker 失败时写一行 `ads_autonomy_sync_receipts`，`skipped_reason` 以
 * `sync_failed:` 开头；这条通道把它变成待办，否则 PM 把开关拨到 bounded_auto
 * 以为自动了，Kernel 其实还在 require_approval。
 *
 * `locked_by_deny` v1 不出待办（无写入者，spec §4.7）。
 *
 * 本文件一行写操作都没有：只读回执、生成待办。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { APP_BASE } from './binding-request-items'

export type AdsAutonomyItemKind = 'ads_autonomy_sync_failed'

/** 回看多久：每日 reconcile 一天一次，24h 够覆盖最近一轮。 */
export const ADS_AUTONOMY_SYNC_LOOKBACK_MS = 24 * 60 * 60 * 1000

interface ReceiptRow {
  client_id: string
  action_key: string
  skipped_reason: string | null
  synced_at: string
}

export function adsAutonomySettingsHref(clientId: string): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}/settings`
}

/** 去掉 `sync_failed:` 前缀，截断到 120 字，别把整段堆栈塞进待办。 */
function stripPrefix(reason: string): string {
  const body = reason.replace(/^sync_failed:\s*/, '')
  return body.length > 120 ? `${body.slice(0, 120)}…` : body
}

export type AdsAutonomyCircuitBreakerItemKind = 'ads_autonomy_circuit_breaker'

/** 单客户版本：Settings 页用来决定要不要画"熔断已触发"横幅 + 解除按钮。 */
export async function isCircuitBreakerTripped(
  supabase: SupabaseClient,
  clientId: string,
  now: Date,
): Promise<boolean> {
  const nowIso = now.toISOString()
  const { data, error } = await supabase
    .from('client_automation_policies')
    .select('client_id')
    .eq('client_id', clientId)
    .eq('mode', 'deny')
    .like('updated_by', 'circuit-breaker:%')
    .lte('effective_from', nowIso)
    .or(`effective_to.is.null,effective_to.gt.${nowIso}`)
    .limit(1)
  if (error) throw new Error(`client_automation_policies 读取失败：${error.message}`)
  return (data ?? []).length > 0
}

export async function pushAdsAutonomyCircuitBreakerItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (id: string) => string,
  activeClientIds: readonly string[],
): Promise<void> {
  if (activeClientIds.length === 0) return
  const nowIso = now.toISOString()
  const { data, error } = await supabase
    .from('client_automation_policies')
    .select('client_id, mode, updated_by')
    .eq('mode', 'deny')
    .like('updated_by', 'circuit-breaker:%')
    .lte('effective_from', nowIso)
    .or(`effective_to.is.null,effective_to.gt.${nowIso}`)
    .in('client_id', activeClientIds)
  if (error) throw new Error(`client_automation_policies 读取失败：${error.message}`)

  const seen = new Set<string>()
  for (const row of (data ?? []) as Array<{ client_id: string; updated_by: string }>) {
    if (seen.has(row.client_id)) continue
    seen.add(row.client_id)
    items.push({
      kind: 'ads_autonomy_circuit_breaker',
      client_id: row.client_id,
      client_name: nameOf(row.client_id),
      what:
        '广告自治被熔断器自动停了 —— 当日实际花费合计超过 7 天中位数的 3 倍，' +
        '系统已自动把全部广告动作切到「禁止」档位，不再动钱。',
      how:
        '先到 Meta Ads Manager 核实实际花费是否正常；' +
        '确认没问题后在客户设置页点「解除熔断」按钮（不是重新拨自治档位——' +
        '那个开关不会碰这把熔断锁，得点专门的解除按钮）。',
      href: adsAutonomySettingsHref(row.client_id),
    })
  }
}

export async function pushAdsAutonomySyncItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  const since = new Date(now.getTime() - ADS_AUTONOMY_SYNC_LOOKBACK_MS).toISOString()
  const { data, error } = await supabase
    .from('ads_autonomy_sync_receipts')
    .select('client_id, action_key, skipped_reason, synced_at')
    .gte('synced_at', since)
    .like('skipped_reason', 'sync_failed:%')
    .order('synced_at', { ascending: false })
  if (error) throw new Error(`ads_autonomy_sync_receipts 读取失败：${error.message}`)

  // 已按时间倒序，每个客户第一次见到的就是它最近那一轮。
  const newestPerClient = new Map<string, ReceiptRow>()
  for (const row of (data ?? []) as ReceiptRow[]) {
    if (!newestPerClient.has(row.client_id)) newestPerClient.set(row.client_id, row)
  }

  for (const row of newestPerClient.values()) {
    const reason = stripPrefix(row.skipped_reason ?? '')
    items.push({
      kind: 'ads_autonomy_sync_failed',
      client_id: row.client_id,
      client_name: nameOf(row.client_id),
      what:
        `自治开关没同步到执行内核：最近一次同步失败（${reason}）。` +
        '面板上显示的自动/观察档位跟内核实际用的可能不一致 —— 拨到自动的会仍然要人审批，' +
        '拨回观察的可能仍在自动动钱。',
      how:
        '打开客户设置页，把「自治档位」重新保存一次（会重新发同步）；' +
        `还是失败就查 ads_autonomy_sync_receipts 最近一行的 skipped_reason（${row.synced_at.slice(0, 10)}）。`,
      href: adsAutonomySettingsHref(row.client_id),
    })
  }
}
