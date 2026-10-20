/**
 * publish-worker 发布正文红线闸测试(补 B10)。
 *
 * 为什么要做成集成测试而不是纯函数测试:这里要证明的不是「扫描函数会算对」,而是
 * 「扫描**真的被接进了发布路径**」。把闸拆成纯函数单测,恰恰证明不了它有没有被调用 ——
 * 而「有实现、没接上」正是这个 bug 本身的形态(红线扫描一直存在于交付环节,却从未
 * 覆盖真正发出去的那串文案)。
 *
 * 发布正文取分镜文案;CTA 与带追踪参数的落地页链接必须放在首评。
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
import { REEL_AUTO_CHECK_KEYS, REEL_HUMAN_CHECK_KEYS } from '@/lib/social/content-review'

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
  checklistReady?: boolean
  noAngle?: boolean
  /** 上次上传到一半崩了:留着 provisional 回执 */
  interrupted?: boolean
  /** brief.remotion.deliverable 取值;'asset_only' = 素材,绝不可发布 */
  deliverable?: string
  /** review_ref.checklist_version(防降级用例:带 v3 版本号但清单是旧的) */
  checklistVersion?: string
  /** review_ref.approved_at(切换日用例) */
  approvedAt?: string
}

/** 记录所有对 content_work_orders 的 update payload,用来断言最终状态 */
let woUpdates: Record<string, unknown>[]
/** 记录所有 insert payload,用来断言三落库内容 */
let inserts: { table: string; payload: Record<string, unknown> }[]

function installMocks(s: Scenario) {
  woUpdates = []
  inserts = []
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
              published_ref: s.interrupted ? { provisional: true, video_id: 'v1' } : null,
                review_ref: s.checklistReady === false ? {} : { ...(s.checklistVersion === undefined ? {} : { checklist_version: s.checklistVersion }), ...(s.approvedAt === undefined ? {} : { approved_at: s.approvedAt }), checklist_human: REEL_HUMAN_CHECK_KEYS.map(key => ({
                  key, judge: 'HUMAN', outcome: 'PASS', detail: null,
                  source_ref: key.startsWith('factual_') ? 'https://example.test/source' : null,
                })) },
                output: {
                  video_path: 'renders/c/wo/final.mp4',
                  ...(s.checklistReady === false ? {} : {
                    quality_checklist_auto: REEL_AUTO_CHECK_KEYS.map(key => ({ key, judge: 'AUTO', outcome: 'PASS', detail: 'measured', source_ref: null })),
                  }),
                },
                brief: { ...(s.noAngle ? {} : { angle: 'X' }), ...(s.deliverable === undefined ? {} : { remotion: { deliverable: s.deliverable } }), copy: { segments: [{ caption: 'Explore with us' }], endcard: s.endcard } },
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
    builder.insert = (p: Record<string, unknown>) => { inserts.push({ table, payload: p }); return builder }
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

  it('legacy approved row without checklist is quarantined before provider access', async () => {
    installMocks({ redlines: [], endcard: { cta: 'Book now', url: 'https://ctstours.co.nz' }, checklistReady: false })
    const r = await run()

    expect(mockPublish).not.toHaveBeenCalled()
    expect(r.detail).toBe('approval_checklist_incomplete')
    expect(finalStatus()).toMatchObject({ status: 'publish_failed', next_retry_at: null })
  })

  it('🔴 asset_only 素材即使被置成 approved 也不发布,且置终态不排重试', async () => {
    installMocks({ redlines: [], endcard: { cta: 'Book now', url: 'https://ctstours.co.nz' }, deliverable: 'asset_only' })
    const r = await run()

    expect(mockPublish).not.toHaveBeenCalled()
    expect(r.detail).toBe('asset_only_not_publishable')
    expect(finalStatus()).toMatchObject({ status: 'publish_failed', next_retry_at: null })
  })

  it('deliverable 拼错不当素材放行,也不当素材拦截(按成片正常发布)', async () => {
    installMocks({ redlines: [], endcard: { cta: 'Book now', url: 'https://ctstours.co.nz/x?utm_source=a' }, deliverable: 'asset-only' })
    await run()

    expect(mockPublish).toHaveBeenCalled()
  })

  it('🔴 防降级:带 v3 版本号的批准回执缺「单独看得懂」一项 → 不发布，置终态', async () => {
    installMocks({ redlines: [], endcard: { cta: 'Book now', url: 'https://ctstours.co.nz' }, checklistVersion: 'v3' })
    const r = await run()

    expect(mockPublish).not.toHaveBeenCalled()
    expect(r.detail).toBe('approval_checklist_incomplete')
    expect(finalStatus()).toMatchObject({ status: 'publish_failed', next_retry_at: null })
  })

  it('🔴 切换日之后批准但没有版本号的（旧形状）回执 → 不发布；切换日之前批准的旧回执照常发布', async () => {
    installMocks({ redlines: [], endcard: { cta: 'Book now', url: 'https://ctstours.co.nz/x?utm_source=a' }, approvedAt: '2026-10-23T00:00:01.000Z' })
    const late = await run()
    expect(mockPublish).not.toHaveBeenCalled()
    expect(late.detail).toBe('approval_checklist_incomplete')

    vi.clearAllMocks()
    mockFindExisting.mockResolvedValue(null)
    mockPublish.mockResolvedValue({ platform: 'facebook', post_id: 'p1', permalink: 'https://fb/p1' } as never)
    installMocks({ redlines: [], endcard: { cta: 'Book now', url: 'https://ctstours.co.nz/x?utm_source=a' }, approvedAt: '2026-10-22T23:59:59.000Z' })
    await run()
    expect(mockPublish).toHaveBeenCalled()
  })

  it('正文使用分镜文案,CTA 与追踪链接放首评', async () => {
    installMocks({ redlines: [], endcard: { cta: 'Book now', offer: ['Save 20%', 'Ends Friday'], url: 'https://ctstours.co.nz' } })
    await run()

    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        caption: 'Explore with us',
        firstComment: expect.stringContaining('Book now\nSave 20% · Ends Friday\nhttps://ctstours.co.nz/?utm_source=facebook&utm_medium=organic_social'),
      }),
    )
  })
})

describe('发布记录与失败原因', () => {
  it('publish failure writes a token-free reject_reason', async () => {
    installMocks({ redlines: [], endcard: { cta: 'Book now', url: 'https://ctstours.co.nz' } })
    mockPublish.mockRejectedValueOnce(new Error('FB upload 失败 400: access_token=EAAfaketokenfaketokenfaketoken1234 https://graph.facebook.com/x'))
    await run()

    const last = finalStatus()!
    expect(last.status).toBe('publish_failed')
    expect(typeof last.reject_reason).toBe('string')
    expect(String(last.reject_reason)).toContain('FB upload 失败 400')
    expect(String(last.reject_reason)).not.toContain('EAAfake')
    expect(String(last.reject_reason)).not.toContain('graph.facebook.com')
  })

  it('a successful publish clears the old reason and labels the vendor by channel, not customer', async () => {
    installMocks({ redlines: [], endcard: { cta: 'Book now', url: 'https://ctstours.co.nz' } })
    await run()

    expect(finalStatus()).toMatchObject({ status: 'published', reject_reason: null })
    const fw = inserts.find((i) => i.table === 'flywheel_actions')
    expect(fw?.payload.vendor).toBe('meta_graph')
    expect(JSON.stringify(inserts)).not.toContain('oztop')
  })

  it('title falls back to the brand name, never the placeholder "factory reel"', async () => {
    installMocks({ redlines: [], endcard: { cta: 'Book now', url: 'https://ctstours.co.nz' }, noAngle: true })
    await run()

    const ex = inserts.find((i) => i.table === 'execution_items')
    expect(String(ex?.payload.title)).toContain('CTS Tours')
    expect(String(ex?.payload.title)).not.toContain('factory reel')
  })

  it('interrupted upload is not re-sent and tells the PM to check manually', async () => {
    installMocks({ redlines: [], endcard: { cta: 'Book now', url: 'https://ctstours.co.nz' }, interrupted: true })
    const r = await run()

    expect(mockPublish).not.toHaveBeenCalled()
    expect(r.detail).toBe('interrupted_verify_manual')
    expect(String(finalStatus()!.reject_reason)).toContain('中断')
  })
})
