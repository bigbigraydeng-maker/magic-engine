import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PublishedTourFact } from '@/lib/tour-catalog/publish-contract'
import type { RankableAssetRow } from '@/lib/factory/client-asset-pool'

const mocks = vi.hoisted(() => ({
  loadPublishedTourFacts: vi.fn(),
  loadRankableClientAssets: vi.fn(),
  getActiveCampaigns: vi.fn(),
  getActiveBrief: vi.fn(),
  runImageEdit: vi.fn(),
  readPosterText: vi.fn(),
}))

vi.mock('@/lib/tour-catalog/store-publish', () => ({ loadPublishedTourFacts: mocks.loadPublishedTourFacts }))
vi.mock('@/lib/factory/client-asset-pool', () => ({ loadRankableClientAssets: mocks.loadRankableClientAssets }))
vi.mock('@/lib/content/campaign-injector', () => ({ getActiveCampaigns: mocks.getActiveCampaigns }))
vi.mock('@/lib/content/brief-injector', () => ({ getActiveBrief: mocks.getActiveBrief }))
vi.mock('@/lib/visual/image-edit', () => ({ runImageEdit: mocks.runImageEdit }))
vi.mock('@/lib/visual/poster-text-reader', () => ({ readPosterText: mocks.readPosterText }))
vi.mock('@/lib/social/weekly-loop/fact-check', () => ({
  checkFacts: () => ({ verdict: 'pass', targetTourId: 't1', catalogVersion: 0, items: [] }),
}))
vi.mock('@/lib/social/outbound-claims', () => ({ scanOutboundClaims: () => [] }))
vi.mock('../image-post-generate-copy', () => ({
  generateImagePostCopy: async () => ({ hook: 'Discover China', body: 'A 14-day journey', cta: 'See the itinerary' }),
}))

import { runImagePostStep } from '../image-post-step'

const CLIENT = 'c0000000-0000-4000-8000-000000000000'
const PHOTO_ID = 'a1b2c3d4-0000-4000-8000-000000000001'

const tour: PublishedTourFact = {
  id: 't1', slug: 'china-panorama', destination: 'china', tier: 'signature', name: 'China Panorama', title: null,
  durationText: '14 Days', displayPriceText: 'From $6,999', highlights: [], inclusions: [], exclusions: [],
  singleSupplement: null, soldOut: false, managesDepartures: true, isActive: true,
  departures: [{ departOn: '2027-03-15', displayDate: '15 March 2027', status: 'open', priceTextOverride: null }],
}
const photo: RankableAssetRow = { id: PHOTO_ID, storage_url: 'https://s/photo.jpg', original_filename: 'china.jpg', vision_metadata: null, source: 'fde_shot' }

interface Inserted { table: string; row: Record<string, unknown> }

function rowsFor(table: string, stills: unknown[], phrases: string[] = []): unknown[] {
  if (table === 'client_assets') return stills
  if (table === 'clients') return [{ brand_redline_phrases: phrases }]
  if (table === 'master_briefs') return [{ excluded_topics: [] }]
  return []
}

/**
 * Fake of exactly the supabase calls image-post-step.ts itself makes (the loaders that
 * take a client are mocked above). Call chains enumerated (穷举) from the step source:
 *   social_plans: select → eq → gte → order → limit   (recent slugs)
 *   client_assets: select → eq → eq → is → limit      (existing identical poster, answers `existing`)
 *   social_plans / client_assets: insert → select → single   (plan row, poster row)
 * Any other chain is undefined here and the test throws — so a new query cannot hide.
 */
function fakeSupabase(inserted: Inserted[], existing: unknown[] = []): SupabaseClient {
  const from = (table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      gte: () => chain,
      order: () => chain,
      is: () => chain,
      limit: () => Promise.resolve({ data: rowsFor(table, existing), error: null }),
      insert: (row: Record<string, unknown>) => {
        inserted.push({ table, row })
        return { select: () => ({ single: () => Promise.resolve({ data: { id: `${table}-new` }, error: null }) }) }
      },
    }
    return chain
  }
  return { from } as unknown as SupabaseClient
}

const config = (recipe?: unknown) => ({
  social_agent: { enabled: true, image_post_per_day: 1, ...(recipe === undefined ? {} : { image_post_recipe: recipe }) },
})

function planRow(inserted: Inserted[]) {
  const plan = inserted.find((i) => i.table === 'social_plans')
  if (!plan) throw new Error('no plan written')
  return plan.row.plan_data as {
    bundles: Array<{ post: { image_asset_id: string } }>
    command_meta: Record<string, unknown>
  }
}

const run = (cfg: unknown, inserted: Inserted[]) =>
  runImagePostStep(CLIENT, '2027-01-01', cfg, null, { supabase: fakeSupabase(inserted), callLLM: vi.fn() })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.loadPublishedTourFacts.mockResolvedValue({ published: true, version: 1, tours: [tour] })
  mocks.loadRankableClientAssets.mockResolvedValue([photo])
  mocks.getActiveCampaigns.mockResolvedValue([{ id: 'camp-1' }])
  mocks.getActiveBrief.mockResolvedValue({ vi_colors: { primary: '#C8102E', secondary: '#D4AF37' }, website: 'https://www.example.co.nz' })
  mocks.runImageEdit.mockResolvedValue({ ok: true, outputUrl: 'https://bucket/posters/p.jpg', fileSizeKb: 200, costUsd: 0.038, requestId: 'req-1' })
  mocks.readPosterText.mockResolvedValue({
    ok: true,
    text: 'China Panorama\n14 Days\nFrom $6,999\nNext departure 15 March 2027\nexample.co.nz',
    costUsd: 0.002,
  })
})

describe('runImagePostStep — factory stills only', () => {
  it('skips when there is no factory still, and does not use the photo pool', async () => {
    const inserted: Inserted[] = []
    const r = await run(config(), inserted)
    expect(r).toMatchObject({ drafted: 0, skipped: 'no_factory_still', error: null })
    expect(inserted).toEqual([])
    expect(mocks.runImageEdit).not.toHaveBeenCalled()
    expect(mocks.loadRankableClientAssets).not.toHaveBeenCalled()
    expect(mocks.loadPublishedTourFacts).not.toHaveBeenCalled()
  })

  it('drafts from a 4:5 factory still and does not edit another image', async () => {
    const inserted: Inserted[] = []
    const r = await runImagePostStep(CLIENT, '2027-01-01', config(), null, {
      supabase: fakeSupabase(inserted, [feedStill('2027-01-01', 'still-1')]),
      callLLM: vi.fn(),
    })
    expect(r).toMatchObject({ drafted: 1, planIds: ['social_plans-new'], dates: ['2027-01-01'], error: null })
    expect(mocks.runImageEdit).not.toHaveBeenCalled()
    expect(planRow(inserted).bundles[0].post.image_asset_id).toBe('still-1')
  })

  it('does not use a still that has no review pass', async () => {
    const inserted: Inserted[] = []
    const still = feedStill('2027-01-01', 'still-1')
    delete (still.vision_metadata.factory_still as { review?: unknown }).review
    const r = await runImagePostStep(CLIENT, '2027-01-01', config(), null, {
      supabase: fakeSupabase(inserted, [still]),
      callLLM: vi.fn(),
    })
    expect(r).toMatchObject({ drafted: 0, skipped: 'no_factory_still', error: null })
    expect(inserted).toEqual([])
  })

  it('does not write a draft when the caption hits a brand red line', async () => {
    const inserted: Inserted[] = []
    const r = await runImagePostStep(CLIENT, '2027-01-01', config(), null, {
      supabase: redlineSupabase(inserted, [feedStill('2027-01-01', 'still-1')], ['Discover']),
      callLLM: vi.fn(),
    })
    expect(r).toMatchObject({ drafted: 0, error: 'brand_redline_hit' })
    expect(inserted).toEqual([])
  })
})

const WEEK = { weekStart: '2026-11-16', weekEnd: '2026-11-22' }

function feedStill(date: string, id: string) {
  return {
    id,
    storage_url: `https://cdn.example/${id}.jpg`,
    vision_metadata: {
      kind: 'factory_still',
      factory_still: {
        aspect: '4:5', role: 'post', slot_date: date,
        sha256: 'ab'.repeat(32), text_line: 'China Panorama',
        source_ref: 'https://example.com/tours', work_order_id: 'wo-1',
        review: { verdict: 'pass', reviewer: 'system:still-review' },
      },
    },
  }
}

function redlineSupabase(inserted: Inserted[], stills: unknown[], phrases: string[]): SupabaseClient {
  const from = (table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      gte: () => chain,
      order: () => chain,
      is: () => chain,
      limit: () => Promise.resolve({ data: rowsFor(table, stills, phrases), error: null }),
      insert: (row: Record<string, unknown>) => {
        inserted.push({ table, row })
        return { select: () => ({ single: () => Promise.resolve({ data: { id: `${table}-new` }, error: null }) }) }
      },
    }
    return chain
  }
  return { from } as unknown as SupabaseClient
}

function weekSupabase(inserted: Inserted[], plans: unknown[] = [], stills: unknown[] = []): SupabaseClient {
  const from = (table: string) => {
    let usedGte = false
    const chain = {
      select: () => chain,
      eq: () => chain,
      gte: () => { usedGte = true; return chain },
      order: () => chain,
      is: () => chain,
      limit: () => Promise.resolve({
        data: table === 'social_plans' && !usedGte ? plans : rowsFor(table, stills),
        error: null,
      }),
      insert: (row: Record<string, unknown>) => {
        inserted.push({ table, row })
        return { select: () => ({ single: () => Promise.resolve({ data: { id: `plan-${inserted.length}` }, error: null }) }) }
      },
    }
    return chain
  }
  return { from } as unknown as SupabaseClient
}

function existingPost(date: string, id: string) {
  return { id, plan_data: { command_meta: { source: 'auto_image_post' }, days: [{ date }] } }
}

describe('runImagePostStep — weekly count', () => {
  it('drafts one post per still on the spread days and ignores the photo pool', async () => {
    const inserted: Inserted[] = []
    const dates = ['2026-11-16', '2026-11-18', '2026-11-20', '2026-11-22']
    const r = await runImagePostStep(CLIENT, '2026-11-14', {
      social_agent: { enabled: false },
      social_week: { post_per_week: 4 },
    }, null, {
      supabase: weekSupabase(inserted, [], dates.map((date, i) => feedStill(date, `still-${i}`))),
      callLLM: vi.fn(),
      week: WEEK,
    })
    expect(r.drafted).toBe(4)
    expect(r.dates).toEqual(dates)
    expect(mocks.loadRankableClientAssets).not.toHaveBeenCalled()
    expect(mocks.runImageEdit).not.toHaveBeenCalled()
  })

  it('does not write again when those dates already have drafts', async () => {
    const inserted: Inserted[] = []
    const existing = ['2026-11-16', '2026-11-18', '2026-11-20', '2026-11-22'].map((date, i) => existingPost(date, `old-${i}`))
    const r = await runImagePostStep(CLIENT, '2026-11-14', {
      social_week: { post_per_week: 4 },
    }, null, { supabase: weekSupabase(inserted, existing), callLLM: vi.fn(), week: WEEK })
    expect(r).toMatchObject({ drafted: 0, skipped: 'already_drafted', error: null })
    expect(r.weekLines?.map((line) => line.ref)).toEqual(['old-0', 'old-1', 'old-2', 'old-3'])
    expect(inserted).toEqual([])
    expect(mocks.loadPublishedTourFacts).not.toHaveBeenCalled()
  })

  it('treats a configured weekly zero as zero even when the agent is on', async () => {
    const r = await runImagePostStep(CLIENT, '2026-11-14', {
      social_agent: { enabled: true, image_post_per_day: 1 },
      social_week: { post_per_week: 0 },
    }, null, { supabase: weekSupabase([]), callLLM: vi.fn(), week: WEEK })
    expect(r).toMatchObject({ drafted: 0, skipped: 'post_per_week=0', requested: 0 })
    expect(mocks.loadPublishedTourFacts).not.toHaveBeenCalled()
  })
})
