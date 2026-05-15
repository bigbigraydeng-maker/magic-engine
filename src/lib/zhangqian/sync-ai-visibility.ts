/**
 * Zhangqian → AI Visibility bridge.
 *
 * Reference: ROADMAP.md P8.12.S1.8
 *
 * When a Zhangqian discovery is confirmed, mirror its `ai_tracker_questions`
 * into the `ai_visibility_queries` table so the AI Visibility module has
 * client-specific, locally-relevant tracking questions out of the box.
 *
 * This replaces the previous flow where operators had to click
 * "Generate Questions" in AI Visibility to produce 18 generic AU/NZ SEO
 * questions — Zhangqian's questions are far higher-signal (built from the
 * actual business / industry / market context).
 *
 * Idempotency: only inserts questions whose text is not already present
 * for this client (preserves operator enable/disable toggles across reruns).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DiscoveryReport, DiscoveredAiQuestion } from './types'

/** Map Zhangqian's market enum to AI Visibility's market_tag format. */
function mapMarketTag(market: DiscoveredAiQuestion['market']): string {
  if (market === 'AU') return 'au'
  if (market === 'NZ') return 'nz'
  return 'au-nz'
}

/**
 * Sync `payload.ai_tracker_questions` into `ai_visibility_queries`.
 * Returns the number of new rows inserted (0 if all questions already exist).
 *
 * Errors thrown by callers (use try/catch in confirm route so a sync
 * failure does not block the confirmation flow).
 */
export async function syncAiTrackerQuestions(
  supabase: SupabaseClient,
  clientId: string,
  payload: DiscoveryReport,
): Promise<number> {
  const questions = payload.ai_tracker_questions
  if (!questions || questions.length === 0) return 0

  // De-dupe: skip questions already mirrored for this client.
  const { data: existingRows, error: selectErr } = await supabase
    .from('ai_visibility_queries')
    .select('question')
    .eq('client_id', clientId)

  if (selectErr) {
    throw new Error(`Failed to load existing ai_visibility_queries: ${selectErr.message}`)
  }

  const existingSet = new Set(
    (existingRows ?? []).map((r: { question: string }) => r.question),
  )

  const rows = questions
    .filter(q => !existingSet.has(q.question))
    .map(q => ({
      client_id: clientId,
      question: q.question,
      source: 'auto_generated' as const,
      enabled: true,
      market_tag: mapMarketTag(q.market),
      // Encode Zhangqian's category + rationale into notes so the
      // QueriesManager UI surfaces context for the operator.
      notes: q.category ? `[${q.category}] ${q.rationale}` : q.rationale,
    }))

  if (rows.length === 0) return 0

  const { error: insertErr } = await supabase
    .from('ai_visibility_queries')
    .insert(rows)

  if (insertErr) {
    throw new Error(`Failed to insert ai_visibility_queries: ${insertErr.message}`)
  }

  return rows.length
}
