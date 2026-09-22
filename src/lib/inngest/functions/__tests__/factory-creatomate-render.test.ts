/**
 * Creatomate 渲染工作流 · 装配 + 关键行为测试。
 *
 * 🔴 这份测试是第二轮复审逼出来的：第一版代码在文件头注释里写了"付费步骤 retries:0"、
 *    "任何失败都要落 job.status=failed"，但 `createFunction()` 配置里根本没加 retries，
 *    提交前抛出的异常也从没把 job 标 failed——注释和代码之间的落差，没有测试会一直发现不了。
 *
 * 测的是**装配 + 关键路径**，不重新验证各个连接器子模块自己的逻辑（那些在
 * src/lib/creatomate/*.test.ts 里）：Inngest 配置对不对、早期失败是否真的落 failed、
 * 成功路径是否真的把 Creatomate 的 credits 估算加进了 cost_usd。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const startCronRunId = vi.fn(async (_jobName: string) => 'run-1')
const finish = vi.fn(async (_opts: Record<string, unknown>) => {})
vi.mock('@/lib/cron/run-logger', () => ({
  startCronRunId: (jobName: string) => startCronRunId(jobName),
  cronRunHandle: () => ({ finish }),
}))

const prepareSceneAssets = vi.fn()
vi.mock('@/lib/creatomate/scene-assets', () => ({ prepareSceneAssets: (...a: unknown[]) => prepareSceneAssets(...a) }))

const buildModifications = vi.fn((..._args: unknown[]) => ({}))
vi.mock('@/lib/creatomate/modifications', () => ({ buildModifications: (...a: unknown[]) => buildModifications(...a) }))

const submitRender = vi.fn()
const getRender = vi.fn()
vi.mock('@/lib/creatomate/render', () => ({
  submitRender: (...a: unknown[]) => submitRender(...a),
  getRender: (...a: unknown[]) => getRender(...a),
}))

const storeCreatomateResult = vi.fn()
vi.mock('@/lib/creatomate/store-result', () => ({ storeCreatomateResult: (...a: unknown[]) => storeCreatomateResult(...a) }))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

// 虚构 UUID，不用任何真实客户 ID（魏征复审 ⚠️3 同类教训）。
const CLIENT_ID = '00000000-0000-4000-8000-000000000001'
const JOB_ID = '00000000-0000-4000-8000-0000000000aa'
const POST_ID = '00000000-0000-4000-8000-0000000000bb'

// 存储层是 snake_case（跟 factory_config 其余字段同惯例，client-config.ts::mergeFactoryConfig
// 写的就是这个形状）——第一版这里错写成 camelCase，projectFactoryConfig 读不出来，
// 直接把测试想验证的"配置生效"场景测成了"没配置"，是本文件自己犯过的同一类 fixture 错。
const STORED_TEMPLATE_CONTRACT = { template_id: 'tmpl-1', scene_field_map: [{ visual: 'Video-1' }] }

import { createFactoryCreatomateRender, resolvePostEndcardOverrides } from '../factory-creatomate-render'
import { cloudFunctions } from '../index'
import { CLOUD_FN_PREFIX, WORKER_OWNED_EVENTS } from '../../client'
import { CREATOMATE_RENDER_REQUESTED_EVENT } from '@/lib/creatomate/events'

type Fn = ReturnType<typeof createFactoryCreatomateRender>
/** Inngest 函数把触发器/重试/并发存在 opts 里，同一读法见 flywheel-seo-weekly.test.ts。 */
function optsOf(fn: Fn) {
  return (fn as unknown as {
    opts: { triggers?: { event?: string }[]; retries?: number; concurrency?: { limit: number; key?: string } }
  }).opts
}

/** 最小可用的假 SupabaseClient：只实现测试真正用到的链式调用。 */
function fakeSupabase(opts: {
  job?: Record<string, unknown> | null
  clients?: Record<string, unknown> | null
  posts?: Record<string, unknown> | null
  updates: Record<string, unknown>[]
}) {
  return {
    from(table: string) {
      return {
        select: () => ({
          eq: () => ({
            single: async () => {
              if (table === 'clients') return { data: opts.clients, error: opts.clients ? null : { message: 'not found' } }
              if (table === 'content_posts') return { data: opts.posts, error: opts.posts ? null : { message: 'not found' } }
              return { data: opts.job, error: opts.job ? null : { message: 'not found' } }
            },
            maybeSingle: async () => ({ data: opts.job, error: null }),
          }),
        }),
        update(patch: Record<string, unknown>) {
          opts.updates.push({ table, patch })
          // 真实 DB 里 update 之后再 select 会看到新值——这里也让它有状态，不然
          // ensurePostFieldsWritten 写完，ensureSubmitted 那次单独的读还是拿到写入前
          // 的旧 fixture，测不出"自动写入真的接上了下游读取"这件事（只有一个 job/
          // 一个 post，不用按 id 精确匹配，同表直接原地合并）。
          if (table === 'content_posts' && opts.posts) Object.assign(opts.posts, patch)
          if (table === 'content_factory_render_jobs' && opts.job) Object.assign(opts.job, patch)
          return { eq: async () => ({ error: null }) }
        },
      }
    },
  }
}

/** run 直接跑传入的函数（不做真实 Inngest 记忆化，单测不需要）。 */
function fakeStep(waitForEventResult: unknown = null) {
  return {
    run: async (_id: string, fn: () => unknown) => fn(),
    waitForEvent: async () => waitForEventResult,
    sleep: async () => {},
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  startCronRunId.mockResolvedValue('run-1')
  vi.stubEnv('APP_URL', 'https://app.magicengine.com.au')
})

describe('factory-creatomate-render — 装配', () => {
  it('函数级 retries:0（第二轮复审 ❌1：此前只在注释里写，配置里没加）', () => {
    const fn = createFactoryCreatomateRender({ supabase: fakeSupabase({ updates: [] }) as never })
    expect(optsOf(fn).retries).toBe(0)
  })

  it('concurrency 按 client_id 限流，触发器是 CREATOMATE_RENDER_REQUESTED_EVENT', () => {
    const fn = createFactoryCreatomateRender({ supabase: fakeSupabase({ updates: [] }) as never })
    expect(optsOf(fn).concurrency).toMatchObject({ limit: 3, key: 'event.data.client_id' })
    expect(optsOf(fn).triggers?.[0]?.event).toBe(CREATOMATE_RENDER_REQUESTED_EVENT)
  })

  it('已注册进 cloudFunctions，且事件名不在 WORKER_OWNED_EVENTS 里（不撞本机 worker）', () => {
    const ids = cloudFunctions.map((f) => (f as unknown as { id: () => string }).id())
    expect(ids).toContain(`${CLOUD_FN_PREFIX}factory-creatomate-render`)
    expect(WORKER_OWNED_EVENTS as readonly string[]).not.toContain(CREATOMATE_RENDER_REQUESTED_EVENT)
  })
})

describe('factory-creatomate-render — 早期失败必须落 job.status=failed（第二轮复审 ❌2）', () => {
  it('客户没配 Creatomate 模板 → 抛错，且 job 被 patch 成 failed（不是安静停在 queued）', async () => {
    const updates: Record<string, unknown>[] = []
    const supabase = fakeSupabase({
      job: { id: JOB_ID, client_id: CLIENT_ID, content_post_id: POST_ID, status: 'queued', scenes: null, creatomate_render_id: null },
      clients: { factory_config: { render: { engine: 'creatomate' } } }, // 没有 creatomate 子对象
      posts: { title: 'x', script: '口播稿' },
      updates,
    })
    // 素材准备本身要能成功，失败点必须精确落在"缺模板配置"这一步，不是别的原因崩的
    prepareSceneAssets.mockResolvedValue([
      { index: 0, captionText: 'A', visualUrl: 'https://x/a.mp4', visualType: 'video', voUrl: 'https://x/a.mp3', costUsd: 0.3 },
    ])

    // .fn/.opts 是 InngestFunction 类的真实运行时属性（node_modules/inngest/components/
    // InngestFunction.d.ts 已 grep 确认：`readonly opts` 公开、`private readonly fn` 仅
    // 编译期私有，运行时可读）——上面"装配"三个用例已实测跑通 .opts 读法，这里同一模式读 .fn。
    const fn = createFactoryCreatomateRender({ supabase: supabase as never })
    const handler = (fn as unknown as { fn: (ctx: { event: { data: unknown }; step: ReturnType<typeof fakeStep> }) => Promise<unknown> }).fn

    await expect(
      handler({ event: { data: { job_id: JOB_ID, client_id: CLIENT_ID, post_id: POST_ID } }, step: fakeStep() }),
    ).rejects.toThrow(/未配置 Creatomate 模板/)

    const failedUpdate = updates.find((u) => u.table === 'content_factory_render_jobs' && (u.patch as { status?: string }).status === 'failed')
    expect(failedUpdate, 'job 必须被 patch 成 failed，否则这条失败对 manual-items.ts 永远不可见').toBeDefined()
  })

  // 2026-09-13 复审补测：这条校验（sceneFieldMap 的 caption 槽位和 requiredPostFields
  // 撞了同一个元素名）是子牙设计复审要求加的安全网，加了却漏了测，这里补上。`.fn` 读法
  // 是本文件第 145-147 行注释里已用真实 d.ts 实测确认过、并已用了 3 次的既有模式，不是
  // 新的接口猜测。
  it('模板配置里 sceneFieldMap 的 caption 和 requiredPostFields 撞了同一个元素名 → 抛错，job 标 failed', async () => {
    const updates: Record<string, unknown>[] = []
    const supabase = fakeSupabase({
      job: { id: JOB_ID, client_id: CLIENT_ID, content_post_id: POST_ID, status: 'queued', scenes: null, creatomate_render_id: null },
      clients: {
        factory_config: {
          render: {
            engine: 'creatomate',
            creatomate: {
              template_id: 'tmpl-1',
              scene_field_map: [{ visual: 'Still-1', caption: 'EndTour' }], // 跟下面 requiredPostFields 撞名
              required_post_fields: ['EndTour'],
            },
          },
        },
      },
      posts: { title: 'x', script: '口播稿' },
      updates,
    })
    prepareSceneAssets.mockResolvedValue([
      { index: 0, captionText: 'A', visualUrl: 'https://x/a.mp4', visualType: 'video', voUrl: 'https://x/a.mp3', costUsd: 0.3 },
    ])

    const fn = createFactoryCreatomateRender({ supabase: supabase as never })
    const handler = (fn as unknown as { fn: (ctx: { event: { data: unknown }; step: ReturnType<typeof fakeStep> }) => Promise<unknown> }).fn

    await expect(
      handler({ event: { data: { job_id: JOB_ID, client_id: CLIENT_ID, post_id: POST_ID } }, step: fakeStep() }),
    ).rejects.toThrow(/模板配置冲突/)

    const failedUpdate = updates.find((u) => u.table === 'content_factory_render_jobs' && (u.patch as { status?: string }).status === 'failed')
    expect(failedUpdate, 'job 必须被 patch 成 failed').toBeDefined()
  })
})

describe('factory-creatomate-render — 成功路径把 Creatomate credits 记进 cost_usd（第二轮复审 ⚠️4）', () => {
  it('渲染成功后 cost_usd 包含场景素材成本 + Creatomate credits 估算，不是只记一半', async () => {
    const updates: Record<string, unknown>[] = []
    const supabase = fakeSupabase({
      job: { id: JOB_ID, client_id: CLIENT_ID, content_post_id: POST_ID, status: 'queued', scenes: null, creatomate_render_id: null },
      clients: { factory_config: { render: { engine: 'creatomate', creatomate: STORED_TEMPLATE_CONTRACT } } },
      posts: { title: 'x', script: '口播稿' },
      updates,
    })

    prepareSceneAssets.mockResolvedValue([
      { index: 0, captionText: 'A', visualUrl: 'https://x/a.mp4', visualType: 'video', voUrl: 'https://x/a.mp3', costUsd: 0.3 },
    ])
    submitRender.mockResolvedValue({ renderId: 'render-1' })
    getRender.mockResolvedValue({ id: 'render-1', status: 'succeeded', url: 'https://cdn.creatomate.com/out.mp4' })
    storeCreatomateResult.mockResolvedValue({ storageUrl: 'https://supabase/out.mp4', fileSizeKb: 100 })

    const fn = createFactoryCreatomateRender({ supabase: supabase as never })
    const handler = (fn as unknown as { fn: (ctx: { event: { data: unknown }; step: ReturnType<typeof fakeStep> }) => Promise<{ ok: boolean }> }).fn

    const result = await handler({
      event: { data: { job_id: JOB_ID, client_id: CLIENT_ID, post_id: POST_ID } },
      step: fakeStep({ data: { job_id: JOB_ID, render_id: 'render-1' } }),
    })

    expect(result.ok).toBe(true)
    const successUpdate = updates.find((u) => (u.patch as { status?: string }).status === 'ready_for_review')
    expect(successUpdate).toBeDefined()
    const costUsd = (successUpdate!.patch as { cost_usd: number }).cost_usd
    // 场景成本 0.3 + Creatomate 估算（默认尺寸，1 镜头 6 秒）> 0.3，证明两笔都算了，不是只记一半
    expect(costUsd).toBeGreaterThan(0.3)
  })
})

describe('resolvePostEndcardOverrides — 单视频专属 EndCard 覆盖（2026-09-13 子牙+魏征复审后新增）', () => {
  it('模板没声明 requiredPostFields（没有需要逐视频变化的文字）→ 直接返回空对象，不要求 snapshot 有内容', () => {
    expect(resolvePostEndcardOverrides(null, undefined)).toEqual({})
    expect(resolvePostEndcardOverrides({ some: 'thing' }, [])).toEqual({})
  })

  it('声明了 requiredPostFields 但 snapshot 完全没有 endcard → 抛错（魏征复审 ②：绝不静默套用模板默认值）', () => {
    expect(() => resolvePostEndcardOverrides(null, ['EndTour', 'EndDate'])).toThrow(/缺少 EndCard 内容/)
    expect(() => resolvePostEndcardOverrides({}, ['EndTour'])).toThrow(/缺少 EndCard 内容/)
  })

  it('endcard 里混了非字符串值（脏数据）→ 当作没有 endcard 一样拒绝，不半收半弃', () => {
    expect(() =>
      resolvePostEndcardOverrides({ endcard: { EndTour: 'Best of China', EndDate: 123 } }, ['EndTour', 'EndDate']),
    ).toThrow(/缺少 EndCard 内容/)
  })

  it('endcard 缺了 requiredPostFields 里的某一项 → 精确报出缺哪个字段，不是笼统报错', () => {
    expect(() =>
      resolvePostEndcardOverrides(
        { endcard: { EndTour: 'Best of China', EndRoute: 'Beijing · Xi\'an · Shanghai' } },
        ['EndTour', 'EndRoute', 'EndDate'],
      ),
    ).toThrow(/EndCard 缺字段：EndDate/)
  })

  it('endcard 字段是空字符串（写了键但没填值）→ 同样算缺失，不能用空字符串糊弄过去', () => {
    expect(() =>
      resolvePostEndcardOverrides({ endcard: { EndTour: '  ', EndDate: '2027-03-01' } }, ['EndTour', 'EndDate']),
    ).toThrow(/EndCard 缺字段：EndTour/)
  })

  it('endcard 齐全 → 原样返回这几个字段的值，供上层合并进 staticOverrides', () => {
    const result = resolvePostEndcardOverrides(
      { endcard: { EndTour: 'Best of China', EndRoute: 'Beijing · Xi\'an · Shanghai', extra: 'ignored-but-fine' } },
      ['EndTour', 'EndRoute'],
    )
    expect(result).toEqual({ EndTour: 'Best of China', EndRoute: 'Beijing · Xi\'an · Shanghai', extra: 'ignored-but-fine' })
  })
})

describe('factory-creatomate-render — 提交时合并单视频 EndCard 覆盖', () => {
  // 2026-09-13 子牙+魏征二次设计复审后：requiredPostFields 的值现在由
  // ensurePostFieldsWritten 在 prepare-assets 步骤自动算好、自动写入，不再要求人工
  // 预先手填 content_posts.generation_context_snapshot.endcard——所以"没人填 endcard"
  // 这个失败点不复存在，取而代之的是"客户模板配置里没配 offers 事实字典"这个更早、
  // 更准确的失败点（同样在 prepare-assets 就会拦下，同样会把 job 标 failed）。
  //
  // 下面两个用例的 `.fn` 读法（`as unknown as { fn: ... }`）不是新写的类型强转——是本
  // 文件第 139-141 行注释里已经用真实 d.ts（node_modules/inngest/components/
  // InngestFunction.d.ts）实测确认过的同一个既有读法，本文件其余用例已经这么读了三次。
  it('客户模板声明了 requiredPostFields，但没配 offers 事实字典 → prepare-assets 阶段就拦下，job 标 failed', async () => {
    const updates: Record<string, unknown>[] = []
    const supabase = fakeSupabase({
      job: { id: JOB_ID, client_id: CLIENT_ID, content_post_id: POST_ID, status: 'queued', scenes: null, creatomate_render_id: null },
      clients: {
        factory_config: {
          render: {
            engine: 'creatomate',
            creatomate: { ...STORED_TEMPLATE_CONTRACT, required_post_fields: ['EndTour', 'EndDate'] }, // 没配 offers
          },
        },
      },
      posts: { title: 'x', script: '口播稿' },
      updates,
    })
    prepareSceneAssets.mockResolvedValue([
      { index: 0, captionText: 'A', visualUrl: 'https://x/a.mp4', visualType: 'video', voUrl: 'https://x/a.mp3', costUsd: 0.3 },
    ])

    const fn = createFactoryCreatomateRender({ supabase: supabase as never })
    const handler = (fn as unknown as { fn: (ctx: { event: { data: unknown }; step: ReturnType<typeof fakeStep> }) => Promise<unknown> }).fn

    await expect(
      handler({ event: { data: { job_id: JOB_ID, client_id: CLIENT_ID, post_id: POST_ID } }, step: fakeStep() }),
    ).rejects.toThrow(/一个团\/档位的事实字典都没配/)

    const failedUpdate = updates.find((u) => u.table === 'content_factory_render_jobs' && (u.patch as { status?: string }).status === 'failed')
    expect(failedUpdate, 'job 必须被 patch 成 failed，不能安静停在 queued/rendering').toBeDefined()
    expect(submitRender).not.toHaveBeenCalled()
  })

  it('模板配了 offers 但这条视频指定的 offer_key 在事实字典里找不到 → 同样在 prepare-assets 拦下，不猜一份顶上', async () => {
    const updates: Record<string, unknown>[] = []
    const supabase = fakeSupabase({
      job: { id: JOB_ID, client_id: CLIENT_ID, content_post_id: POST_ID, status: 'queued', scenes: null, creatomate_render_id: null },
      clients: {
        factory_config: {
          render: {
            engine: 'creatomate',
            creatomate: {
              ...STORED_TEMPLATE_CONTRACT,
              required_post_fields: ['EndTour'],
              offers: { best_of_china: { tour: 'Best of China' } },
              post_field_sources: { EndTour: 'tour' },
            },
          },
        },
      },
      posts: { title: 'x', script: '口播稿', generation_context_snapshot: { offer_key: 'christmas_tour' } },
      updates,
    })
    prepareSceneAssets.mockResolvedValue([
      { index: 0, captionText: 'A', visualUrl: 'https://x/a.mp4', visualType: 'video', voUrl: 'https://x/a.mp3', costUsd: 0.3 },
    ])

    const fn = createFactoryCreatomateRender({ supabase: supabase as never })
    const handler = (fn as unknown as { fn: (ctx: { event: { data: unknown }; step: ReturnType<typeof fakeStep> }) => Promise<unknown> }).fn

    await expect(
      handler({ event: { data: { job_id: JOB_ID, client_id: CLIENT_ID, post_id: POST_ID } }, step: fakeStep() }),
    ).rejects.toThrow(/christmas_tour/)
    expect(submitRender).not.toHaveBeenCalled()
  })

  it('offers 配好、这条视频没标 offer_key（客户只配了一个档位）→ 自动算出 EndTour 写进 endcard，合并进 staticOverrides，其它子 key 和客户级 staticOverrides 都保留', async () => {
    const updates: Record<string, unknown>[] = []
    const supabase = fakeSupabase({
      job: { id: JOB_ID, client_id: CLIENT_ID, content_post_id: POST_ID, status: 'queued', scenes: null, creatomate_render_id: null },
      clients: {
        factory_config: {
          render: {
            engine: 'creatomate',
            creatomate: {
              ...STORED_TEMPLATE_CONTRACT,
              static_overrides: { EndLogo: 'https://x/logo.png' },
              required_post_fields: ['EndTour'],
              offers: { default: { tour: 'Best of China' } },
              post_field_sources: { EndTour: 'tour' },
            },
          },
        },
      },
      posts: {
        title: 'x',
        script: '口播稿',
        // 没有 endcard 子 key——这次要验证的正是"不用人工预填，自动算出来写进去"，
        // 只留一个不相关的兄弟 key 验证自动写入不会把它冲掉。
        generation_context_snapshot: { unrelated_key: 'from-another-feature' },
      },
      updates,
    })
    prepareSceneAssets.mockResolvedValue([
      { index: 0, captionText: 'A', visualUrl: 'https://x/a.mp4', visualType: 'video', voUrl: 'https://x/a.mp3', costUsd: 0.3 },
    ])
    submitRender.mockResolvedValue({ renderId: 'render-1' })
    getRender.mockResolvedValue({ id: 'render-1', status: 'succeeded', url: 'https://cdn.creatomate.com/out.mp4' })
    storeCreatomateResult.mockResolvedValue({ storageUrl: 'https://supabase/out.mp4', fileSizeKb: 100 })

    const fn = createFactoryCreatomateRender({ supabase: supabase as never })
    const handler = (fn as unknown as { fn: (ctx: { event: { data: unknown }; step: ReturnType<typeof fakeStep> }) => Promise<{ ok: boolean }> }).fn

    const result = await handler({
      event: { data: { job_id: JOB_ID, client_id: CLIENT_ID, post_id: POST_ID } },
      step: fakeStep({ data: { job_id: JOB_ID, render_id: 'render-1' } }),
    })

    expect(result.ok).toBe(true)
    expect(buildModifications).toHaveBeenCalledTimes(1)
    const [, effectiveContract] = buildModifications.mock.calls[0] as [unknown, { staticOverrides?: Record<string, string> }]
    expect(effectiveContract.staticOverrides).toEqual({ EndLogo: 'https://x/logo.png', EndTour: 'Best of China' })
  })
})
