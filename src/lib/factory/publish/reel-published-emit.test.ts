/**
 * 发布信号 emit + 补发对账的集成测试(魏征头号阻断项)。
 *
 * 证明的不是「builder 会算对」(那在 reel-published-event.test.ts),而是:
 *  ① 只有真·PUBLISHED 的 Reel 才 emit —— 草稿绝不冒充正式发布信号通知下游建广告;
 *  ② emit 失败不阻塞发布(片已发出);
 *  ③ 补发对账只补 PUBLISHED、跳过草稿、跳过已喊过的(不双发)。
 * 这三条正是「有实现、没接对」会出的事,拆纯函数单测证明不了。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('./facebook-reel-adapter', () => ({
  facebookReelAdapter: { publish: vi.fn(), findExisting: vi.fn(async () => null) },
}))
vi.mock('@/lib/workflows/inngest-event', () => ({
  sendInngestEvent: vi.fn(async () => ({ event_ids: ['evt_reel_1'] })),
}))

import { runPublishWorker, reconcileMissingReelEvents } from './publish-worker'
import { supabaseAdmin } from '@/lib/supabase'
import { facebookReelAdapter } from './facebook-reel-adapter'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import { FactoryReelPublishedEventSchema, reelPublishedEventId } from './reel-published-event'
import { REEL_AUTO_CHECK_KEYS, REEL_HUMAN_CHECK_KEYS } from '@/lib/social/content-review'

const mockFrom = vi.mocked(supabaseAdmin.from)
const mockPublish = vi.mocked(facebookReelAdapter.publish)
const mockFindExisting = vi.mocked(facebookReelAdapter.findExisting)
const mockSend = vi.mocked(sendInngestEvent)

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const WO_ID = 'a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5'
const PAGE_ID = '1616575215312482'
const VIDEO_ID = '1707599651172223'

let woUpdates: Record<string, unknown>[]

/** runPublishWorker 全链路 mock(领单→发布→落库→emit)。 */
function installWorkerMocks(priorRef: Record<string, unknown> | null = null) {
  woUpdates = []
  let claimed = false
  mockFrom.mockImplementation((table: string) => {
    const ctx = { select: '', isUpdate: false, payload: null as Record<string, unknown> | null }
    const resolve = (): { data: unknown; error: unknown } => {
      if (table === 'content_work_orders') {
        if (ctx.isUpdate) {
          woUpdates.push(ctx.payload ?? {})
          if (ctx.payload?.status === 'publishing') {
            return {
              data: {
                id: WO_ID, client_id: CLIENT_ID, master_brief_id: 'mb-1',
                publish_attempts: 0, published_ref: priorRef,
                output: {
                  video_path: 'renders/c/wo/final.mp4',
                  quality_checklist_auto: REEL_AUTO_CHECK_KEYS.map(key => ({ key, judge: 'AUTO', outcome: 'PASS', detail: 'measured', source_ref: null })),
                },
                review_ref: {
                  approved_at: '2026-10-20T00:00:00.000Z', // 切换日(2026-10-23)之前批准的旧版清单
                  checklist_human: REEL_HUMAN_CHECK_KEYS.map(key => ({
                    key, judge: 'HUMAN', outcome: 'PASS', detail: null,
                    source_ref: key.startsWith('factual_') ? 'https://example.test/source' : null,
                  })),
                },
                brief: { angle: 'China tour', copy: { endcard: { cta: 'Book your China tour', url: 'https://ctstours.co.nz' } } },
              },
              error: null,
            }
          }
          return { data: null, error: null }
        }
        if (claimed) return { data: null, error: null }
        claimed = true
        return { data: { id: WO_ID, status: 'approved' }, error: null }
      }
      if (table === 'clients') {
        return ctx.select.includes('brand_redline_phrases')
          ? { data: { brand_redline_phrases: [] }, error: null }
          : { data: { factory_config: { publish_target: { platform: 'facebook', page_id: PAGE_ID } } }, error: null }
      }
      if (table === 'master_briefs') {
        return ctx.select.includes('excluded_topics')
          ? { data: { excluded_topics: [] }, error: null }
          : { data: { brand_name: 'CTS Tours' }, error: null }
      }
      return { data: null, error: null }
    }
    const b: Record<string, unknown> = {}
    for (const m of ['eq', 'or', 'order', 'limit', 'maybeSingle', 'single', 'not']) b[m] = () => b
    b.select = (c?: string) => { ctx.select = c ?? ''; return b }
    b.update = (p: Record<string, unknown>) => { ctx.isUpdate = true; ctx.payload = p; return b }
    b.insert = () => b
    ;(b as { then: unknown }).then = (r: (v: { data: unknown; error: unknown }) => unknown) => r(resolve())
    return b as never
  })
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, headers: { get: (h: string) => (h === 'content-type' ? 'video/mp4' : '123456') },
  })))
}

const publishedRefUpdates = () =>
  woUpdates.filter((u) => 'published_ref' in u).map((u) => u.published_ref as Record<string, unknown>)

beforeEach(() => {
  vi.clearAllMocks()
  mockFindExisting.mockResolvedValue(null)
  mockSend.mockResolvedValue({ event_ids: ['evt_reel_1'] })
})

describe('发布信号 emit(只在真·PUBLISHED 喊)', () => {
  it('🔴 真·PUBLISHED Reel → emit 一次,事件 id/payload 正确,回执落回 published_ref.event_ids', async () => {
    installWorkerMocks()
    mockPublish.mockResolvedValue({
      platform: 'facebook', page_id: PAGE_ID, post_id: VIDEO_ID, video_id: VIDEO_ID,
      published_at: '2026-09-06T20:00:00.000Z', permalink: 'https://fb/r', video_state: 'PUBLISHED',
    } as never)

    const r = await runPublishWorker({ draft: false, workerId: 'test' })
    expect(r.result).toBe('published')

    expect(mockSend).toHaveBeenCalledTimes(1)
    const evt = mockSend.mock.calls[0][0] as { id: string; name: string; data: Record<string, unknown> }
    expect(evt.id).toBe(reelPublishedEventId(WO_ID, VIDEO_ID))
    expect(evt.name).toBe('me/factory.reel.published')
    expect(evt.data.page_id).toBe(PAGE_ID)
    expect(evt.data.video_id).toBe(VIDEO_ID)
    // 回执落回 published_ref.event_ids(补发对账靠它判断喊过没)
    const withEvents = publishedRefUpdates().find((ref) => Array.isArray(ref.event_ids))
    expect(withEvents?.event_ids).toEqual(['evt_reel_1'])
  })

  it('恢复已公开的 Reel 时，把 Graph 的 +0000 时间写成 Z 再发读数事件', async () => {
    installWorkerMocks({ provisional: true, platform: 'facebook', page_id: PAGE_ID, video_id: VIDEO_ID })
    mockFindExisting.mockResolvedValue({
      platform: 'facebook', page_id: PAGE_ID, post_id: VIDEO_ID, video_id: VIDEO_ID,
      published_at: '2026-10-18T00:00:00+0000', permalink: 'https://facebook.com/reel/1', video_state: 'PUBLISHED',
    } as never)

    const r = await runPublishWorker({ draft: false, workerId: 'test' })
    expect(r.result).toBe('published')
    expect(mockPublish).not.toHaveBeenCalled()
    expect(mockSend).toHaveBeenCalledTimes(1)
    const evt = mockSend.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(evt.data.published_at).toBe('2026-10-18T00:00:00.000Z')
    expect(FactoryReelPublishedEventSchema.safeParse(evt.data).success).toBe(true)
    const stored = publishedRefUpdates().find((ref) => ref.video_state === 'PUBLISHED')
    expect(stored?.published_at).toBe('2026-10-18T00:00:00.000Z')
  })

  it('🔴 草稿(video_state=DRAFT)→ 绝不 emit(草稿不可 promote 成广告)', async () => {
    installWorkerMocks()
    mockPublish.mockResolvedValue({
      platform: 'facebook', page_id: PAGE_ID, post_id: VIDEO_ID, video_id: VIDEO_ID,
      published_at: '2026-09-06T20:00:00.000Z', video_state: 'DRAFT',
    } as never)

    const r = await runPublishWorker({ draft: true, workerId: 'test' })
    expect(r.result).toBe('drafted')
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('emit 失败不阻塞发布(片已发出,best-effort)', async () => {
    installWorkerMocks()
    mockSend.mockRejectedValue(new Error('INNGEST_EVENT_KEY_MISSING'))
    mockPublish.mockResolvedValue({
      platform: 'facebook', page_id: PAGE_ID, post_id: VIDEO_ID, video_id: VIDEO_ID,
      published_at: '2026-09-06T20:00:00.000Z', video_state: 'PUBLISHED',
    } as never)

    const r = await runPublishWorker({ draft: false, workerId: 'test' })
    expect(r.result).toBe('published') // emit 炸了,发布照样算成功
  })
})

/** 补发对账用的独立 mock:content_work_orders 的 select 直接返回一批行。 */
function installReconcileMocks(rows: Array<Record<string, unknown>>) {
  woUpdates = []
  mockFrom.mockImplementation((table: string) => {
    const ctx = { isUpdate: false, payload: null as Record<string, unknown> | null }
    const resolve = (): { data: unknown; error: unknown } => {
      if (table === 'content_work_orders' && !ctx.isUpdate) return { data: rows, error: null }
      if (ctx.isUpdate) woUpdates.push(ctx.payload ?? {})
      return { data: null, error: null }
    }
    const b: Record<string, unknown> = {}
    for (const m of ['eq', 'order', 'limit', 'not', 'filter', 'maybeSingle', 'single']) b[m] = () => b
    b.select = () => b
    b.update = (p: Record<string, unknown>) => { ctx.isUpdate = true; ctx.payload = p; return b }
    ;(b as { then: unknown }).then = (r: (v: { data: unknown; error: unknown }) => unknown) => r(resolve())
    return b as never
  })
}

describe('补发对账(reconcileMissingReelEvents)', () => {
  it('🔴 已 PUBLISHED 但 event_ids 空 → 补喊', async () => {
    installReconcileMocks([
      { id: WO_ID, client_id: CLIENT_ID, published_ref: { platform: 'facebook', page_id: PAGE_ID, video_id: VIDEO_ID, post_id: VIDEO_ID, published_at: '2026-09-06T20:00:00.000Z', video_state: 'PUBLISHED' } },
    ])
    await reconcileMissingReelEvents()
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect((mockSend.mock.calls[0][0] as { id: string }).id).toBe(reelPublishedEventId(WO_ID, VIDEO_ID))
  })

  it('🔴 草稿绝不补喊', async () => {
    installReconcileMocks([
      { id: WO_ID, client_id: CLIENT_ID, published_ref: { platform: 'facebook', page_id: PAGE_ID, video_id: VIDEO_ID, post_id: VIDEO_ID, published_at: '2026-09-06T20:00:00.000Z', video_state: 'DRAFT' } },
    ])
    await reconcileMissingReelEvents()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('🔴 已喊过(event_ids 非空)不重发(不双发)', async () => {
    installReconcileMocks([
      { id: WO_ID, client_id: CLIENT_ID, published_ref: { platform: 'facebook', page_id: PAGE_ID, video_id: VIDEO_ID, post_id: VIDEO_ID, published_at: '2026-09-06T20:00:00.000Z', video_state: 'PUBLISHED', event_ids: ['evt_old'] } },
    ])
    await reconcileMissingReelEvents()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('video_state 来路不明(undefined,如 findExisting 补记)不补喊(宁可不喊)', async () => {
    installReconcileMocks([
      { id: WO_ID, client_id: CLIENT_ID, published_ref: { platform: 'facebook', page_id: PAGE_ID, video_id: VIDEO_ID, post_id: VIDEO_ID, published_at: '2026-09-06T20:00:00.000Z' } },
    ])
    await reconcileMissingReelEvents()
    expect(mockSend).not.toHaveBeenCalled()
  })
})
