/**
 * Magic Bridge 全平台免费额度用到 80% 以上 —— 要不要加额度由 PM 定。
 *
 * Magic Bridge 是给新客户生成报告的免费入口，全平台每月有一个美元上限
 * （PM 定的）。用满之后，这个月新客户就生成不了报告 —— 而这件事以前
 * 没有任何一条路会把它端到人眼前，只有生成失败时的一行报错。
 *
 * 这条待办只做两件事：把「快满了 / 已用满」摆到今日待办里，并告诉人
 * 怎么加额度（改后台设置表，不用发版）。加不加由 PM 定，系统不自动加。
 *
 * 判据（quotaAlert）是纯函数，单独测；取数（pushMagicBridgeQuotaItems）
 * 只读两张表 / 一个 RPC，读失败由调用方兜底（见 manual-items.ts 的 .catch）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'

/** 用到这个百分比（含）就提醒 —— 留出加额度的时间，别等用满才说。 */
export const QUOTA_WARN_PCT = 80

/** 生成一份报告大约要花的美元数 —— 判断「还能不能再开一份」时要把它算进去。 */
export const QUOTA_RESERVE_USD = 0.12

export interface QuotaAlert {
  /** none：还早，不提醒；warn：快满了；full：已用满。 */
  level: 'none' | 'warn' | 'full'
  /** 已用占上限的百分比（四舍五入到整数）。上限为 0 时按 100 处理。 */
  pct: number
}

/**
 * 把「已用 / 上限」判成提醒档位。
 *
 * - 上限 <= 0：没有可用额度，直接算用满（pct=100）—— 免得除零，也免得
 *   一个配错的上限把这条提醒静音。
 * - 已用 + 预留 > 上限：full —— 剩下的钱不够再开一份报告，新客户这个月
 *   已经生成不了了，所以不能等到「已用 >= 上限」才说。
 * - 百分比 >= 80：warn。
 * - 其余：none。
 */
export function quotaAlert(usedUsd: number, capUsd: number, reserveUsd: number = QUOTA_RESERVE_USD): QuotaAlert {
  if (!(capUsd > 0)) return { level: 'full', pct: 100 }
  const pct = Math.round((usedUsd / capUsd) * 100)
  if (usedUsd + reserveUsd > capUsd) return { level: 'full', pct }
  if (pct >= QUOTA_WARN_PCT) return { level: 'warn', pct }
  return { level: 'none', pct }
}

/** 当前计费周期，UTC 'YYYY-MM'（跟 RPC / 配置表用的口径一致）。 */
function currentPeriod(now: Date): string {
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

/**
 * 读全平台额度用量，快满 / 用满时下发一条待办。
 *
 * 上限来自 `meta_ads_ai_quota_config` 里 scope='platform' 那一行；
 * 已用来自 RPC `meta_ads_quota_used`（跟真正扣额度的那条路共用同一份判据，
 * 所以这里说的话跟系统真扣的钱永远一致）。
 *
 * 读失败直接抛，由调用方（manual-items.ts）的 .catch 兜住 —— 跟本文件其他
 * 通道同一条纪律：一条通道读挂了不拖垮别的待办。
 */
export async function pushMagicBridgeQuotaItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
): Promise<void> {
  const period = currentPeriod(now)

  const { data: config, error: configError } = await supabase
    .from('meta_ads_ai_quota_config')
    .select('cap_usd')
    .eq('scope', 'platform')
    .maybeSingle()
  if (configError) throw new Error(configError.message)

  const capUsd = Number((config as { cap_usd?: number | string } | null)?.cap_usd ?? 0)

  const { data: usedRaw, error: usedError } = await supabase.rpc('meta_ads_quota_used', {
    p_period: period,
    p_scope: 'platform',
    p_key: '',
  })
  if (usedError) throw new Error(usedError.message)

  const usedUsd = Number(usedRaw ?? 0)

  const { level, pct } = quotaAlert(usedUsd, capUsd)
  if (level === 'none') return

  items.push({
    kind: 'magic_bridge_quota',
    client_id: 'infra',
    client_name: 'Magic Engine 后台',
    what:
      level === 'full'
        ? `Magic Bridge 本月免费名额已用满：US$${usedUsd.toFixed(2)} / ${capUsd}（${pct}%），新客户这个月生成不了报告，加不加？`
        : `Magic Bridge 本月免费名额已用 US$${usedUsd.toFixed(2)} / ${capUsd}（${pct}%），快满了，加不加？`,
    how: '要加：回开发窗口「Magic Bridge 月上限改成 60 美元」（数字你定），当天生效，不用发版。不加：用满后到月底新客户生成不了报告，下个月初自动恢复。',
    href: 'https://app.magicengine.com.au/meta-ads-ai/demo',
  })
}
