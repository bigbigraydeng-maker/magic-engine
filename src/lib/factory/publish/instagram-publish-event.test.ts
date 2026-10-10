/**
 * me/factory.reel.instagram.submitted 事件契约测试。
 *
 * 证明的是「契约本身自洽」:幂等 id 稳定、payload 形状锁死、坏输入被 schema 挡在发送前。
 * 事件「有没有真被接进发布路径」由集成测试证明,两层分工。
 */
import { describe, expect, it } from 'vitest'
import {
  FACTORY_REEL_INSTAGRAM_SUBMITTED_EVENT,
  FactoryReelInstagramSubmittedEventSchema,
  buildInstagramReelSubmittedEvent,
  instagramReelSubmittedEventId,
} from './instagram-publish-event'

const BASE = {
  workOrderId: 'a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5',
  clientId: 'c0000000-0000-0000-0000-000000000000',
  publerAccountId: 'acct_12345678',
  mediaId: 'media_12345678',
  requestId: 'f0f0f0f0-1111-2222-3333-444444444444',
  createdAt: '2026-09-06T20:00:01.000Z',
  firstCommentRequested: false,
}

describe('instagramReelSubmittedEventId', () => {
  it('幂等 id 由 work_order + media 决定,稳定可复现(正常路径与补发路径同 id → Inngest 去重)', () => {
    expect(instagramReelSubmittedEventId(BASE.workOrderId, BASE.mediaId)).toBe(
      `me-factory-ig-reel-${BASE.workOrderId}-${BASE.mediaId}`,
    )
    // 换 media → 换 id(重发新片不被当成旧片的重试)
    expect(instagramReelSubmittedEventId(BASE.workOrderId, 'media_99999999')).not.toBe(
      instagramReelSubmittedEventId(BASE.workOrderId, BASE.mediaId),
    )
  })
})

describe('buildInstagramReelSubmittedEvent', () => {
  it('draft 事件可构建:no_publish=true、authorization=DRAFT_ONLY、无 scheduled_at 键', () => {
    const e = buildInstagramReelSubmittedEvent({ ...BASE, providerState: 'draft' })
    expect(e.name).toBe(FACTORY_REEL_INSTAGRAM_SUBMITTED_EVENT)
    expect(e.name).toBe('me/factory.reel.instagram.submitted')
    expect(e.id).toBe(instagramReelSubmittedEventId(BASE.workOrderId, BASE.mediaId))
    expect(e.data.provider_state).toBe('draft')
    expect(e.data.no_publish).toBe(true)
    expect(e.data.authorization).toBe('DRAFT_ONLY')
    expect('scheduled_at' in e.data).toBe(false)
    expect(FactoryReelInstagramSubmittedEventSchema.safeParse(e.data).success).toBe(true)
  })

  it('scheduled 事件可构建:no_publish=false、authorization=AUTHORIZED、带 scheduled_at', () => {
    const e = buildInstagramReelSubmittedEvent({
      ...BASE,
      providerState: 'scheduled',
      scheduledAt: '2026-09-07T20:00:00.000Z',
    })
    expect(e.data.provider_state).toBe('scheduled')
    expect(e.data.no_publish).toBe(false)
    expect(e.data.authorization).toBe('AUTHORIZED')
    expect(e.data.scheduled_at).toBe('2026-09-07T20:00:00.000Z')
    expect(FactoryReelInstagramSubmittedEventSchema.safeParse(e.data).success).toBe(true)
  })

  it('🔴 scheduled 缺 scheduledAt → builder 抛错(绝不发出无排期的 scheduled 事件)', () => {
    expect(() =>
      buildInstagramReelSubmittedEvent({ ...BASE, providerState: 'scheduled' }),
    ).toThrow()
  })

  it('🔴 draft 带 scheduledAt → builder 抛错(草稿绝不冒充排期)', () => {
    expect(() =>
      buildInstagramReelSubmittedEvent({
        ...BASE,
        providerState: 'draft',
        scheduledAt: '2026-09-07T20:00:00.000Z',
      }),
    ).toThrow()
  })

  it('post_id 可缺(拿不到不阻塞),带上时原样保留', () => {
    const without = buildInstagramReelSubmittedEvent({ ...BASE, providerState: 'draft' })
    expect('post_id' in without.data).toBe(false)

    const withPost = buildInstagramReelSubmittedEvent({
      ...BASE,
      providerState: 'draft',
      postId: 'post_12345678',
    })
    expect(withPost.data.post_id).toBe('post_12345678')
  })
})

describe('FactoryReelInstagramSubmittedEventSchema', () => {
  const draftData = buildInstagramReelSubmittedEvent({ ...BASE, providerState: 'draft' }).data
  const scheduledData = buildInstagramReelSubmittedEvent({
    ...BASE,
    providerState: 'scheduled',
    scheduledAt: '2026-09-07T20:00:00.000Z',
  }).data

  it('🔴 拒绝 draft + no_publish=false(草稿绝不冒充正式发布信号)', () => {
    expect(
      FactoryReelInstagramSubmittedEventSchema.safeParse({ ...draftData, no_publish: false }).success,
    ).toBe(false)
  })

  it('🔴 拒绝 scheduled + authorization=DRAFT_ONLY', () => {
    expect(
      FactoryReelInstagramSubmittedEventSchema.safeParse({
        ...scheduledData,
        authorization: 'DRAFT_ONLY',
      }).success,
    ).toBe(false)
  })

  it('🔴 拒绝 platform=facebook(Instagram 事件绝不冒充 Facebook 事件)', () => {
    expect(
      FactoryReelInstagramSubmittedEventSchema.safeParse({ ...draftData, platform: 'facebook' })
        .success,
    ).toBe(false)
  })

  it('🔴 拒绝非 uuid 形状的 work_order_id', () => {
    expect(
      FactoryReelInstagramSubmittedEventSchema.safeParse({
        ...draftData,
        work_order_id: 'not-a-uuid',
      }).success,
    ).toBe(false)
  })

  it('🔴 拒绝 cost_usd=1(收据字段盖死)', () => {
    expect(
      FactoryReelInstagramSubmittedEventSchema.safeParse({ ...draftData, cost_usd: 1 }).success,
    ).toBe(false)
  })

  it('接受 CTS 风格的种子 client id(c0000000-… 非 RFC4122,严格 uuid 校验会误拒)', () => {
    expect(
      FactoryReelInstagramSubmittedEventSchema.safeParse({
        ...draftData,
        client_id: 'c0000000-0000-0000-0000-000000000000',
      }).success,
    ).toBe(true)
  })
})
