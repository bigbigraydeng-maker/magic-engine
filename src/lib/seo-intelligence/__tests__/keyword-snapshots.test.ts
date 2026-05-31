import { describe, expect, it } from 'vitest'
import {
  buildKeywordSnapshotRows,
  locationCodeForDb,
  type KeywordSnapshotClient,
} from '../keyword-snapshots'
import type { LabsKeyword } from '@/lib/dataforseo/labs'

const CLIENT: KeywordSnapshotClient = {
  id: 'client-1',
  domain: 'example.co.nz',
  semrush_db: 'nz',
}

const KEYWORDS: LabsKeyword[] = [
  {
    keyword: 'new zealand tours',
    search_volume: 1200,
    keyword_difficulty: 28,
    cpc: 2.4,
    competition: 0.36,
    intent: 'commercial',
    position: 7,
  },
  {
    keyword: 'nz hiking trips',
    search_volume: 400,
    keyword_difficulty: 15,
    cpc: 1.1,
    competition: 0.2,
    intent: 'commercial',
    position: 12,
  },
  {
    keyword: '   ',
    search_volume: 50,
    keyword_difficulty: 10,
    cpc: null,
    competition: null,
    intent: 'informational',
    position: null,
  },
]

describe('keyword snapshots', () => {
  it('maps semrush_db to DataForSEO location codes', () => {
    expect(locationCodeForDb('au')).toBe(2036)
    expect(locationCodeForDb('nz')).toBe(2554)
    expect(locationCodeForDb(null)).toBe(2036)
    expect(locationCodeForDb('unknown')).toBe(2036)
  })

  it('builds weekly snapshot rows and skips blank keywords', () => {
    const rows = buildKeywordSnapshotRows(
      CLIENT,
      KEYWORDS,
      new Date('2026-05-23T12:34:56.000Z'),
    )

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      client_id: 'client-1',
      domain: 'example.co.nz',
      keyword: 'new zealand tours',
      position: 7,
      search_volume: 1200,
      keyword_difficulty: 28,
      cpc: 2.4,
      competition: 0.36,
      intent: 'commercial',
      source: 'dataforseo',
      location_code: 2554,
      semrush_db: 'nz',
      snapshot_date: '2026-05-23',
      measured_at: '2026-05-23T12:34:56.000Z',
      local_pack_rank: null,
    })
  })

  it('injects local_pack_rank when localPackRanks provided', () => {
    const rows = buildKeywordSnapshotRows(
      CLIENT,
      KEYWORDS,
      new Date('2026-05-23T12:34:56.000Z'),
      [
        { keyword: 'new zealand tours', rank: 2 },
        { keyword: 'nz hiking trips', rank: null },
      ],
    )

    expect(rows).toHaveLength(2)
    expect(rows[0].local_pack_rank).toBe(2)
    expect(rows[1].local_pack_rank).toBeNull()
  })

  it('defaults local_pack_rank to null when keyword not in pack map', () => {
    const rows = buildKeywordSnapshotRows(
      CLIENT,
      KEYWORDS,
      new Date('2026-05-23T12:34:56.000Z'),
      [{ keyword: 'unrelated keyword', rank: 1 }],
    )

    expect(rows.every(r => r.local_pack_rank === null)).toBe(true)
  })
})
