import { describe, expect, it } from 'vitest'
import type { PublishedTourFact } from '@/lib/tour-catalog/publish-contract'
import type { RankableAssetRow } from '@/lib/factory/client-asset-pool'
import type { FactCheckResult, FactCheckInput } from '@/lib/social/weekly-loop/fact-check'
import type { ClaimHit } from '@/lib/social/outbound-claims'
import {
  draftImagePost,
  hashCode,
  pickTour,
  pickImage,
  type ImagePostDrafterInput,
  type ImagePostDrafterDeps,
} from '../image-post-drafter'
import type { PosterReceipt } from '../image-post-poster'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const tour = (slug: string, over: Partial<PublishedTourFact> = {}): PublishedTourFact => ({
  id: `id-${slug}`,
  slug,
  destination: slug.replace(/-/g, ' '),
  tier: 'signature',
  name: `Tour ${slug}`,
  title: `Tour ${slug}`,
  durationText: '14 Days',
  displayPriceText: 'From $6,999 pp twin share',
  highlights: ['Great Wall'],
  inclusions: ['Flights'],
  exclusions: ['Tips'],
  singleSupplement: '$1,200',
  soldOut: false,
  managesDepartures: true,
  isActive: true,
  departures: [{ departOn: '2027-03-15', displayDate: '15 March 2027', status: 'open', priceTextOverride: null }],
  ...over,
})

const asset = (id: string, filename: string): RankableAssetRow => ({
  id,
  storage_url: `https://storage/${id}.jpg`,
  original_filename: filename,
  vision_metadata: null,
  source: null,
})

const passingFactCheck: FactCheckResult = {
  verdict: 'pass',
  targetTourId: 'id-china-panorama',
  catalogVersion: 0,
  items: [],
}

const makeDeps = (overrides: Partial<ImagePostDrafterDeps> = {}): ImagePostDrafterDeps => ({
  generateCopy: async () => ({ hook: 'Discover China', body: '14-day journey', cta: 'Book now' }),
  checkFacts: () => passingFactCheck,
  scanOutboundClaims: () => [],
  ...overrides,
})

const makeInput = (over: Partial<ImagePostDrafterInput> = {}): ImagePostDrafterInput => ({
  clientId: 'c0000000-0000-0000-0000-000000000000',
  date: '2026-11-06',
  tours: [tour('china-panorama'), tour('yunnan-explorer'), tour('silk-road')],
  assets: [asset('a1', 'china-panorama-great-wall.jpg'), asset('a2', 'yunnan-rice-terrace.jpg')],
  recentTourSlugs: [],
  ctaBaseUrl: 'https://www.ctstours.co.nz/tours',
  ...over,
})

// ---------------------------------------------------------------------------
// hashCode
// ---------------------------------------------------------------------------

describe('hashCode', () => {
  it('deterministic and non-negative', () => {
    expect(hashCode('2026-11-06')).toBe(hashCode('2026-11-06'))
    expect(hashCode('2026-11-06')).toBeGreaterThanOrEqual(0)
  })

  it('different dates give different hashes', () => {
    expect(hashCode('2026-11-06')).not.toBe(hashCode('2026-11-07'))
  })
})

// ---------------------------------------------------------------------------
// pickTour
// ---------------------------------------------------------------------------

describe('pickTour', () => {
  it('filters out soldOut and inactive tours', () => {
    const tours = [tour('a', { soldOut: true }), tour('b', { isActive: false }), tour('c')]
    expect(pickTour(tours, [], '2026-11-06')?.slug).toBe('c')
  })

  it('avoids recent slugs when alternatives exist', () => {
    const tours = [tour('a'), tour('b')]
    const picked = pickTour(tours, ['a'], '2026-11-06')
    expect(picked?.slug).toBe('b')
  })

  it('falls back to all eligible when all are recent', () => {
    const tours = [tour('a'), tour('b')]
    const picked = pickTour(tours, ['a', 'b'], '2026-11-06')
    expect(picked).not.toBeNull()
  })

  it('returns null when no eligible tours', () => {
    expect(pickTour([tour('a', { soldOut: true })], [], '2026-11-06')).toBeNull()
    expect(pickTour([], [], '2026-11-06')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// pickImage
// ---------------------------------------------------------------------------

describe('pickImage', () => {
  it('prefers filename matching tour destination', () => {
    const assets = [asset('a1', 'yunnan-rice.jpg'), asset('a2', 'china-panorama-wall.jpg')]
    const picked = pickImage(assets, 'china panorama', 'china-panorama', '2026-11-06')
    expect(picked?.id).toBe('a2')
  })

  it('falls back to any asset when no match', () => {
    const assets = [asset('a1', 'random-photo.jpg')]
    expect(pickImage(assets, 'silk road', 'silk-road', '2026-11-06')).not.toBeNull()
  })

  it('returns null on empty pool', () => {
    expect(pickImage([], 'china', 'china', '2026-11-06')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// draftImagePost — happy path
// ---------------------------------------------------------------------------

describe('draftImagePost', () => {
  it('returns a draft on success', async () => {
    const result = await draftImagePost(makeInput(), makeDeps())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.hook).toBe('Discover China')
    expect(result.draft.image_asset_id).toBeTruthy()
    expect(result.draft.cta_url).toContain('ctstours.co.nz/tours/')
    expect(result.tourSlug).toBeTruthy()
  })

  it('fails when no eligible tours', async () => {
    const result = await draftImagePost(makeInput({ tours: [] }), makeDeps())
    expect(result).toEqual({ ok: false, reason: 'no_eligible_tour' })
  })

  it('fails when no eligible images', async () => {
    const result = await draftImagePost(makeInput({ assets: [] }), makeDeps())
    expect(result).toEqual({ ok: false, reason: 'no_eligible_image' })
  })

  it('fails when fact check does not pass', async () => {
    const deps = makeDeps({
      checkFacts: () => ({ ...passingFactCheck, verdict: 'fail' }),
    })
    const result = await draftImagePost(makeInput(), deps)
    expect(result).toEqual({ ok: false, reason: 'fact_check_fail' })
  })

  it('fails when outbound claims are ungrounded', async () => {
    const deps = makeDeps({
      scanOutboundClaims: () => [{ kind: 'visa' as const, match: 'visa free' }] as ClaimHit[],
    })
    const result = await draftImagePost(makeInput(), deps)
    expect(result).toMatchObject({ ok: false, reason: 'outbound_claim:visa' })
  })

  it('allows price claims when tour has displayPriceText', async () => {
    const deps = makeDeps({
      scanOutboundClaims: () => [{ kind: 'price' as const, match: '$6,999' }] as ClaimHit[],
    })
    const result = await draftImagePost(makeInput(), deps)
    expect(result.ok).toBe(true)
  })

  it('allows duration claims when tour has durationText', async () => {
    const deps = makeDeps({
      scanOutboundClaims: () => [{ kind: 'duration' as const, match: '14 days' }] as ClaimHit[],
    })
    const result = await draftImagePost(makeInput(), deps)
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// draftImagePost — optional poster recipe
// ---------------------------------------------------------------------------

const POSTER_ID = 'p0000000-0000-4000-8000-000000000001'
const receipt = (over: Partial<PosterReceipt> = {}): PosterReceipt => ({
  recipe_id: 'tour_poster_v1',
  recipe_version: 1,
  source_asset_id: 'x',
  status: 'composed',
  reason: null,
  poster_asset_id: POSTER_ID,
  has_price: true,
  cost_usd: 0.038,
  provider_request_id: 'req-1',
  created_at: '2026-11-15T00:00:00.000Z',
  text_check: null,
  ...over,
})

describe('draftImagePost — composePoster', () => {
  it('without the dep: result has no poster key and keeps the photo (unchanged behaviour)', async () => {
    const result = await draftImagePost(makeInput(), makeDeps())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect('poster' in result).toBe(false)
    expect(Object.keys(result.draft).sort()).toEqual(['body', 'cta', 'cta_url', 'hook', 'image_asset_id'])
  })

  it('success: draft points at the poster, receipt returned, photo passed to the composer', async () => {
    const calls: Array<{ tour: string; image: string }> = []
    const deps = makeDeps({
      composePoster: async (t, image) => {
        calls.push({ tour: t.slug, image: image.id })
        return { ok: true, assetId: POSTER_ID, receipt: receipt({ source_asset_id: image.id }) }
      },
    })
    const plain = await draftImagePost(makeInput(), makeDeps())
    const result = await draftImagePost(makeInput(), deps)
    expect(result.ok && plain.ok).toBe(true)
    if (!result.ok || !plain.ok) return
    expect(result.draft.image_asset_id).toBe(POSTER_ID)
    expect(calls).toEqual([{ tour: plain.tourSlug, image: plain.draft.image_asset_id }])
    expect(result.poster).toMatchObject({ status: 'composed', poster_asset_id: POSTER_ID })
    // copy untouched by the poster step
    expect({ ...result.draft, image_asset_id: '' }).toEqual({ ...plain.draft, image_asset_id: '' })
  })

  it('failure: keeps the original photo and returns the fallback reason', async () => {
    const deps = makeDeps({
      composePoster: async (_t, image) => ({
        ok: false,
        reason: 'image_edit_failed: no_output',
        receipt: receipt({ status: 'fallback', reason: 'image_edit_failed: no_output', poster_asset_id: null, source_asset_id: image.id }),
      }),
    })
    const plain = await draftImagePost(makeInput(), makeDeps())
    const result = await draftImagePost(makeInput(), deps)
    if (!result.ok || !plain.ok) throw new Error('expected ok')
    expect(result.draft).toEqual(plain.draft)
    expect(result.poster).toMatchObject({ status: 'fallback', reason: 'image_edit_failed: no_output' })
  })

  it('never spends on a draft that fails fact check', async () => {
    let called = 0
    const deps = makeDeps({
      checkFacts: () => ({ ...passingFactCheck, verdict: 'fail' }),
      composePoster: async () => {
        called++
        return { ok: true, assetId: POSTER_ID, receipt: receipt() }
      },
    })
    const result = await draftImagePost(makeInput(), deps)
    expect(result).toEqual({ ok: false, reason: 'fact_check_fail' })
    expect(called).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// tier-defaults: imagePostPerDay
// ---------------------------------------------------------------------------

describe('SocialAgentSettings imagePost fields', async () => {
  const { readSocialAgentSettings } = await import('@/lib/social/recipe/tier-defaults')

  it('disabled client has 0 image posts', () => {
    const s = readSocialAgentSettings({}, 'growth')
    expect(s.imagePostPerDay).toBe(0)
    expect(s.imagePostSource).toBe('off')
  })

  it('growth tier gives 1 image post per day', () => {
    const s = readSocialAgentSettings({ social_agent: { enabled: true } }, 'growth')
    expect(s.imagePostPerDay).toBe(1)
    expect(s.imagePostSource).toBe('tier')
  })

  it('starter tier gives 0 image posts', () => {
    const s = readSocialAgentSettings({ social_agent: { enabled: true } }, 'starter')
    expect(s.imagePostPerDay).toBe(0)
    expect(s.imagePostSource).toBe('tier')
  })

  it('client override takes precedence', () => {
    const s = readSocialAgentSettings({ social_agent: { enabled: true, image_post_per_day: 0 } }, 'growth')
    expect(s.imagePostPerDay).toBe(0)
    expect(s.imagePostSource).toBe('client')
  })

  it('hard cap limits to 1', () => {
    const s = readSocialAgentSettings({ social_agent: { enabled: true, image_post_per_day: 5 } }, 'growth')
    expect(s.imagePostPerDay).toBe(1)
    expect(s.imagePostSource).toBe('client')
  })
})
