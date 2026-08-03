/**
 * 目标「起点」与「现值」口径一致性检查（2026-08-03）。
 *
 * 真实事故：我看着仪表盘报给 PM「CTS 自然流量掉了 39%、Oztop 掉了 28%」，
 * 查下去发现**两个都是假的**：
 *   · CTS 起点 525 = 2026-06-04 的**总会话数**；同一天的自然流量只有 226
 *   · 现值 320 只算 `medium='organic'` 那部分
 *   → 真实是 226 → 320，**涨了 42%**，不是跌 39%
 *   · Oztop 同病：起点 402 是总会话，当天自然流量 95 → 现在 288，**涨了 203%**
 *
 * 根因：`baseline_value` 是建目标时人工/AI 填进去的，而 `current_value` 由
 * `autoFetchMetricValue` 自动算。**代码里没有任何东西保证两者用同一个算法。**
 *
 * 🔴 为什么这比「数字不好看」严重得多：
 *    错的方向感会让人做出反向决策 —— 看到「掉了 39%」的合理反应是砍掉正在见效的
 *    动作。**错的数字比没有数字更危险。**
 *
 * 这里不猜、不自动改客户的目标（那是业务事实），只把「口径可能不一致」标出来。
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** 能自动取值的指标 —— 只有这些才谈得上「起点和现值口径是否一致」。 */
const AUTO_METRICS = ['organic_traffic', 'brand_search_volume', 'form_submissions', 'leads_count', 'ai_visibility_score']

export interface BaselineSuspect {
  goalId: string
  /** 拼目标页地址要用它 —— 少了它就只能拼出 404（2026-08-03 差点又发一个死链）。 */
  clientId: string
  clientName: string
  title: string
  metricKey: string
  baseline: number
  current: number
  /** 按现值算法回算出来的、目标起始那天的真实值。取不到为 null。 */
  recomputedBaseline: number | null
  reason: string
}

/**
 * 判断起点是否可疑。
 *
 * 判据刻意保守 —— 宁可漏报也不要天天误报：
 *   只有当「按同一算法回算出的起点」与「记录的起点」差 25% 以上才算可疑。
 *   自然波动和采集时点差异撑不到这个量级；口径错（总量 vs 分项）通常差一倍以上。
 */
export const BASELINE_DRIFT_THRESHOLD = 0.25

export function isSuspect(baseline: number, recomputed: number | null): boolean {
  if (recomputed === null || recomputed === 0) return false
  return Math.abs(baseline - recomputed) / recomputed > BASELINE_DRIFT_THRESHOLD
}

/**
 * 回算某个目标起始日的自然流量 —— 用**跟现值完全相同**的算法。
 *
 * 只支持 organic_traffic：其余指标的历史快照结构不同，回算逻辑不一样，
 * 没验证过的分支不写（写了就是没测过的路）。
 */
async function recomputeOrganicBaseline(
  supabase: SupabaseClient,
  clientId: string,
  periodStart: string,
): Promise<number | null> {
  const { data } = await supabase
    .from('ga4_traffic_snapshots')
    .select('top_sources, period_end')
    .eq('client_id', clientId)
    .lte('period_end', periodStart)
    .order('period_end', { ascending: false })
    .limit(1)
    .maybeSingle<{ top_sources: Array<{ medium?: string; sessions?: number }> | null }>()

  if (!data?.top_sources) return null
  return data.top_sources.reduce(
    (sum, s) => sum + (s.medium === 'organic' && typeof s.sessions === 'number' ? s.sessions : 0),
    0,
  )
}

export async function auditGoalBaselines(supabase: SupabaseClient): Promise<BaselineSuspect[]> {
  const { data } = await supabase
    .from('goals')
    .select('id, client_id, title, primary_metric_key, baseline_value, current_value, period_start, clients(name)')
    .eq('status', 'active')
    .in('primary_metric_key', AUTO_METRICS)

  const out: BaselineSuspect[] = []
  for (const g of (data ?? []) as Array<Record<string, unknown>>) {
    const metricKey = g.primary_metric_key as string
    const baseline = Number(g.baseline_value ?? 0)
    const current = Number(g.current_value ?? 0)
    if (!Number.isFinite(baseline) || !g.current_value) continue

    // 目前只回算得了自然流量；其余指标先跳过，不假装检查过
    if (metricKey !== 'organic_traffic') continue

    const recomputed = await recomputeOrganicBaseline(
      supabase,
      g.client_id as string,
      g.period_start as string,
    )
    if (!isSuspect(baseline, recomputed)) continue

    const clientName = ((g.clients as { name?: string } | null)?.name) ?? '未知客户'
    out.push({
      goalId: g.id as string,
      clientId: g.client_id as string,
      clientName,
      title: g.title as string,
      metricKey,
      baseline,
      current,
      recomputedBaseline: recomputed,
      reason:
        `起点记的是 ${baseline}，但按现值同样的算法回算，目标开始那天应该是 ${recomputed} —— ` +
        `多半起点填成了「总流量」而现值只算「自然流量」。` +
        `按正确口径，真实变化是 ${recomputed} → ${current}` +
        (recomputed && recomputed > 0
          ? `（${current >= recomputed ? '涨' : '跌'} ${Math.abs(Math.round(((current - recomputed) / recomputed) * 100))}%）`
          : ''),
    })
  }
  return out
}
