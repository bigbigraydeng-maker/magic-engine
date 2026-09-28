/**
 * Tools Lab 全站每月合计上限（src/lib/tools-lab/spend-cap.ts）快用完 → 今日待办。
 *
 * 这道桶是网站诊断 + 广告体检赞助分析共用的一个计数池（子牙复审 S1）。自助客户激活时
 * `sponsored_analysis_enabled` 默认就是 true（`supabase/migrations/20260927160000_meta_ads_ai_self_serve.sql:112`，
 * 魏征复审发现），不是只给一小撮特批客户——自助客户涨起来，这道桶会比想象中更快被吃满，
 * 而吃满时网站诊断的免费访客会被一起挡下、看起来像自己的功能坏了，却查不出原因。
 *
 * 跟 magic-bridge-quota-items.ts 同一个纪律：只做「快满了 / 已用满」摆到今日待办、
 * 说清楚现在是哪个桶、加不加名额由 PM 定，系统不自动加。这是一条纯读检查，读挂了
 * 由调用方（manual-items.ts 的 .catch）兜住，不拖垮别的待办。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { TOOLS_AI_CALLS_MONTHLY_BUCKET, TOOLS_AI_CALLS_MONTHLY_CAP } from '@/lib/tools-lab/spend-cap'
import type { ManualItem } from './manual-item-types'

/** 用到这个百分比（含）就提醒——留出加名额的时间，别等用满才说（跟 Magic Bridge 那条同一个门槛）。 */
export const TOOLS_WIDE_BUDGET_WARN_PCT = 80

export interface ToolsWideBudgetAlert {
  level: 'none' | 'warn' | 'full'
  pct: number
  count: number
}

/** 把「当前计数 / 上限」判成提醒档位。上限 <= 0 直接算用满，免得除零也免得配错值把提醒静音。 */
export function toolsWideBudgetAlert(count: number, cap: number): ToolsWideBudgetAlert {
  if (!(cap > 0)) return { level: 'full', pct: 100, count }
  const pct = Math.round((count / cap) * 100)
  if (count >= cap) return { level: 'full', pct, count }
  if (pct >= TOOLS_WIDE_BUDGET_WARN_PCT) return { level: 'warn', pct, count }
  return { level: 'none', pct, count }
}

function monthStartUtcIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

export async function pushToolsWideBudgetItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
): Promise<void> {
  const { data, error } = await supabase
    .from('zhangqian_scan_rate_limits')
    .select('count')
    .eq('bucket_type', TOOLS_AI_CALLS_MONTHLY_BUCKET)
    .eq('bucket_key', 'all')
    .eq('window_start', monthStartUtcIso(now))
    .maybeSingle()
  if (error) throw new Error(error.message)

  const count = Number((data as { count?: number | string } | null)?.count ?? 0)
  const { level, pct } = toolsWideBudgetAlert(count, TOOLS_AI_CALLS_MONTHLY_CAP)
  if (level === 'none') return

  items.push({
    kind: 'tools_wide_budget_warning',
    client_id: 'infra',
    client_name: 'Magic Engine 工具实验室',
    what:
      level === 'full'
        ? `工具实验室这个月的全站合计次数用满了（${count} / ${TOOLS_AI_CALLS_MONTHLY_CAP} 次，${pct}%）——网站诊断和广告体检赞助分析共用这一个上限，用满后两边新请求都会被拒`
        : `工具实验室这个月的全站合计次数快用完了（${count} / ${TOOLS_AI_CALLS_MONTHLY_CAP} 次，${pct}%）——网站诊断和广告体检赞助分析共用这一个上限，加不加？`,
    how: '要加：回开发窗口说「工具实验室全站上限改成 X」（数字你定），当天生效，不用发版。不加：用满后两边工具当月都会显示「本月免费名额已满」，下个月初自动恢复。',
    href: 'https://app.magicengine.com.au/dashboard',
  })
}
