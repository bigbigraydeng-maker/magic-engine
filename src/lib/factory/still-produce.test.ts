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
    expect(db.assets[0]?.verified_by).toBeNull()
    expect(db.assets[0]?.verified_at).toBeUndefined()
    const meta = db.assets[0]?.vision_metadata as { factory_still?: { tour_id?: string; review?: { verdict?: string; reviewer?: string } } }
    expect(meta.factory_still?.tour_id).toBe('t1')
    expect(meta.factory_still?.review).toEqual({ verdict: 'pass', reviewer: 'system:still-review' })
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

  it('skips a failed image check on the next run and does not charge again', async () => {
    const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
    const db = capSupabase(inserts)
    const reviewVisual = vi.fn(async () => ({ pass: false, reasons: ['有水印或其他品牌'], costUsd: 0.01, model: 'test-model', billed: true }))
    const compose = vi.fn(passCompose)
    const deps = {
      supabase: db as never,
      compose,
      hashUrl: async () => 'ab'.repeat(32),
      reviewCopy: passCopy,
      reviewVisual,
    }
    const config = { factory_stills: { enabled: true, weekly_cap_usd: 1 }, social_week: { post_per_week: 1 } }
    const first = await produceFactoryStills('c1', config, WEEK_NOW, deps)
    expect(first.drafted).toBe(0)
    expect(reviewVisual).toHaveBeenCalledTimes(1)
    const charged = inserts.filter((row) => row.table === 'factory_balance_ledger').length
    expect(charged).toBe(2)
    const review = (db.assets[0]?.vision_metadata as { factory_still?: { review?: { verdict?: string; reasons?: string[] } } }).factory_still?.review
    expect(review).toEqual({ verdict: 'fail', reviewer: 'system:still-review', reasons: ['有水印或其他品牌'] })
    expect(db.assets[0]?.verified_by).toBeNull()
    const second = await produceFactoryStills('c1', config, WEEK_NOW, deps)
    expect(second).toMatchObject({ drafted: 0, skipped: 'stills_already_made', spentUsd: 0 })
    expect(reviewVisual).toHaveBeenCalledTimes(1)
    expect(compose).toHaveBeenCalledTimes(1)
    expect(inserts.filter((row) => row.table === 'factory_balance_ledger')).toHaveLength(charged)
  })

  it('does not mark a still usable when the review cannot be saved', async () => {
    const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
    const db = capSupabase(inserts, { failReviewWrite: true })
    const compose = vi.fn(passCompose)
    const reviewVisual = vi.fn(async () => ({ pass: true, reasons: [], costUsd: 0, model: 'test-model', billed: true }))
    const deps = {
      supabase: db as never,
      compose,
      hashUrl: async () => 'ab'.repeat(32),
      reviewCopy: passCopy,
      reviewVisual,
    }
    const receipt = await produceFactoryStills('c1', ONE_POST, WEEK_NOW, deps)
    expect(receipt).toMatchObject({ drafted: 0, skipped: 'still_review_unrecorded' })
    expect(db.assets[0]?.verified_by).toBeNull()
    expect(failReview(db).verdict).toBe('fail')
    await expectNoSecondCharge(inserts, deps, compose)
    expect(reviewVisual).toHaveBeenCalledTimes(1)
  })

  it('skips a failed file check on the next run and does not charge again', async () => {
    const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
    const db = capSupabase(inserts)
    const reviewVisual = vi.fn(async () => ({ pass: true, reasons: [], costUsd: 0.01, model: 'test-model', billed: true }))
    const compose = vi.fn(passCompose)
    const deps = { supabase: db as never, compose, hashUrl: async () => null, reviewCopy: passCopy, reviewVisual }
    const first = await produceFactoryStills('c1', ONE_POST, WEEK_NOW, deps)
    expect(first.drafted).toBe(0)
    expect(failReview(db).reasons).toContain('文件校验算不出来')
    expect(db.assets[0]?.verified_by).toBeNull()
    await expectNoSecondCharge(inserts, deps, compose)
    expect(reviewVisual).toHaveBeenCalledTimes(1)
  })

  it('skips a tour mismatch on the next run and does not charge again', async () => {
    const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
    const db = capSupabase(inserts)
    const reviewVisual = vi.fn()
    const compose = vi.fn(passCompose)
    const deps = {
      supabase: db as never,
      compose,
      reviewCopy: async () => ({ pass: false, reasons: ['链接和画面不是同一条线路'], redlineHits: [], factVerdict: 'fail' }),
      reviewVisual,
    }
    const first = await produceFactoryStills('c1', ONE_POST, WEEK_NOW, deps)
    expect(first.drafted).toBe(0)
    expect(reviewVisual).not.toHaveBeenCalled()
    expect(failReview(db).reasons).toContain('链接和画面不是同一条线路')
    expect(db.assets[0]?.verified_by).toBeNull()
    await expectNoSecondCharge(inserts, deps, compose)
  })

  it('skips an upload failure on the next run and does not charge again', async () => {
    const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
    const db = capSupabase(inserts)
    const compose = vi.fn(failedCompose('output_store_failed: upload', 0.038))
    const deps = { supabase: db as never, compose }
    const first = await produceFactoryStills('c1', ONE_POST, WEEK_NOW, deps)
    expect(first.drafted).toBe(0)
    expect(orderReasons(db)).toContain('output_store_failed: upload')
    expect(JSON.stringify(db.assets[0]?.vision_metadata)).not.toContain('factory_still')
    await expectNoSecondCharge(inserts, deps, compose)
  })

  it('skips an oversized image on the next run and does not charge again', async () => {
    const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
    const db = capSupabase(inserts)
    const compose = vi.fn(failedCompose('text_check_failed: image_too_large', 0.02))
    const deps = { supabase: db as never, compose }
    const first = await produceFactoryStills('c1', ONE_POST, WEEK_NOW, deps)
    expect(first.drafted).toBe(0)
    expect(orderReasons(db)).toContain('text_check_failed: image_too_large')
    await expectNoSecondCharge(inserts, deps, compose)
  })

  it('skips an unknown provider bill on the next run and does not charge again', async () => {
    const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
    const db = capSupabase(inserts)
    const compose = vi.fn(async (): Promise<ComposeTourPosterResult> => ({
      ok: false,
      reason: 'image_edit_failed: edit_failed_maybe_billed: timeout',
      receipt: {
        recipe_id: 'tour_poster_v1', recipe_version: 1, source_asset_id: 'photo-1', status: 'fallback',
        reason: 'image_edit_failed: edit_failed_maybe_billed: timeout', poster_asset_id: null, has_price: false,
        cost_usd: null, provider_request_id: null, created_at: '2026-11-12T00:00:00.000Z', text_check: null,
      },
    }))
    const deps = { supabase: db as never, compose }
    const first = await produceFactoryStills('c1', ONE_POST, WEEK_NOW, deps)
    expect(first.skipped).toBe('provider_unknown_billing')
    expect(orderReasons(db)).toContain('改图没有回报价，已按估价记账')
    await expectNoSecondCharge(inserts, deps, compose)
  })

  it('skips a still when the image check was billed but the ledger write failed', async () => {
    const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
    const db = capSupabase(inserts, { failLedgerAfter: 1 })
    const reviewVisual = vi.fn(async () => ({ pass: false, reasons: ['有水印或其他品牌'], costUsd: 0.01, model: 'test-model', billed: true }))
    const compose = vi.fn(passCompose)
    const deps = { supabase: db as never, compose, reviewCopy: passCopy, reviewVisual }
    const first = await produceFactoryStills('c1', ONE_POST, WEEK_NOW, deps)
    expect(first.skipped).toBe('ledger_failed')
    expect(failReview(db).verdict).toBe('fail')
    expect(db.assets[0]?.verified_by).toBeNull()
    await expectNoSecondCharge(inserts, deps, compose)
    expect(reviewVisual).toHaveBeenCalledTimes(1)
  })
})

const ONE_POST = { factory_stills: { enabled: true, weekly_cap_usd: 1 }, social_week: { post_per_week: 1 } }

const passCopy = async () => ({ pass: true, reasons: [], redlineHits: [], factVerdict: 'pass' })

function failedCompose(reason: string, costUsd: number) {
  return async (): Promise<ComposeTourPosterResult> => ({
    ok: false,
    reason,
    receipt: {
      recipe_id: 'tour_poster_v1', recipe_version: 1, source_asset_id: 'photo-1', status: 'fallback',
      reason, poster_asset_id: null, has_price: false, cost_usd: costUsd,
      provider_request_id: 'req-1', created_at: '2026-11-12T00:00:00.000Z', text_check: null,
    },
  })
}

function failReview(db: { assets: Array<Record<string, unknown>> }): { verdict?: string; reasons?: string[] } {
  const meta = db.assets[0]?.vision_metadata as { factory_still?: { review?: { verdict?: string; reasons?: string[] } } }
  return meta.factory_still?.review ?? {}
}

function orderReasons(db: { orders: Array<Record<string, unknown>> }): string[] {
  const stills = (db.orders[0]?.output as { stills?: Array<{ reasons?: string[] }> } | undefined)?.stills
  return stills?.flatMap((row) => row.reasons ?? []) ?? []
}

async function expectNoSecondCharge(
  inserts: Array<{ table: string; row: Record<string, unknown> }>,
  deps: { supabase: unknown; compose: ReturnType<typeof vi.fn> },
  compose: ReturnType<typeof vi.fn>,
): Promise<void> {
  const charged = inserts.filter((row) => row.table === 'factory_balance_ledger').length
  const calls = compose.mock.calls.length
  const second = await produceFactoryStills('c1', ONE_POST, WEEK_NOW, deps as never)
  expect(second).toMatchObject({ drafted: 0, skipped: 'stills_already_made', spentUsd: 0 })
  expect(compose).toHaveBeenCalledTimes(calls)
  expect(inserts.filter((row) => row.table === 'factory_balance_ledger')).toHaveLength(charged)
}

const passCompose = async (): Promise<ComposeTourPosterResult> => ({
  ok: true,
  assetId: 'asset-1',
  receipt: {
    recipe_id: 'tour_poster_v1', recipe_version: 1, source_asset_id: 'photo-1', status: 'composed',
    reason: null, poster_asset_id: 'asset-1', has_price: false, cost_usd: 0.038,
    provider_request_id: 'req-1', created_at: '2026-11-12T00:00:00.000Z', text_check: null,
  },
})

function capSupabase(
  inserts: Array<{ table: string; row: Record<string, unknown> }>,
  opts: { failReviewWrite?: boolean; failLedgerAfter?: number } = {},
) {
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
        const ledgerCount = inserts.filter((item) => item.table === 'factory_balance_ledger').length
        const failLedger = table === 'factory_balance_ledger' && opts.failLedgerAfter != null && ledgerCount > opts.failLedgerAfter
        return {
          error: failLedger ? { message: 'ledger' } : null,
          select: () => ({ single: () => Promise.resolve({ data: { id: 'wo-1' }, error: null }) }),
        }
      },
      update: (patch: Record<string, unknown>) => {
        const fail = opts.failReviewWrite === true && table === 'content_work_orders' && 'output' in patch
        if (!fail && table === 'content_work_orders' && orders[0]) Object.assign(orders[0], patch)
        if (!fail && table === 'client_assets' && assets[0]) Object.assign(assets[0], patch)
        const eq = () => Object.assign(Promise.resolve({ error: fail ? { message: 'write failed' } : null }), { eq })
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
