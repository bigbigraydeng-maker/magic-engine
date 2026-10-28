/**
 * Load one paused draft plus the latest pre-launch checks.
 * Does not create a draft and does not write to the ad network.
 * Blade 11's entry, when it lands, is still this same waiting row.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isLandingConfirmed, landingHardCheck, readStoredReceipt } from '@/lib/ads-landing-verify'
import { ADS_CREATE_ACTION } from '@/lib/ads-strategy/draft-and-gate'
import { loadTrackingGateFacts } from '@/lib/ads-tracking-preflight/load-receipt'
import { receiptIsStale, TRACKING_RECEIPT_STALE_HOURS } from '@/lib/ads-tracking-preflight/receipt'
import type { CardFacts } from '@/lib/confirmation-card'
import { gatesFromReceipt, type StoredGate } from './checks'
import { goLiveSubjectKey, parsePausedDraft, type GoLiveIds } from './draft'
import { buildGoLiveFacts } from './facts'

export interface GoLiveLoaded {
  readonly facts: CardFacts
  readonly ids: GoLiveIds | null
}

export type LoadResult = { ok: true } & GoLiveLoaded | { ok: false; status: number; error: string }

function failure(status: number, error: string): LoadResult {
  return { ok: false, status, error }
}

async function readDraft(sb: SupabaseClient, clientId: string, draftId: string): Promise<
  { ok: true; payload: unknown } | { ok: false; status: number; error: string }
> {
  try {
    const { data, error } = await sb
      .from('flywheel_actions')
      .select('client_id, payload')
      .eq('id', draftId)
      .eq('action_type', ADS_CREATE_ACTION)
      .maybeSingle()
    if (error) return { ok: false, status: 503, error: '暂时查不到这条广告，没有出卡。' }
    const row = data as { client_id?: string; payload?: unknown } | null
    if (!row || row.client_id !== clientId) return { ok: false, status: 404, error: '找不到这条暂停广告。' }
    return { ok: true, payload: row.payload }
  } catch {
    return { ok: false, status: 503, error: '暂时查不到这条广告，没有出卡。' }
  }
}

async function boundLabels(sb: SupabaseClient, clientId: string): Promise<readonly (string | null)[] | null> {
  try {
    const { data, error } = await sb.from('client_meta_ad_accounts').select('label').eq('client_id', clientId)
    if (error) return null
    return ((data ?? []) as { label: string | null }[]).map((row) => row.label)
  } catch {
    return null
  }
}

async function receiptOf(sb: SupabaseClient, clientId: string, now: Date) {
  try {
    const tracking = await loadTrackingGateFacts(sb, clientId, { now })
    if (!tracking?.receipt) return null
    const gates: StoredGate[] = tracking.receipt.gates.map((gate) => ({
      key: gate.key,
      status: gate.status,
      reason: gate.reason,
      na: gate.na,
    }))
    return { checkedAt: tracking.receipt.checked_at, gates }
  } catch {
    return null
  }
}

export async function loadGoLive(
  sb: SupabaseClient,
  clientId: string,
  draftId: string,
  now: Date,
): Promise<LoadResult> {
  if (!goLiveSubjectKey(draftId)) return failure(400, '这条草稿的编号不对，没有出卡。')
  const row = await readDraft(sb, clientId, draftId)
  if (!row.ok) return row
  const view = parsePausedDraft(row.payload)
  if (!view) return failure(404, '这条草案没有内容。')
  if (view.status !== 'awaiting_approval') {
    return failure(409, '只有还在等点头的暂停广告才能出开投卡。')
  }
  const [labels, receipt] = await Promise.all([boundLabels(sb, clientId), receiptOf(sb, clientId, now)])
  const landingReceipt = readStoredReceipt(row.payload)
  const stale = !landingReceipt || receiptIsStale(landingReceipt.checkedAt, now, TRACKING_RECEIPT_STALE_HOURS)
  const confirmed = !stale && landingReceipt
    ? await isLandingConfirmed(sb, clientId, draftId, view.accountLabel, landingReceipt)
    : false
  return {
    ok: true,
    ids: view.ids,
    facts: buildGoLiveFacts({
      draftId,
      view,
      gates: gatesFromReceipt({ receipt, now }),
      boundLabels: labels,
      landing: landingHardCheck({ receipt: landingReceipt, confirmed, now }),
    }),
  }
}
