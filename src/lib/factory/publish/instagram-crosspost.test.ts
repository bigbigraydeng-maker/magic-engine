/**
 * instagram-crosspost 的单元测试：全部依赖注入，无数据库、无网络。
 *
 * 覆盖：草稿/上线两种模式、审批门、红线、对账、认领冲突、账号类失败退避、
 * 'other' 类失败三次后终态、onStarted 锚点、事件补发。
 */

import { describe, it, expect, vi } from 'vitest'
import {
  runInstagramCrosspost,
  instagramLive,
  instagramLiveClients,
  instagramEnabledClients,
  MIN_GAP_PER_CLIENT_MS,
  type CrosspostCandidate,
  type CrosspostDeps,
  type CrosspostStore,
} from './instagram-crosspost'
import type { PublishAdapter, PublishTarget, PublishedRef } from '../types'
import {
  REEL_AUTO_CHECK_KEYS,
  REEL_HUMAN_CHECK_KEYS,
} from '@/lib/social/content-review'
import { ACCOUNT_RETRY_MINUTES, readReceipt, withReceipt } from './instagram-receipt'
import { PublerAccountError, PublerRejectedError } from './instagram-publer-adapter'

// ===== 测试夹具 =====

// 事件契约要求 uuid 形状的 id(真实工单 id 就是 uuid),夹具必须同形,否则事件构造会(正确地)拒收。
const WO_ID = '11111111-1111-4111-8111-111111111111'
const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
/** 真发名单:只含夹具客户。不在名单里的客户即使全局开关全开也只存草稿 */
const LIVE_CLIENTS = new Set([CLIENT_ID])
/** 启用名单:夹具客户 -> 内存 store 返回的账号。没点名 = 连草稿也不建 */
const ENABLED = new Map([[CLIENT_ID, 'acct_12345678']])

/** 构造一份全部 PASS 的清单。 */
function passingChecklist(
  keys: readonly string[],
  judge: 'AUTO' | 'HUMAN',
): Array<Record<string, unknown>> {
  // 人工审的「事实有来源」两项,PASS 必须带 source_ref(同审批门的真实规则);其余项不许带。
  return keys.map((key) => ({
    key,
    judge,
    outcome: 'PASS',
    detail: 'ok',
    source_ref: judge === 'HUMAN' && key.startsWith('factual_claims') ? 'brief:master' : null,
  }))
}

interface CandidateOpts {
  id?: string
  clientId?: string
  /** undefined = 默认 PUBLISHED;null = 回执里没有 video_state(来路不明) */
  fbVideoState?: 'DRAFT' | 'PUBLISHED' | null
  output?: Record<string, unknown>
  reviewRef?: Record<string, unknown>
  brief?: Record<string, unknown>
  updatedAt?: string
  /** Facebook 回执里的发布时间;默认等于测试里的「现在」 */
  fbPublishedAt?: string
}

/** 构造一个通过审批门的候选。 */
function makeCandidate(opts: CandidateOpts = {}): CrosspostCandidate {
  const id = opts.id ?? WO_ID
  const clientId = opts.clientId ?? CLIENT_ID
  const fbVideoState = opts.fbVideoState === undefined ? 'PUBLISHED' : opts.fbVideoState
  const brief = opts.brief ?? {
    angle: 'china-travel',
    copy: {
      caption: 'Discover China',
      endcard: {
        cta: 'Book now',
        url: 'https://example.test/china',
        offer: [],
      },
    },
  }
  const output = opts.output ?? {
    video_path: 'renders/x/final.mp4',
    quality_checklist_auto: passingChecklist(REEL_AUTO_CHECK_KEYS, 'AUTO'),
  }
  const reviewRef = opts.reviewRef ?? {
    checklist_human: passingChecklist(REEL_HUMAN_CHECK_KEYS, 'HUMAN'),
  }
  return {
    id,
    client_id: clientId,
    master_brief_id: 'mb-1',
    angle: 'china-travel',
    brief,
    output,
    review_ref: reviewRef,
    published_ref: {
      platform: 'facebook',
      post_id: 'fb-post-1',
      ...(fbVideoState === null ? {} : { video_state: fbVideoState }),
      published_at: opts.fbPublishedAt ?? '2024-01-01T00:00:00.000Z',
    },
    updated_at: opts.updatedAt ?? '2024-01-01T00:00:00.000Z',
  }
}

/** 内存 store：真实实现乐观写。 */
function makeStore(initial: CrosspostCandidate[]): {
  store: CrosspostStore
  rows: Map<string, CrosspostCandidate>
  rejectNextWrite: () => void
} {
  const rows = new Map<string, CrosspostCandidate>()
  for (const c of initial) rows.set(c.id, { ...c })
  let rejectOnce = false
  let clock = 0

  const store: CrosspostStore = {
    async listCandidates(limit: number): Promise<CrosspostCandidate[]> {
      return Array.from(rows.values()).slice(0, limit)
    },
    async loadInstagramTarget(): Promise<PublishTarget | null> {
      return {
        platform: 'publer',
        publer_account_id: 'acct_12345678',
        publer_provider: 'instagram',
        client_id: CLIENT_ID,
        expect_brand: 'TestBrand',
      }
    },
    async writeOutput(id, expectedUpdatedAt, output) {
      if (rejectOnce) {
        rejectOnce = false
        return { ok: false }
      }
      const row = rows.get(id)
      if (row === undefined) return { ok: false }
      if (row.updated_at !== expectedUpdatedAt) return { ok: false }
      clock += 1
      const updatedAt = `2024-01-01T00:00:${String(clock).padStart(2, '0')}.000Z`
      rows.set(id, { ...row, output, updated_at: updatedAt })
      return { ok: true, updatedAt }
    },
  }

  return {
    store,
    rows,
    rejectNextWrite: () => {
      rejectOnce = true
    },
  }
}

/** 假 adapter：记录调用，可配置 findExisting 与 publish 行为。 */
function makeAdapter(
  opts: {
    existing?: PublishedRef | null
    publishImpl?: (args: {
      onStarted?: (videoId: string) => Promise<void>
    }) => Promise<PublishedRef>
  } = {},
): {
  adapter: PublishAdapter
  publishCalls: Array<Record<string, unknown>>
  findExistingCalls: Array<Record<string, unknown>>
} {
  const publishCalls: Array<Record<string, unknown>> = []
  const findExistingCalls: Array<Record<string, unknown>> = []
  const adapter: PublishAdapter = {
    platform: 'publer',
    async publish(args) {
      publishCalls.push(args as unknown as Record<string, unknown>)
      if (opts.publishImpl !== undefined) {
        return await opts.publishImpl({ onStarted: args.onStarted })
      }
      if (args.onStarted !== undefined) {
        await args.onStarted('media-0001')
      }
      return {
        platform: 'publer',
        post_id: 'ig-post-1',
        published_at: '2024-01-01T00:00:00.000Z',
        provider_state: args.draft ? 'draft' : 'scheduled',
        // 真 adapter 排期时一定带 scheduled_at(事件契约要求);假的也要同形
        ...(args.draft ? {} : { scheduled_at: '2024-01-01T00:03:00.000Z' }),
        permalink: 'https://instagram.test/p/1',
      }
    },
    async findExisting(args) {
      findExistingCalls.push(args as unknown as Record<string, unknown>)
      return opts.existing ?? null
    },
  }
  return { adapter, publishCalls, findExistingCalls }
}

/** 构造完整 deps。 */
function makeDeps(overrides: Partial<CrosspostDeps> = {}): CrosspostDeps {
  return {
    store: overrides.store ?? makeStore([]).store,
    adapter: overrides.adapter ?? makeAdapter().adapter,
    scanCaption: overrides.scanCaption ?? vi.fn(async () => null),
    validateVideoUrl: overrides.validateVideoUrl ?? vi.fn(async () => null),
    publicBase: overrides.publicBase ?? (() => 'https://cdn.test'),
    emit: overrides.emit ?? vi.fn(async () => ({ event_ids: ['evt-1'] })),
    recordBooks: overrides.recordBooks ?? vi.fn(async () => undefined),
    now: overrides.now ?? (() => new Date('2024-01-01T00:00:00.000Z')),
    newRequestId: overrides.newRequestId ?? (() => 'aaaaaaaa-0000-4000-8000-000000000001'),
  }
}

/** 记录 emit 调用，便于断言事件内容。 */
function makeEmit(
  impl?: (
    event: { id: string; name: string; data: Record<string, unknown> },
  ) => Promise<{ event_ids: string[] }>,
): {
  emit: (event: {
    id: string
    name: string
    data: Record<string, unknown>
  }) => Promise<{ event_ids: string[] }>
  calls: Array<{ id: string; name: string; data: Record<string, unknown> }>
} {
  const calls: Array<{
    id: string
    name: string
    data: Record<string, unknown>
  }> = []
  const emit = async (event: {
    id: string
    name: string
    data: Record<string, unknown>
  }): Promise<{ event_ids: string[] }> => {
    calls.push(event)
    if (impl !== undefined) return await impl(event)
    return { event_ids: ['evt-1'] }
  }
  return { emit, calls }
}

// ===== 场景 =====

describe('runInstagramCrosspost', () => {
  it('1. draft 模式 + FB DRAFT：只发草稿，不写三本书', async () => {
    const { store, rows } = makeStore([makeCandidate({ fbVideoState: 'DRAFT' })])
    const { adapter, publishCalls } = makeAdapter()
    const { emit, calls } = makeEmit()
    const recordBooks = vi.fn(async () => undefined)
    const deps = makeDeps({ store, adapter, emit, recordBooks })

    const out = await runInstagramCrosspost({ live: false, enabledClients: ENABLED }, deps)
    expect(out.result).toBe('drafted')
    expect(publishCalls).toHaveLength(1)
    expect(publishCalls[0].draft).toBe(true)

    const receipt = readReceipt(rows.get(WO_ID)?.output)
    expect(receipt?.status).toBe('draft')
    expect(receipt?.no_publish).toBe(true)
    expect(receipt?.authorization).toBe('DRAFT_ONLY')
    expect(recordBooks).not.toHaveBeenCalled()

    expect(calls).toHaveLength(1)
    expect(calls[0].data.no_publish).toBe(true)
  })

  it('2. live + FB PUBLISHED：发排期，写三本书', async () => {
    const { store, rows } = makeStore([
      makeCandidate({ fbVideoState: 'PUBLISHED' }),
    ])
    const { adapter, publishCalls } = makeAdapter()
    const { emit, calls } = makeEmit()
    const recordBooks = vi.fn(async () => undefined)
    const deps = makeDeps({ store, adapter, emit, recordBooks })

    const out = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, deps)
    expect(out.result).toBe('scheduled')
    expect(publishCalls[0].draft).toBe(false)

    const receipt = readReceipt(rows.get(WO_ID)?.output)
    expect(receipt?.status).toBe('scheduled')
    expect(receipt?.authorization).toBe('AUTHORIZED')
    expect(recordBooks).not.toHaveBeenCalled() // 排期≠已发布,不记完成账

    expect(calls[0].data.provider_state).toBe('scheduled')
  })

  it('3. live + FB DRAFT：不发布', async () => {
    const { store } = makeStore([makeCandidate({ fbVideoState: 'DRAFT' })])
    const { adapter, publishCalls } = makeAdapter()
    const deps = makeDeps({ store, adapter })

    const out = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, deps)
    expect(out.result).toBe('no_candidate')
    expect(publishCalls).toHaveLength(0)
  })

  it('4. FB video_state 未定义：什么都不做', async () => {
    const { store } = makeStore([makeCandidate({ fbVideoState: null })])
    const { adapter, publishCalls } = makeAdapter()
    const deps = makeDeps({ store, adapter })

    const out = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, deps)
    expect(out.result).toBe('no_candidate')
    expect(publishCalls).toHaveLength(0)
  })

  it('5. 客户没配 Instagram：不发布', async () => {
    const { store } = makeStore([makeCandidate()])
    const noTargetStore: CrosspostStore = {
      ...store,
      async loadInstagramTarget() {
        return null
      },
    }
    const { adapter, publishCalls } = makeAdapter()
    const deps = makeDeps({ store: noTargetStore, adapter })

    const out = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, deps)
    expect(out.result).toBe('no_candidate')
    expect(publishCalls).toHaveLength(0)
  })

  it('6. 回执已是 draft：不重复发布', async () => {
    const candidate = makeCandidate()
    candidate.output = {
      ...candidate.output,
      instagram_publish: {
        schema_version: 1,
        status: 'draft',
        work_order_id: WO_ID,
        client_id: CLIENT_ID,
        publer_account_id: 'acct_12345678',
        request_id: 'aaaaaaaa-0000-4000-8000-000000000000',
        attempts: 0,
        first_comment_requested: true,
        no_publish: true,
        authorization: 'DRAFT_ONLY',
        cost_usd: 0,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      },
    }
    const { store } = makeStore([candidate])
    const { adapter, publishCalls } = makeAdapter()
    const deps = makeDeps({ store, adapter })

    const out = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, deps)
    expect(out.result).toBe('no_candidate')
    expect(publishCalls).toHaveLength(0)
  })

  it('7. Publer 账号错误：account 失败，50 分钟后重试，第二次不重发', async () => {
    const { store, rows } = makeStore([makeCandidate()])
    const { adapter, publishCalls } = makeAdapter({
      publishImpl: async () => {
        throw new PublerAccountError('account disconnected')
      },
    })
    const now = new Date('2024-01-01T00:00:00.000Z')
    const deps = makeDeps({ store, adapter, now: () => now })

    const out = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, deps)
    expect(out.result).toBe('failed')
    const receipt = readReceipt(rows.get(WO_ID)?.output)
    expect(receipt?.status).toBe('failed')
    expect(receipt?.failure_kind).toBe('account')
    expect(receipt?.attempts).toBe(0)
    const retryAt = Date.parse(receipt?.next_retry_at ?? '')
    expect(retryAt - now.getTime()).toBe(ACCOUNT_RETRY_MINUTES * 60 * 1000)

    // 第二次立即运行：退避中，不重发。
    const out2 = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, deps)
    expect(out2.result).toBe('no_candidate')
    expect(publishCalls).toHaveLength(1)
  })

  it('8. other 错误三次后终态', async () => {
    const { store, rows } = makeStore([makeCandidate()])
    const { adapter, publishCalls } = makeAdapter({
      publishImpl: async () => {
        throw new Error('transient')
      },
    })
    let now = new Date('2024-01-01T00:00:00.000Z')
    const deps = makeDeps({ store, adapter, now: () => now })

    await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, deps)
    let receipt = readReceipt(rows.get(WO_ID)?.output)
    expect(receipt?.attempts).toBe(1)
    expect(receipt?.next_retry_at).not.toBeNull()

    now = new Date(Date.parse(receipt?.next_retry_at ?? '') + 1000)
    await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, deps)
    receipt = readReceipt(rows.get(WO_ID)?.output)
    expect(receipt?.attempts).toBe(2)

    now = new Date(Date.parse(receipt?.next_retry_at ?? '') + 1000)
    await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, deps)
    receipt = readReceipt(rows.get(WO_ID)?.output)
    expect(receipt?.attempts).toBe(3)
    expect(receipt?.next_retry_at).toBeNull()

    const before = publishCalls.length
    const out4 = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, deps)
    expect(out4.result).toBe('no_candidate')
    expect(publishCalls.length).toBe(before)
  })

  it('9. findExisting 返回草稿：不发布，recovered', async () => {
    const { store, rows } = makeStore([makeCandidate()])
    const existing: PublishedRef = {
      platform: 'publer',
      post_id: 'ig-existing',
      published_at: '2024-01-01T00:00:00.000Z',
      provider_state: 'draft',
      permalink: 'https://instagram.test/p/existing',
    }
    const { adapter, publishCalls } = makeAdapter({ existing })
    const deps = makeDeps({ store, adapter })

    const out = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, deps)
    expect(out.result).toBe('recovered')
    expect(publishCalls).toHaveLength(0)
    const receipt = readReceipt(rows.get(WO_ID)?.output)
    expect(receipt?.status).toBe('draft')
  })

  it('10. 卡死的 creating + findExisting null：终态失败，不发布', async () => {
    const candidate = makeCandidate()
    candidate.output = {
      ...candidate.output,
      instagram_publish: {
        schema_version: 1,
        status: 'creating',
        work_order_id: WO_ID,
        client_id: CLIENT_ID,
        publer_account_id: 'acct_12345678',
        request_id: 'aaaaaaaa-0000-4000-8000-000000000000',
        attempts: 0,
        media_id: 'media-0000-old',
        first_comment_requested: true,
        no_publish: false,
        authorization: 'AUTHORIZED',
        cost_usd: 0,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      },
    }
    const { store } = makeStore([candidate])
    const { adapter, publishCalls } = makeAdapter({ existing: null })
    const now = new Date('2024-01-01T00:20:00.000Z') // 20 分钟后
    const deps = makeDeps({ store, adapter, now: () => now })

    const out = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, deps)
    expect(out.result).toBe('failed')
    expect(publishCalls).toHaveLength(0)
  })

  it('11. 认领写冲突：lost_race，不发布', async () => {
    const { store, rejectNextWrite } = makeStore([makeCandidate()])
    rejectNextWrite()
    const { adapter, publishCalls } = makeAdapter()
    const deps = makeDeps({ store, adapter })

    const out = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, deps)
    expect(out.result).toBe('lost_race')
    expect(publishCalls).toHaveLength(0)
  })

  it('12. 红线阻断：终态失败，不发布', async () => {
    const { store, rows } = makeStore([makeCandidate()])
    const { adapter, publishCalls } = makeAdapter()
    const scanCaption = vi.fn(async () => 'blocked by redline')
    const deps = makeDeps({ store, adapter, scanCaption })

    const out = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, deps)
    expect(out.result).toBe('failed')
    expect(publishCalls).toHaveLength(0)
    const receipt = readReceipt(rows.get(WO_ID)?.output)
    expect(receipt?.next_retry_at).toBeNull()
  })

  it('13. 缺审批清单：终态失败，不发布', async () => {
    const candidate = makeCandidate({ reviewRef: {} })
    const { store } = makeStore([candidate])
    const { adapter, publishCalls } = makeAdapter()
    const deps = makeDeps({ store, adapter })

    const out = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, deps)
    expect(out.result).toBe('failed')
    expect(publishCalls).toHaveLength(0)
  })

  it('14. onStarted 在创建前写入 creating 回执', async () => {
    const { store, rows } = makeStore([makeCandidate()])
    let statusAtCreate: string | undefined
    let mediaAtCreate: string | undefined
    const { adapter } = makeAdapter({
      publishImpl: async ({ onStarted }) => {
        if (onStarted !== undefined) await onStarted('media-0042')
        const receipt = readReceipt(rows.get(WO_ID)?.output)
        statusAtCreate = receipt?.status
        mediaAtCreate = receipt?.media_id
        return {
          platform: 'publer',
          post_id: 'ig-post-1',
          published_at: '2024-01-01T00:00:00.000Z',
          provider_state: 'scheduled',
          scheduled_at: '2024-01-01T00:03:00.000Z',
        }
      },
    })
    const deps = makeDeps({ store, adapter })

    const out = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, deps)
    expect(out.result).toBe('scheduled')
    expect(statusAtCreate).toBe('creating')
    expect(mediaAtCreate).toBe('media-0042')
  })

  it('14b. onStarted 写冲突：失败，创建步骤不执行', async () => {
    const rowsMap = new Map<string, CrosspostCandidate>()
    const c = makeCandidate()
    rowsMap.set(c.id, { ...c })
    let writeCount = 0
    const customStore: CrosspostStore = {
      async listCandidates() {
        return Array.from(rowsMap.values())
      },
      async loadInstagramTarget() {
        return {
          platform: 'publer',
          publer_account_id: 'acct_12345678',
          publer_provider: 'instagram',
          client_id: CLIENT_ID,
          expect_brand: 'TestBrand',
        }
      },
      async writeOutput(id, expectedUpdatedAt, output) {
        writeCount += 1
        // 第 2 次写（onStarted）失败；第 1 次（claim）与第 3 次（failWith）成功。
        if (writeCount === 2) return { ok: false }
        const row = rowsMap.get(id)
        if (row === undefined) return { ok: false }
        if (row.updated_at !== expectedUpdatedAt) return { ok: false }
        const updatedAt = `2024-01-01T00:00:${String(writeCount).padStart(2, '0')}.000Z`
        rowsMap.set(id, { ...row, output, updated_at: updatedAt })
        return { ok: true, updatedAt }
      },
    }
    let created = false
    const { adapter } = makeAdapter({
      publishImpl: async ({ onStarted }) => {
        if (onStarted !== undefined) await onStarted('media-0042')
        created = true
        return {
          platform: 'publer',
          post_id: 'ig-post-1',
          published_at: '2024-01-01T00:00:00.000Z',
          provider_state: 'scheduled',
        }
      },
    })
    const deps = makeDeps({ store: customStore, adapter })

    const out = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, deps)
    expect(out.result).toBe('failed')
    expect(created).toBe(false)
  })

  it('15. emit 抛错：回执保持成功状态，下一轮补发', async () => {
    const { store, rows } = makeStore([makeCandidate()])
    const { adapter } = makeAdapter()
    let emitCalls = 0
    const { emit } = makeEmit(async () => {
      emitCalls += 1
      if (emitCalls === 1) throw new Error('inngest down')
      return { event_ids: ['evt-late'] }
    })
    const deps = makeDeps({ store, adapter, emit })

    const out = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, deps)
    expect(out.result).toBe('scheduled')
    let receipt = readReceipt(rows.get(WO_ID)?.output)
    expect(receipt?.status).toBe('scheduled')
    expect(receipt?.event_ids).toBeUndefined()

    // 下一轮：候选已 scheduled，decideSweep 跳过，走 emitMissingEvents。
    const out2 = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, deps)
    expect(out2.result).toBe('no_candidate')
    receipt = readReceipt(rows.get(WO_ID)?.output)
    expect(receipt?.event_ids).toEqual(['evt-late'])
  })

  it('16. 首评使用 utm_source=instagram', async () => {
    const { store } = makeStore([makeCandidate()])
    const { adapter, publishCalls } = makeAdapter()
    const deps = makeDeps({ store, adapter })

    await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, deps)
    const firstComment = publishCalls[0].firstComment
    expect(typeof firstComment).toBe('string')
    expect(firstComment as string).toContain('utm_source=instagram')
  })

  it('17. Facebook 发出超过 48 小时的旧片不跟发(防开关一开就批量补发历史片)', async () => {
    const { store } = makeStore([
      makeCandidate({ fbVideoState: 'PUBLISHED', fbPublishedAt: '2023-12-29T00:00:00.000Z' }),
    ])
    const { adapter, publishCalls } = makeAdapter()
    const out = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, makeDeps({ store, adapter }))
    expect(out.result).toBe('no_candidate')
    expect(publishCalls).toHaveLength(0)
  })

  it('18. Facebook 回执读不出发布时间 = 来路不明,不跟发', async () => {
    const stale = makeCandidate({ fbVideoState: 'PUBLISHED' })
    delete stale.published_ref.published_at
    const { store } = makeStore([stale])
    const { adapter, publishCalls } = makeAdapter()
    const out = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, makeDeps({ store, adapter }))
    expect(out.result).toBe('no_candidate')
    expect(publishCalls).toHaveLength(0)
  })

  it('19. 一个客户的 Instagram 配置读失败,不拖垮后面别的客户', async () => {
    const bad = makeCandidate({ id: '22222222-2222-4222-8222-222222222222', clientId: 'bad-client' })
    const good = makeCandidate()
    const { store } = makeStore([bad, good])
    const flaky: CrosspostStore = {
      ...store,
      async loadInstagramTarget(clientId: string) {
        if (clientId === 'bad-client') throw new Error('缺品牌名,无法做防误发校验')
        return store.loadInstagramTarget(clientId)
      },
    }
    const { adapter, publishCalls } = makeAdapter()
    const deps = makeDeps({ store: flaky, adapter })
    const enabled = new Map([[CLIENT_ID, 'acct_12345678'], ['bad-client', 'acct_12345678']])
    // 第一轮:坏客户留下失败回执(不静默丢);第二轮:坏客户在退避期,轮到好客户发出
    const first = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: enabled }, deps)
    expect(first.result).toBe('failed')
    expect(publishCalls).toHaveLength(0)
    const second = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: enabled }, deps)
    expect(second.result).toBe('scheduled')
    expect(publishCalls).toHaveLength(1)
  })

  it('20. 同一客户的多条候选只查一次 Instagram 配置(省库)', async () => {
    const a = makeCandidate({ id: '33333333-3333-4333-8333-333333333333' })
    const b = makeCandidate({ id: '44444444-4444-4444-8444-444444444444' })
    const { store } = makeStore([a, b])
    let loads = 0
    const counting: CrosspostStore = {
      ...store,
      async loadInstagramTarget(clientId: string) {
        loads += 1
        return store.loadInstagramTarget(clientId)
      },
    }
    const { adapter } = makeAdapter({ existing: null })
    // 两条都跳过(FB 状态未知)也要只查一次
    for (const c of [a, b]) delete c.published_ref.video_state
    await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, makeDeps({ store: counting, adapter }))
    expect(loads).toBe(1)
  })

  // ───── 复审后补的场景 ─────

  it('21. 建帖后结果不确定(5xx/超时,本地锚已写)→ 回执保持 creating,不写 failed,15 分钟后只对账、不重发', async () => {
    const { store, rows } = makeStore([makeCandidate()])
    let created = 0
    const { adapter, publishCalls } = makeAdapter({
      publishImpl: async ({ onStarted }) => {
        await onStarted?.('media-0001')
        throw new Error('Publer POST /posts/schedule 502: bad gateway')
      },
    })
    const deps = makeDeps({ store, adapter })
    const out = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, deps)
    expect(out.result).toBe('failed')
    expect(out.detail).toBe('uncertain')
    const r = readReceipt(rows.get(WO_ID)?.output)
    expect(r?.status).toBe('creating')
    expect(r?.error).toContain('502')

    // 立刻再跑:在途,不动
    await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, deps)
    expect(publishCalls).toHaveLength(1)

    // 20 分钟后:走对账(找不到 → 终态失败转人工),依然不会再建帖
    const later = makeDeps({ store, adapter, now: () => new Date('2024-01-01T00:20:00.000Z') })
    const out3 = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, later)
    expect(out3.result).toBe('failed')
    expect(publishCalls).toHaveLength(1)
    expect(created).toBe(0)
    expect(readReceipt(rows.get(WO_ID)?.output)?.next_retry_at).toBeNull()
  })

  it('22. Publer 明确拒绝(4xx/失败清单)→ 才是可安全重试的普通失败(会排重试)', async () => {
    const { store, rows } = makeStore([makeCandidate()])
    const { adapter } = makeAdapter({
      publishImpl: async ({ onStarted }) => {
        await onStarted?.('media-0001')
        throw new PublerRejectedError('Publer 拒绝发布: nope')
      },
    })
    const out = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, makeDeps({ store, adapter }))
    expect(out.result).toBe('failed')
    const r = readReceipt(rows.get(WO_ID)?.output)
    expect(r?.status).toBe('failed')
    expect(r?.attempts).toBe(1)
    expect(r?.next_retry_at).not.toBeNull()
  })

  it('23. 对账命中已排期的帖子 → 补三本账(发出去了但本地没记上的那条不能永远缺账)', async () => {
    const { store } = makeStore([makeCandidate()])
    const { adapter, publishCalls } = makeAdapter({
      existing: {
        platform: 'publer', post_id: 'ig-post-9', video_id: 'media-0009', published_at: '2024-01-01T00:00:00.000Z',
        provider_state: 'scheduled', scheduled_at: '2024-01-01T00:03:00.000Z',
      },
    })
    const recordBooks = vi.fn(async () => undefined)
    const out = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, makeDeps({ store, adapter, recordBooks }))
    expect(out.result).toBe('recovered')
    expect(publishCalls).toHaveLength(0)
    expect(recordBooks).not.toHaveBeenCalled()
  })

  it('24. 事件的草稿/排期以刚拿到的回执为准,不是回执里的旧状态(成功回执写冲突时不能把真排期报成草稿)', async () => {
    const { store, rows } = makeStore([makeCandidate()])
    const { adapter } = makeAdapter()
    const { emit, calls } = makeEmit()
    // 让「成功回执」那一次写入冲突:认领(1)、onStarted(2)通过,第 3 次(成功回执)被拒
    const realWrite = store.writeOutput.bind(store)
    let n = 0
    const flaky: CrosspostStore = {
      ...store,
      async writeOutput(id, expected, output) {
        n += 1
        if (n === 3) return { ok: false }
        return realWrite(id, expected, output)
      },
    }
    await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, makeDeps({ store: flaky, adapter, emit }))
    expect(calls).toHaveLength(1)
    expect(calls[0].data.provider_state).toBe('scheduled')
    expect(calls[0].data.no_publish).toBe(false)
    expect(readReceipt(rows.get(WO_ID)?.output)?.status).toBe('creating') // 回执没写成,留给后续对账
  })

  it('25. 同一客户 30 分钟内刚提交过一条,另一条候选先不发(开关刚开时不连发一串)', async () => {
    const first = makeCandidate({ id: '55555555-5555-4555-8555-555555555555' })
    const second = makeCandidate({ id: '66666666-6666-4666-8666-666666666666' })
    const { store, rows } = makeStore([first, second])
    const { adapter, publishCalls } = makeAdapter()
    const deps = makeDeps({ store, adapter })
    await runInstagramCrosspost({ live: false, enabledClients: ENABLED }, deps)
    expect(publishCalls).toHaveLength(1)
    await runInstagramCrosspost({ live: false, enabledClients: ENABLED }, deps)
    expect(publishCalls).toHaveLength(1) // 间隔内第二条不发
    const later = makeDeps({ store, adapter, now: () => new Date(Date.parse('2024-01-01T00:00:00.000Z') + MIN_GAP_PER_CLIENT_MS + 60_000) })
    await runInstagramCrosspost({ live: false, enabledClients: ENABLED }, later)
    expect(publishCalls).toHaveLength(2)
    expect(rows.size).toBe(2)
  })

  it('26. Facebook 发布时间在未来(脏数据)= 来路不明,不跟发', async () => {
    const { store } = makeStore([makeCandidate({ fbPublishedAt: '2024-01-02T00:00:00.000Z' })])
    const { adapter, publishCalls } = makeAdapter()
    await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, makeDeps({ store, adapter }))
    expect(publishCalls).toHaveLength(0)
  })

  it('27. 审批清单:有一项 FAIL / 有一项 NOT_MEASURED / 自动清单整份缺失,都终态失败且不发', async () => {
    for (const mutate of [
      (o: Record<string, unknown>, r: Record<string, unknown>) => {
        const human = r.checklist_human as Array<Record<string, unknown>>
        human[0] = { ...human[0], outcome: 'FAIL', detail: 'bad' }
      },
      (o: Record<string, unknown>) => {
        const auto = o.quality_checklist_auto as Array<Record<string, unknown>>
        auto[0] = { ...auto[0], outcome: 'NOT_MEASURED' }
      },
      (o: Record<string, unknown>) => {
        delete o.quality_checklist_auto
      },
    ]) {
      const c = makeCandidate()
      mutate(c.output, c.review_ref)
      const { store, rows } = makeStore([c])
      const { adapter, publishCalls } = makeAdapter()
      const out = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, makeDeps({ store, adapter }))
      expect(out.result).toBe('failed')
      expect(publishCalls).toHaveLength(0)
      expect(readReceipt(rows.get(WO_ID)?.output)?.next_retry_at).toBeNull()
    }
  })

  it('28. 红线扫描本身抛错 → 失败关闭(终态,不发)', async () => {
    const { store, rows } = makeStore([makeCandidate()])
    const { adapter, publishCalls } = makeAdapter()
    const scanCaption = vi.fn(async () => {
      throw new Error('db down')
    })
    const out = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, makeDeps({ store, adapter, scanCaption }))
    expect(out.result).toBe('failed')
    expect(publishCalls).toHaveLength(0)
    expect(readReceipt(rows.get(WO_ID)?.output)?.next_retry_at).toBeNull()
  })

  it('29. 红线扫描看到的是「正文 + 首评」两段(不是空串)', async () => {
    const { store } = makeStore([makeCandidate()])
    const { adapter } = makeAdapter()
    const scanCaption = vi.fn(async () => null)
    await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, makeDeps({ store, adapter, scanCaption }))
    const scanned = String((scanCaption.mock.calls[0] as unknown[])[2])
    expect(scanned).toContain('Discover China')
    expect(scanned).toContain('utm_source=instagram')
  })

  it('30. 一个客户配置读失败 → 汇总里带 config_errors(不只死在日志里)', async () => {
    const { store } = makeStore([makeCandidate()])
    const broken: CrosspostStore = { ...store, async loadInstagramTarget() { throw new Error('缺品牌名,无法做防误发校验') } }
    const out = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, makeDeps({ store: broken }))
    expect(out.result).toBe('failed')
    expect(out.config_errors).toBe(1)
  })

  // ───── Round 7:启用名单 / 幂等标记 / post_may_exist ─────

  it('31. 没传 enabledClients(或空)= 谁都不处理:不查配置、不发布', async () => {
    const { store } = makeStore([makeCandidate()])
    let loads = 0
    const counting: CrosspostStore = {
      ...store,
      async loadInstagramTarget(clientId: string) {
        loads += 1
        return store.loadInstagramTarget(clientId)
      },
    }
    const { adapter, publishCalls } = makeAdapter()
    const omitted = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS }, makeDeps({ store: counting, adapter }))
    expect(omitted.result).toBe('no_candidate')
    const empty = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: new Map() }, makeDeps({ store: counting, adapter }))
    expect(empty.result).toBe('no_candidate')
    expect(loads).toBe(0)
    expect(publishCalls).toHaveLength(0)
  })

  it('32. 客户被点名但账号与绑定不符:不发布、不写回执、config_errors=1', async () => {
    const { store, rows } = makeStore([makeCandidate()])
    const { adapter, publishCalls } = makeAdapter()
    const wrong = new Map([[CLIENT_ID, 'acct_99999999']])
    const out = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: wrong }, makeDeps({ store, adapter }))
    expect(out.result).toBe('no_candidate')
    expect(out.config_errors).toBe(1)
    expect(publishCalls).toHaveLength(0)
    expect(readReceipt(rows.get(WO_ID)?.output)).toBeNull()
  })

  it('33. 同批里有一条 idempotency_unverified 回执 → 真发降级为草稿', async () => {
    const flagged = makeCandidate({ id: '77777777-7777-4777-8777-777777777777' })
    flagged.output = withReceipt(flagged.output, {
      schema_version: 1,
      status: 'draft',
      work_order_id: flagged.id,
      client_id: CLIENT_ID,
      publer_account_id: 'acct_12345678',
      request_id: 'aaaaaaaa-0000-4000-8000-000000000002',
      attempts: 0,
      first_comment_requested: true,
      no_publish: true,
      authorization: 'DRAFT_ONLY',
      cost_usd: 0,
      idempotency_unverified: true,
      created_at: '2023-12-31T20:00:00.000Z',
      updated_at: '2023-12-31T20:00:00.000Z', // 早于「现在」30 分钟以上,否则同客户最小间隔会先把整批挡住
    })
    const target = makeCandidate()
    const { store } = makeStore([flagged, target])
    const { adapter, publishCalls } = makeAdapter()
    const out = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, makeDeps({ store, adapter }))
    expect(out.result).toBe('drafted')
    expect(publishCalls).toHaveLength(1)
    expect(publishCalls[0].draft).toBe(true)
  })

  it('34. 对账时 findExisting 抛错(回执有 media_id)→ post_may_exist,下一轮只对账不重发', async () => {
    const candidate = makeCandidate()
    candidate.output = {
      ...candidate.output,
      instagram_publish: {
        schema_version: 1,
        status: 'creating',
        work_order_id: WO_ID,
        client_id: CLIENT_ID,
        publer_account_id: 'acct_12345678',
        request_id: 'aaaaaaaa-0000-4000-8000-000000000000',
        attempts: 0,
        media_id: 'media-0000-old',
        first_comment_requested: true,
        no_publish: false,
        authorization: 'AUTHORIZED',
        cost_usd: 0,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      },
    }
    const { store, rows } = makeStore([candidate])
    let findCalls = 0
    const adapter: PublishAdapter = {
      platform: 'publer',
      async publish() {
        throw new Error('不该走到发布')
      },
      async findExisting() {
        findCalls += 1
        if (findCalls === 1) throw new Error('publer 抖动')
        return null
      },
    }
    const now = new Date('2024-01-01T00:20:00.000Z') // 卡死,走对账
    const deps = makeDeps({ store, adapter, now: () => now })
    const out = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, deps)
    expect(out.result).toBe('failed')
    const r = readReceipt(rows.get(WO_ID)?.output)
    expect(r?.status).toBe('failed')
    expect(r?.post_may_exist).toBe(true)

    // 退避到期后再跑:只对账(找不到 → 终态失败),绝不重发
    const later = makeDeps({ store, adapter, now: () => new Date(Date.parse(r?.next_retry_at ?? '') + 1000) })
    const out2 = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, later)
    expect(out2.result).toBe('failed')
    expect(findCalls).toBe(2)
    expect(readReceipt(rows.get(WO_ID)?.output)?.next_retry_at).toBeNull()
  })

  it('35. onStarted 之后普通错误 → 回执保持 creating 且 post_may_exist=true', async () => {
    const { store, rows } = makeStore([makeCandidate()])
    const { adapter } = makeAdapter({
      publishImpl: async ({ onStarted }) => {
        await onStarted?.('media-0001')
        throw new Error('socket hang up')
      },
    })
    const out = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, makeDeps({ store, adapter }))
    expect(out.result).toBe('failed')
    const r = readReceipt(rows.get(WO_ID)?.output)
    expect(r?.status).toBe('creating')
    expect(r?.post_may_exist).toBe(true)
  })
})

describe('instagramEnabledClients(启用名单解析)', () => {
  it('逗号分隔的「客户:账号」,按第一个冒号切分,空项忽略,重复客户保留最后一个', () => {
    const m = instagramEnabledClients({ FACTORY_INSTAGRAM_ENABLED_CLIENTS: ' a:b , c:d:e,,x: , :y ' })
    expect([...m.entries()]).toEqual([['a', 'b'], ['c', 'd:e']])
  })
  it('没配 = 空 Map', () => {
    expect(instagramEnabledClients({}).size).toBe(0)
  })
})

describe('instagramLive(Instagram 独立真发闸)', () => {
  it('总开关关 → 永远草稿', () => {
    expect(instagramLive(false, { FACTORY_INSTAGRAM_LIVE: 'true' })).toBe(false)
  })
  it('总开关开、但 Instagram 独立开关没设/不是 true → 仍是草稿(首次真连必须先验草稿)', () => {
    expect(instagramLive(true, {})).toBe(false)
    expect(instagramLive(true, { FACTORY_INSTAGRAM_LIVE: 'yes' })).toBe(false)
  })
  it('两个开关都明确是 true 才真发', () => {
    expect(instagramLive(true, { FACTORY_INSTAGRAM_LIVE: 'true' })).toBe(true)
  })
})

describe('按客户点名真发(Publer 绑了账号 ≠ 客户同意自动跟发)', () => {
  it('全局开关打开、但该客户不在名单里 → 只存草稿,绝不排期', async () => {
    const { store, rows } = makeStore([makeCandidate({ fbVideoState: 'PUBLISHED' })])
    const { adapter, publishCalls } = makeAdapter()
    const out = await runInstagramCrosspost({ live: true, liveClientIds: new Set(['someone-else']), enabledClients: ENABLED }, makeDeps({ store, adapter }))
    expect(out.result).toBe('drafted')
    expect(publishCalls[0].draft).toBe(true)
    expect(readReceipt(rows.get(WO_ID)?.output)?.authorization).toBe('DRAFT_ONLY')
  })

  it('不传名单 = 空名单 = 失败关闭:全局开关再开也只存草稿', async () => {
    const { store } = makeStore([makeCandidate({ fbVideoState: 'PUBLISHED' })])
    const { adapter, publishCalls } = makeAdapter()
    await runInstagramCrosspost({ live: true, enabledClients: ENABLED }, makeDeps({ store, adapter }))
    expect(publishCalls[0].draft).toBe(true)
  })

  it('FACTORY_INSTAGRAM_LIVE_CLIENTS 的解析:逗号分隔、去空格、没配是空集', () => {
    expect([...instagramLiveClients({ FACTORY_INSTAGRAM_LIVE_CLIENTS: ' a , b,, ' })]).toEqual(['a', 'b'])
    expect(instagramLiveClients({}).size).toBe(0)
  })
})

describe('ig_crosspost_blocked:受控转公开动作盖章的工单不进 Instagram 跟发', () => {
  const blocked = (c: CrosspostCandidate): CrosspostCandidate => ({ ...c, published_ref: { ...c.published_ref, ig_crosspost_blocked: true } })

  it('决策:本来会存草稿的工单带标记 → 什么都不发,不调 Publer', async () => {
    const { store } = makeStore([blocked(makeCandidate({ fbVideoState: 'PUBLISHED' }))])
    const { adapter, publishCalls, findExistingCalls } = makeAdapter()
    const out = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, makeDeps({ store, adapter }))
    expect(out.result).toBe('no_candidate')
    expect(publishCalls).toHaveLength(0)
    expect(findExistingCalls).toHaveLength(0)
  })

  it('对账:卡在 creating 的工单带标记 → 不去 Publer 对账,回执原样不动', async () => {
    const candidate = blocked(makeCandidate())
    candidate.output = {
      ...candidate.output,
      instagram_publish: {
        schema_version: 1, status: 'creating', work_order_id: WO_ID, client_id: CLIENT_ID, publer_account_id: 'acct_12345678',
        request_id: 'aaaaaaaa-0000-4000-8000-000000000000', attempts: 0, media_id: 'media-0000-old', first_comment_requested: true,
        no_publish: false, authorization: 'AUTHORIZED', cost_usd: 0,
        created_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-01-01T00:00:00.000Z',
      },
    }
    const { store, rows } = makeStore([candidate])
    const { adapter, publishCalls, findExistingCalls } = makeAdapter({ existing: null })
    const now = new Date('2024-01-01T00:20:00.000Z')
    const out = await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, makeDeps({ store, adapter, now: () => now }))
    expect(out.result).toBe('no_candidate')
    expect(findExistingCalls).toHaveLength(0)
    expect(publishCalls).toHaveLength(0)
    expect(readReceipt(rows.get(WO_ID)?.output)?.status).toBe('creating')
  })

  it('补发事件:已有 scheduled 回执但没事件的工单带标记 → 不补发', async () => {
    const plain = makeCandidate()
    const { store: seedStore, rows: seedRows } = makeStore([plain])
    const { adapter } = makeAdapter()
    const seedDeps = makeDeps({ store: seedStore, adapter, emit: makeEmit(async () => { throw new Error('inngest down') }).emit })
    await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, seedDeps)
    const seeded = seedRows.get(WO_ID)
    expect(readReceipt(seeded?.output)?.event_ids).toBeUndefined()

    const { store } = makeStore([blocked(seeded as CrosspostCandidate)])
    const { emit, calls } = makeEmit()
    await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, makeDeps({ store, adapter, emit }))
    expect(calls).toHaveLength(0)
  })

  it('对照:同样的工单没带标记 → 补发会发出(证明上面的 0 次不是夹具问题)', async () => {
    const { store: seedStore, rows: seedRows } = makeStore([makeCandidate()])
    const { adapter } = makeAdapter()
    await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, makeDeps({ store: seedStore, adapter, emit: makeEmit(async () => { throw new Error('inngest down') }).emit }))
    const { store } = makeStore([seedRows.get(WO_ID) as CrosspostCandidate])
    const { emit, calls } = makeEmit()
    await runInstagramCrosspost({ live: true, liveClientIds: LIVE_CLIENTS, enabledClients: ENABLED }, makeDeps({ store, adapter, emit }))
    expect(calls).toHaveLength(1)
  })
})
