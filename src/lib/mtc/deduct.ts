import { supabaseAdmin } from '@/lib/supabase'
import { getMtcBalance } from './balance'
import type { ServiceKey, MtcSource, DeductResult } from './types'

export async function deductMtc(
  clientId: string,
  serviceKey: ServiceKey,
  mtcAmount: number,
  opts: { referenceId?: string; source?: MtcSource; notes?: string } = {},
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

  // Write all batch updates + ledger entry as a single logical operation.
  // Supabase doesn't expose multi-statement transactions via the JS client,
  // so we write ledger first then update batches — ledger is the source of truth.
  const { data: ledgerRow, error: ledgerErr } = await supabaseAdmin
    .from('mtc_ledger')
    .insert({
      client_id: clientId,
      purchase_id: updates[0]?.id ?? null,
      direction: 'debit',
      service_key: serviceKey,
      mtc_amount: mtcAmount,
      reference_id: opts.referenceId ?? null,
      source: opts.source ?? 'auto',
      notes: opts.notes ?? null,
    })
    .select('id')
    .single()

  if (ledgerErr || !ledgerRow) {
    return { ok: false, reason: 'db_error' }
  }

  // Update each batch's remaining balance
  for (const update of updates) {
    await supabaseAdmin
      .from('mtc_purchases')
      .update({ mtc_remaining: update.newRemaining })
      .eq('id', update.id)
  }

  return { ok: true, ledgerEntryId: ledgerRow.id as string }
}
