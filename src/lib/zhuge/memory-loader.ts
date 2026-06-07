/**
 * DAPE W2 — 诸葛亮 memory loader helpers
 *
 * Loads the Layer 2 (industry-level) and self-feedback memory snapshots that
 * the zhuge conductor / proactive lens / luban router consume. The Layer 1
 * client memory already loads via `@/lib/memory`'s loadMemoryForClient; this
 * file fills the remaining gaps spec'd in v0.2 §1.5.6 + §2.x.6.
 *
 * Design rules (mirror @/lib/memory/service.ts):
 *   - Any failure → return an empty/has_content=false snapshot (never throw)
 *   - Logs go to console.warn so we can validate memory hits in §3 metrics
 *   - Read-only — never writes anything
 *
 * Reference: docs/superpowers/specs/2026-06-08-me-dape-redefine-v0.2.md §3
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { IndustryBenchmarkSummary, ZhugeFeedbackSummary } from './types'

const FEEDBACK_SAMPLE_SIZE = 25

interface IndustryBenchmarkRow {
  industry_category: string | null
  dimension: 'seo' | 'social' | 'reputation' | 'ai_visibility'
  score_p50: number | null
  score_p75: number | null
  score_p90: number | null
  typical_monthly_budget_aud: number | null
  confidence: number | null
  source: string | null
}

interface FeedbackRow {
  suggestion_key: string
  suggestion_title: string
  feedback_state: 'done' | 'dismissed' | 'irrelevant'
  created_at: string
}

/**
 * Resolve the canonical sub-industry slug for benchmark lookup.
 * Mirrors the convention used by huatuo (see lib/huatuo/benchmarks.ts).
 *
 * Order of preference:
 *   1. clients.sub_industry (if column populated)
 *   2. clients.industry (legacy)
 *   3. null (caller treats as no benchmark)
 */
export async function resolveClientSubIndustry(
  supabase: SupabaseClient,
  clientId: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('clients')
      .select('industry, sub_industry')
      .eq('id', clientId)
      .maybeSingle()

    if (error || !data) return null
    const row = data as { industry?: string | null; sub_industry?: string | null }
    return row.sub_industry || row.industry || null
  } catch {
    return null
  }
}

/**
 * DAPE W2 — Load industry_benchmarks summary for the client's sub-industry.
 *
 * - Returns empty summary on any failure (non-throwing, like loadMemoryForClient)
 * - Only the columns the prompt actually needs are read (token-cheap)
 * - Logs a one-line console.warn on failure so memory hits stay observable
 */
export async function loadIndustryBenchmarkSummary(
  supabase: SupabaseClient,
  clientId: string,
): Promise<IndustryBenchmarkSummary> {
  const emptySummary: IndustryBenchmarkSummary = {
    sub_industry: null,
    dimensions: [],
    has_content: false,
  }

  const subIndustry = await resolveClientSubIndustry(supabase, clientId)
  if (!subIndustry) {
    return emptySummary
  }

  try {
    const { data, error } = await supabase
      .from('industry_benchmarks')
      .select(
        'industry_category, dimension, score_p50, score_p75, score_p90, typical_monthly_budget_aud, confidence, source',
      )
      .eq('industry_category', subIndustry)

    if (error) {
      console.warn(
        `[zhuge/memory-loader] loadIndustryBenchmarkSummary error for ${subIndustry}:`,
        error.message,
      )
      return { ...emptySummary, sub_industry: subIndustry }
    }

    const rows = (data ?? []) as IndustryBenchmarkRow[]
    if (rows.length === 0) {
      return { ...emptySummary, sub_industry: subIndustry }
    }

    return {
      sub_industry: subIndustry,
      dimensions: rows.map((r) => ({
        dimension: r.dimension,
        score_p50: r.score_p50,
        score_p75: r.score_p75,
        score_p90: r.score_p90,
        typical_monthly_budget_aud: r.typical_monthly_budget_aud,
        confidence: r.confidence ?? 0,
        source: r.source,
      })),
      has_content: true,
    }
  } catch (err) {
    console.warn(
      `[zhuge/memory-loader] loadIndustryBenchmarkSummary exception for ${subIndustry}:`,
      err instanceof Error ? err.message : String(err),
    )
    return { ...emptySummary, sub_industry: subIndustry }
  }
}

/**
 * DAPE W2 — Load zhuge's own feedback loop snapshot for one client.
 *
 * Returns the last N events plus aggregates so the proactive lens can:
 *   - skip suggestion_keys the client has repeatedly dismissed
 *   - learn from suggestion_keys the client repeatedly marks "done"
 *   - learn from suggestion_keys the client marks "irrelevant"
 */
export async function loadZhugeFeedbackSummary(
  supabase: SupabaseClient,
  clientId: string,
  limit: number = FEEDBACK_SAMPLE_SIZE,
): Promise<ZhugeFeedbackSummary> {
  const empty: ZhugeFeedbackSummary = {
    has_content: false,
    total: 0,
    state_counts: { done: 0, dismissed: 0, irrelevant: 0 },
    dismissed_keys: [],
    irrelevant_keys: [],
    recent_events: [],
  }

  try {
    const { data, error } = await supabase
      .from('zhuge_feedback_events')
      .select('suggestion_key, suggestion_title, feedback_state, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.warn(
        `[zhuge/memory-loader] loadZhugeFeedbackSummary error for ${clientId}:`,
        error.message,
      )
      return empty
    }

    const rows = (data ?? []) as FeedbackRow[]
    if (rows.length === 0) return empty

    // Aggregate by feedback_state + tally repeat-offender keys.
    const stateCounts = { done: 0, dismissed: 0, irrelevant: 0 }
    const dismissedTally = new Map<string, number>()
    const irrelevantTally = new Map<string, number>()

    for (const row of rows) {
      stateCounts[row.feedback_state] = (stateCounts[row.feedback_state] ?? 0) + 1
      if (row.feedback_state === 'dismissed') {
        dismissedTally.set(row.suggestion_key, (dismissedTally.get(row.suggestion_key) ?? 0) + 1)
      } else if (row.feedback_state === 'irrelevant') {
        irrelevantTally.set(row.suggestion_key, (irrelevantTally.get(row.suggestion_key) ?? 0) + 1)
      }
    }

    const dismissedKeys = Array.from(dismissedTally.entries())
      .filter(([, count]) => count >= 2)
      .map(([key]) => key)
    const irrelevantKeys = Array.from(irrelevantTally.entries())
      .filter(([, count]) => count >= 2)
      .map(([key]) => key)

    return {
      has_content: true,
      total: rows.length,
      state_counts: stateCounts,
      dismissed_keys: dismissedKeys,
      irrelevant_keys: irrelevantKeys,
      // recent_events ordered newest-first (already from query); cap to 10 for prompt brevity
      recent_events: rows.slice(0, 10).map((r) => ({
        suggestion_key: r.suggestion_key,
        suggestion_title: r.suggestion_title,
        feedback_state: r.feedback_state,
        created_at: r.created_at,
      })),
    }
  } catch (err) {
    console.warn(
      `[zhuge/memory-loader] loadZhugeFeedbackSummary exception for ${clientId}:`,
      err instanceof Error ? err.message : String(err),
    )
    return empty
  }
}

/**
 * DAPE W2 — Format the industry benchmark summary as a compact prompt block.
 *
 * Empty input → empty string (caller can splat into the prompt unconditionally).
 */
export function formatIndustryBenchmarkPrompt(
  summary: IndustryBenchmarkSummary | undefined,
): string {
  if (!summary || !summary.has_content || summary.dimensions.length === 0) return ''

  const lines: string[] = [
    `\n## Industry Memory (L2 — sub_industry=${summary.sub_industry ?? 'n/a'})`,
    'Use these per-dimension benchmarks to anchor recommendations against real peer performance.',
  ]
  for (const d of summary.dimensions) {
    const p50 = d.score_p50 ?? '—'
    const p75 = d.score_p75 ?? '—'
    const p90 = d.score_p90 ?? '—'
    const budget = d.typical_monthly_budget_aud != null ? ` typical_budget_aud=${d.typical_monthly_budget_aud}` : ''
    const source = d.source ? ` source="${d.source}"` : ''
    lines.push(
      `  - ${d.dimension}: P50=${p50} P75=${p75} P90=${p90}${budget} confidence=${d.confidence.toFixed(2)}${source}`,
    )
  }
  return lines.join('\n') + '\n'
}

/**
 * DAPE W2 — Format the zhuge feedback summary as a compact prompt block.
 *
 * Empty input → empty string. Highlights what the client already pushed back on
 * so the LLM doesn't re-propose the same thing next pass.
 */
export function formatZhugeFeedbackPrompt(
  summary: ZhugeFeedbackSummary | undefined,
): string {
  if (!summary || !summary.has_content || summary.total === 0) return ''

  const lines: string[] = [
    '\n## Self-Feedback Loop (zhuge_feedback_events)',
    `Total recent events: ${summary.total} (done=${summary.state_counts.done}, dismissed=${summary.state_counts.dismissed}, irrelevant=${summary.state_counts.irrelevant})`,
  ]

  if (summary.dismissed_keys.length > 0) {
    lines.push(
      `Client repeatedly DISMISSED these suggestion keys — DO NOT re-suggest: ${summary.dismissed_keys.join(', ')}`,
    )
  }
  if (summary.irrelevant_keys.length > 0) {
    lines.push(
      `Client repeatedly marked IRRELEVANT — re-frame or skip: ${summary.irrelevant_keys.join(', ')}`,
    )
  }
  if (summary.recent_events.length > 0) {
    lines.push('Recent feedback events (most-recent first):')
    for (const ev of summary.recent_events) {
      lines.push(`  - [${ev.feedback_state}] ${ev.suggestion_key} "${ev.suggestion_title}"`)
    }
  }
  return lines.join('\n') + '\n'
}
