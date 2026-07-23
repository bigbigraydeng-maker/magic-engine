/**
 * publish-worker 发布正文红线闸测试(补 B10)。
 *
 * 为什么要做成集成测试而不是纯函数测试:这里要证明的不是「扫描函数会算对」,而是
 * 「扫描**真的被接进了发布路径**」。把闸拆成纯函数单测,恰恰证明不了它有没有被调用 ——
 * 而「有实现、没接上」正是这个 bug 本身的形态(红线扫描一直存在于交付环节,却从未
 * 覆盖真正发出去的那串文案)。
 *
 * 关键事实:交付时扫的是 output.caption + 分镜文字;发布时发的是 buildCaption() 从
 * brief.copy.endcard 另拼的字。两串不是同一个东西。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('./facebook-reel-adapter', () => ({
  facebookReelAdapter: {
    publish: vi.fn(),
    findExisting: vi.fn(async () => null),
  },
}))

import { runPublishWorker } from './publish-worker'
import { supabaseAdmin } from '@/lib/supabase'
import { facebookReelAdapter } from './facebook-reel-adapter'

const mockFrom = vi.mocked(supabaseAdmin.from)
const mockPublish = vi.mocked(facebookReelAdapter.publish)
const mockFindExisting = vi.mocked(facebookReelAdapter.findExisting)

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const WO_ID = 'wo-publish-1'

interface Scenario {
  redlines: string[]
  excludedTopics?: string[]
  endcard: Record<string, unknown>
  /** 模拟红线查询失败(fail-closed 用例) */
  redlineQueryError?: boolean
}

/** 记录所有对 content_work_orders 的 update payload,用来断言最终状态 */
let woUpdates: Record<string, unknown>[]

function installMocks(s: Scenario) {
  woUpdates = []
  let claimed = false

  mockFrom.mockImplementation((table: string) => {
    const ctx: { select: string; isUpdate: boolean; payload: Record<string, unknown> | null } = {
      select: '', isUpdate: false, payload: null,
    }

    const resolve = (): { data: unknown; error: unknown } => {
      if (table === 'content_work_orders') {
        if (ctx.isUpdate) {
          woUpdates.push(ctx.payload ?? {})
          // claimOne 的条件 UPDATE:返回领到的工单整行
          if (ctx.payload?.status === 'publishing') {
            return {
              data: {
                id: WO_ID,
                client_id: CLIENT_ID,
                master_brief_id: 'mb-1',
                publish_attempts: 0,
                published_ref: null,
                output: { video_path: 'renders/c/wo/final.mp4' },
                brief: { angle: 'X', copy: { endcard: s.endcard } },
              },
              error: null,
            }
          }
          return { data: null, error: null }
        }
        // claimOne 的候选查询:只给一次,避免无限领
        if (claimed) return { data: null, error: null }
        claimed = true
        return { data: { id: WO_ID, status: 'approved' }, error: null }
      }

      if (table === 'clients') {
        if (ctx.select.includes('brand_redline_phrases')) {
          return s.redlineQueryError
            ? { data: null, error: { message: 'boom' } }
            : { data: { brand_redline_phrases: s.redlines }, error: null }
        }
        return {
          data: { factory_config: { publish_target: { platform: 'facebook', page_id: '1616575215312482' } } },
          error: null,
        }
      }

      if (table === 'master_briefs') {
        return ctx.select.includes('excluded_topics')
          ? { data: { excluded_topics: s.excludedTopics ?? [] }, error: null }
          : { data: { brand_name: 'CTS Tours' }, error: null }
      }

      return { data: null, error: null } // 三落库等
    }

    const builder: Record<string, unknown> = {}
    for (const m of ['eq', 'or', 'order', 'limit', 'maybeSingle', 'single']) builder[m] = () => builder
    builder.select = (cols?: string) => { ctx.select = cols ?? ''; return builder }
    builder.update = (p: Record<string, unknown>) => { ctx.isUpdate = true; ctx.payload = p; return builder }
    builder.insert = () => builder
    ;(builder as { then: unknown }).then = (r: (v: { data: unknown; error: unknown }) => unknown) => r(resolve())
    return builder as never
  })

  // 视频 URL HEAD 校验
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    headers: { get: (h: string) => (h === 'content-type' ? 'video/mp4' : '123456') },
  })))
}

const run = () => runPublishWorker({ draft: true, workerId: 'test' })
const finalStatus = () => woUpdates.filter((u) => 'status' in u).at(-1)

beforeEach(() => {
  vi.clearAllMocks()
  mockFindExisting.mockResolvedValue(null)
  mockPublish.mockResolvedValue({ platform: 'facebook', post_id: 'p1', permalink: 'https://fb/p1' } as never)
})

describe('发布正文红线闸', () => {
  it('🔴 发布正文命中红线 → 不发布', async () => {
    installMocks({ redlines: ['affordable'], endcard: { cta: 'Affordable floors, call today', url: 'https://x.test' } })
    const r = await run()

    expect(mockPublish).not.toHaveBeenCalled()
    expect(r.result).toBe('failed')
    expect(r.detail).toBe('redline_hit')
  })

  it('🔴 命中后置终态,不排重试(重试只会每轮重扫同一串文案)', async () => {
    installMocks({ redlines: ['affordable'], endcard: { cta: 'Affordable floors', url: 'https://x.test' } })
    await run()

    const last = finalStatus()!
    expect(last.status).toBe('publish_failed')
    expect(last.next_retry_at).toBeNull()
  })

  it('🔴 红线只在发布正文里、不在交付文案里,照样拦得住(两串字本就不同)', async () => {
    // 交付时扫的是 output.caption —— 这里刻意让它干净,红线只藏在 endcard.offer 里
    installMocks({ redlines: ['$35.50'], endcard: { cta: 'Shop now', offer: ['Clearance from $35.50/m²'], url: 'https://x.test' } })
    const r = await run()

    expect(mockPublish).not.toHaveBeenCalled()
    expect(r.detail).toBe('redline_hit')
  })

  it('brief 的排除话题同样生效', async () => {
    installMocks({ redlines: [], excludedTopics: ['competitor tiles'], endcard: { cta: 'Better than competitor tiles', url: 'https://x.test' } })
    expect((await run()).detail).toBe('redline_hit')
  })

  it('🔴 红线查询失败 → 保守不发(fail-closed:查不到 ≠ 没有)', async () => {
    installMocks({ redlines: [], endcard: { cta: 'Totally clean copy', url: 'https://x.test' }, redlineQueryError: true })
    const r = await run()

    expect(mockPublish).not.toHaveBeenCalled()
    expect(r.result).toBe('failed')
  })

  it('干净文案 → 正常发布(闸不误伤)', async () => {
    installMocks({ redlines: ['affordable', '$35.50'], endcard: { cta: 'Book your China tour', url: 'https://ctstours.co.nz' } })
    const r = await run()

    expect(mockPublish).toHaveBeenCalledTimes(1)
    expect(r.result).toBe('published')
    expect(finalStatus()!.status).toBe('published')
  })

  it('发布正文由 cta + offer + url 拼成(确认扫的就是真发出去的那串)', async () => {
    installMocks({ redlines: [], endcard: { cta: 'Book now', offer: ['Save 20%', 'Ends Friday'], url: 'https://ctstours.co.nz' } })
    await run()

    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({ caption: 'Book now\nSave 20% · Ends Friday\nhttps://ctstours.co.nz' }),
    )
  })
})
