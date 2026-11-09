import { describe, expect, it } from 'vitest'

import { listClientReels, summariseReelVariety } from '../build'

describe('summariseReelVariety', () => {
  it('returns zeroed counts for an empty array', () => {
    expect(summariseReelVariety([])).toEqual({
      same_track_max: 0,
      same_track_file: null,
      price_screen_count: 0,
      total: 0,
    })
  })

  it('does not count reels whose music_file is null', () => {
    const result = summariseReelVariety([
      { music_file: null, template: null },
      { music_file: null, template: null },
      { music_file: null, template: null },
    ])
    expect(result.same_track_max).toBe(0)
    expect(result.same_track_file).toBeNull()
    expect(result.total).toBe(3)
  })

  it('reports the most-used track among five reels', () => {
    const result = summariseReelVariety([
      { music_file: 'a.mp3', template: null },
      { music_file: 'a.mp3', template: null },
      { music_file: 'a.mp3', template: null },
      { music_file: 'b.mp3', template: null },
      { music_file: null, template: null },
    ])
    expect(result.same_track_max).toBe(3)
    expect(result.same_track_file).toBe('a.mp3')
    expect(result.total).toBe(5)
  })

  it('keeps the first-seen track when counts tie', () => {
    const result = summariseReelVariety([
      { music_file: 'a.mp3', template: null },
      { music_file: 'b.mp3', template: null },
      { music_file: 'a.mp3', template: null },
      { music_file: 'b.mp3', template: null },
    ])
    expect(result.same_track_file).toBe('a.mp3')
    expect(result.same_track_max).toBe(2)
  })

  it('counts only the price-list template', () => {
    const result = summariseReelVariety([
      { music_file: null, template: 'list' },
      { music_file: null, template: 'list' },
      { music_file: null, template: 'story' },
      { music_file: null, template: null },
    ])
    expect(result.price_screen_count).toBe(2)
    expect(result.total).toBe(4)
  })
})

interface FakeChain {
  select: (columns: string) => FakeChain
  eq: (column: string, value: string) => FakeChain
  not: (column: string, operator: string, value: string) => FakeChain
  or: (filter: string) => FakeChain
  order: (column: string, options: { ascending: boolean }) => FakeChain
  limit: (count: number) => Promise<{ data: unknown[]; error: null }>
}

function makeFakeDb(rows: unknown[]): { db: { from: (table: string) => FakeChain }; selects: string[] } {
  const selects: string[] = []
  const chain: FakeChain = {
    select: (columns: string) => {
      selects.push(columns)
      return chain
    },
    eq: () => chain,
    not: () => chain,
    or: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: rows, error: null }),
  }
  return { db: { from: () => chain }, selects }
}

describe('listClientReels', () => {
  it('selects the music file and template paths and normalises the rows', async () => {
    const rows = [
      {
        id: 'r1',
        status: 'in_review',
        angle: 'x',
        created_at: '2026-10-12T00:00:00Z',
        video_path: 'v/1.mp4',
        published_ref: null,
        music_file: '  track.mp3 ',
        template: 'list',
      },
      {
        id: 'r2',
        status: 'in_review',
        angle: 'y',
        created_at: '2026-10-11T00:00:00Z',
        video_path: 'v/2.mp4',
        published_ref: null,
        music_file: null,
        template: null,
      },
    ]
    const { db, selects } = makeFakeDb(rows)

    const result = await listClientReels(db as never, 'client-1')

    expect(selects).toHaveLength(1)
    expect(selects[0]).toContain('brief->remotion->props->>musicFile')
    expect(selects[0]).toContain('brief->remotion->>template')

    expect(result).toHaveLength(2)
    expect(result[0].music_file).toBe('track.mp3')
    expect(result[0].template).toBe('list')
    expect(result[1].music_file).toBeNull()
    expect(result[1].template).toBeNull()
  })
  it('hides asset_only material but keeps a mistyped deliverable as a normal Reel', async () => {
    const base = { status: 'in_review', angle: 'x', created_at: '2026-10-12T00:00:00Z', published_ref: null, music_file: null, template: null }
    const rows = [
      { ...base, id: 'a', video_path: 'v/a.mp4', deliverable: 'asset_only' },
      { ...base, id: 'b', video_path: 'v/b.mp4', deliverable: 'asset-only' },
      { ...base, id: 'c', video_path: 'v/c.mp4', deliverable: null },
    ]
    const { db, selects } = makeFakeDb(rows)

    const result = await listClientReels(db as never, 'client-1')

    expect(selects[0]).toContain('brief->remotion->>deliverable')
    expect(result.map((r) => r.id)).toEqual(['b', 'c'])
  })
})
