/**
 * Once-a-day scale-back cards. Issuing a card does not change a budget.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { KernelDeps } from '@/lib/kernel/deps'
import { isUuid } from '@/lib/validation-utils'
import { loadApprovedPromoDeliveryStage } from '@/lib/marketing-plan/promo/approved-delivery-stage'
import { fallbackFacts } from './facts'
import { loadScaleFallback } from './load'
import { judgeScaleFallback, type ScaleFallbackProposal } from './rules'

export interface ScaleFallbackResult {
  readonly cards: number
  readonly skipped: readonly string[]
  readonly wroteMeta: false
  readonly error?: string
}

const CLICKER = { kind: 'agent' as const, email: null }

export async function runScaleFallback(
  sb: SupabaseClient,
  clientId: string,
  now = new Date(),
): Promise<ScaleFallbackResult> {
  try {
    return await issueDaily(sb, clientId, now)
  } catch (error) {
    return { cards: 0, skipped: [], wroteMeta: false, error: short(error) }
  }
}

async function issueDaily(sb: SupabaseClient, clientId: string, now: Date): Promise<ScaleFallbackResult> {
  if (!isUuid(clientId)) return { cards: 0, skipped: ['client'], wroteMeta: false }
  const stageRead = await loadApprovedPromoDeliveryStage(sb, clientId)
  if (stageRead === 'query_failed') {
    return { cards: 0, skipped: ['ledger_unread'], wroteMeta: false }
  }
  if (stageRead.kind === 'missing') {
    return { cards: 0, skipped: ['no_delivery_stage'], wroteMeta: false }
  }
  const loaded = await loadScaleFallback(sb, clientId, now)
  if (loaded === 'unreadable') return { cards: 0, skipped: ['unreadable'], wroteMeta: false }
  const proposals = judgeScaleFallback(loaded)
  if (proposals.length === 0) return { cards: 0, skipped: ['none'], wroteMeta: false }
  const cards = await issueCards(sb, clientId, proposals, now)
  return { cards, skipped: [], wroteMeta: false }
}

async function issueCards(
  sb: SupabaseClient,
  clientId: string,
  proposals: readonly ScaleFallbackProposal[],
  now: Date,
): Promise<number> {
  const { createKernel } = await import('@/lib/kernel')
  const kernel = createKernel(sb, { now: () => now })
  let cards = 0
  for (const proposal of proposals) {
    if (await issueOne(kernel, clientId, proposal, now)) cards += 1
  }
  return cards
}

async function issueOne(
  kernel: KernelDeps,
  clientId: string,
  proposal: ScaleFallbackProposal,
  now: Date,
): Promise<boolean> {
  const { issueConfirmationCard } = await import('@/lib/confirmation-card')
  try {
    await issueConfirmationCard(kernel, { clientId, clicker: CLICKER, facts: fallbackFacts(proposal), now })
    return true
  } catch {
    return false
  }
}

function short(error: unknown): string {
  const text = error instanceof Error ? error.message : '放量回退建议没跑成'
  return text.replace(/\s+/g, ' ').trim().slice(0, 160) || '放量回退建议没跑成'
}
