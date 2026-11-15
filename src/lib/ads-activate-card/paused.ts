/**
 * Paused ads from the latest stored snapshots. This read does not call Meta.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { plainName } from './facts'

export interface AdPicture {
  readonly adName: string
  readonly adsetName: string
  readonly adsetId: string | null
  readonly campaignId: string | null
  readonly adAccountId: string | null
  readonly previewUrl: string | null
  readonly adStatus: string | null
}

export interface PausedChoice {
  readonly adId: string
  readonly adName: string
  readonly adsetName: string
  readonly previewUrl: string | null
}

interface SnapRow {
  level?: string
  entity_id?: string
  entity_name?: string | null
  ad_account_id?: string | null
  campaign_id?: string | null
  adset_id?: string | null
  status?: string | null
  captured_at?: string
  targeting_summary?: unknown
}

const CAP = 2000

export async function describePausedAd(
  sb: SupabaseClient,
  clientId: string,
  adId: string,
): Promise<AdPicture | null | 'unreadable'> {
  const rows = await loadSnapRows(sb, clientId)
  if (!rows) return 'unreadable'
  return pictureFrom(rows, adId)
}

export async function listPausedAds(sb: SupabaseClient, clientId: string): Promise<PausedChoice[]> {
  const rows = await loadSnapRows(sb, clientId)
  if (!rows) return []
  return pausedChoices(rows)
}

export function pictureFrom(rows: readonly SnapRow[], adId: string): AdPicture | null {
  const ad = newest(rows).get(`ad:${adId}`)
  if (!ad) return null
  const adsetId = text(ad.adset_id)
  const campaignId = text(ad.campaign_id)
  return {
    adName: plainName(nameOf(rows, 'ad', adId), '这条广告'),
    adsetName: plainName(nameOf(rows, 'adset', adsetId), '它所在的广告组'),
    adsetId,
    campaignId,
    adAccountId: text(ad.ad_account_id),
    previewUrl: previewOf(ad),
    adStatus: ownStatus(ad),
  }
}

export function pausedChoices(rows: readonly SnapRow[]): PausedChoice[] {
  const out: PausedChoice[] = []
  for (const [key, row] of newest(rows)) {
    if (!key.startsWith('ad:') || ownStatus(row) !== 'PAUSED' || !row.entity_id) continue
    const picture = pictureFrom(rows, row.entity_id)
    if (!picture) continue
    out.push({
      adId: row.entity_id,
      adName: picture.adName,
      adsetName: picture.adsetName,
      previewUrl: picture.previewUrl,
    })
  }
  return out.sort((a, b) => a.adName.localeCompare(b.adName, 'zh'))
}

async function loadSnapRows(sb: SupabaseClient, clientId: string): Promise<SnapRow[] | null> {
  const { data, error } = await sb.from('ad_entity_snapshots')
    .select('level, entity_id, entity_name, ad_account_id, campaign_id, adset_id, status, captured_at, targeting_summary')
    .eq('client_id', clientId)
    .in('level', ['ad', 'adset', 'campaign'])
    .order('captured_at', { ascending: false })
    .limit(CAP)
  if (error) return null
  return (data ?? []) as SnapRow[]
}

function newest(rows: readonly SnapRow[]): Map<string, SnapRow> {
  const out = new Map<string, SnapRow>()
  const sorted = [...rows].sort((a, b) => String(b.captured_at ?? '').localeCompare(String(a.captured_at ?? '')))
  for (const row of sorted) {
    if (row.level !== 'ad' && row.level !== 'adset' && row.level !== 'campaign') continue
    if (!row.entity_id) continue
    const key = `${row.level}:${row.entity_id}`
    if (!out.has(key)) out.set(key, row)
  }
  return out
}

function nameOf(rows: readonly SnapRow[], level: string, id: string | null): string | null {
  if (!id) return null
  const row = newest(rows).get(`${level}:${id}`)
  return typeof row?.entity_name === 'string' ? row.entity_name : null
}

function ownStatus(row: SnapRow): string | null {
  return typeof row.status === 'string' && row.status ? row.status : null
}

function previewOf(row: SnapRow): string | null {
  const summary = row.targeting_summary
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null
  const url = (summary as { image_url?: unknown }).image_url
  if (typeof url !== 'string' || !url.startsWith('https://') || url.length > 300) return null
  return url
}

function text(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}
