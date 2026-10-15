/**
 * 整条链路试跑：apply → readback → rollback，走**真实**的 Meta HTTP 封装
 * （`src/lib/meta/ad-creatives.ts` 没有被 mock），只把网络换成一个假 Graph 服务。
 *
 * 为什么单独一个文件：`swap-creative.test.ts` 把 ad-creatives 整个 mock 掉了，
 * 验的是判定逻辑；这一份验的是「判定 + 真实请求拼装 + 真实回包解析」接起来是通的。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CapabilityStepContext } from '@/lib/kernel/types'
import { createFakeSupabase } from '@/lib/kernel/__tests__/fake-supabase'
import { createSwapCreativeCapability } from '../swap-creative'

vi.mock('@/lib/ads-strategy/config', () => ({
  loadAdStrategyConfigWithSource: vi.fn(async () => ({
    source: 'row',
    config: {
      creative_pool: [{
        kind: 'meta_video', ref: '2069489893713349', status: 'approved',
        approved_by: 'bigbigraydeng@gmail.com', approved_at: '2026-10-14T00:00:00Z',
      }],
    },
  })),
}))
vi.mock('@/lib/meta/ad-account-binding', () => ({
  canonicalAccountDigits: (id: string) => id.replace(/^act_/, ''),
  findOtherClientRegistrations: vi.fn(async () => []),
}))
vi.mock('@/lib/meta/campaign-ownership', () => ({
  getRegisteredAccountIds: vi.fn(async () => ({ ids: ['1234567890'], error: null })),
}))
vi.mock('../common', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../common')>()
  return {
    ...actual,
    makeSnapshotPreStep: vi.fn(() => vi.fn(async () => ({ output: { snapshotted_at: 'fake' } }))),
    requireMetaToken: vi.fn(async () => 'test-token'),
  }
})

const AD = '777000111'
const VIDEO = '2069489893713349'
const OLD_VIDEO = '1111111111'
const PAGE = '1616575215312482'
const OLD_CREATIVE = '900000000000001'
const NEW_CREATIVE = '900000000000009'

/** 两条素材的买家可见文案与落地去向必须完全一致，只有视频不同——这是本动作的语义。 */
function creativeOf(id: string, videoId: string) {
  return {
    id,
    object_story_spec: {
      page_id: PAGE,
      video_data: {
        video_id: videoId,
        message: '14 天中国深度游',
        title: 'Best of China',
        call_to_action: { type: 'LEARN_MORE', value: { link: 'https://ctstours.co.nz/tours' } },
      },
    },
  }
}

/** 假 Graph：按请求的 URL/方法回包，并记录每一次写。 */
function fakeGraph(opts: { effectiveStatus?: string } = {}) {
  const state = { creativeOnAd: OLD_CREATIVE }
  const writes: string[] = []
  const byId: Record<string, ReturnType<typeof creativeOf>> = {
    [OLD_CREATIVE]: creativeOf(OLD_CREATIVE, OLD_VIDEO),
    [NEW_CREATIVE]: creativeOf(NEW_CREATIVE, VIDEO),
  }
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const body = (init?.method ?? 'GET') === 'POST' ? decodeURIComponent(String(init?.body ?? '')) : ''
    if (body.includes('creative=')) {
      const match = /"creative_id":"(\d+)"/.exec(body)
      if (match?.[1]) {
        state.creativeOnAd = match[1]
        writes.push(match[1])
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    }
    if (url.includes('/adcreatives')) {
      return new Response(JSON.stringify({
        data: [
          { ...byId[OLD_CREATIVE], name: '旧素材', status: 'ACTIVE' },
          { ...byId[NEW_CREATIVE], name: '丝路无价版', status: 'ACTIVE' },
        ],
      }), { status: 200 })
    }
    return new Response(JSON.stringify({
      id: AD,
      account_id: '1234567890',
      effective_status: opts.effectiveStatus ?? 'ACTIVE',
      issues_info: [],
      creative: byId[state.creativeOnAd],
    }), { status: 200 })
  })
  return { state, writes, fetchMock }
}

function step(stepKey: string, priorOutputs: Record<string, Record<string, unknown>> = {}): CapabilityStepContext {
  return {
    ctx: { clientId: 'client-a' } as CapabilityStepContext['ctx'],
    stepKey, attempt: 1, idempotencyKey: 'chain-run', priorOutputs,
    runInput: { cycle_date: '2026-10-15', ad_account_id: 'act_1234567890', ad_id: AD, creative_ref: VIDEO },
  }
}

describe('swap_creative 整条链路（真实 HTTP 封装 + 假 Graph）', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('换上 → 回读通过 → 撤回，广告最后回到换前那个素材', async () => {
    const graph = fakeGraph()
    vi.stubGlobal('fetch', graph.fetchMock)
    const capability = createSwapCreativeCapability(createFakeSupabase({}))

    const applied = await capability.steps.apply(step('apply'))
    expect(applied.output).toMatchObject({
      prior_creative_id: OLD_CREATIVE, new_creative_id: NEW_CREATIVE, no_change: false,
    })
    expect(graph.state.creativeOnAd).toBe(NEW_CREATIVE)

    const prior = { apply: applied.output as Record<string, unknown> }
    const readback = await capability.steps.readback(step('readback', prior))
    expect(readback.verification?.passed).toBe(true)
    expect(readback.output).toMatchObject({ creative_id_now: NEW_CREATIVE })

    const rolledBack = await capability.rollback!(step('apply', prior), prior)
    expect(rolledBack.ok).toBe(true)
    expect(graph.state.creativeOnAd).toBe(OLD_CREATIVE)
    expect(graph.writes).toEqual([NEW_CREATIVE, OLD_CREATIVE])

    vi.unstubAllGlobals()
  })

  it('回读时发现 Meta 上的素材不是我们换上的那个 → 验证不通过（不是静默放过）', async () => {
    const graph = fakeGraph()
    vi.stubGlobal('fetch', graph.fetchMock)
    const capability = createSwapCreativeCapability(createFakeSupabase({}))

    const prior = { apply: { prior_creative_id: OLD_CREATIVE, new_creative_id: NEW_CREATIVE } }
    const readback = await capability.steps.readback(step('readback', prior))
    expect(readback.verification?.passed).toBe(false)
    expect(readback.verification?.failure_reason).toContain('回读跟预期不符')

    vi.unstubAllGlobals()
  })

  it('换完被打回审核（不是 ACTIVE）→ 验证不通过，让 Kernel 去撤回', async () => {
    const graph = fakeGraph({ effectiveStatus: 'DISAPPROVED' })
    vi.stubGlobal('fetch', graph.fetchMock)
    const capability = createSwapCreativeCapability(createFakeSupabase({}))

    const applied = await capability.steps.apply(step('apply'))
    const prior = { apply: applied.output as Record<string, unknown> }
    const readback = await capability.steps.readback(step('readback', prior))
    expect(readback.verification?.passed).toBe(false)
    expect(readback.verification?.failure_reason).toContain('effective_status')

    vi.unstubAllGlobals()
  })
})
