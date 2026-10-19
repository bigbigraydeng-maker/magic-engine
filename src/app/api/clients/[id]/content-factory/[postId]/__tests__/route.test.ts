/**
 * PATCH /api/clients/[id]/content-factory/[postId] — 只测这次新加的 offer_key 行为
 * （2026-09-13：确认做片时可选带上「这条视频对应哪份资料包」，见
 * post-fields.ts::resolveOfferFacts 消费这个字段）。不重新覆盖这条路由原有的
 * confirm/reject/schedule 分支——那些不是这次改动碰的地方。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: mocks.requireAccess,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

const enqueueRenderJob = vi.fn()
vi.mock('@/lib/factory/render-queue', () => ({ enqueueRenderJob: (...a: unknown[]) => enqueueRenderJob(...a) }))

const sendInngestEvent = vi.fn()
vi.mock('@/lib/workflows/inngest-event', () => ({ sendInngestEvent: (...a: unknown[]) => sendInngestEvent(...a) }))

const checkTopicAlignment = vi.fn()
vi.mock('@/lib/factory/topic-alignment-store', () => ({ checkTopicAlignment: (...a: unknown[]) => checkTopicAlignment(...a) }))

import { PATCH } from '../route'

const CLIENT_ID = '377468af-b103-45f0-984a-b353febb56a1'
const POST_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

function makeReq(body: unknown) {
  return { json: async () => body } as never
}

/** 记录每次 update() 的 patch 内容，其余链式调用直接照抄这条路由真实调用顺序建假件。 */
function fakeSupabase(opts: {
  platforms?: string[]
  currentSnapshot?: Record<string, unknown> | null
  updatedRow?: Record<string, unknown> | null
  clientFactoryConfig?: unknown
  updates: Record<string, unknown>[]
}) {
  return {
    from(table: string) {
      if (table === 'content_posts') {
        return {
          select: (cols: string) => {
            // select 对应路由里的读：YouTube 选题闸预读 platforms / offer_key 合并前读（update().select() 走 update 分支）
            if (cols === 'platforms') {
              return { eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { platforms: opts.platforms ?? [] }, error: null }) }) }) }
            }
            if (cols === 'generation_context_snapshot') {
              // 双重限定：.eq('client_id',...).eq('id',...).single()，跟真实路由改动后的调用链一致。
              return { eq: () => ({ eq: () => ({ single: async () => ({ data: { generation_context_snapshot: opts.currentSnapshot ?? null }, error: null }) }) }) }
            }
            throw new Error(`unexpected select: ${cols}`)
          },
          update: (patch: Record<string, unknown>) => {
            opts.updates.push(patch)
            return {
              eq: () => ({
                eq: () => ({
                  select: () => ({ maybeSingle: async () => ({ data: opts.updatedRow ?? { id: POST_ID, status: 'approved', format: '短视频', source: null }, error: null }) }),
                }),
              }),
            }
          },
        }
      }
      if (table === 'clients') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { factory_config: opts.clientFactoryConfig ?? null } }) }) }) }
      }
      if (table === 'content_factory_render_jobs') {
        return { update: () => ({ eq: async () => ({ error: null }) }) }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAccess.mockResolvedValue({ ok: true })
  enqueueRenderJob.mockResolvedValue({ jobId: null, created: false })
  checkTopicAlignment.mockResolvedValue({ ready: true, gaps: [] })
})

describe('PATCH content-factory/[postId] — offer_key（2026-09-13 新增）', () => {
  it('confirm 不带 offer_key → patch 里没有 generation_context_snapshot，不去多读一次', async () => {
    const updates: Record<string, unknown>[] = []
    mocks.from.mockImplementation(fakeSupabase({ updates, clientFactoryConfig: { render: { engine: 'ffmpeg' } } }).from)

    await PATCH(makeReq({ action: 'confirm' }), { params: { id: CLIENT_ID, postId: POST_ID } })

    expect(updates).toEqual([{ status: 'approved' }])
  })

  it('confirm 带 offer_key，且这个 key 真的在客户配置的 offers 里 → 合并进 generation_context_snapshot，且保留已有的其它子 key（如 endcard）', async () => {
    const updates: Record<string, unknown>[] = []
    mocks.from.mockImplementation(
      fakeSupabase({
        updates,
        currentSnapshot: { endcard: { EndTour: 'Best of China' } },
        clientFactoryConfig: {
          render: {
            engine: 'ffmpeg',
            creatomate: {
              template_id: 't1',
              scene_field_map: [{ visual: 'V-1' }],
              offers: { best_of_china: { tour: 'Best of China' } },
            },
          },
        },
      }).from,
    )

    await PATCH(makeReq({ action: 'confirm', offer_key: 'best_of_china' }), { params: { id: CLIENT_ID, postId: POST_ID } })

    expect(updates).toEqual([
      { status: 'approved', generation_context_snapshot: { endcard: { EndTour: 'Best of China' }, offer_key: 'best_of_china' } },
    ])
  })

  // 2026-09-13 复审补测（魏征 a9a67fc1）：此前这里完全没校验 offer_key 是否真的存在于
  // 客户配置里，一个选了已删除/打错档位的视频会混进渲染队列，等 Inngest 任务几十秒后
  // 才默默失败——本该在确认这一刻就能发现。
  it('🔴 confirm 带的 offer_key 客户配置里根本没有这个档位 → 400 拦下，不写库、不排渲染任务', async () => {
    const updates: Record<string, unknown>[] = []
    mocks.from.mockImplementation(
      fakeSupabase({
        updates,
        clientFactoryConfig: {
          render: {
            engine: 'creatomate',
            creatomate: { template_id: 't1', scene_field_map: [{ visual: 'V-1' }], offers: { best_of_china: { tour: 'x' } } },
          },
        },
      }).from,
    )

    const res = await PATCH(makeReq({ action: 'confirm', offer_key: 'christmas_tour' }), { params: { id: CLIENT_ID, postId: POST_ID } })

    expect(res.status).toBe(400)
    expect(updates).toEqual([])
    expect(enqueueRenderJob).not.toHaveBeenCalled()
  })

  it('🔴 confirm 带 offer_key，但这个客户压根没配任何 offers → 同样 400 拦下（不是"没配就放行"）', async () => {
    const updates: Record<string, unknown>[] = []
    mocks.from.mockImplementation(fakeSupabase({ updates, clientFactoryConfig: { render: { engine: 'ffmpeg' } } }).from)

    const res = await PATCH(makeReq({ action: 'confirm', offer_key: 'best_of_china' }), { params: { id: CLIENT_ID, postId: POST_ID } })

    expect(res.status).toBe(400)
    expect(updates).toEqual([])
  })

  it('offer_key 只有空白字符 → 当没传，不写进 patch（防止把空字符串当成真实选择存下）', async () => {
    const updates: Record<string, unknown>[] = []
    mocks.from.mockImplementation(fakeSupabase({ updates, clientFactoryConfig: { render: { engine: 'ffmpeg' } } }).from)

    await PATCH(makeReq({ action: 'confirm', offer_key: '   ' }), { params: { id: CLIENT_ID, postId: POST_ID } })

    expect(updates).toEqual([{ status: 'approved' }])
  })

  it('reject 带 offer_key → 忽略（这个字段只在确认做片时有意义）', async () => {
    const updates: Record<string, unknown>[] = []
    mocks.from.mockImplementation(fakeSupabase({ updates }).from)

    await PATCH(makeReq({ action: 'reject', offer_key: 'best_of_china' }), { params: { id: CLIENT_ID, postId: POST_ID } })

    expect(updates).toEqual([{ status: 'rejected' }])
  })

  it('YouTube topic without cross-channel evidence is blocked before confirmation', async () => {
    const updates: Record<string, unknown>[] = []
    mocks.from.mockImplementation(fakeSupabase({ updates, platforms: ['youtube'] }).from)
    checkTopicAlignment.mockResolvedValue({ ready: false, gaps: ['官网页面未在近 7 天读回核对'] })

    const res = await PATCH(makeReq({ action: 'confirm' }), { params: { id: CLIENT_ID, postId: POST_ID } })

    expect(res.status).toBe(409)
    expect(updates).toEqual([])
    expect(checkTopicAlignment).toHaveBeenCalledWith(CLIENT_ID, POST_ID)
  })
})
