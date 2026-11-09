import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllBatched } from '@/lib/supabase-paginate'
import type { TouchRow } from './contact-response-row'

const BATCH_SIZE = 10_000
const HARD_CAP = 100_000

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

/** Metadata is null or a non-array object. Arrays are objects in JS and are not allowed. */
function isNullableMetadata(value: unknown): value is Record<string, unknown> | null {
  return value === null || (typeof value === 'object' && !Array.isArray(value))
}

function isPriorityBatchRow(row: unknown): row is Omit<TouchRow, 'summary'> {
  if (!row || typeof row !== 'object') return false
  const item = row as Record<string, unknown>
  return typeof item.id === 'string'
    && typeof item.contact_id === 'string'
    && typeof item.channel === 'string'
    && (item.direction === 'inbound' || item.direction === 'outbound')
    && typeof item.occurred_at === 'string'
    && isNullableString(item.created_at)
    && isNullableString(item.raw)
    && isNullableString(item.source)
    && isNullableMetadata(item.metadata)
}

/** Prefer one bounded JSON batch per database round trip, with the old reader as a safe fallback. */
export async function loadPriorityTouchpoints(sb: SupabaseClient, clientId: string): Promise<TouchRow[]> {
  try {
    const all: TouchRow[] = []
    for (let offset = 0; offset < HARD_CAP; offset += BATCH_SIZE) {
      const { data, error } = await sb.rpc('crm_priority_touchpoint_batch', { p_client_id: clientId, p_offset: offset })
      if (error || !Array.isArray(data) || data.length > BATCH_SIZE) throw new Error('priority batch unavailable')
      for (const row of data) {
        if (!isPriorityBatchRow(row)) throw new Error('invalid priority batch')
        all.push({ ...row, summary: null })
      }
      if (all.length >= HARD_CAP) throw new Error('priority batch reached safety limit')
      if (data.length < BATCH_SIZE) return all
    }
    throw new Error('priority batch reached safety limit')
  } catch {
    // Missing migration, malformed response or an RPC failure: preserve existing complete-read semantics.
    const rows = await fetchAllBatched<Omit<TouchRow, 'summary'>>((from, to) =>
      sb.from('contact_touchpoints').select('id, contact_id, channel, direction, occurred_at, created_at, raw, metadata, source')
        .eq('client_id', clientId).order('occurred_at', { ascending: false }).order('id', { ascending: false }).range(from, to),
    )
    return rows.map((row) => ({ ...row, summary: null }))
  }
}
