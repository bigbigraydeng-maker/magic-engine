import { supabaseAdmin } from '@/lib/supabase'
import { getMtcBalance } from './balance'
import type { ServiceKey, MtcSource, DeductResult } from './types'

/**
 * Phase X.S6 M-1: deductMtc is now atomic via the mtc_deduct_atomic RPC
 * (migration 20260626000006). The function holds row locks on the client's
 * batches across the SELECT-decrement-insert sequence, so concurrent
 * callers serialise instead of racing each other's reads.
 *
 * The JS-side legacy implementation is preserved as a fallback for safety:
 * if the RPC errors out (e.g. not deployed, transient DB issue), we fall
 * back to the non-atomic path with a logged warning rather than 500-ing on
 * every deduction. Once we've confirmed the RPC is stable everywhere
 * (~1 week in prod), the fallback can be removed.
 */
export async function deductMtc(
  clientId: string,
  serviceKey: ServiceKey,
  mtcAmount: number,
  opts: { referenceId?: string; source?: MtcSource; notes?: string } = {},
): Promise<DeductResult> {
  // ── Primary path: atomic RPC ────────────────────────────────────────────────
  const { data, error } = await supabaseAdmin.rpc('mtc_deduct_atomic', {
    p_client_id:    clientId,
    p_service_key:  serviceKey,
    p_mtc_amount:   mtcAmount,
    p_reference_id: opts.referenceId ?? null,
    p_source:       opts.source ?? 'auto',
    p_notes:        opts.notes ?? null,
  })

  if (!error) {
    // RPC TABLE-returning functions come back as an array with one row.
    const row = Array.isArray(data) ? data[0] : data
    const okRow = row as { ok: boolean; ledger_entry_id: string | null; balance_remaining: number } | null
    if (okRow) {
      if (okRow.ok && okRow.ledger_entry_id) {
        return { ok: true, ledgerEntryId: okRow.ledger_entry_id }
      }
      if (!okRow.ok) {
        return { ok: false, reason: 'insufficient_balance', balance: okRow.balance_remaining }
      }
    }
    // Defensive: malformed row shape. Treat as db_error rather than silently
    // crediting the user with success.
    console.error('[mtc/deduct] atomic RPC returned malformed row', { row })
    return { ok: false, reason: 'db_error' }
  }

  // ── Fallback path: legacy SELECT-then-UPDATE (non-atomic) ──────────────────
  // Logged so we notice when the RPC starts failing in prod and can react.
  console.warn('[mtc/deduct] atomic RPC failed, falling back to non-atomic path', {
    message: error.message,
    code:    (error as { code?: string }).code,
  })

  return legacyDeductMtc(clientId, serviceKey, mtcAmount, opts)
}

/**
 * Non-atomic implementation kept as fallback. Documented race: a concurrent
 * pair of requests on the same balance can both read the same starting value
 * and both succeed. The atomic RPC above is the real fix; this remains only
 * to keep deductMtc usable if the RPC is temporarily unavailable.
 */
async function legacyDeductMtc(
  clientId: string,
  serviceKey: ServiceKey,
  mtcAmount: number,
  opts: { referenceId?: string; source?: MtcSource; notes?: string },
): Promise<DeductResult> {
  const { balance, batches } = await getMtcBalance(clientId)

  if (balance < mtcAmount) {
    return { ok: false, reason: 'insufficient_balance', balance }
  }

  // FIFO: consume from earliest-expiring batch first
  let remaining = mtcAmount
  const updates: Array<{ id: string; newRemaining: number }> = []

  for (const batch of batches) {
    if (remaining <= 0) break
    const consume = Math.min(batch.remaining, remaining)
    updates.push({ id: batch.purchaseId, newRemaining: batch.remaining - consume })
    remaining -= consume
  }

  const { data: ledgerRow, error: ledgerErr } = await supabaseAdmin
    .from('mtc_ledger')
    .insert({
      client_id:    clientId,
      purchase_id:  updates[0]?.id ?? null,
      direction:    'debit',
      service_key:  serviceKey,
      mtc_amount:   mtcAmount,
      reference_id: opts.referenceId ?? null,
      source:       opts.source ?? 'auto',
      notes:        opts.notes ?? null,
    })
    .select('id')
    .single()

  if (ledgerErr || !ledgerRow) {
    return { ok: false, reason: 'db_error' }
  }

  for (const update of updates) {
    await supabaseAdmin
      .from('mtc_purchases')
      .update({ mtc_remaining: update.newRemaining })
      .eq('id', update.id)
  }

  return { ok: true, ledgerEntryId: ledgerRow.id as string }
}
