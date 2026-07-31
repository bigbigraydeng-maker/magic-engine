/**
 * Recommendation-card auto-expiry (22.E.S18 前置 · 待办卫生).
 *
 * writeExecutionItems already supersedes an old zhuge card when a NEW card of
 * the same action_type arrives — but a card whose issue stopped being
 * recommended (rankings recovered, keyword dropped out) is never re-issued,
 * so it sits 'pending' forever. 447 such rows had accumulated by 2026-07-31.
 *
 * Rule: a zhuge-sourced card still pending after CARD_EXPIRY_DAYS is no
 * longer today's recommendation — mark it 'superseded' (existing status,
 * same value the persister uses). Human-created cards (source fde/luban)
 * are never touched: those are commitments, not recommendations.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const CARD_EXPIRY_DAYS = 14

export interface CardExpiryResult {
  superseded: number
}

export function cardExpiryCutoff(now: Date, days: number = CARD_EXPIRY_DAYS): string {
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - days)
  return cutoff.toISOString()
}

export async function supersedeStaleZhugeCards(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<CardExpiryResult> {
  const cutoff = cardExpiryCutoff(now)

  const { data, error } = await supabase
    .from('execution_items')
    .update({ status: 'superseded' })
    .eq('status', 'pending')
    .eq('source', 'zhuge')
    .lt('created_at', cutoff)
    .select('id')

  if (error) throw new Error(`card expiry failed: ${error.message}`)

  return { superseded: (data ?? []).length }
}
