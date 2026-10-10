// Server-side "PM accepted this quality flag" feature for the video factory review page.
// Records an acceptance keyed by a fingerprint of the narrator brief so the same flag is
// not re-surfaced for the same brief. Service-role only (see migration).

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  isAcceptableFlagCategory,
  type AcceptableFlagCategory,
} from './review-flag-categories'

/** sha256 hex of the narrator-relevant parts of a brief, or null when there is no persona. */
export function narratorBriefFingerprint(brief: unknown): string | null {
  const b = (brief ?? {}) as Record<string, unknown>
  const brandName = typeof b.brand_name === 'string' ? b.brand_name : ''
  const voice = (b.brand_voice ?? {}) as Record<string, unknown>
  const persona = (voice.persona ?? {}) as Record<string, unknown>
  const name = typeof persona.name === 'string' ? persona.name : ''
  const role = typeof persona.role === 'string' ? persona.role : ''
  if (name.trim() === '') return null
  const payload = JSON.stringify([brandName.trim(), name.trim(), role.trim()])
  return createHash('sha256').update(payload).digest('hex')
}

export interface AcceptedFlagView {
  category: AcceptableFlagCategory
  accepted_at: string
  accepted_by: string
}

export interface AcceptanceRow {
  client_id: string
  category: string
  brief_fingerprint: string
  accepted_by: string
  accepted_at: string
}

/** Pure: newest acceptance per category matching this order's client + brief fingerprint. */
export function matchAcceptedFlags(
  rows: AcceptanceRow[],
  order: { client_id: string; brief: unknown },
): AcceptedFlagView[] {
  const fingerprint = narratorBriefFingerprint(order.brief)
  if (fingerprint === null) return []
  const matching = rows.filter(
    row =>
      row.client_id === order.client_id &&
      isAcceptableFlagCategory(row.category) &&
      row.brief_fingerprint === fingerprint,
  )
  const newestByCategory = new Map<AcceptableFlagCategory, AcceptanceRow>()
  for (const row of matching) {
    const category = row.category as AcceptableFlagCategory
    const current = newestByCategory.get(category)
    if (!current || row.accepted_at > current.accepted_at) newestByCategory.set(category, row)
  }
  return Array.from(newestByCategory.values()).map(row => ({
    category: row.category as AcceptableFlagCategory,
    accepted_at: row.accepted_at,
    accepted_by: row.accepted_by,
  }))
}

export type AcceptFlagResult =
  | { ok: true; status: 200; data: { category: AcceptableFlagCategory; accepted_at: string } }
  | { ok: false; status: number; error: string }

/** Records a PM acceptance of a brief-deviation flag on an in_review work order. */
export async function applyAcceptFlag(
  supabase: SupabaseClient,
  id: string,
  category: unknown,
  reviewer: string,
  note?: string,
): Promise<AcceptFlagResult> {
  // (1) Validate the category BEFORE any database call.
  if (!isAcceptableFlagCategory(category)) {
    return { ok: false, status: 400, error: 'category is not acceptable' }
  }

  // (2) Load the work order.
  const { data: wo, error } = await supabase
    .from('content_work_orders')
    .select('id, client_id, status, output, brief')
    .eq('id', id)
    .maybeSingle()
  if (error) return { ok: false, status: 500, error: error.message }
  if (!wo) return { ok: false, status: 404, error: 'work order not found' }

  // (3) Only in_review orders can be acted on.
  if (wo.status !== 'in_review') {
    return { ok: false, status: 409, error: `only in_review can be reviewed (status=${wo.status})` }
  }

  // (4) The flag must actually be present on this work order.
  const output = (wo.output ?? {}) as Record<string, unknown>
  const flags = Array.isArray(output.quality_flags) ? output.quality_flags : []
  const present = flags.some(flag => {
    const f = (flag ?? {}) as Record<string, unknown>
    return f.category === category
  })
  if (!present) return { ok: false, status: 409, error: 'flag not present on this work order' }

  // (5) Fingerprint the narrator brief.
  const fingerprint = narratorBriefFingerprint(wo.brief)
  if (fingerprint === null) {
    return { ok: false, status: 422, error: 'work order has no narrator brief to accept against' }
  }

  // (6) Record the acceptance.
  const { data: inserted, error: insErr } = await supabase
    .from('factory_review_flag_acceptances')
    .insert({
      client_id: wo.client_id,
      work_order_id: id,
      category,
      brief_fingerprint: fingerprint,
      accepted_by: reviewer,
      note: note?.slice(0, 500) ?? null,
    })
    .select('accepted_at')
    .single()
  if (insErr) return { ok: false, status: 500, error: insErr.message }
  return { ok: true, status: 200, data: { category, accepted_at: inserted.accepted_at } }
}
