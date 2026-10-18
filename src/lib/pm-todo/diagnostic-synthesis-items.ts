/**
 * 每周体检（diagnostic-weekly）的 AI 文字叙事没写成 —— 开发侧欠账，不是给人做的活。
 *
 * 每周任务把每个客户的结果写进 cron_run_logs.summary.outcomes[]，其中
 * synthesis 是一张回执：state / failed_modules / errors / total_cost_usd。
 * state 为 'failed' 或 'partial' 时，那份体检报告里的叙事部分是空的，
 * 而失败时大模型费用照样会花 —— 以前这件事没有任何一条路会把它端到人眼前。
 *
 * 判据（extractSynthesisFailures / buildDiagnosticSynthesisItems）是纯函数，
 * 单独测；取数（pushDiagnosticSynthesisItems）只读一张表，读失败由调用方兜底。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'

/** 往回看多少天 —— 比一周多一天，免得周一早上漏掉上周日那轮。 */
export const SYNTHESIS_ITEM_LOOKBACK_DAYS = 8

export interface SynthesisReceiptLike {
  state: string
  failed_modules: string[]
  errors: string[]
  skipped_reason?: string
  total_cost_usd: number
}

export interface SynthesisFailure {
  clientId: string
  clientName: string
  runId?: string
  receipt: SynthesisReceiptLike
}

/** 模块 key 的中文名 —— 认不出的 key 原样打印。 */
const MODULE_LABELS: Record<string, string> = {
  score_explanations: '打分解释',
  dimension_narratives: '分维度叙事',
  competitor_analysis: '竞品分析',
  market_context: '行业背景',
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string')
}

function toFiniteNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : 0
}

/** 把一条 outcome 里的 synthesis 收成回执；形状不对返回 null（忽略该条）。 */
function parseReceipt(raw: unknown): SynthesisReceiptLike | null {
  if (!isRecord(raw)) return null
  if (typeof raw.state !== 'string') return null
  const receipt: SynthesisReceiptLike = {
    state: raw.state,
    failed_modules: toStringArray(raw.failed_modules),
    errors: toStringArray(raw.errors),
    total_cost_usd: toFiniteNumber(raw.total_cost_usd),
  }
  if (typeof raw.skipped_reason === 'string') receipt.skipped_reason = raw.skipped_reason
  return receipt
}

/**
 * 从 cron_run_logs 行里挑出叙事没写成的客户。
 *
 * logs 按 started_at 新到旧排。每个 clientId 只看最新一条带 synthesis 的
 * outcome —— 更新的健康一轮会抵消更旧的失败。只报 'failed' / 'partial'，
 * 保持首次出现的顺序。全程防御，形状不对就跳过，绝不抛。
 */
export function extractSynthesisFailures(logs: Array<{ summary: unknown }>): SynthesisFailure[] {
  const seen = new Set<string>()
  const failures: SynthesisFailure[] = []

  for (const log of logs) {
    const summary = log?.summary
    if (!isRecord(summary)) continue
    const outcomes = summary.outcomes
    if (!Array.isArray(outcomes)) continue

    for (const outcome of outcomes) {
      if (!isRecord(outcome)) continue
      const clientId = outcome.clientId
      if (typeof clientId !== 'string' || clientId.length === 0) continue
      if (seen.has(clientId)) continue

      const receipt = parseReceipt(outcome.synthesis)
      if (!receipt) continue

      // 'skipped'（限流/关闭）说明这轮没尝试叙事，不能抵消更早的失败 —— 继续往旧的看。
      if (receipt.state === 'skipped') continue
      // 这个客户最新一条真正尝试过叙事的 outcome 就是它 —— 之后更旧的都不看了。
      seen.add(clientId)
      if (receipt.state !== 'failed' && receipt.state !== 'partial') continue

      const clientName = typeof outcome.clientName === 'string' ? outcome.clientName : clientId
      const failure: SynthesisFailure = { clientId, clientName, receipt }
      if (typeof outcome.runId === 'string') failure.runId = outcome.runId
      failures.push(failure)
    }
  }

  return failures
}

function modulesText(modules: string[]): string {
  if (modules.length === 0) return '未知模块'
  return modules.map((m) => MODULE_LABELS[m] ?? m).join('、')
}

/** 一条失败 -> 一条待办。纯函数。 */
export function buildDiagnosticSynthesisItems(failures: SynthesisFailure[]): ManualItem[] {
  return failures.map((f) => {
    const base = `「${f.clientName}」本周体检的 AI 文字叙事没写成（${modulesText(f.receipt.failed_modules)}）—— 体检报告里的叙事部分是空的，而且失败时大模型费用仍然会花`
    const firstError = f.receipt.errors[0]
    const what = firstError ? `${base} 首个原因：${firstError.slice(0, 160)}` : base
    return {
      kind: 'diagnostic_synthesis_failing',
      client_id: f.clientId,
      client_name: f.clientName,
      what,
      how: '这条不用你动手 —— 是我们这边的欠账。回我一句「修一下体检叙事」，我去查原因',
      href: `https://app.magicengine.com.au/dashboard/clients/${f.clientId}/diagnostic/report`,
    }
  })
}

/**
 * 读最近几轮 diagnostic-weekly 的日志，把叙事没写成的客户下发成待办。
 *
 * 读失败直接抛，由调用方（manual-items.ts）的 .catch 兜住 —— 跟本文件夹
 * 其他通道同一条纪律：一条通道读挂了不拖垮别的待办。
 */
export async function pushDiagnosticSynthesisItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
): Promise<void> {
  const since = new Date(now.getTime() - SYNTHESIS_ITEM_LOOKBACK_DAYS * 24 * 3_600_000).toISOString()

  const { data, error } = await supabase
    .from('cron_run_logs')
    .select('summary')
    .eq('job_name', 'diagnostic-weekly')
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(10)

  if (error) throw new Error(`cron_run_logs query failed: ${error.message}`)

  const rows = (data ?? []) as Array<{ summary: unknown }>
  items.push(...buildDiagnosticSynthesisItems(extractSynthesisFailures(rows)))
}
