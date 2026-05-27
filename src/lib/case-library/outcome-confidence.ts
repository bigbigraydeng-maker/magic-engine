/**
 * Outcome Confidence — P12.C.2
 *
 * Queries flywheel_outcomes + flywheel_actions to compute historical success
 * rates per action_type. Result is injected into the Huatuo generation prompt
 * so Claude can annotate each recommended action with a confidence label.
 *
 * Pure functions are exported for testability; DB access is in the async fetch.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RawOutcomeConfidenceRow {
  action_type: string
  verdict: string
}

export interface ConfidenceEntry {
  successRate: number
  sampleSize: number
}

/** keyed by action_type (e.g. "geo.deploy_directive") */
export type OutcomeConfidenceMap = Record<string, ConfidenceEntry>

// ── Pure helpers ──────────────────────────────────────────────────────────────

export function computeConfidenceMap(rows: RawOutcomeConfidenceRow[]): OutcomeConfidenceMap {
  const buckets = new Map<string, { confirmed: number; total: number }>()
  for (const r of rows) {
    const b = buckets.get(r.action_type) ?? { confirmed: 0, total: 0 }
    b.total++
    if (r.verdict === 'confirmed') b.confirmed++
    buckets.set(r.action_type, b)
  }
  const result: OutcomeConfidenceMap = {}
  buckets.forEach((b, actionType) => {
    result[actionType] = {
      successRate: b.total === 0 ? 0 : b.confirmed / b.total,
      sampleSize: b.total,
    }
  })
  return result
}

export function getConfidenceLabel(map: OutcomeConfidenceMap, actionType: string): string {
  const entry = map[actionType]
  if (!entry) return '新策略，尚无验证数据'
  const pct = Math.round(entry.successRate * 100)
  return `历史成功率 ${pct}%，基于 ${entry.sampleSize} 个客户案例`
}

export function formatConfidenceForPrompt(map: OutcomeConfidenceMap): string {
  const entries = Object.entries(map)
  if (entries.length === 0) return ''

  const lines: string[] = [
    '## 历史成效数据（飞轮归因库）',
    '',
    '以下是 Magic Engine 历史上各行动类型的实测成功率。',
    '**使用方式**：为每个推荐行动附上置信度标签，帮助 FDE 优先执行高效行动。',
    '**不要跳过低成功率行动**：它们可能对特定客户仍有价值，只需透明标注。',
    '',
    '| action_type | 历史成功率 | 案例数 |',
    '|-------------|-----------|--------|',
  ]

  const sorted = entries.sort((a, b) => b[1].successRate - a[1].successRate)
  for (const [actionType, entry] of sorted) {
    const pct = Math.round(entry.successRate * 100)
    lines.push(`| \`${actionType}\` | ${pct}% | ${entry.sampleSize} |`)
  }

  lines.push(
    '',
    '**输出约束**：每个 action 的 `description` 末尾必须附上对应 action_type 的置信度标签，',
    '格式：`（${getConfidenceLabel(map, actionType)}）`。',
    '若该 action 无历史数据，附：`（新策略，尚无验证数据）`。',
  )

  return lines.join('\n')
}

// ── DB fetch ──────────────────────────────────────────────────────────────────

/**
 * Fetches all flywheel_outcomes joined to flywheel_actions and returns a
 * confidence map keyed by action_type.
 *
 * Fails silently — returns empty map on any DB error so Huatuo is not blocked.
 */
export async function fetchOutcomeConfidenceMap(
  supabase: SupabaseClient,
): Promise<OutcomeConfidenceMap> {
  try {
    const { data, error } = await supabase
      .from('flywheel_outcomes')
      .select('verdict, flywheel_actions!inner(action_type)')

    if (error || !data) return {}

    const rows: RawOutcomeConfidenceRow[] = (data as Array<{
      verdict: string
      flywheel_actions: { action_type: string } | Array<{ action_type: string }>
    }>).map(r => {
      const actions = Array.isArray(r.flywheel_actions) ? r.flywheel_actions[0] : r.flywheel_actions
      return { action_type: actions?.action_type ?? 'unknown', verdict: r.verdict }
    })

    return computeConfidenceMap(rows)
  } catch {
    return {}
  }
}
