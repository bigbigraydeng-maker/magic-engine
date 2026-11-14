import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PublishedTourFact } from '@/lib/tour-catalog/publish-contract'
import type { RankableAssetRow } from '@/lib/factory/client-asset-pool'

const mocks = vi.hoisted(() => ({
  loadPublishedTourFacts: vi.fn(),
  loadRankableClientAssets: vi.fn(),
  getActiveCampaigns: vi.fn(),
  getActiveBrief: vi.fn(),
  uploadFromUrl: vi.fn(),
  runImageEdit: vi.fn(),
  readPosterText: vi.fn(),
}))

vi.mock('@/lib/tour-catalog/store-publish', () => ({ loadPublishedTourFacts: mocks.loadPublishedTourFacts }))
vi.mock('@/lib/factory/client-asset-pool', () => ({ loadRankableClientAssets: mocks.loadRankableClientAssets }))
vi.mock('@/lib/content/campaign-injector', () => ({ getActiveCampaigns: mocks.getActiveCampaigns }))
vi.mock('@/lib/content/brief-injector', () => ({ getActiveBrief: mocks.getActiveBrief }))
vi.mock('@/lib/visual/storage', () => ({ uploadFromUrl: mocks.uploadFromUrl }))
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
      limit: () => Promise.resolve({ data: table === 'client_assets' ? existing : [], error: null }),
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
  mocks.uploadFromUrl.mockResolvedValue({ storage_url: 'https://bucket/poster.jpg', file_size_kb: 200 })
  mocks.runImageEdit.mockResolvedValue({ ok: true, outputUrl: 'https://out/p.jpg', costUsd: 0.038, requestId: 'req-1' })
  mocks.readPosterText.mockResolvedValue({
    ok: true,
    text: 'China Panorama\n14 Days\nFrom $6,999\nNext departure 15 March 2027\nexample.co.nz',
    costUsd: 0.002,
  })
})

describe('runImagePostStep — poster recipe opt-in', () => {
  it('off (no key): no brief read, no edit call, photo kept, receipt and plan shape unchanged', async () => {
    const inserted: Inserted[] = []
    const r = await run(config(), inserted)
    expect(r).toEqual({ attempted: 1, drafted: 1, planIds: ['social_plans-new'], dates: ['2027-01-01'], skipped: null, error: null })
    expect(mocks.getActiveBrief).not.toHaveBeenCalled()
    expect(mocks.runImageEdit).not.toHaveBeenCalled()
    expect(inserted.map((i) => i.table)).toEqual(['social_plans'])
    const plan = planRow(inserted)
    expect(plan.bundles[0].post.image_asset_id).toBe(PHOTO_ID)
    expect(Object.keys(plan.command_meta).sort()).toEqual(['raw_summary', 'received_at', 'source'])
  })

  it('unknown recipe value is treated as off', async () => {
    const r = await run(config('tour_poster_v9'), [])
    expect(r.posters).toBeUndefined()
    expect(mocks.runImageEdit).not.toHaveBeenCalled()
  })

  it('on + success: poster row written, draft uses it, cost on step receipt + command_meta', async () => {
    const inserted: Inserted[] = []
    const r = await run(config('tour_poster_v1'), inserted)
    expect(mocks.getActiveBrief).toHaveBeenCalledTimes(1)
    expect(mocks.runImageEdit).toHaveBeenCalledTimes(1)
    expect(inserted.map((i) => i.table)).toEqual(['client_assets', 'social_plans'])
    expect(inserted[0].row).toMatchObject({ client_id: CLIENT, source: 'ai_generated', status: 'analyzed' })
    const plan = planRow(inserted)
    expect(plan.bundles[0].post.image_asset_id).toBe('client_assets-new')
    expect(plan.command_meta.poster).toMatchObject({ status: 'composed', poster_asset_id: 'client_assets-new', source_asset_id: PHOTO_ID })
    expect(r.posters).toHaveLength(1)
    expect(r.posterCostUsd).toBe(0.04) // edit 0.038 + read-back 0.002
    expect(r.error).toBeNull()
  })

  it('on + misspelt poster text: falls back to the photo, both costs counted', async () => {
    mocks.readPosterText.mockResolvedValue({ ok: true, text: 'China Panorama\nNext derparture', costUsd: 0.002 })
    const inserted: Inserted[] = []
    const r = await run(config('tour_poster_v1'), inserted)
    expect(inserted.map((i) => i.table)).toEqual(['social_plans'])
    expect(planRow(inserted).bundles[0].post.image_asset_id).toBe(PHOTO_ID)
    expect(r.posters?.[0]).toMatchObject({ status: 'fallback', reason: 'text_mismatch' })
    expect(r.posterCostUsd).toBe(0.04)
  })

  it('on + an identical poster already stored: reused, no new edit submitted', async () => {
    const existing = [{
      id: 'poster-old',
      vision_metadata: { poster: {
        recipe_id: 'tour_poster_v1', recipe_version: 1, source_asset_id: PHOTO_ID, has_price: true, text_lines: [],
        cost_usd: 0.038, provider_request_id: null, created_at: '2026-11-01T00:00:00.000Z', next_depart_on: null,
      } },
    }]
    const inserted: Inserted[] = []
    const r = await runImagePostStep(CLIENT, '2027-01-01', config('tour_poster_v1'), null, {
      supabase: fakeSupabase(inserted, existing), callLLM: vi.fn(),
    })
    expect(mocks.runImageEdit).not.toHaveBeenCalled()
    expect(planRow(inserted).bundles[0].post.image_asset_id).toBe('poster-old')
    expect(r.posters?.[0]).toMatchObject({ status: 'reused' })
  })

  it('on + edit failure: falls back to the photo, reason on the receipt, single submit', async () => {
    mocks.runImageEdit.mockResolvedValue({ ok: false, reason: 'no_output', costUsd: 0.038, requestId: 'req-2' })
    const inserted: Inserted[] = []
    const r = await run(config('tour_poster_v1'), inserted)
    expect(mocks.runImageEdit).toHaveBeenCalledTimes(1)
    expect(planRow(inserted).bundles[0].post.image_asset_id).toBe(PHOTO_ID)
    expect(r.drafted).toBe(1)
    expect(r.posters?.[0]).toMatchObject({ status: 'fallback', reason: 'image_edit_failed: no_output' })
    expect(r.posterCostUsd).toBe(0.038)
  })

  it('on + no brand colour: no edit call, photo kept, reason recorded', async () => {
    mocks.getActiveBrief.mockResolvedValue({ vi_colors: { primary: 'red' }, website: null })
    const inserted: Inserted[] = []
    const r = await run(config('tour_poster_v1'), inserted)
    expect(mocks.runImageEdit).not.toHaveBeenCalled()
    expect(planRow(inserted).bundles[0].post.image_asset_id).toBe(PHOTO_ID)
    expect(r.posters?.[0]).toMatchObject({ status: 'fallback', reason: 'no_brand_primary_colour' })
    expect(r.posterCostUsd).toBe(0)
  })

  it('brief read failure counts as no brand colour', async () => {
    mocks.getActiveBrief.mockRejectedValue(new Error('db down'))
    const r = await run(config('tour_poster_v1'), [])
    expect(r.posters?.[0]).toMatchObject({ reason: 'no_brand_primary_colour' })
  })

})

const WEEK = { weekStart: '2026-11-16', weekEnd: '2026-11-22' }

function weekSupabase(inserted: Inserted[], existing: unknown[] = []): SupabaseClient {
  const from = (table: string) => {
    let usedGte = false
    const chain = {
      select: () => chain,
      eq: () => chain,
      gte: () => { usedGte = true; return chain },
      order: () => chain,
      is: () => chain,
      limit: () => Promise.resolve({
        data: table === 'social_plans' && !usedGte ? existing : [],
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
  it('drafts the weekly count on different days even when the social agent is off', async () => {
    const inserted: Inserted[] = []
    const r = await runImagePostStep(CLIENT, '2026-11-14', {
      social_agent: { enabled: false },
      social_week: { post_per_week: 4 },
    }, null, { supabase: weekSupabase(inserted), callLLM: vi.fn(), week: WEEK })
    expect(r.drafted).toBe(4)
    expect(r.dates).toEqual(['2026-11-16', '2026-11-18', '2026-11-20', '2026-11-22'])
    expect(r.weekLines).toHaveLength(4)
    expect(inserted.filter((row) => row.table === 'social_plans')).toHaveLength(4)
    expect(r.posters).toBeUndefined()
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
