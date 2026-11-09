/**
 * Once-a-day creative cards. Issuing a card does not change a budget or an ad.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface CreativeDailyResult {
  readonly cards: number
  readonly skipped: readonly string[]
  readonly wroteMeta: false
  readonly error?: string
}

const CLICKER = { kind: 'agent' as const, email: null }

export async function runCreativeStateDaily(
  sb: SupabaseClient,
  clientId: string,
  now = new Date(),
): Promise<CreativeDailyResult> {
  try {
    return await issueDaily(sb, clientId, now)
  } catch (error) {
    return { cards: 0, skipped: [], wroteMeta: false, error: short(error) }
  }
}

async function issueDaily(sb: SupabaseClient, clientId: string, now: Date): Promise<CreativeDailyResult> {
  const { loadCreativeDecision } = await import('@/lib/action-submission/creative-state-live')
  const decision = await loadCreativeDecision(sb, clientId, now)
  if (decision.proposals.length === 0) return { cards: 0, skipped: decision.skipped, wroteMeta: false }
  const { proposeCreativeStateCards } = await import('@/lib/action-submission/creative-state-card')
  const { createKernel } = await import('@/lib/kernel')
  const issued = await proposeCreativeStateCards(createKernel(sb, { now: () => now }), {
    clientId,
    clicker: CLICKER,
    decision,
    now,
  })
  return { cards: issued.issued.length, skipped: issued.skipped, wroteMeta: false }
}

function short(error: unknown): string {
  const text = error instanceof Error ? error.message : '素材建议没跑成'
  return text.replace(/\s+/g, ' ').trim().slice(0, 160) || '素材建议没跑成'
}
