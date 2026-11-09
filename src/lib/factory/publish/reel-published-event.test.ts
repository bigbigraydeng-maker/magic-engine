/**
 * me/factory.reel.published 事件契约测试。
 *
 * 证明的是「契约本身自洽」:幂等 id 稳定、payload 形状锁死、坏输入被 schema 挡在发送前。
 * 事件「有没有真被接进发布路径」由 reel-published-emit.test.ts(集成)证明,两层分工。
 */
import { describe, expect, it } from 'vitest'
import {
  FACTORY_REEL_PUBLISHED_EVENT,
  FactoryReelPublishedEventSchema,
  buildReelPublishedEvent,
  reelPublishedEventId,
} from './reel-published-event'

const BASE = {
  workOrderId: 'a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5',
  clientId: 'c0000000-0000-0000-0000-000000000000',
  pageId: '1616575215312482',
  videoId: '1707599651172223',
  permalink: 'https://www.facebook.com/reel/1707599651172223',
  publishedAt: '2026-09-06T20:00:00.000Z',
  requestId: 'f0f0f0f0-1111-2222-3333-444444444444',
  createdAt: '2026-09-06T20:00:01.000Z',
}

describe('reelPublishedEventId', () => {
  it('幂等 id 由 work_order + video 决定,稳定可复现(正常路径与补发路径同 id → Inngest 去重)', () => {
    expect(reelPublishedEventId(BASE.workOrderId, BASE.videoId)).toBe(
      `me-factory-reel-${BASE.workOrderId}-${BASE.videoId}`,
    )
    // 换 video → 换 id(重发新片不被当成旧片的重试)
    expect(reelPublishedEventId(BASE.workOrderId, '999')).not.toBe(
      reelPublishedEventId(BASE.workOrderId, BASE.videoId),
    )
  })
})

describe('buildReelPublishedEvent', () => {
  it('产出 { id, name, data },name 是 me/ 命名空间事件,post_id === video_id(下游拼 <page>_<video>)', () => {
    const e = buildReelPublishedEvent(BASE)
    expect(e.name).toBe(FACTORY_REEL_PUBLISHED_EVENT)
    expect(e.name).toBe('me/factory.reel.published')
    expect(e.id).toBe(reelPublishedEventId(BASE.workOrderId, BASE.videoId))
    expect(e.data.post_id).toBe(BASE.videoId)
    expect(e.data.video_id).toBe(BASE.videoId)
    expect(e.data.page_id).toBe(BASE.pageId)
  })

  it('是机器可读收据:status/no_publish/authorization/cost 都盖死(Inngest 副作用硬约束)', () => {
    const { data } = buildReelPublishedEvent(BASE)
    expect(data.status).toBe('PUBLISHED')
    expect(data.no_publish).toBe(false)
    expect(data.authorization).toBe('AUTHORIZED')
    expect(data.cost_usd).toBe(0)
    expect(data.media_type).toBe('reel')
    expect(data.platform).toBe('facebook')
  })

  it('permalink 可缺(拿不到不阻塞)', () => {
    const { permalink, ...noLink } = BASE
    void permalink
    const { data } = buildReelPublishedEvent(noLink)
    expect(data.permalink).toBeUndefined()
    expect(FactoryReelPublishedEventSchema.safeParse(data).success).toBe(true)
  })

  it('🔴 相对路径 permalink(Graph 真返回 /reel/123/)补成绝对网址,不再让整条信号发不出', () => {
    // 2026-09-07 首发实测的真 bug:FB 返回 /reel/2259550698170048/,.url() 拒相对路径 → emit 全挂。
    const { data } = buildReelPublishedEvent({ ...BASE, permalink: '/reel/2259550698170048/' })
    expect(data.permalink).toBe('https://www.facebook.com/reel/2259550698170048/')
    expect(FactoryReelPublishedEventSchema.safeParse(data).success).toBe(true)
  })

  it('拼不出合法网址的 permalink 丢弃(非关键,绝不因它挡下整条信号)', () => {
    const { data } = buildReelPublishedEvent({ ...BASE, permalink: 'not a url at all' })
    expect(data.permalink).toBeUndefined()
    expect(FactoryReelPublishedEventSchema.safeParse(data).success).toBe(true)
  })

  it('🔴 坏 page_id(非数字)被 schema 挡在发送前,绝不发出畸形事件', () => {
    expect(() => buildReelPublishedEvent({ ...BASE, pageId: '69e777961cec3ed0f94bb7cf' })).toThrow()
  })

  it('🔴 坏 video_id(空)被挡', () => {
    expect(() => buildReelPublishedEvent({ ...BASE, videoId: '' })).toThrow()
  })
})

describe('FactoryReelPublishedEventSchema', () => {
  it('拒绝把 no_publish 伪造成 true(草稿绝不冒充正式发布信号)', () => {
    const { data } = buildReelPublishedEvent(BASE)
    expect(FactoryReelPublishedEventSchema.safeParse({ ...data, no_publish: true }).success).toBe(false)
  })

  it('拒绝把 status 伪造成非 PUBLISHED', () => {
    const { data } = buildReelPublishedEvent(BASE)
    expect(FactoryReelPublishedEventSchema.safeParse({ ...data, status: 'DRAFT' }).success).toBe(false)
  })
})
