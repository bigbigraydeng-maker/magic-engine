import { describe, expect, it, vi } from 'vitest'

import type { ComposeTourPosterResult } from '@/lib/social/image-post-poster'

import { produceFactoryStills } from './still-produce'
import { planStillSlots, roomForAnother } from './still-plan'
import { readFactoryStillConfig } from './still-config'

const WEEK_NOW = new Date('2026-11-12T00:00:00.000Z')

describe('readFactoryStillConfig', () => {
  it('stays off when the switch is missing', () => {
    expect(readFactoryStillConfig({})).toEqual({ enabled: false, weeklyCapUsd: null })
    expect(readFactoryStillConfig({ factory_stills: { enabled: true } }).weeklyCapUsd).toBeNull()
  })
})

describe('planStillSlots', () => {
  it('spreads story and post stills and does not add a daily post when the week count is set', () => {
    const slots = planStillSlots({
      config: { social_week: { story_per_week: 2, post_per_week: 2 }, social_agent: { enabled: true, image_post_per_day: 1 } },
      week: { weekStart: '2026-11-16', weekEnd: '2026-11-22' },
      today: '2026-11-12',
    })
    expect(slots.filter((slot) => slot.role === 'post').map((slot) => slot.date)).toEqual(['2026-11-16', '2026-11-22'])
    expect(slots.filter((slot) => slot.role === 'story').every((slot) => slot.aspect === '9:16')).toBe(true)
    expect(roomForAnother(0, 0.03)).toBe(false)
    expect(roomForAnother(0, 0.04)).toBe(true)
  })
})

describe('produceFactoryStills', () => {
  it('does not touch the database when the switch is off', async () => {
    const supabase = { from: vi.fn() }
    const receipt = await produceFactoryStills('c1', {}, WEEK_NOW, { supabase: supabase as never })
    expect(receipt.skipped).toBe('factory_stills_off')
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('stops before a second image once the weekly cap is used', async () => {
    const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
    const supabase = capSupabase(inserts)
    const compose = vi.fn(async (): Promise<ComposeTourPosterResult> => ({
      ok: true,
      assetId: 'asset-1',
      receipt: {
        recipe_id: 'tour_poster_v1', recipe_version: 1, source_asset_id: 'photo-1', status: 'composed',
        reason: null, poster_asset_id: 'asset-1', has_price: false, cost_usd: 0.038,
        provider_request_id: 'req-1', created_at: '2026-11-12T00:00:00.000Z', text_check: null,
      },
    }))
    const reviewVisual = vi.fn()
    const receipt = await produceFactoryStills('c1', {
      factory_stills: { enabled: true, weekly_cap_usd: 0.04 },
      social_week: { post_per_week: 2 },
    }, WEEK_NOW, {
      supabase: supabase as never,
      compose,
      hashUrl: async () => 'ab'.repeat(32),
      reviewCopy: passCopy,
      reviewVisual,
    })
    expect(compose).toHaveBeenCalledTimes(1)
    expect(receipt.drafted).toBe(0)
    expect(receipt.skipped).toBe('weekly_cap_reached')
    expect(reviewVisual).not.toHaveBeenCalled()
    const ledger = inserts.find((row) => row.table === 'factory_balance_ledger')
    expect(ledger?.row).toMatchObject({ entry_type: 'spend', amount_usd: -0.038, work_order_id: 'wo-1' })
    const order = inserts.find((row) => row.table === 'content_work_orders')
    expect(order?.row).toMatchObject({ status: 'closed', order_type: 'fresh_angle' })
    expect(JSON.stringify(order?.row.brief)).toContain('asset_only')
  })

  it('books the estimate and stops when the edit may have billed without a cost', async () => {
    const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
    const compose = vi.fn(async (): Promise<ComposeTourPosterResult> => ({
      ok: false,
      reason: 'image_edit_failed: edit_failed_maybe_billed: timeout',
      receipt: {
        recipe_id: 'tour_poster_v1', recipe_version: 1, source_asset_id: 'photo-1', status: 'fallback',
        reason: 'image_edit_failed: edit_failed_maybe_billed: timeout', poster_asset_id: null, has_price: false,
        cost_usd: null, provider_request_id: null, created_at: '2026-11-12T00:00:00.000Z', text_check: null,
      },
    }))
    const receipt = await produceFactoryStills('c1', {
      factory_stills: { enabled: true, weekly_cap_usd: 1 },
      social_week: { post_per_week: 2 },
    }, WEEK_NOW, {
      supabase: capSupabase(inserts) as never,
      compose,
      hashUrl: async () => 'ab'.repeat(32),
    })
    expect(compose).toHaveBeenCalledTimes(1)
    expect(receipt.drafted).toBe(0)
    expect(receipt.skipped).toBe('provider_unknown_billing')
    expect(receipt.spentUsd).toBe(0.04)
    const ledger = inserts.find((row) => row.table === 'factory_balance_ledger')
    expect(ledger?.row).toMatchObject({ entry_type: 'spend', amount_usd: -0.04, work_order_id: 'wo-1' })
  })

  it('stamps a pass and records the reviewer only after copy and image both pass', async () => {
    const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
    const db = capSupabase(inserts)
    const reviewVisual = vi.fn(async () => ({ pass: true, reasons: [], costUsd: 0.01, model: 'test-model', billed: true }))
    const receipt = await produceFactoryStills('c1', {
      factory_stills: { enabled: true, weekly_cap_usd: 1 },
      social_week: { post_per_week: 1 },
    }, WEEK_NOW, {
      supabase: db as never,
      compose: passCompose,
      hashUrl: async () => 'ab'.repeat(32),
      reviewCopy: passCopy,
      reviewVisual,
    })
    expect(receipt.drafted).toBe(1)
    expect(receipt.skipped).toBeNull()
    expect(reviewVisual).toHaveBeenCalledTimes(1)
    expect(db.assets[0]?.verified_by).toBe('system:still-review')
    const stills = (db.orders[0]?.output as { stills?: Array<{ verdict?: string }> } | undefined)?.stills
    expect(stills?.[0]?.verdict).toBe('pass')
  })

  it('drops a still when the copy gate fails and does not call the image check', async () => {
    const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
    const db = capSupabase(inserts)
    const reviewVisual = vi.fn()
    const receipt = await produceFactoryStills('c1', {
      factory_stills: { enabled: true, weekly_cap_usd: 1 },
      social_week: { post_per_week: 1 },
    }, WEEK_NOW, {
      supabase: db as never,
      compose: passCompose,
      reviewCopy: async () => ({ pass: false, reasons: ['红线：Discover'], redlineHits: ['Discover'], factVerdict: 'pass' }),
      reviewVisual,
    })
    expect(reviewVisual).not.toHaveBeenCalled()
    expect(receipt.drafted).toBe(0)
    expect(receipt.note).toContain('没有通过审片')
    expect(db.assets[0]?.verified_by).toBeNull()
    const stills = (db.orders[0]?.output as { stills?: Array<{ verdict?: string; reasons?: string[] }> } | undefined)?.stills
    expect(stills?.[0]).toMatchObject({ verdict: 'fail', reasons: ['红线：Discover'] })
  })

  it('drops a still when the image check fails and keeps that cost', async () => {
    const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
    const db = capSupabase(inserts)
    const receipt = await produceFactoryStills('c1', {
      factory_stills: { enabled: true, weekly_cap_usd: 1 },
      social_week: { post_per_week: 1 },
    }, WEEK_NOW, {
      supabase: db as never,
      compose: passCompose,
      hashUrl: async () => 'ab'.repeat(32),
      reviewCopy: passCopy,
      reviewVisual: async () => ({ pass: false, reasons: ['有水印或其他品牌'], costUsd: 0.01, model: 'test-model', billed: true }),
    })
    expect(receipt.drafted).toBe(0)
    expect(db.assets[0]?.verified_by).toBeNull()
    expect(inserts.filter((row) => row.table === 'factory_balance_ledger').map((row) => row.row.amount_usd)).toEqual([-0.038, -0.01])
  })
})

const passCopy = async () => ({ pass: true, reasons: [], redlineHits: [], factVerdict: 'pass' })

const passCompose = async (): Promise<ComposeTourPosterResult> => ({
  ok: true,
  assetId: 'asset-1',
  receipt: {
    recipe_id: 'tour_poster_v1', recipe_version: 1, source_asset_id: 'photo-1', status: 'composed',
    reason: null, poster_asset_id: 'asset-1', has_price: false, cost_usd: 0.038,
    provider_request_id: 'req-1', created_at: '2026-11-12T00:00:00.000Z', text_check: null,
  },
})

function capSupabase(inserts: Array<{ table: string; row: Record<string, unknown> }>) {
  const orders: Array<Record<string, unknown>> = []
  const assets: Array<Record<string, unknown>> = [{
    id: 'asset-1',
    storage_url: 'https://cdn.example/a.jpg',
    verified_by: null,
    vision_metadata: { poster: { recipe_id: 'tour_poster_v1', text_lines: ['Harbour Walk'] } },
  }]
  const from = (table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      or: () => chain,
      order: () => chain,
      is: () => chain,
      limit: () => Promise.resolve({
        data: table === 'goals' || table === 'master_briefs' ? [{ id: `${table}-1` }]
          : table === 'client_assets' ? assets
          : table === 'content_work_orders' ? orders
          : [],
        error: null,
      }),
      insert: (row: Record<string, unknown>) => {
        inserts.push({ table, row })
        if (table === 'content_work_orders') orders.push({ ...row, id: 'wo-1' })
        return { select: () => ({ single: () => Promise.resolve({ data: { id: 'wo-1' }, error: null }) }) }
      },
      update: (patch: Record<string, unknown>) => {
        if (table === 'content_work_orders' && orders[0]) Object.assign(orders[0], patch)
        if (table === 'client_assets' && assets[0]) Object.assign(assets[0], patch)
        const eq = () => Object.assign(Promise.resolve({ error: null }), { eq })
        return { eq }
      },
    }
    return chain
  }
  return { from, assets, orders }
}

vi.mock('@/lib/tour-catalog/store-publish', () => ({
  loadPublishedTourFacts: async () => ({ published: true, version: 1, tours: [{ id: 't1', name: 'Harbour Walk', slug: 'harbour', destination: 'harbour', departures: [] }] }),
}))
vi.mock('@/lib/factory/client-asset-pool', () => ({
  loadRankableClientAssets: async () => [{ id: 'photo-1', storage_url: 'https://cdn.example/photo.jpg', original_filename: 'harbour.jpg', vision_metadata: null, source: 'fde_shot' }],
}))
vi.mock('@/lib/content/brief-injector', () => ({
  getActiveBrief: async () => ({ website: 'https://example.com/tours', vi_colors: { primary: '#112233' } }),
}))
