/**
 * 深度诊断周更调度（2026-08-03）。
 *
 * 补的是 DAPE 最大的断点：**A 段(分析)此前零自动化** —— 深度诊断只能人工点按钮，
 * 或新客户建档时跑一次。最近一次是 2026-07-20，两周前。
 * 结果是 E 段(执行)天天在跑，但执行的是两个月前的结论：
 * 没有新分析 → 没有新处方 → 只能重复老动作。
 *
 * 🔴 为什么是周更不是日更：
 *    诊断是**六个维度全量采集 + AI 综合**（SEO/社媒/口碑/竞品/AI 可见度/广告），
 *    每跑一次要打一圈外部接口。跟规则引擎型的 anomaly-detector 完全不是一个量级 ——
 *    那个可以日更，这个日更就是烧钱。六个维度一周变一次已经够灵敏。
 *
 * 🔴 为什么不是「所有 active 客户」：
 *    库里 active 里混着 Magic Engine / Magic Lab 这类**我们自己的内部账号**，
 *    它们没有客户数据，跑一圈采集器只会白烧外部接口额度。
 *    判据用「有没有域名」—— 没有网站就没有 SEO/竞品可采，这是天然的门槛。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createDiagnosticRun, executeDiagnosticRun } from './runner'

/** 同一个客户多久内跑过就跳过 —— 防手工刚跑完 cron 又跑一遍白花钱。 */
export const RERUN_COOLDOWN_DAYS = 5

export interface ScheduledDiagnosticOutcome {
  clientId: string
  clientName: string
  result: 'ran' | 'skipped_recent' | 'error'
  runId?: string
  detail?: string
}

export interface ScheduledDiagnosticSummary {
  eligible: number
  outcomes: ScheduledDiagnosticOutcome[]
}

export interface EligibleClient {
  id: string
  name: string
  domain: string | null
}

/**
 * 谁该跑。
 *
 * 纯函数，便于测试 —— 「选错客户」是这条链上最贵的错（每多选一个就多烧一圈接口）。
 */
export function pickEligible(
  clients: EligibleClient[],
  lastRunByClient: Map<string, Date>,
  now: Date,
): { run: EligibleClient[]; skipped: ScheduledDiagnosticOutcome[] } {
  const run: EligibleClient[] = []
  const skipped: ScheduledDiagnosticOutcome[] = []

  for (const c of clients) {
    // 没域名 = 没网站 = SEO/竞品采集器无从下手，跑了也是空的
    if (!c.domain || !c.domain.trim()) continue

    const last = lastRunByClient.get(c.id)
    if (last) {
      const days = (now.getTime() - last.getTime()) / 86_400_000
      if (days < RERUN_COOLDOWN_DAYS) {
        skipped.push({
          clientId: c.id,
          clientName: c.name,
          result: 'skipped_recent',
          detail: `${days.toFixed(1)} 天前刚诊断过（冷却 ${RERUN_COOLDOWN_DAYS} 天）`,
        })
        continue
      }
    }
    run.push(c)
  }
  return { run, skipped }
}

export async function runScheduledDiagnostics(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<ScheduledDiagnosticSummary> {
  const { data: clientRows, error } = await supabase
    .from('clients')
    .select('id, name, domain')
    .eq('client_status', 'active')
  if (error) throw new Error(`clients query failed: ${error.message}`)

  const clients = (clientRows ?? []) as EligibleClient[]

  // 每个客户最近一次诊断。一次查回来，不逐个打库。
  const { data: runRows } = await supabase
    .from('diagnostic_runs')
    .select('client_id, created_at')
    .order('created_at', { ascending: false })
    .limit(500)

  const lastRun = new Map<string, Date>()
  for (const r of (runRows ?? []) as Array<{ client_id: string; created_at: string }>) {
    if (!lastRun.has(r.client_id)) lastRun.set(r.client_id, new Date(r.created_at))
  }

  const { run, skipped } = pickEligible(clients, lastRun, now)
  const outcomes: ScheduledDiagnosticOutcome[] = [...skipped]

  // 串行跑：诊断本身就在并发打一圈外部接口，再并行几个客户会直接把额度打爆。
  // 慢不是问题 —— 这是周更任务，跑一小时也没人等。
  for (const c of run) {
    try {
      const runId = await createDiagnosticRun(supabase, c.id, 'full')
      await executeDiagnosticRun(supabase, runId, c.id, 'full')
      outcomes.push({ clientId: c.id, clientName: c.name, result: 'ran', runId })
    } catch (e) {
      // 一个客户失败不拖累其他客户 —— 但要留下原因，否则又变成「没结果也不知道为什么」
      outcomes.push({
        clientId: c.id,
        clientName: c.name,
        result: 'error',
        detail: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return { eligible: run.length, outcomes }
}
