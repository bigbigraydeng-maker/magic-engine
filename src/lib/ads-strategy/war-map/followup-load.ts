/**
 * Read-only: which ad-form leads are still waiting, grouped by ad set.
 * The due/not-due rule is `lead-followup-due`. This file only counts.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  BACKLOG_LOOKBACK_DAYS,
  loadLeadCandidates,
  loadSuppressedStages,
  pickLeadFollowupDue,
  rateLeadFollowupWithinSla,
} from '@/lib/crm/lead-followup-due'
import { fetchAll } from '@/lib/supabase-paginate'
import { groupFollowupByAdset } from './followup'
import type { FollowupInput } from './types'

interface NameRow {
  entity_id: string
  entity_name: string | null
  captured_at: string
}

async function loadAdsetNames(
  supabase: SupabaseClient,
  clientId: string,
  ids: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  if (ids.length === 0) return names
  const rows = await fetchAll<NameRow>((from, to) =>
    supabase
      .from('ad_entity_snapshots')
      .select('entity_id, entity_name, captured_at')
      .eq('client_id', clientId)
      .eq('level', 'adset')
      .in('entity_id', ids)
      .order('id', { ascending: true })
      .range(from, to),
  )
  const seenAt = new Map<string, string>()
  for (const row of rows) {
    const prev = seenAt.get(row.entity_id)
    if (prev !== undefined && prev > row.captured_at) continue
    seenAt.set(row.entity_id, row.captured_at)
    const name = row.entity_name?.trim() ?? ''
    if (name) names.set(row.entity_id, name)
  }
  return names
}

export async function loadAdFollowup(
  supabase: SupabaseClient,
  clientId: string,
  now: Date,
): Promise<FollowupInput> {
  const [{ candidates }, suppressedStages] = await Promise.all([
    loadLeadCandidates(supabase, clientId, now, BACKLOG_LOOKBACK_DAYS),
    loadSuppressedStages(supabase, clientId),
  ])
  const picked = pickLeadFollowupDue(candidates, now, { maxPerClient: 0, suppressedStages })
  const rate = rateLeadFollowupWithinSla(candidates, now, { suppressedStages })
  const ids = [...new Set(picked.items.map((item) => item.adsetId).filter((id): id is string => Boolean(id)))]
  const names = await loadAdsetNames(supabase, clientId, ids)
  return {
    unreadable: false,
    groups: groupFollowupByAdset(picked.items, names),
    inWindow: picked.items.length,
    outsideWindow: picked.outsideWindow,
    rateWithin24h: rate.rate,
  }
}
