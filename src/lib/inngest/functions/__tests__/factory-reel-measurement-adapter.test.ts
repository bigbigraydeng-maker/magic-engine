/**
 * Factory Reel → measurement adapter 的业务行为。
 *
 * 覆盖 issue 描述里的每一条 fail-closed 断点：缺字段、错 client、错 page、错
 * video、事件重放、身份漂移。不测 Inngest step 本身（那是 daily-plan-post-
 * measurement 的责任），只测 adapter 的纯函数与两个 supabase 交互 helper。
 */
import { describe, it, expect } from 'vitest'
import {
  reelPostId,
  reelMeasurementIdempotencyKey,
  reelMeasureAt,
  reelPublishIdentityMismatch,
  rebindFactoryReelAction,
  registerReelPublishAction,
  REEL_MEASURE_WINDOWS,
  type RegisterReelPublishInput,
} from '../factory-reel-measurement-adapter'
import { FactoryReelPublishedEventSchema } from '@/lib/factory/publish/reel-published-event'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const WORK_ORDER = 'a1b2c3d4-1111-4222-8333-444455556666'
const PAGE = '1616575215312482'
const VIDEO = '1485915556968219'
const PUBLISHED_AT = '2026-09-01T04:30:00.000Z'

function realReelEvent(over: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    request_id: 'aaaabbbb-0000-4000-8000-000000000000',
    work_order_id: WORK_ORDER,
    client_id: CLIENT,
    platform: 'facebook',
    page_id: PAGE,
    video_id: VIDEO,
    post_id: VIDEO, // bare video_id per PR #1424 contract
    media_type: 'reel',
    permalink: 'https://www.facebook.com/reel/1485915556968219/',
    published_at: PUBLISHED_AT,
    status: 'PUBLISHED',
    no_publish: false,
    authorization: 'AUTHORIZED',
    cost_usd: 0,
    created_at: PUBLISHED_AT,
    ...over,
  }
}

// ─── 纯函数：拼接 / 派生 / 时刻计算 ─────────────────────────────────────────

describe('reelPostId — Feed story id 是 <page>_<video>', () => {
  it('拼接正确格式，天然满足 checkIsolation 的 <page>_ 前缀要求', () => {
    expect(reelPostId(PAGE, VIDEO)).toBe(`${PAGE}_${VIDEO}`)
    expect(reelPostId(PAGE, VIDEO).startsWith(`${PAGE}_`)).toBe(true)
  })
})

describe('reelMeasurementIdempotencyKey — 稳定派生', () => {
  it('同 (workOrder, video) → 同 key（重放不产生第二组任务的第一层保障）', () => {
    const a = reelMeasurementIdempotencyKey(WORK_ORDER, VIDEO)
    const b = reelMeasurementIdempotencyKey(WORK_ORDER, VIDEO)
    expect(a).toBe(b)
    expect(a).toBe(`factory-reel:${WORK_ORDER}:${VIDEO}`)
  })
  it('不同 video → 不同 key', () => {
    expect(reelMeasurementIdempotencyKey(WORK_ORDER, VIDEO)).not.toBe(
      reelMeasurementIdempotencyKey(WORK_ORDER, '9999999999999999'),
    )
  })
})

describe('reelMeasureAt — T+4 / T+72 从 published_at 起算', () => {
  it('两个窗口时刻与 published_at 偏移严格一致', () => {
    const at = reelMeasureAt(PUBLISHED_AT)
    expect(at).toHaveLength(2)
    expect(at[0]).toEqual({ hours: 4, at: '2026-09-01T08:30:00.000Z' })
    expect(at[1]).toEqual({ hours: 72, at: '2026-09-04T04:30:00.000Z' })
  })
  it('窗口常量与 daily-plan 保持一致 (4, 72)', () => {
    expect([...REEL_MEASURE_WINDOWS]).toEqual([4, 72])
  })
  it('非法 published_at 抛错，不静默塌成 NaN', () => {
    expect(() => reelMeasureAt('not-a-date')).toThrow(/invalid publishedAt/)
  })
})

// ─── PR #1424 事件契约 ────────────────────────────────────────────────────

describe('FactoryReelPublishedEventSchema — 拒绝 DRAFT / 拒绝错平台', () => {
  it('真实 PUBLISHED Reel 通过', () => {
    expect(FactoryReelPublishedEventSchema.safeParse(realReelEvent()).success).toBe(true)
  })
  it('status=DRAFT 直接拒 — 草稿不该触发下游测量', () => {
    expect(
      FactoryReelPublishedEventSchema.safeParse(realReelEvent({ status: 'DRAFT' })).success,
    ).toBe(false)
  })
  it('no_publish=true 直接拒 — dry-run 不能被当真实发布', () => {
    expect(
      FactoryReelPublishedEventSchema.safeParse(realReelEvent({ no_publish: true })).success,
    ).toBe(false)
  })
})

// ─── 身份重绑：第二道闸 ────────────────────────────────────────────────────

/** 只对 flywheel_actions 建模；其他表一律炸。 */
function flywheelDb(row: { client_id?: string; payload?: Record<string, unknown> } | null, error?: unknown) {
  return {
    from(table: string) {
      if (table !== 'flywheel_actions') throw new Error(`unexpected table ${table}`)
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.maybeSingle = () => Promise.resolve({ data: row, error: error ?? null })
      chain.single = () => Promise.resolve({ data: row, error: error ?? null })
      chain.insert = () => ({ select: () => ({ single: () => Promise.resolve({ data: row, error: error ?? null }) }) })
      return chain
    },
  } as never
}

function factoryActionRow(over: Record<string, unknown> = {}) {
  return {
    id: 'action-1',
    client_id: CLIENT,
    payload: {
      work_order_id: WORK_ORDER,
      platform: 'facebook',
      page_id: PAGE,
      post_id: VIDEO,
      video_id: VIDEO,
      published_at: PUBLISHED_AT,
      permalink: '/reel/1485915556968219/',
      video_state: 'PUBLISHED',
      ...over,
    },
  }
}

describe('rebindFactoryReelAction — event 与 action 身份必须一致', () => {
  const claim = { clientId: CLIENT, workOrderId: WORK_ORDER, pageId: PAGE, videoId: VIDEO, publishedAt: PUBLISHED_AT }

  it.each(['DRAFT', undefined, 'UPLOADING'])('rejects stored video_state=%s despite a published event', async video_state => {
    expect(await rebindFactoryReelAction(flywheelDb(factoryActionRow({ video_state })), claim))
      .toEqual({ ok: false, reason: 'not_published' })
  })

  it('rejects an event shifting the real publication timestamp', async () => {
    expect(await rebindFactoryReelAction(flywheelDb(factoryActionRow()), {
      ...claim, publishedAt: '2026-09-02T04:30:00.000Z',
    })).toEqual({ ok: false, reason: 'published_at_mismatch' })
  })

  it('匹配 → ok + permalink', async () => {
    const r = await rebindFactoryReelAction(flywheelDb(factoryActionRow()), claim)
    expect(r).toEqual({ ok: true, permalink: '/reel/1485915556968219/' })
  })

  it('DB 错误 → 抛出（让 Inngest 有界重试，不塌成 not_found）', async () => {
    await expect(
      rebindFactoryReelAction(flywheelDb(null, { message: 'connection timeout' }), claim),
    ).rejects.toThrow(/db error.*connection timeout/)
  })

  it('action 不存在 → action_not_found（fail-closed）', async () => {
    const r = await rebindFactoryReelAction(flywheelDb(null), claim)
    expect(r).toEqual({ ok: false, reason: 'action_not_found' })
  })

  it('客户不一致 → client_mismatch（防跨客户串台）', async () => {
    const r = await rebindFactoryReelAction(
      flywheelDb({ ...factoryActionRow(), client_id: 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84' }),
      claim,
    )
    expect(r).toEqual({ ok: false, reason: 'client_mismatch' })
  })

  it('page_id 不一致 → page_mismatch', async () => {
    const r = await rebindFactoryReelAction(flywheelDb(factoryActionRow({ page_id: '99999' })), claim)
    expect(r).toEqual({ ok: false, reason: 'page_mismatch' })
  })

  it('video_id 不一致（payload.post_id 与 event.video_id 不同） → video_mismatch', async () => {
    const r = await rebindFactoryReelAction(
      flywheelDb(factoryActionRow({ post_id: '9999999999999999', video_id: '9999999999999999' })),
      claim,
    )
    expect(r).toEqual({ ok: false, reason: 'video_mismatch' })
  })

  it('permalink 缺席 → ok + permalink=null', async () => {
    const r = await rebindFactoryReelAction(
      flywheelDb(factoryActionRow({ permalink: undefined })),
      claim,
    )
    expect(r).toEqual({ ok: true, permalink: null })
  })
})

// ─── 登记 + 重放幂等 ───────────────────────────────────────────────────────

function baseInput(over: Partial<RegisterReelPublishInput> = {}): RegisterReelPublishInput {
  return {
    clientId: CLIENT,
    idempotencyKey: reelMeasurementIdempotencyKey(WORK_ORDER, VIDEO),
    postId: reelPostId(PAGE, VIDEO),
    pageId: PAGE,
    permalink: '/reel/1485915556968219/',
    publishedAt: PUBLISHED_AT,
    measureAt: reelMeasureAt(PUBLISHED_AT),
    ...over,
  }
}

/** 首次 INSERT 成功的 fake supabase。 */
function insertOkDb(actionId: string) {
  return {
    from(table: string) {
      if (table !== 'flywheel_actions') throw new Error(`unexpected table ${table}`)
      return {
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: { id: actionId }, error: null }),
          }),
        }),
      }
    },
  } as never
}

/** 撞唯一约束，然后回读到 existingRow 的 fake supabase。 */
function uniqueViolationThen(existingRow: Record<string, unknown> | null, readError?: unknown) {
  let insertCalled = false
  return {
    from(table: string) {
      if (table !== 'flywheel_actions') throw new Error(`unexpected table ${table}`)
      if (!insertCalled) {
        insertCalled = true
        return {
          insert: () => ({
            select: () => ({
              single: () =>
                Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } }),
            }),
          }),
        }
      }
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.maybeSingle = () => Promise.resolve({ data: existingRow, error: readError ?? null })
      return chain
    },
  } as never
}

describe('registerReelPublishAction — 首次成功 / 重放幂等 / 身份漂移拒绝', () => {
  it('首次 INSERT 成功 → created=true, actionId', async () => {
    const r = await registerReelPublishAction(insertOkDb('new-id-1'), baseInput())
    expect(r).toEqual({ ok: true, actionId: 'new-id-1', created: false || true })
    if (r.ok) expect(r.created).toBe(true)
  })

  it('重放：撞约束回读到同身份 → created=false, 同 actionId（不产生第二条 action）', async () => {
    const input = baseInput()
    const r = await registerReelPublishAction(
      uniqueViolationThen({
        id: 'action-existing',
        client_id: CLIENT,
        payload: {
          source: 'factory_reel',
          idempotency_key: input.idempotencyKey,
          post_id: input.postId,
          page_id: input.pageId,
          permalink: input.permalink,
          campaign_id: null,
          plan_id: null,
          published_at: input.publishedAt,
          measure_at: input.measureAt,
        },
      }),
      input,
    )
    expect(r).toEqual({ ok: true, actionId: 'action-existing', created: false })
  })

  it('🔴 撞约束但回读到不同 post_id → identity_mismatch（同 key 换视频不许挂到旧 action）', async () => {
    const input = baseInput()
    const r = await registerReelPublishAction(
      uniqueViolationThen({
        id: 'action-existing',
        client_id: CLIENT,
        payload: {
          idempotency_key: input.idempotencyKey,
          post_id: `${PAGE}_9999999999999999`, // 不同 post
          page_id: input.pageId,
          campaign_id: null,
          plan_id: null,
          published_at: input.publishedAt,
          measure_at: input.measureAt,
        },
      }),
      input,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('identity_mismatch')
      expect(r.field).toBe('post_id_mismatch')
    }
  })

  it('撞约束但回读不到 → unique_conflict_unreadable（不静默返回假 id）', async () => {
    const r = await registerReelPublishAction(uniqueViolationThen(null), baseInput())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('unique_conflict_unreadable')
  })
})

describe('reelPublishIdentityMismatch — 每字段独立守护', () => {
  const input = baseInput()

  function existingLike(pOver: Record<string, unknown> = {}) {
    return {
      id: 'x',
      client_id: CLIENT,
      payload: {
        idempotency_key: input.idempotencyKey,
        post_id: input.postId,
        page_id: input.pageId,
        campaign_id: null,
        plan_id: null,
        published_at: input.publishedAt,
        measure_at: input.measureAt,
        ...pOver,
      },
    }
  }

  it('完全匹配 → null', () => {
    expect(reelPublishIdentityMismatch(existingLike(), input)).toBeNull()
  })
  it('client_id 差异 → client_id_mismatch', () => {
    const row = { ...existingLike(), client_id: 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84' }
    expect(reelPublishIdentityMismatch(row, input)).toBe('client_id_mismatch')
  })
  it('published_at 差异 → published_at_mismatch', () => {
    expect(
      reelPublishIdentityMismatch(existingLike({ published_at: '2026-01-01T00:00:00.000Z' }), input),
    ).toBe('published_at_mismatch')
  })
  it('measure_at 长度差异 → measure_at_length_mismatch', () => {
    expect(
      reelPublishIdentityMismatch(existingLike({ measure_at: [{ hours: 4, at: '2026-09-01T08:30:00.000Z' }] }), input),
    ).toBe('measure_at_length_mismatch')
  })
  it('🔴 campaign_id/plan_id 双方 null 视为相等（Reel 场景不写实值）', () => {
    expect(reelPublishIdentityMismatch(existingLike({ campaign_id: null, plan_id: null }), input)).toBeNull()
    // 但如果旧行意外带了值，视为漂移
    expect(reelPublishIdentityMismatch(existingLike({ campaign_id: 'x' }), input)).toBe('campaign_id_mismatch')
  })
  it('缺 measure_at → measure_at_missing', () => {
    const row = { id: 'x', client_id: CLIENT, payload: { idempotency_key: input.idempotencyKey, post_id: input.postId, page_id: input.pageId, campaign_id: null, plan_id: null, published_at: input.publishedAt } }
    expect(reelPublishIdentityMismatch(row, input)).toBe('measure_at_missing')
  })
  it('existing 为 null → action_not_readable', () => {
    expect(reelPublishIdentityMismatch(null, input)).toBe('action_not_readable')
  })
})
