/**
 * Finished factory stills only. Base photos stay in the rankable pool.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import type { StillAspect, StillRole } from './still-config'

export interface FactoryStill {
  id: string
  storageUrl: string
  aspect: StillAspect
  role: StillRole
  slotDate: string
  sha256: string | null
  textLine: string | null
  sourceRef: string | null
  workOrderId: string | null
}

const SHA = /^[0-9a-f]{64}$/

export function parseFactoryStill(row: {
  id?: unknown
  storage_url?: unknown
  vision_metadata?: unknown
}): FactoryStill | null {
  if (typeof row.id !== 'string' || typeof row.storage_url !== 'string' || !row.storage_url.startsWith('https://')) return null
  const meta = record(record(row.vision_metadata)?.factory_still)
  if (!meta) return null
  if (meta.aspect !== '9:16' && meta.aspect !== '4:5') return null
  if (meta.role !== 'story' && meta.role !== 'post') return null
  if (typeof meta.slot_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(meta.slot_date)) return null
  return {
    id: row.id,
    storageUrl: row.storage_url,
    aspect: meta.aspect,
    role: meta.role,
    slotDate: meta.slot_date,
    sha256: typeof meta.sha256 === 'string' && SHA.test(meta.sha256) ? meta.sha256 : null,
    textLine: textLine(meta.text_line),
    sourceRef: typeof meta.source_ref === 'string' && meta.source_ref.startsWith('https://') ? meta.source_ref : null,
    workOrderId: typeof meta.work_order_id === 'string' ? meta.work_order_id : null,
  }
}

export function storyReady(still: FactoryStill): still is FactoryStill & { sha256: string; textLine: string; sourceRef: string } {
  return still.role === 'story' && still.aspect === '9:16' && still.sha256 !== null && still.textLine !== null && still.sourceRef !== null
}

export async function loadFactoryStills(
  supabase: SupabaseClient,
  clientId: string,
): Promise<FactoryStill[] | 'unreadable'> {
  const { data, error } = await supabase
    .from('client_assets')
    .select('id, storage_url, vision_metadata')
    .eq('client_id', clientId)
    .eq('status', 'analyzed')
    .is('archived_at', null)
    .limit(80)
  if (error) return 'unreadable'
  const out: FactoryStill[] = []
  for (const row of data ?? []) {
    const still = parseFactoryStill(row as { id?: unknown; storage_url?: unknown; vision_metadata?: unknown })
    if (still) out.push(still)
  }
  return out
}

function textLine(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  return text.length >= 1 && text.length <= 200 ? text : null
}

function record(raw: unknown): Record<string, unknown> | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null
}
