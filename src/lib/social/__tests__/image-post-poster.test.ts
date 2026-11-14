import { describe, expect, it, vi } from 'vitest'
import type { PublishedTourFact } from '@/lib/tour-catalog/publish-contract'
import { readPosterLineage } from '@/lib/assets/provenance'
import { resolvePosterRecipe } from '@/lib/visual/poster-recipe'
import { composeTourPoster, posterFilename, type ComposeTourPosterDeps, type ComposeTourPosterInput } from '../image-post-poster'

const PHOTO_ID = 'a1b2c3d4-0000-4000-8000-000000000001'
const NOW = new Date('2026-11-15T00:00:00.000Z')

const tour: PublishedTourFact = {
  id: 't1',
  slug: 'china-panorama',
  destination: 'china',
  tier: 'signature',
  name: 'China Panorama',
  title: null,
  durationText: '14 Days',
  displayPriceText: 'From $6,999 pp twin share',
  highlights: [],
  inclusions: [],
  exclusions: [],
  singleSupplement: null,
  soldOut: false,
  managesDepartures: true,
  isActive: true,
  departures: [{ departOn: '2027-03-15', displayDate: '15 March 2027', status: 'open', priceTextOverride: null }],
}

const recipe = resolvePosterRecipe('tour_poster_v1')!

const input = (over: Partial<ComposeTourPosterInput> = {}): ComposeTourPosterInput => ({
  clientId: 'client-1',
  date: '2027-01-01',
  tour,
  asset: { id: PHOTO_ID, storage_url: 'https://store/photo.jpg', original_filename: 'x.jpg', vision_metadata: null, source: 'fde_shot' },
  recipe,
  brand: { primary: '#C8102E', secondary: '#D4AF37', accent: null },
  website: 'https://www.example.co.nz',
  ...over,
})

const EXPECTED_LINES = ['China Panorama', '14 Days', 'From $6,999 pp twin share', 'Next departure 15 March 2027', 'example.co.nz']

function deps(over: Partial<ComposeTourPosterDeps> = {}): ComposeTourPosterDeps {
  return {
    runImageEdit: vi.fn().mockResolvedValue({ ok: true, outputUrl: 'https://out/p.jpg', costUsd: 0.038, requestId: 'req-1' }),
    readPosterText: vi.fn().mockResolvedValue({ ok: true, text: EXPECTED_LINES.join('\n'), costUsd: 0.002 }),
    findExistingPoster: vi.fn().mockResolvedValue(null),
    uploadFromUrl: vi.fn().mockResolvedValue({ storage_url: 'https://bucket/visual-assets/p.jpg', file_size_kb: 300 }),
    insertPosterAsset: vi.fn().mockResolvedValue({ id: 'poster-1' }),
    now: () => NOW,
    ...over,
  }
}

describe('composeTourPoster', () => {
  it('success: one edit, upload to bucket, client_assets row per spec', async () => {
    const d = deps()
    const r = await composeTourPoster(input(), d)
    expect(r).toMatchObject({ ok: true, assetId: 'poster-1' })
    expect(d.runImageEdit).toHaveBeenCalledTimes(1)
    expect(d.runImageEdit).toHaveBeenCalledWith(expect.objectContaining({
      model: 'minimax-h3-image-edit',
      imageUrl: 'https://store/photo.jpg',
      resolution: '2K',
    }))
    expect(d.uploadFromUrl).toHaveBeenCalledWith({ sourceUrl: 'https://out/p.jpg', clientId: 'client-1', assetType: 'image', folder: 'posters' })

    const row = vi.mocked(d.insertPosterAsset).mock.calls[0][0]
    expect(row).toMatchObject({
      client_id: 'client-1',
      storage_url: 'https://bucket/visual-assets/p.jpg',
      file_size_bytes: 300 * 1024,
      mime_type: 'image/jpeg',
      status: 'analyzed',
      source: 'ai_generated',
      ownership: 'client_exclusive',
      verified_by: null,
      verified_at: null,
    })
    expect(row.vision_metadata.poster).toEqual({
      recipe_id: 'tour_poster_v1',
      recipe_version: 1,
      source_asset_id: PHOTO_ID,
      has_price: true,
      text_lines: ['China Panorama', '14 Days', 'From $6,999 pp twin share', 'Next departure 15 March 2027', 'example.co.nz'],
      cost_usd: 0.038,
      provider_request_id: 'req-1',
      created_at: NOW.toISOString(),
      next_depart_on: '2027-03-15',
    })
    // The row we write is one the gate will recognise as a poster.
    expect(readPosterLineage(row.vision_metadata)).not.toBeNull()
    if (r.ok) expect(r.receipt).toMatchObject({
      status: 'composed', poster_asset_id: 'poster-1', cost_usd: 0.038, reason: null,
      text_check: { status: 'match', cost_usd: 0.002 },
    })
    // text is read off the provider output, before upload
    expect(d.readPosterText).toHaveBeenCalledWith('https://out/p.jpg')
    expect(row.original_filename).toBe(posterFilename(recipe, 'china-panorama', '2027-01-01'))
  })

  it('text mismatch (live-trial misspelling) → fallback, nothing stored, transcript kept (≤500)', async () => {
    const bad = EXPECTED_LINES.join('\n').replace('departure', 'derparture') + ' '.repeat(600)
    const d = deps({ readPosterText: vi.fn().mockResolvedValue({ ok: true, text: bad, costUsd: 0.002 }) })
    const r = await composeTourPoster(input(), d)
    expect(r).toMatchObject({ ok: false, reason: 'text_mismatch' })
    if (!r.ok) {
      expect(r.receipt.text_check).toMatchObject({ status: 'mismatch', cost_usd: 0.002 })
      expect(r.receipt.text_check?.transcribed?.length).toBeLessThanOrEqual(500)
      expect(r.receipt.text_check?.transcribed).toContain('derparture')
      expect(r.receipt.cost_usd).toBe(0.038)
    }
    expect(d.uploadFromUrl).not.toHaveBeenCalled()
    expect(d.insertPosterAsset).not.toHaveBeenCalled()
  })

  it('reader failure (or throw) → text_check_failed, cost null when unknown', async () => {
    const r1 = await composeTourPoster(input(), deps({ readPosterText: vi.fn().mockResolvedValue({ ok: false, reason: 'image_fetch_404', costUsd: null }) }))
    expect(r1).toMatchObject({ ok: false, reason: 'text_check_failed: image_fetch_404', receipt: { text_check: { status: 'failed', transcribed: null, cost_usd: null } } })
    const r2 = await composeTourPoster(input(), deps({ readPosterText: vi.fn().mockRejectedValue(new Error('boom')) }))
    expect(r2).toMatchObject({ ok: false, reason: 'text_check_failed: boom' })
  })

  it('an identical poster already exists → reused, no edit submitted, no spend', async () => {
    const d = deps({ findExistingPoster: vi.fn().mockResolvedValue({ id: 'poster-old' }) })
    const r = await composeTourPoster(input(), d)
    expect(r).toMatchObject({ ok: true, assetId: 'poster-old', receipt: { status: 'reused', cost_usd: 0, poster_asset_id: 'poster-old' } })
    expect(d.runImageEdit).not.toHaveBeenCalled()
    expect(d.findExistingPoster).toHaveBeenCalledWith({
      clientId: 'client-1',
      originalFilename: posterFilename(recipe, 'china-panorama', '2027-01-01'),
      sourceAssetId: PHOTO_ID,
      recipeId: 'tour_poster_v1',
      recipeVersion: 1,
    })
  })

  it('dedupe lookup fails → no submit (cannot rule out a duplicate charge)', async () => {
    const d = deps({ findExistingPoster: vi.fn().mockRejectedValue(new Error('db down')) })
    const r = await composeTourPoster(input(), d)
    expect(r).toMatchObject({ ok: false, reason: 'existing_poster_lookup_failed' })
    expect(d.runImageEdit).not.toHaveBeenCalled()
  })

  it('photo that cannot back a real price → poster without the price line, has_price false', async () => {
    const d = deps({
      readPosterText: vi.fn().mockResolvedValue({ ok: true, text: 'China Panorama\n14 Days\nNext departure 15 March 2027\nexample.co.nz', costUsd: 0.002 }),
    })
    const r = await composeTourPoster(input({ asset: { ...input().asset, source: 'client_provided' } }), d)
    expect(r.ok).toBe(true)
    const prompt = vi.mocked(d.runImageEdit).mock.calls[0][0].prompt
    expect(prompt).not.toContain('Price:')
    const lineage = vi.mocked(d.insertPosterAsset).mock.calls[0][0].vision_metadata.poster
    expect(lineage.has_price).toBe(false)
    expect(lineage.text_lines).not.toContain('From $6,999 pp twin share')
  })

  it('no brand colour → no poster, no spend', async () => {
    const d = deps()
    const r = await composeTourPoster(input({ brand: null }), d)
    expect(r).toMatchObject({ ok: false, reason: 'no_brand_primary_colour' })
    expect(d.runImageEdit).not.toHaveBeenCalled()
    if (!r.ok) expect(r.receipt).toMatchObject({ status: 'fallback', cost_usd: null, poster_asset_id: null })
  })

  it('photo without URL → no spend', async () => {
    const d = deps()
    const r = await composeTourPoster(input({ asset: { ...input().asset, storage_url: null } }), d)
    expect(r).toMatchObject({ ok: false, reason: 'source_image_missing' })
    expect(d.runImageEdit).not.toHaveBeenCalled()
  })

  it('edit failure → fallback with cost + request id, nothing stored', async () => {
    const d = deps({ runImageEdit: vi.fn().mockResolvedValue({ ok: false, reason: 'poll_failed: timed out', costUsd: null, requestId: 'req-9' }) })
    const r = await composeTourPoster(input(), d)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('image_edit_failed: poll_failed: timed out')
      expect(r.receipt).toMatchObject({ status: 'fallback', provider_request_id: 'req-9' })
    }
    expect(d.uploadFromUrl).not.toHaveBeenCalled()
    expect(d.insertPosterAsset).not.toHaveBeenCalled()
  })

  it('upload / insert failure → fallback, cost still on the receipt', async () => {
    const up = await composeTourPoster(input(), deps({ uploadFromUrl: vi.fn().mockRejectedValue(new Error('bucket down')) }))
    expect(up).toMatchObject({ ok: false, receipt: { cost_usd: 0.038, status: 'fallback' } })
    const ins = await composeTourPoster(input(), deps({ insertPosterAsset: vi.fn().mockRejectedValue(new Error('check violation')) }))
    expect(ins).toMatchObject({ ok: false, receipt: { cost_usd: 0.038 } })
    if (!ins.ok) expect(ins.reason).toContain('poster_insert_failed')
  })

  it('has_price false when no price fact exists', async () => {
    const d = deps({ readPosterText: vi.fn().mockResolvedValue({ ok: true, text: 'China Panorama\n14 Days\nNext departure 15 March 2027\nexample.co.nz', costUsd: null }) })
    await composeTourPoster(input({ tour: { ...tour, displayPriceText: null } }), d)
    expect(vi.mocked(d.insertPosterAsset).mock.calls[0][0].vision_metadata.poster.has_price).toBe(false)
  })
})
