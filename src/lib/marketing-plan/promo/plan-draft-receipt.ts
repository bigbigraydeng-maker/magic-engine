import type { SupabaseClient } from '@supabase/supabase-js'
import type { PlanDraftReceipt } from './plan-draft-types'

interface ReceiptRow {
  generation_meta?: unknown
  updated_at?: unknown
}

function mergedMeta(current: unknown, receipt: PlanDraftReceipt): Record<string, unknown> {
  const base = current && typeof current === 'object' && !Array.isArray(current)
    ? { ...(current as Record<string, unknown>) }
    : {}
  return { ...base, plan_draft: receipt }
}

/** Read, merge, and compare updated_at. One retry when the row moved. */
export async function writePlanDraftReceipt(
  sb: SupabaseClient,
  clientId: string,
  prescriptionId: string,
  receipt: PlanDraftReceipt,
): Promise<void> {
  for (let pass = 0; pass < 2; pass += 1) {
    const read = await sb
      .from('prescriptions')
      .select('generation_meta, updated_at')
      .eq('id', prescriptionId)
      .eq('client_id', clientId)
      .maybeSingle()
    if (read.error) throw new Error('plan draft receipt read failed')
    const row = read.data as ReceiptRow | null
    let update = sb
      .from('prescriptions')
      .update({ generation_meta: mergedMeta(row?.generation_meta, receipt) })
      .eq('id', prescriptionId)
      .eq('client_id', clientId)
    if (typeof row?.updated_at === 'string' && row.updated_at !== '') {
      update = update.eq('updated_at', row.updated_at)
    }
    const wrote = await update.select('id').maybeSingle()
    if (wrote.error) throw new Error('plan draft receipt write failed')
    if (wrote.data) return
  }
  throw new Error('plan draft receipt conflict')
}
