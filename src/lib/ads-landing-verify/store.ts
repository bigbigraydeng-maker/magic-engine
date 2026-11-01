/**
 * Read and write the landing receipt on the paused draft.
 * The draft must still be waiting. This does not create a table and does not touch the ad network.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { LandingReceipt } from './receipt'

const ACTION = 'ads.create_ad'

export type DraftLoad =
  | { readonly ok: true; readonly payload: Record<string, unknown> }
  | { readonly ok: false; readonly status: number; readonly error: string }

function asPayload(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export async function loadDraftPayload(
  sb: SupabaseClient,
  clientId: string,
  draftId: string,
): Promise<DraftLoad> {
  try {
    const { data, error } = await sb
      .from('flywheel_actions')
      .select('client_id, payload')
      .eq('id', draftId)
      .eq('action_type', ACTION)
      .maybeSingle()
    if (error) return { ok: false, status: 503, error: '暂时查不到这条广告，没有核实。' }
    const row = data as { client_id?: string; payload?: unknown } | null
    if (!row || row.client_id !== clientId) return { ok: false, status: 404, error: '找不到这条暂停广告。' }
    const payload = asPayload(row.payload)
    if (!payload) return { ok: false, status: 404, error: '这条草案没有内容。' }
    return { ok: true, payload }
  } catch {
    return { ok: false, status: 503, error: '暂时查不到这条广告，没有核实。' }
  }
}

export async function writeLandingReceipt(
  sb: SupabaseClient,
  clientId: string,
  draftId: string,
  payload: Record<string, unknown>,
  receipt: LandingReceipt,
): Promise<DraftLoad> {
  if (payload.status !== 'awaiting_approval') {
    return { ok: false, status: 409, error: '只有还在等点头的暂停广告才能核实落地页。' }
  }
  const next = { ...payload, landing_verify: receipt }
  try {
    const updated = await sb
      .from('flywheel_actions')
      .update({ payload: next })
      .eq('id', draftId)
      .eq('client_id', clientId)
      .eq('action_type', ACTION)
      .eq('payload->>status', 'awaiting_approval')
      .eq('payload', JSON.stringify(payload))
      .select('id')
    const rows = Array.isArray(updated.data) ? updated.data.length : 0
    if (updated.error) {
      return { ok: false, status: 503, error: '核实结果没写上，请再查一次。' }
    }
    if (rows !== 1) return { ok: false, status: 409, error: '广告草稿或核实结果刚刚变过，请刷新后再查一次。' }
    return { ok: true, payload: next }
  } catch {
    return { ok: false, status: 503, error: '核实结果没写上，请再查一次。' }
  }
}
