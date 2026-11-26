import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  findPriceGateBlocks,
  findStalePosterBlocks,
  findUnsignedPosterBlocks,
  priceFactText,
  loadPosterParentSources,
  posterImageFacts,
  posterParentIds,
  type GateAssetRow,
} from '../daily-plan-poster-backing'

const CLIENT = 'client-1'
const PARENT = 'a1b2c3d4-0000-4000-8000-000000000001'
const PRICE_TEXT = 'Tour from NZD $2,699 per person'
const NO_PRICE_TEXT = 'Discover Shanghai this March'

const lineage = (hasPrice: boolean) => ({
  poster: {
    recipe_id: 'tour_poster_v1',
    recipe_version: 1,
    source_asset_id: PARENT,
    has_price: hasPrice,
    text_lines: ['Shanghai', 'From $2,699'],
    cost_usd: 0.038,
    provider_request_id: 'req-1',
    created_at: '2026-11-15T00:00:00.000Z',
  },
})

const poster = (opts: { signed: boolean; hasPrice?: boolean }): GateAssetRow => ({
  id: 'poster-1',
  source: 'ai_generated',
  verified_by: opts.signed ? 'fde@me.test' : null,
  verified_at: opts.signed ? '2026-11-15T01:00:00.000Z' : null,
  vision_metadata: lineage(opts.hasPrice ?? true),
})

/** Run the same two steps the runner runs: facts per asset → gate. */
function gate(asset: GateAssetRow, parentSource: string | null, text: string) {
  const parents = new Map<string, string | null>(parentSource === null ? [] : [[PARENT, parentSource]])
  return findPriceGateBlocks([
    { date: '2027-01-01', judgedText: text, imageSource: asset.source, ...posterImageFacts(asset, parents) },
  ])
}

describe('publish price gate — AI poster rule', () => {
  it('signed poster + verified parent → allowed', () => {
    expect(gate(poster({ signed: true }), 'client_verified', PRICE_TEXT)).toEqual([])
    expect(gate(poster({ signed: true }), 'fde_shot', PRICE_TEXT)).toEqual([])
  })

  it('unsigned poster → blocked, with the poster-specific message', () => {
    const blocks = gate(poster({ signed: false }), 'client_verified', PRICE_TEXT)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].message).toContain('已对原图，确认')
  })

  it('signed poster + parent downgraded (or gone) → blocked', () => {
    expect(gate(poster({ signed: true }), 'client_provided', PRICE_TEXT)).toHaveLength(1)
    expect(gate(poster({ signed: true }), null, PRICE_TEXT)).toHaveLength(1)
  })

  it('poster with a price + caption without price + unsigned → blocked (price hidden in the image)', () => {
    expect(gate(poster({ signed: false, hasPrice: true }), 'client_verified', NO_PRICE_TEXT)).toHaveLength(1)
  })

  it('poster without a price + caption without price → allowed even unsigned', () => {
    expect(gate(poster({ signed: false, hasPrice: false }), 'client_provided', NO_PRICE_TEXT)).toEqual([])
  })

  it('non-poster ai_generated with a price → blocked as before (signature does not help)', () => {
    const plain: GateAssetRow = { id: 'x', source: 'ai_generated', verified_by: 'a', verified_at: '2026-11-15T00:00:00.000Z', vision_metadata: null }
    const blocks = gate(plain, 'client_verified', PRICE_TEXT)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].message).toContain('AI 生成或改写')
    expect(posterImageFacts(plain, new Map())).toBeNull()
  })

  it('non-poster: judged exactly as before', () => {
    expect(gate({ id: 'x', source: 'client_verified', verified_by: null, verified_at: null, vision_metadata: {} }, null, PRICE_TEXT)).toEqual([])
    expect(gate({ id: 'x', source: 'unknown', verified_by: null, verified_at: null, vision_metadata: {} }, null, NO_PRICE_TEXT)).toEqual([])
  })
})

/**
 * Fake supabase for `loadPosterParentSources`. Its call chain, enumerated (穷举) from the
 * source: from('client_assets') → select → eq('client_id') → in('id') → awaited result.
 * Any other method is undefined and throws, so an extra or missing filter shows up.
 */
function fakeClient(result: { data: unknown; error: unknown }, seen: Array<[string, unknown]>): SupabaseClient {
  const builder = {
    select: () => builder,
    eq: (col: string, val: unknown) => { seen.push([col, val]); return builder },
    in: (col: string, val: unknown) => { seen.push([col, val]); return Promise.resolve(result) },
  }
  const client = { from: (table: string) => { seen.push(['table', table]); return builder } }
  return client as unknown as SupabaseClient
}

describe('posterParentIds / loadPosterParentSources', () => {
  it('collects deduplicated parent ids from posters only', () => {
    expect(posterParentIds([poster({ signed: true }), poster({ signed: false }), { vision_metadata: null }])).toEqual([PARENT])
  })

  it('no posters → no query', async () => {
    const seen: Array<[string, unknown]> = []
    expect((await loadPosterParentSources(fakeClient({ data: [], error: null }, seen), CLIENT, [])).size).toBe(0)
    expect(seen).toEqual([])
  })

  it('one batched query scoped to the client; archived parents count as missing; errors throw', async () => {
    const seen: Array<[string, unknown]> = []
    const rows = [
      { id: PARENT, source: 'client_verified', archived_at: null },
      { id: 'other', source: 'fde_shot', archived_at: '2026-11-01T00:00:00.000Z' },
    ]
    const map = await loadPosterParentSources(fakeClient({ data: rows, error: null }, seen), CLIENT, [PARENT, 'other'])
    expect(Array.from(map.entries())).toEqual([[PARENT, 'client_verified']])
    expect(seen).toEqual([['table', 'client_assets'], ['client_id', CLIENT], ['id', [PARENT, 'other']]])
    await expect(
      loadPosterParentSources(fakeClient({ data: null, error: new Error('boom') }, []), CLIENT, [PARENT]),
    ).rejects.toThrow('boom')
  })
})

describe('poster checks beyond price backing', () => {
  const facts = (asset: GateAssetRow) => posterImageFacts(asset, new Map([[PARENT, 'client_verified']]))
  const cand = (asset: GateAssetRow, date = '2027-01-01') =>
    ({ date, judgedText: NO_PRICE_TEXT, imageSource: asset.source, ...facts(asset) })

  it('every poster needs the sign-off, priced or not; non-posters are untouched', () => {
    expect(findUnsignedPosterBlocks([cand(poster({ signed: false, hasPrice: false }))])).toHaveLength(1)
    expect(findUnsignedPosterBlocks([cand(poster({ signed: true, hasPrice: false }))])).toEqual([])
    expect(findUnsignedPosterBlocks([{ date: 'd', judgedText: '', imageSource: 'ai_generated' }])).toEqual([])
  })

  it('poster text is added to the text the price-fact check judges', () => {
    const c = cand(poster({ signed: true }))
    expect(priceFactText(c)).toContain('From $2,699')
    expect(priceFactText({ judgedText: 'copy' })).toBe('copy')
  })

  it('departure printed on the poster: past (post date or today) or undated → blocked', () => {
    const withDeparture = (next: string | null): GateAssetRow => ({
      ...poster({ signed: true }),
      vision_metadata: { poster: { ...lineage(true).poster, text_lines: ['X', 'Next departure 15 March 2027'], next_depart_on: next } },
    })
    expect(findStalePosterBlocks([cand(withDeparture('2027-03-15'), '2027-01-01')], '2026-11-15')).toEqual([])
    expect(findStalePosterBlocks([cand(withDeparture('2027-03-15'), '2027-03-16')], '2026-11-15')).toHaveLength(1)
    expect(findStalePosterBlocks([cand(withDeparture('2027-03-15'), '2027-01-01')], '2027-04-01')).toHaveLength(1)
    expect(findStalePosterBlocks([cand(withDeparture(null))], '2026-11-15')).toHaveLength(1)
    // no departure line on the poster → nothing to go stale
    expect(findStalePosterBlocks([cand(poster({ signed: true }))], '2030-01-01')).toEqual([])
  })
})
