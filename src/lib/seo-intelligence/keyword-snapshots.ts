import { supabaseAdmin } from '@/lib/supabase'
import { getRankedKeywords, type LabsKeyword } from '@/lib/dataforseo/labs'

export const LOCATION_CODE_BY_DB: Record<string, number> = { au: 2036, nz: 2554 }
const SNAPSHOT_LIMIT = 200

export interface KeywordSnapshotClient {
  id: string
  domain: string
  semrush_db: string | null
}

export interface LocalPackInput {
  keyword: string
  /** 1–3, or null if not in pack */
  rank: number | null
}

export interface KeywordSnapshotRow {
  client_id: string
  domain: string
  keyword: string
  position: number | null
  search_volume: number | null
  keyword_difficulty: number | null
  cpc: number | null
  competition: number | null
  intent: string | null
  source: 'dataforseo'
  location_code: number
  semrush_db: string | null
  snapshot_date: string
  measured_at: string
  /** Position in Google Local Pack (1–3). NULL if not present in Local Pack. */
  local_pack_rank: number | null
}

export interface KeywordSnapshotResult {
  client_id: string
  domain: string
  location_code: number
  keywords_seen: number
  snapshots_written: number
}

export interface LatestKeywordSnapshotResult {
  domain: string
  snapshot_date: string | null
  keywords: Array<LabsKeyword & { local_pack_rank: number | null }>
}

export function locationCodeForDb(semrushDb: string | null | undefined): number {
  return LOCATION_CODE_BY_DB[semrushDb ?? 'au'] ?? LOCATION_CODE_BY_DB.au
}

export function buildKeywordSnapshotRows(
  client: KeywordSnapshotClient,
  keywords: LabsKeyword[],
  measuredAt = new Date(),
  localPackRanks: LocalPackInput[] = [],
): KeywordSnapshotRow[] {
  const measuredAtIso = measuredAt.toISOString()
  const snapshotDate = measuredAtIso.slice(0, 10)
  const locationCode = locationCodeForDb(client.semrush_db)
  const packMap = new Map(localPackRanks.map(lp => [lp.keyword, lp.rank]))

  return keywords
    .filter(kw => kw.keyword.trim().length > 0)
    .map(kw => ({
      client_id: client.id,
      domain: client.domain,
      keyword: kw.keyword,
      position: kw.position ?? null,
      search_volume: kw.search_volume,
      keyword_difficulty: kw.keyword_difficulty,
      cpc: kw.cpc,
      competition: kw.competition,
      intent: kw.intent,
      source: 'dataforseo' as const,
      location_code: locationCode,
      semrush_db: client.semrush_db,
      snapshot_date: snapshotDate,
      measured_at: measuredAtIso,
      local_pack_rank: packMap.get(kw.keyword) ?? null,
    }))
}

export async function snapshotRankedKeywordsForClient(
  client: KeywordSnapshotClient,
): Promise<KeywordSnapshotResult> {
  const locationCode = locationCodeForDb(client.semrush_db)
  const keywords = await getRankedKeywords(client.domain, locationCode, SNAPSHOT_LIMIT)
  const rows = buildKeywordSnapshotRows(client, keywords)

  if (rows.length === 0) {
    return {
      client_id: client.id,
      domain: client.domain,
      location_code: locationCode,
      keywords_seen: 0,
      snapshots_written: 0,
    }
  }

  const { data, error } = await supabaseAdmin
    .from('keyword_snapshots')
    .upsert(rows, {
      onConflict: 'client_id,keyword,location_code,snapshot_date',
    })
    .select('id')

  if (error) {
    throw new Error(`keyword_snapshots upsert failed: ${error.message}`)
  }

  return {
    client_id: client.id,
    domain: client.domain,
    location_code: locationCode,
    keywords_seen: keywords.length,
    snapshots_written: data?.length ?? rows.length,
  }
}

export async function getLatestKeywordSnapshotForClient(
  client: KeywordSnapshotClient,
): Promise<LatestKeywordSnapshotResult> {
  const locationCode = locationCodeForDb(client.semrush_db)
  const { data: latest, error: latestError } = await supabaseAdmin
    .from('keyword_snapshots')
    .select('snapshot_date')
    .eq('client_id', client.id)
    .eq('location_code', locationCode)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestError) {
    throw new Error(`keyword_snapshots latest fetch failed: ${latestError.message}`)
  }

  const snapshotDate = (latest as { snapshot_date?: string } | null)?.snapshot_date ?? null
  if (!snapshotDate) {
    return {
      domain: client.domain,
      snapshot_date: null,
      keywords: [],
    }
  }

  const { data, error } = await supabaseAdmin
    .from('keyword_snapshots')
    .select('keyword, position, search_volume, keyword_difficulty, cpc, competition, intent, local_pack_rank')
    .eq('client_id', client.id)
    .eq('location_code', locationCode)
    .eq('snapshot_date', snapshotDate)
    .order('position', { ascending: true, nullsFirst: false })
    .limit(SNAPSHOT_LIMIT)

  if (error) {
    throw new Error(`keyword_snapshots rows fetch failed: ${error.message}`)
  }

  return {
    domain: client.domain,
    snapshot_date: snapshotDate,
    keywords: ((data ?? []) as Array<{
      keyword: string
      position: number | null
      search_volume: number | null
      keyword_difficulty: number | null
      cpc: number | null
      competition: number | null
      intent: string | null
      local_pack_rank: number | null
    }>).map(row => ({
      keyword: row.keyword,
      position: row.position,
      search_volume: row.search_volume,
      keyword_difficulty: row.keyword_difficulty,
      cpc: row.cpc,
      competition: row.competition,
      intent: row.intent ?? 'informational',
      local_pack_rank: row.local_pack_rank,
    })),
  }
}
