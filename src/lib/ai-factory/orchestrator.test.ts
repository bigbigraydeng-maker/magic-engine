/**
 * TDD — P21.5 量产编排器 + production_packages 聚合
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Module-level mocks (hoisted before imports) ───────────────────────────────

vi.mock('./fan-out', () => ({
  fanOutToPlatforms: vi.fn(),
}))

// ── Imports after mocks ───────────────────────────────────────────────────────

import { fanOutToPlatforms } from './fan-out'
import { runProductionBatch } from './orchestrator'
import type { FanOutResult, PlatformFanOutResult } from './fan-out'
import type { FactoryResult, SupportedPlatform } from './types'

const mockFanOut = vi.mocked(fanOutToPlatforms)

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeFactoryResult(platform: SupportedPlatform): FactoryResult {
  return {
    jobId:          `job-${platform}`,
    clientId:       'client-123',
    platform,
    contentType:    'post',
    topic:          'Summer travel',
    variants:       [{ content: `Post for ${platform}`, hashtags: [`#${platform}`] }],
    memoryInjected: true,
    modelUsed:      'claude-haiku-4-5-20251001',
    inputTokens:    100,
    outputTokens:   50,
    costUsd:        0.0003,
    generatedAt:    '2026-05-31T00:00:00.000Z',
  }
}

function makeFanOutResult(
  results: PlatformFanOutResult[],
): FanOutResult {
  const successes = results.filter(r => r.result)
  return {
    topic:             'Summer travel',
    platforms:         results.map(r => r.platform),
    results,
    successCount:      successes.length,
    totalCostUsd:      successes.reduce((s, r) => s + (r.result?.costUsd ?? 0), 0),
    totalInputTokens:  successes.reduce((s, r) => s + (r.result?.inputTokens ?? 0), 0),
    totalOutputTokens: successes.reduce((s, r) => s + (r.result?.outputTokens ?? 0), 0),
    generatedAt:       '2026-05-31T00:00:00.000Z',
  }
}

// ── Supabase fake ───────────────────────────────────────────────────────────
//
// Records inserts/updates per table and hands back canned ids. master_briefs
// returns a brief row; content_posts / production_items mint sequential ids.

interface FakeState {
  masterBriefId: string | null
  masterBriefError: string | null
  packageInserts: Record<string, unknown>[]
  packageUpdates: Record<string, unknown>[]
  contentPostInserts: Record<string, unknown>[]
  contentPostUpdates: Record<string, unknown>[]
  itemInserts: Record<string, unknown>[]
  /** force content_posts insert #n to fail (0-indexed) */
  failContentPostAt: number | null
}

function makeSupabase(overrides: Partial<FakeState> = {}) {
  const state: FakeState = {
    masterBriefId:      'mb-1',
    masterBriefError:   null,
    packageInserts:     [],
    packageUpdates:     [],
    contentPostInserts: [],
    contentPostUpdates: [],
    itemInserts:        [],
    failContentPostAt:  null,
    ...overrides,
  }

  let postSeq = 0
  let itemSeq = 0

  const from = vi.fn((table: string) => {
    if (table === 'master_briefs') {
      return {
        select: () => ({
          eq: () => ({
            limit: () => ({
              maybeSingle: async () =>
                state.masterBriefError
                  ? { data: null, error: { message: state.masterBriefError } }
                  : { data: state.masterBriefId ? { id: state.masterBriefId } : null, error: null },
            }),
          }),
        }),
      }
    }

    if (table === 'production_packages') {
      return {
        insert: (row: Record<string, unknown>) => {
          state.packageInserts.push(row)
          return {
            select: () => ({
              single: async () => ({ data: { id: 'pkg-1' }, error: null }),
            }),
          }
        },
        update: (row: Record<string, unknown>) => {
          state.packageUpdates.push(row)
          return { eq: async () => ({ data: null, error: null }) }
        },
      }
    }

    if (table === 'content_posts') {
      return {
        insert: (row: Record<string, unknown>) => {
          const idx = postSeq
          postSeq += 1
          state.contentPostInserts.push(row)
          return {
            select: () => ({
              single: async () =>
                state.failContentPostAt === idx
                  ? { data: null, error: { message: 'insert blocked' } }
                  : { data: { id: `post-${idx}` }, error: null },
            }),
          }
        },
        update: (row: Record<string, unknown>) => {
          state.contentPostUpdates.push(row)
          return { eq: async () => ({ data: null, error: null }) }
        },
      }
    }

    if (table === 'production_items') {
      return {
        insert: (row: Record<string, unknown>) => {
          const idx = itemSeq
          itemSeq += 1
          state.itemInserts.push(row)
          return {
            select: () => ({
              single: async () => ({ data: { id: `item-${idx}` }, error: null }),
            }),
          }
        },
      }
    }

    throw new Error(`unexpected table: ${table}`)
  })

  return { supabase: { from } as never, state }
}

const baseInput = { clientId: 'client-123', topic: 'Summer travel' }

// ── runProductionBatch ────────────────────────────────────────────────────────

describe('runProductionBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('happy path：2 平台 → 落 1 包 + 2 content_posts + 2 production_items', async () => {
    mockFanOut.mockResolvedValue(
      makeFanOutResult([
        { platform: 'facebook',  result: makeFactoryResult('facebook') },
        { platform: 'instagram', result: makeFactoryResult('instagram') },
      ]),
    )
    const { supabase, state } = makeSupabase()

    const out = await runProductionBatch(supabase, {
      ...baseInput,
      platforms: ['facebook', 'instagram'],
    })

    expect(out.status).toBe('ready_for_review')
    expect(out.successCount).toBe(2)
    expect(out.items).toHaveLength(2)
    expect(state.packageInserts).toHaveLength(1)
    expect(state.contentPostInserts).toHaveLength(2)
    expect(state.itemInserts).toHaveLength(2)
  })

  it('content_posts 行回链 production_item_id', async () => {
    mockFanOut.mockResolvedValue(
      makeFanOutResult([{ platform: 'facebook', result: makeFactoryResult('facebook') }]),
    )
    const { supabase, state } = makeSupabase()

    await runProductionBatch(supabase, { ...baseInput, platforms: ['facebook'] })

    expect(state.contentPostUpdates).toHaveLength(1)
    expect(state.contentPostUpdates[0]).toMatchObject({ production_item_id: 'item-0' })
  })

  it('production_items 用 content_type=content_post + content_post_id', async () => {
    mockFanOut.mockResolvedValue(
      makeFanOutResult([{ platform: 'facebook', result: makeFactoryResult('facebook') }]),
    )
    const { supabase, state } = makeSupabase()

    await runProductionBatch(supabase, { ...baseInput, platforms: ['facebook'] })

    expect(state.itemInserts[0]).toMatchObject({
      package_id:      'pkg-1',
      content_type:    'content_post',
      content_post_id: 'post-0',
      status:          'ready',
    })
  })

  it('包初始 status=generating，finalize 后 ready_for_review', async () => {
    mockFanOut.mockResolvedValue(
      makeFanOutResult([{ platform: 'facebook', result: makeFactoryResult('facebook') }]),
    )
    const { supabase, state } = makeSupabase()

    await runProductionBatch(supabase, { ...baseInput, platforms: ['facebook'] })

    expect(state.packageInserts[0]).toMatchObject({ status: 'generating' })
    expect(state.packageUpdates[0]).toMatchObject({ status: 'ready_for_review' })
  })

  it('部分平台失败：成功项落库，失败项进 failures，不阻断', async () => {
    mockFanOut.mockResolvedValue(
      makeFanOutResult([
        { platform: 'facebook',  result: makeFactoryResult('facebook') },
        { platform: 'instagram', result: null, error: 'Rate limit' },
      ]),
    )
    const { supabase, state } = makeSupabase()

    const out = await runProductionBatch(supabase, {
      ...baseInput,
      platforms: ['facebook', 'instagram'],
    })

    expect(out.status).toBe('ready_for_review')
    expect(out.successCount).toBe(1)
    expect(out.failures).toHaveLength(1)
    expect(out.failures[0]).toMatchObject({ platform: 'instagram', error: 'Rate limit' })
    expect(state.contentPostInserts).toHaveLength(1)
  })

  it('全部平台失败：package status=failed，无 items', async () => {
    mockFanOut.mockResolvedValue(
      makeFanOutResult([
        { platform: 'facebook',  result: null, error: 'API error' },
        { platform: 'instagram', result: null, error: 'API error' },
      ]),
    )
    const { supabase, state } = makeSupabase()

    const out = await runProductionBatch(supabase, {
      ...baseInput,
      platforms: ['facebook', 'instagram'],
    })

    expect(out.status).toBe('failed')
    expect(out.successCount).toBe(0)
    expect(out.items).toHaveLength(0)
    expect(state.packageUpdates[0]).toMatchObject({ status: 'failed' })
  })

  it('落库时 content_posts 失败 → 该平台进 failures，其余继续', async () => {
    mockFanOut.mockResolvedValue(
      makeFanOutResult([
        { platform: 'facebook',  result: makeFactoryResult('facebook') },
        { platform: 'instagram', result: makeFactoryResult('instagram') },
      ]),
    )
    const { supabase, state } = makeSupabase({ failContentPostAt: 0 })

    const out = await runProductionBatch(supabase, {
      ...baseInput,
      platforms: ['facebook', 'instagram'],
    })

    expect(out.successCount).toBe(1)
    expect(out.failures).toHaveLength(1)
    expect(out.failures[0].error).toContain('insert blocked')
    expect(state.itemInserts).toHaveLength(1)
  })

  it('成本/token 聚合透传自 fanOut', async () => {
    mockFanOut.mockResolvedValue(
      makeFanOutResult([
        { platform: 'facebook',  result: makeFactoryResult('facebook') },
        { platform: 'instagram', result: makeFactoryResult('instagram') },
      ]),
    )
    const { supabase } = makeSupabase()

    const out = await runProductionBatch(supabase, {
      ...baseInput,
      platforms: ['facebook', 'instagram'],
    })

    expect(out.totalCostUsd).toBeCloseTo(0.0006, 6)
    expect(out.totalInputTokens).toBe(200)
    expect(out.totalOutputTokens).toBe(100)
  })

  it('generation_context_snapshot 写入主题/平台/模型/成本', async () => {
    mockFanOut.mockResolvedValue(
      makeFanOutResult([{ platform: 'facebook', result: makeFactoryResult('facebook') }]),
    )
    const { supabase, state } = makeSupabase()

    await runProductionBatch(supabase, { ...baseInput, platforms: ['facebook'] })

    const snap = state.packageUpdates[0].generation_context_snapshot as Record<string, unknown>
    expect(snap).toMatchObject({
      origin:        'ai_factory',
      topic:         'Summer travel',
      model_used:    'claude-haiku-4-5-20251001',
      success_count: 1,
    })
  })

  it('包记录 origin=ai_factory + marketing_plan_id 透传', async () => {
    mockFanOut.mockResolvedValue(
      makeFanOutResult([{ platform: 'facebook', result: makeFactoryResult('facebook') }]),
    )
    const { supabase, state } = makeSupabase()

    await runProductionBatch(supabase, {
      ...baseInput,
      platforms:       ['facebook'],
      marketingPlanId: 'plan-9',
    })

    expect(state.packageInserts[0]).toMatchObject({
      marketing_plan_id: 'plan-9',
      dimension:         'social',
    })
    expect(state.packageInserts[0].source_payload).toMatchObject({ origin: 'ai_factory' })
  })

  it('客户无 Master Brief → 抛错，不建包不扇出', async () => {
    const { supabase, state } = makeSupabase({ masterBriefId: null })

    await expect(
      runProductionBatch(supabase, { ...baseInput, platforms: ['facebook'] }),
    ).rejects.toThrow(/Master Brief/)

    expect(state.packageInserts).toHaveLength(0)
    expect(mockFanOut).not.toHaveBeenCalled()
  })

  it('默认不传 platforms 时透传给 fanOut（由 fanOut 决定全 5 平台）', async () => {
    mockFanOut.mockResolvedValue(
      makeFanOutResult([{ platform: 'facebook', result: makeFactoryResult('facebook') }]),
    )
    const { supabase } = makeSupabase()

    await runProductionBatch(supabase, baseInput)

    expect(mockFanOut).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ topic: 'Summer travel', clientId: 'client-123' }),
    )
  })
})
