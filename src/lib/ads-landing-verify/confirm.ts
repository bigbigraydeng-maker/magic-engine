/**
 * A person has confirmed this exact landing result when an authorised card matches it.
 * Declined, expired, and older wordings do not count.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { readStoredCard } from '@/lib/confirmation-card/view'
import { CONFIRMATION_ACTION_KEY } from '@/lib/kernel/registry-confirmation'
import { landingCardFacts, landingCardFingerprint } from './card'
import type { LandingReceipt } from './receipt'

export async function isLandingConfirmed(
  sb: SupabaseClient,
  clientId: string,
  draftId: string,
  accountLabel: string | null,
  receipt: LandingReceipt,
): Promise<boolean> {
  const facts = landingCardFacts(draftId, accountLabel, receipt)
  if (!facts) return false
  const fingerprint = landingCardFingerprint(facts)
  try {
    const { data, error } = await sb
      .from('action_runs')
      .select('status, input')
      .eq('client_id', clientId)
      .eq('action_key', CONFIRMATION_ACTION_KEY)
      .eq('status', 'authorized')
      .filter('input->>subject_key', 'eq', facts.subjectKey)
      .limit(5)
    if (error || !Array.isArray(data)) return false
    return data.some((row) => {
      const input = (row as { input?: unknown }).input
      if (!input || typeof input !== 'object' || Array.isArray(input)) return false
      const stored = readStoredCard(input as Record<string, unknown>)
      return stored?.subjectKey === facts.subjectKey && stored.fingerprint === fingerprint
    })
  } catch {
    return false
  }
}
