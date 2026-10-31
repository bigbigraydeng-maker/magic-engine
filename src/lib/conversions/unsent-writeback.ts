/**
 * When a send dies before its row exists, leave one failed row so the
 * conversions page can retry it. A second insert for the same event is ignored,
 * so this cannot open a second send.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const FALLBACK = '发送记录还没写成，这次没有发给广告平台。'

export async function parkUnsentFailure(
  supabase: SupabaseClient,
  outcomeId: string,
  destination: string,
  eventId: string,
  error: unknown,
): Promise<void> {
  const { error: insertErr } = await supabase.from('me_conversion_writebacks').insert({
    outcome_id: outcomeId,
    destination,
    event_id: eventId,
    status: 'failed',
    last_error: clip(error),
    last_error_code: 'retry',
  })
  if (!insertErr || codeOf(insertErr) === '23505') return
  console.info(JSON.stringify({ receipt: 'unsent_writeback', outcome_id: outcomeId, status: 'error' }))
}

function clip(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean === '') return FALLBACK
  return clean.slice(0, 240)
}

function codeOf(error: unknown): string | null {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    return typeof code === 'string' ? code : null
  }
  return null
}
