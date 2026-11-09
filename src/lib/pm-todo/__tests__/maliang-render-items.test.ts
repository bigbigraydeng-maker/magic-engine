import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// render-check imports the Gemini SDKs at module load; stub them so importing
// the pure verdict reader is safe in a unit test.
vi.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: class {} }))
vi.mock('@google/generative-ai/server', () => ({ GoogleAIFileManager: class {} }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

import {
  buildMaliangTodo,
  buildRemotionMaliangTodo,
  fetchMaliangTodos,
  pushMaliangRenderItems,
  boardUrl,
  CHECK_GRACE_HOURS,
  type PostRow,
  type RenderJobRow,
} from '../maliang-render-items'
import type { ManualItem } from '../manual-item-types'

const NOW = new Date('2026-10-05T20:00:00Z')
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString()

type Job = {
  id: string
  client_id: string
  content_post_id: string
  status: string
  updated_at: string
  // 真实查询第一步就是 .eq('render_engine', 'creatomate')——夹具漏了这列会被过滤成空，
  // 第一版正是这样把「两条 job」用例测红的（夹具错、代码对）
  render_engine: string
}
type Post = { id: string; title: string | null; generation_context_snapshot: unknown }

// 链式形状照抄 creatomate-render-items.test.ts 已验证过的同款 mock 惯例：
// 逐行对着 fetchMaliangTodos 里真实的 .select(...).eq(...).in(...).gte(...)
// .order(...).limit(...) 调用链核对过，证明这里暴露的方法跟真实生产者一一对应。
function database(tables: {
  content_factory_render_jobs?: Job[]
  content_posts?: Post[]
  content_work_orders?: Array<Record<string, unknown>>
  jobsError?: { message: string } | null
  postsError?: { message: string } | null
  ordersError?: { message: string } | null
}) {
  return {
    from: (table: string) => {
      if (table === 'content_factory_render_jobs') {
        let data = [...(tables.content_factory_render_jobs ?? [])]
        const query = {
          select: () => query,
          eq: (key: keyof Job, value: unknown) => {
            data = data.filter((r) => r[key] === value)
            return query
          },
          in: (key: keyof Job, values: readonly unknown[]) => {
            data = data.filter((r) => values.includes(r[key]))
            return query
          },
          gte: (key: keyof Job, value: string) => {
            data = data.filter((r) => String(r[key] ?? '') >= value)
            return query
          },
          order: () => query,
          limit: (n: number) => {
            data = data.slice(0, n)
            return query
          },
          then: (resolve: (result: unknown) => unknown) =>
            resolve({ data, error: tables.jobsError ?? null }),
        }
        return query
      }
      if (table === 'content_posts') {
        let data = [...(tables.content_posts ?? [])]
        const query = {
          select: () => query,
          in: (key: keyof Post, values: readonly unknown[]) => {
            data = data.filter((r) => values.includes(r[key]))
            return query
          },
          then: (resolve: (result: unknown) => unknown) =>
            resolve({ data, error: tables.postsError ?? null }),
        }
        return query
      }
      if (table === 'content_work_orders') {
        let data = [...(tables.content_work_orders ?? [])]
        const query = {
          select: () => query,
          in: (key: string, values: readonly unknown[]) => {
            data = data.filter((r) => values.includes(r[key]))
            return query
          },
          gte: (key: string, value: string) => {
            data = data.filter((r) => String(r[key] ?? '') >= value)
            return query
          },
          order: () => query,
          limit: (n: number) => {
            data = data.slice(0, n)
            return query
          },
          then: (resolve: (result: unknown) => unknown) =>
            resolve({ data, error: tables.ordersError ?? null }),
        }
        return query
      }
      throw new Error(`unexpected table: ${table}`)
    },
  } as unknown as SupabaseClient
}

const job = (over: Partial<Job> = {}): Job => ({
  id: 'job-1',
  client_id: 'client-a',
  content_post_id: 'post-1',
  status: 'ready_for_review',
  updated_at: ago(3),
  render_engine: 'creatomate',
  ...over,
})

const post = (over: Partial<Post> = {}): Post => ({
  id: 'post-1',
  title: 'CTS 秋季上新',
  generation_context_snapshot: {},
  ...over,
})

const withCheck = (check: unknown): Post =>
  post({ generation_context_snapshot: { maliang_check: check } })

const passCheck = {
  status: 'pass',
  checked_at: ago(2),
  video_url: 'https://x.supabase.co/v.mp4',
  reasons: [],
  frames: [],
  model: 'gemini-2.5-flash',
}

const failCheck = (reasons: string[]) => ({
  status: 'fail',
  checked_at: ago(2),
  video_url: 'https://x.supabase.co/v.mp4',
  reasons,
  frames: [],
  model: 'gemini-2.5-flash',
})

describe('buildMaliangTodo', () => {
  it('过关 + ready_for_review → 署名待办，指向内容工厂看板', () => {
    const todo = buildMaliangTodo(job(), withCheck(passCheck), NOW)
    expect(todo?.kind).toBe('maliang_render_passed')
    expect(todo?.what.startsWith('马良：')).toBe(true)
    expect(todo?.what).toContain('过关')
    expect(todo?.href.endsWith('/content-factory')).toBe(true)
  })

  it('不过关 → 返工还是放弃，问 PM', () => {
    const todo = buildMaliangTodo(
      job({ status: 'needs_rework' }),
      withCheck(failCheck(['第 3 镜文字：字幕被裁', '第 7 镜 logo：被遮住'])),
      NOW,
    )
    expect(todo?.kind).toBe('maliang_render_failed')
    expect(todo?.what).toContain('字幕被裁')
    expect(todo?.what).toContain('没放进你的审片队列')
    expect(todo?.how).toContain('返工')
    expect(todo?.how).toContain('放弃')
  })

  it('不过关且原因多于 4 条 → 只列 4 条，其余折叠成「另有 N 处」', () => {
    const reasons = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']
    const todo = buildMaliangTodo(job({ status: 'needs_rework' }), withCheck(failCheck(reasons)), NOW)
    expect(todo?.what).toContain('r4')
    expect(todo?.what).not.toContain('r5')
    expect(todo?.what).toContain('另有 2 处')
  })

  it('检不了 → 系统欠账，把原因原样带出来', () => {
    const todo = buildMaliangTodo(
      job(),
      withCheck({
        status: 'unverifiable',
        checked_at: ago(2),
        video_url: 'https://x.supabase.co/v.mp4',
        reasons: ['GEMINI_API_KEY 未配置，马良看不了片'],
        frames: [],
        model: null,
      }),
      NOW,
    )
    expect(todo?.kind).toBe('maliang_check_unverifiable')
    expect(todo?.what).toContain('GEMINI_API_KEY 未配置')
  })

  it('成片 3 小时了还没有自检记录 → 没检，进系统欠账', () => {
    const todo = buildMaliangTodo(job({ updated_at: ago(3) }), post(), NOW)
    expect(todo?.kind).toBe('maliang_check_missing')
    expect(todo?.what).toContain('3 小时')
  })

  it('成片才 30 分钟、还没到宽限期 → 不下发', () => {
    const todo = buildMaliangTodo(job({ updated_at: ago(0.5) }), post(), NOW)
    expect(todo).toBeNull()
  })

  it('没有自检记录但状态是 needs_rework → 不下发（不是审片队列里的片）', () => {
    const todo = buildMaliangTodo(job({ status: 'needs_rework' }), post(), NOW)
    expect(todo).toBeNull()
  })

  it('过关但状态是 needs_rework → 不下发（不在审片队列）', () => {
    const todo = buildMaliangTodo(job({ status: 'needs_rework' }), withCheck(passCheck), NOW)
    expect(todo).toBeNull()
  })
})

describe('fetchMaliangTodos', () => {
  it('两条 job：一条过关、一条没有对应 post → 过关的等审片，没 post 的按「没检」报', async () => {
    const todos = await fetchMaliangTodos(
      database({
        content_factory_render_jobs: [
          job({ id: 'job-1', content_post_id: 'post-1' }),
          job({ id: 'job-2', content_post_id: 'post-missing' }),
        ],
        content_posts: [withCheck(passCheck)],
      }),
      NOW,
    )
    // 找不到对应 post 的那条不是「跳过」：它出片 3 小时了还没有自检记录，按设计要报「没检」
    //（事件丢了也不能静默）。第一版期望只出 1 条，是期望写错、代码对。
    expect(todos).toHaveLength(2)
    expect(todos.map((t) => t.kind)).toEqual(['maliang_render_passed', 'maliang_check_missing'])
  })

  it('jobs 查询报错 → 抛出，不静默吞掉', async () => {
    await expect(
      fetchMaliangTodos(
        database({ jobsError: { message: 'boom' } }),
        NOW,
      ),
    ).rejects.toThrow(/boom/)
  })

  it('没有 Creatomate 成片时，模板出片没过的待办仍然出来', async () => {
    const todos = await fetchMaliangTodos(
      database({
        content_factory_render_jobs: [],
        content_work_orders: [{
          id: 'wo-1',
          client_id: 'client-a',
          status: 'in_review',
          angle: '示例角度',
          updated_at: ago(3),
          brief: { remotion: { template: 'postcard', props: {} } },
          output: { machine_reviewed: true, maliang_check: failCheck(['第 1 镜文字：错字']) },
        }],
      }),
      NOW,
    )
    expect(todos).toHaveLength(1)
    expect(todos[0].kind).toBe('maliang_render_failed')
    expect(todos[0].what).toContain('马良没过')
  })

  it('模板出片待办查询失败时，另一条出片路线的待办还在', async () => {
    const todos = await fetchMaliangTodos(
      database({
        content_factory_render_jobs: [job()],
        content_posts: [withCheck(passCheck)],
        ordersError: { message: 'orders down' },
      }),
      NOW,
    )
    expect(todos.map((t) => t.kind)).toEqual(['maliang_render_passed'])
  })
})

describe('pushMaliangRenderItems', () => {
  it('每条待办 href 都是 https，client_name 来自 nameOf', async () => {
    const items: ManualItem[] = []
    await pushMaliangRenderItems(
      database({
        content_factory_render_jobs: [job()],
        content_posts: [withCheck(passCheck)],
      }),
      items,
      NOW,
      (id) => (id === 'client-a' ? 'CTS' : '未知客户'),
    )
    expect(items).toHaveLength(1)
    expect(items[0].href.startsWith('https://')).toBe(true)
    expect(items[0].client_name).toBe('CTS')
    expect(items[0].href).toBe(boardUrl('client-a'))
  })
})

describe('buildRemotionMaliangTodo', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'wo-1',
    client_id: 'client-a',
    status: 'in_review',
    angle: '示例角度',
    updated_at: ago(3),
    brief: { remotion: { template: 'postcard', props: {} } },
    output: {},
    ...over,
  })

  it('pass stays a review todo for the factory screen', () => {
    const todo = buildRemotionMaliangTodo(row({
      output: { machine_reviewed: true, maliang_check: passCheck },
    }), NOW)
    expect(todo?.kind).toBe('maliang_render_passed')
    expect(todo?.href).toBe('https://app.magicengine.com.au/dashboard/factory')
  })

  it('reject stays a failed-kind todo that points at the inbox and the reason', () => {
    const todo = buildRemotionMaliangTodo(row({
      status: 'in_review',
      output: { machine_reviewed: true, maliang_check: failCheck(['第 1 镜文字：错字']) },
    }), NOW)
    expect(todo?.kind).toBe('maliang_render_failed')
    expect(todo?.what).toContain('马良没过')
    expect(todo?.what).toContain('审片收件箱')
    expect(todo?.what).toContain('错字')
    expect(todo?.how).toContain('通过或打回')
    expect(todo?.href).toBe('https://app.magicengine.com.au/dashboard/factory')
  })

  it('a fail already decided by a person is not nagged again', () => {
    const todo = buildRemotionMaliangTodo(row({
      status: 'review_rejected',
      output: { machine_reviewed: true, maliang_check: failCheck(['第 1 镜文字：错字']) },
    }), NOW)
    expect(todo).toBeNull()
  })

  it('a review that did not finish is unverifiable and still points at the queue', () => {
    const todo = buildRemotionMaliangTodo(row({
      output: {
        machine_reviewed: false,
        maliang_check: {
          status: 'unverifiable',
          checked_at: ago(1),
          video_url: 'https://x.supabase.co/v.mp4',
          reasons: ['马良自检失败：model down'],
          frames: [],
          model: null,
        },
      },
    }), NOW)
    expect(todo?.kind).toBe('maliang_check_unverifiable')
    expect(todo?.how).toContain('审片队列')
  })
})

describe('constants', () => {
  it('宽限期是 2 小时', () => {
    expect(CHECK_GRACE_HOURS).toBe(2)
  })
})
