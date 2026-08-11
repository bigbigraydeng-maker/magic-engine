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
import { fetchAll } from '@/lib/supabase-paginate'
import { keepOneCasePerAction } from '@/lib/flywheel/attribution/outcome-identity'

/**
 * An outcome row as these queries fetch it. The identity columns are selected
 * so multi-window rows for one action collapse to a single sample before any
 * counting — see keepOneMeasurementPerAction.
 */
/** Lift `expected_metric` off the joined action so case-picking can see it. */
function withPromise<A extends { expected_metric?: string | null }>(
  rows: Array<OutcomeConfidenceQueryRow<A>>,
): Array<OutcomeConfidenceQueryRow<A>> {
  return rows.map(r => {
    const action = Array.isArray(r.flywheel_actions) ? r.flywheel_actions[0] : r.flywheel_actions
    return { ...r, expected_metric: action?.expected_metric ?? null }
  })
}

interface OutcomeConfidenceQueryRow<A> {
  action_id: string
  metric_key: string
  window_days: number | null
  /** Copied off the joined action so one case can be picked per action. */
  expected_metric?: string | null
  verdict: string
  flywheel_actions: A | A[]
}

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
    // 分页读全：PostgREST 单次最多 1000 行且不报错。截断在这里比少几行更糟 ——
    // 按动作折叠是在读到的行里挑代表，如果恰好把带 expected_metric 的那行截掉了,
    // 折叠会挑另一行当这个动作的结论，于是不是「少算」而是「算错」。
    // 一个动作本来就出三行，双窗口再翻倍，上限来得比行数看上去快得多。
    // （Codex P2, round 28 on PR #862）
    const data = await fetchAll<OutcomeConfidenceQueryRow<{ action_type: string; expected_metric?: string | null }>>(
      (from, to) =>
        supabase
          .from('flywheel_outcomes')
          .select('id, action_id, metric_key, window_days, verdict, flywheel_actions!inner(action_type, expected_metric)')
          .order('id', { ascending: true })
          .range(from, to),
    )

    const rows: RawOutcomeConfidenceRow[] = keepOneCasePerAction(
      withPromise(data),
    ).map(r => {
      const actions = Array.isArray(r.flywheel_actions) ? r.flywheel_actions[0] : r.flywheel_actions
      return { action_type: actions?.action_type ?? 'unknown', verdict: r.verdict }
    })

    return computeConfidenceMap(rows)
  } catch {
    return {}
  }
}

// ── 诸葛亮 v2: per-client outcome history (agent-tools readonly) ──────────────

/**
 * Per-client outcome confidence — the client-scoped counterpart of
 * fetchOutcomeConfidenceMap.
 *
 * 🔴 SECURITY (spec §3.3 条款 A): fetchOutcomeConfidenceMap queries the WHOLE
 * flywheel_outcomes table (all clients) — correct for Huatuo's global baseline,
 * but a cross-client leak if exposed as a per-client agent tool. This function
 * ALWAYS filters `flywheel_actions.client_id = clientId` (same guard pattern as
 * fetchSeoBlogConfidenceByMode) so the 诸葛亮 query_flywheel_history tool can
 * only ever see the current client's own action outcomes.
 *
 * Returns a confidence map keyed by action_type, scoped to one client.
 * Fails silently — returns {} on any DB error.
 *
 * @param filters.flywheel    Optional — restrict to one flywheel (seo/geo/ads/social).
 * @param filters.actionType  Optional — restrict to one action_type.
 */
export async function fetchClientOutcomeHistory(
  supabase: SupabaseClient,
  clientId: string,
  filters?: { flywheel?: string; actionType?: string },
): Promise<OutcomeConfidenceMap> {
  if (!clientId) return {}
  try {
    // 分页读全：理由同 fetchOutcomeConfidenceMap —— 截断之后再折叠不是少算是算错。
    // （Codex P2, round 29 on PR #862）
    const data = await fetchAll<OutcomeConfidenceQueryRow<{ action_type: string; expected_metric?: string | null }>>(
      (from, to) => {
        let query = supabase
          .from('flywheel_outcomes')
          .select('id, action_id, metric_key, window_days, verdict, flywheel_actions!inner(action_type, flywheel, client_id, expected_metric)')
          .eq('flywheel_actions.client_id', clientId) // 🔴 hard client scope — never removed

        if (filters?.flywheel) query = query.eq('flywheel_actions.flywheel', filters.flywheel)
        if (filters?.actionType) query = query.eq('flywheel_actions.action_type', filters.actionType)

        return query.order('id', { ascending: true }).range(from, to)
      },
    )

    const rows: RawOutcomeConfidenceRow[] = keepOneCasePerAction(
      withPromise(data),
    ).map(r => {
      const actions = Array.isArray(r.flywheel_actions) ? r.flywheel_actions[0] : r.flywheel_actions
      return { action_type: actions?.action_type ?? 'unknown', verdict: r.verdict }
    })

    return computeConfidenceMap(rows)
  } catch {
    return {}
  }
}

// ── P14.C.5: SEO blog outcome → mode-level feedback loop ─────────────────────

/** Aggregated success stats per content_mode for one client's SEO blog history. */
export type SeoBlogConfidenceByMode = Record<
  'unified' | 'geo_only' | 'seo_only',
  ConfidenceEntry
>

/**
 * Per-client SEO blog confidence keyed by content_mode (unified / geo_only / seo_only).
 *
 * Reads the mode out of flywheel_actions.payload.mode for any SEO publish action
 * on the given client, then aggregates outcome verdicts. Returns zero-filled
 * entries when the client has no SEO history yet so callers can treat the result
 * uniformly.
 *
 * Used by:
 *   1. strategy/generate scorer — small priority boost for modes with proven success
 *   2. Huatuo prompt extension — surfaces per-mode hit rate alongside global stats
 *
 * Reference: ROADMAP.md P14.C.5
 */
export async function fetchSeoBlogConfidenceByMode(
  supabase: SupabaseClient,
  clientId: string,
): Promise<SeoBlogConfidenceByMode> {
  const empty: SeoBlogConfidenceByMode = {
    unified:  { successRate: 0, sampleSize: 0 },
    geo_only: { successRate: 0, sampleSize: 0 },
    seo_only: { successRate: 0, sampleSize: 0 },
  }

  try {
    // 分页读全：理由同 fetchOutcomeConfidenceMap —— 截断之后再折叠不是少算是算错。
    // （Codex P2, round 29 on PR #862）
    const data = await fetchAll<OutcomeConfidenceQueryRow<{ payload?: { mode?: string } | null; expected_metric?: string | null }>>(
      (from, to) =>
        supabase
          .from('flywheel_outcomes')
          .select('id, action_id, metric_key, window_days, verdict, flywheel_actions!inner(action_type, payload, client_id, expected_metric)')
          .eq('flywheel_actions.client_id', clientId)
          .eq('flywheel_actions.action_type', 'seo.publish_blog')
          .order('id', { ascending: true })
          .range(from, to),
    )

    const buckets: Record<string, { confirmed: number; total: number }> = {
      unified:  { confirmed: 0, total: 0 },
      geo_only: { confirmed: 0, total: 0 },
      seo_only: { confirmed: 0, total: 0 },
    }

    for (const row of keepOneCasePerAction(
      withPromise(data),
    )) {
      const action = Array.isArray(row.flywheel_actions) ? row.flywheel_actions[0] : row.flywheel_actions
      const mode = action?.payload?.mode
      if (!mode || !(mode in buckets)) continue
      buckets[mode].total++
      if (row.verdict === 'confirmed') buckets[mode].confirmed++
    }

    return {
      unified:  toEntry(buckets.unified),
      geo_only: toEntry(buckets.geo_only),
      seo_only: toEntry(buckets.seo_only),
    }
  } catch {
    return empty
  }
}

function toEntry(b: { confirmed: number; total: number }): ConfidenceEntry {
  return {
    successRate: b.total === 0 ? 0 : b.confirmed / b.total,
    sampleSize:  b.total,
  }
}

/**
 * Compute a 0–10 priority boost for one content_mode based on its historical
 * success rate. Requires at least 2 samples to avoid noise; caps at +10 to
 * preserve the scorer's existing ceiling.
 *
 * Pure function — exported for unit testing.
 */
export function getModeBoost(stats: ConfidenceEntry): number {
  if (stats.sampleSize < 2) return 0
  if (stats.successRate >= 0.7) return 10
  if (stats.successRate >= 0.5) return 6
  if (stats.successRate >= 0.3) return 2
  return 0
}

/** Markdown block for Huatuo prompt — surfaces per-mode SEO performance. */
export function formatSeoModeConfidenceForPrompt(
  stats: SeoBlogConfidenceByMode,
): string {
  const anyData = Object.values(stats).some(s => s.sampleSize > 0)
  if (!anyData) return ''

  const fmt = (mode: keyof SeoBlogConfidenceByMode): string => {
    const s = stats[mode]
    if (s.sampleSize === 0) return `| \`${mode}\` | — | 0 |`
    return `| \`${mode}\` | ${Math.round(s.successRate * 100)}% | ${s.sampleSize} |`
  }

  return [
    '## SEO 博客 — 按 content_mode 分组成效（仅本客户历史）',
    '',
    '当推荐 `seo.publish_blog` 类行动时，请优先选择历史成功率最高的 mode。',
    '',
    '| mode | 成功率 | 案例数 |',
    '|------|--------|--------|',
    fmt('unified'),
    fmt('geo_only'),
    fmt('seo_only'),
  ].join('\n')
}
