import { supabaseAdmin } from '@/lib/supabase'
import type { ServiceKey } from './types'

export async function refundMtc(
  clientId: string,
  serviceKey: ServiceKey,
  mtcAmount: number,
  opts: { referenceId?: string; notes?: string } = {},
): Promise<{ ok: boolean; ledgerEntryId?: string }> {
  // Find the most recent active batch to credit back into
  const { data: batches } = await supabaseAdmin
    .from('mtc_purchases')
    .select('id, mtc_remaining, mtc_amount')
    .eq('client_id', clientId)
    .eq('status', 'completed')
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: true })
    .limit(1)

  const targetBatch = batches?.[0]

  const { data: ledgerRow, error } = await supabaseAdmin
    .from('mtc_ledger')
    .insert({
      client_id: clientId,
      purchase_id: targetBatch?.id ?? null,
      direction: 'credit',
      service_key: serviceKey,
      mtc_amount: mtcAmount,
      reference_id: opts.referenceId ?? null,
      source: 'refund',
      notes: opts.notes ?? `Refund for failed ${serviceKey}`,
    })
    .select('id')
    .single()

  if (error || !ledgerRow) return { ok: false }

  // Restore the MTC to the earliest batch (capped at original mtc_amount)
  if (targetBatch) {
    const restored = Math.min(
      targetBatch.mtc_remaining + mtcAmount,
      targetBatch.mtc_amount as number,
    )
    await supabaseAdmin
      .from('mtc_purchases')
      .update({ mtc_remaining: restored })
      .eq('id', targetBatch.id)
  }

  return { ok: true, ledgerEntryId: ledgerRow.id as string }
}
