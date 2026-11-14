import { describe, expect, it, vi } from 'vitest'
import {
  buildImagePostPlanData,
  writeImagePostPlan,
  type ImagePostPlanWriterInput,
  type ImagePostPlanWriterDeps,
} from '../image-post-plan-writer'
import type { CampaignDailyPostDraft } from '@/lib/campaign/daily-plan'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const draft: CampaignDailyPostDraft = {
  hook: 'Discover the beauty of China',
  body: 'A 14-day journey through ancient wonders.',
  cta: 'See the full itinerary on our website.',
  cta_url: 'https://www.ctstours.co.nz/tours/china-panorama',
  image_asset_id: 'asset-abc',
}

const input: ImagePostPlanWriterInput = {
  clientId: 'c0000000-0000-0000-0000-000000000000',
  campaignId: 'camp-1',
  date: '2026-11-07',
  draft,
  tourSlug: 'china-panorama',
}

const makeDeps = (overrides: Partial<ImagePostPlanWriterDeps> = {}): ImagePostPlanWriterDeps => ({
  insertPlan: vi.fn().mockResolvedValue({ id: 'plan-123' }),
  ...overrides,
})

// ---------------------------------------------------------------------------
// buildImagePostPlanData
// ---------------------------------------------------------------------------

describe('buildImagePostPlanData', () => {
  it('produces valid campaign_daily_v1 envelope', () => {
    const data = buildImagePostPlanData(input)
    expect(data.plan_kind).toBe('campaign_daily_v1')
    expect(data.campaign_id).toBe('camp-1')
    expect(data.master_brief_ref).toBeNull()
    expect(data.days).toHaveLength(1)
    expect(data.days[0].date).toBe('2026-11-07')
    expect(data.days[0].slots.post).toBe('PLANNED')
    expect(data.days[0].slots.reel).toBe('NOT_PLANNED')
    expect(data.bundles).toHaveLength(1)
    expect(data.bundles[0].post).toBe(draft)
    expect(data.bundles[0].reel).toBeNull()
    expect(data.bundles[0].story).toBeNull()
    expect(data.command_meta.source).toBe('auto_image_post')
    expect(data.command_meta.raw_summary).toContain('china-panorama')
    expect('poster' in data.command_meta).toBe(false)
  })

  it('carries the poster receipt into command_meta only when given', () => {
    const poster = {
      recipe_id: 'tour_poster_v1',
      recipe_version: 1,
      source_asset_id: 'asset-photo',
      status: 'composed' as const,
      reason: null,
      poster_asset_id: 'asset-abc',
      has_price: true,
      cost_usd: 0.038,
      provider_request_id: 'req-1',
      created_at: '2026-11-15T00:00:00.000Z',
      text_check: null,
    }
    const data = buildImagePostPlanData({ ...input, poster })
    expect(data.command_meta.poster).toEqual(poster)
    expect(data.command_meta.source).toBe('auto_image_post')
  })
})

// ---------------------------------------------------------------------------
// writeImagePostPlan
// ---------------------------------------------------------------------------

describe('writeImagePostPlan', () => {
  it('inserts row and returns planId on success', async () => {
    const deps = makeDeps()
    const result = await writeImagePostPlan(input, deps)
    expect(result).toEqual({ ok: true, planId: 'plan-123' })
    expect(deps.insertPlan).toHaveBeenCalledOnce()
    const call = (deps.insertPlan as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.client_id).toBe(input.clientId)
    expect(call.campaign_id).toBe(input.campaignId)
    expect(call.platform).toBe('facebook')
    expect(call.wave_number).toBe(1)
    expect(call.plan_data.plan_kind).toBe('campaign_daily_v1')
  })

  it('returns error on insert failure', async () => {
    const deps = makeDeps({
      insertPlan: vi.fn().mockRejectedValue(new Error('DB connection lost')),
    })
    const result = await writeImagePostPlan(input, deps)
    expect(result).toEqual({ ok: false, error: 'DB connection lost' })
  })

  it('truncates long error messages', async () => {
    const deps = makeDeps({
      insertPlan: vi.fn().mockRejectedValue(new Error('x'.repeat(500))),
    })
    const result = await writeImagePostPlan(input, deps)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.length).toBeLessThanOrEqual(300)
    }
  })
})
