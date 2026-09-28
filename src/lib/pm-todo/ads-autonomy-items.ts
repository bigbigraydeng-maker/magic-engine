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

/**
 * 🔴 Codex P2 复审：链接必须指向真正能操作的页面。自治档位单选和「解除熔断」
 * 按钮都只在 `AutonomySettings` 组件（`ads-health/autonomy-settings.tsx`）里，
 * 而这个组件只被 `ads-health/page.tsx` 渲染——`/settings` 页的 `AdStrategyPanel`
 * 不含 `autonomy_mode`/熔断相关任何内容（全仓 grep 确认）。之前两条待办通道
 * 都把 href 指向 `/settings`，点进去的人得自己再找一次入口。
 */
export function adsAutonomyAdsHealthHref(clientId: string): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}/ads-health`
}

/** 去掉 `sync_failed:` 前缀，截断到 120 字，别把整段堆栈塞进待办。 */
function stripPrefix(reason: string): string {
  const body = reason.replace(/^sync_failed:\s*/, '')
  return body.length > 120 ? `${body.slice(0, 120)}…` : body
}

export type AdsAutonomyCircuitBreakerItemKind = 'ads_autonomy_circuit_breaker'

/**
 * 从 `updated_by` 里抠出触发账户 id——写法见 `ads-circuit-breaker-check.ts`
 * 的 `tripReason`：`[accountId] reason` 或多账户同轮触发时的
 * `[accountId1,accountId2] reason1 | reason2`，拼进 SQL 函数的 `updated_by`
 * 时是 `circuit-breaker:[accountId] reason...:timestamp`（Codex P2 复审：
 * 多账户客户只有一个账户触发时，这个信息已经写进库了，之前的待办文案没
 * 读出来，PM 只能自己去 Meta Ads Manager 逐个账户排查）。抠不出来（比如
 * 手工建的 deny 行不符合这个格式）就返回 null，文案退回不点名账户的通用
 * 版本。返回值可能是逗号连接的多个账户 id，调用方用 `formatAccountList`
 * 转成人话列表。
 *
 * 这里的账户 id 是 circuit-breaker-spend.ts 归一化后的形式（不带 act_ 前缀）
 * ——正好是 Meta Ads Manager 界面上显示账户号的形式，不用 FDE 自己再剥一次。
 */
function extractTriggeringAccount(updatedBy: string): string | null {
  const match = /^circuit-breaker:\[([^\]]+)\]/.exec(updatedBy)
  return match ? match[1] : null
}

/** 逗号连接的账户 id 列表 → 中文顿号列表，单个账户原样返回。 */
function formatAccountList(commaJoined: string): string {
  return commaJoined.split(',').join('、')
}

/** 单客户版本：广告健康页用来决定要不要画"熔断已触发"横幅 + 解除按钮。 */
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
    const account = extractTriggeringAccount(row.updated_by)
    const accountDisplay = account ? formatAccountList(account) : null
    const accountNote = accountDisplay ? `（触发账户：${accountDisplay}）` : ''
    items.push({
      kind: 'ads_autonomy_circuit_breaker',
      client_id: row.client_id,
      client_name: nameOf(row.client_id),
      what:
        `广告自治被熔断器自动停了${accountNote} —— 当日实际花费合计超过 7 天中位数的 3 倍，` +
        '系统已自动把全部广告动作切到「禁止」档位，不再动钱。',
      how:
        (accountDisplay
          ? `先到 Meta Ads Manager 核实账户 ${accountDisplay} 的实际花费是否正常（同轮触发的每个账户都要查，不能只看第一个）；`
          : '先到 Meta Ads Manager 核实实际花费是否正常（多账户客户请逐个核对）；') +
        '确认没问题后在客户广告健康页点「解除熔断」按钮（不是重新拨自治档位——' +
        '那个开关不会碰这把熔断锁，得点专门的解除按钮）。',
      href: adsAutonomyAdsHealthHref(row.client_id),
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
        '打开客户广告健康页，把「自治档位」重新保存一次（会重新发同步）；' +
        `还是失败就查 ads_autonomy_sync_receipts 最近一行的 skipped_reason（${row.synced_at.slice(0, 10)}）。`,
      href: adsAutonomyAdsHealthHref(row.client_id),
    })
  }
}
