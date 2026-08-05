import { describe, it, expect, vi } from 'vitest'
import { buildDraftTodos, hasWorkingChannel, fetchBlogDraftTodos } from '../blog-drafts'
import type { BlogDraftRow, CmsConnectionRow } from '../blog-drafts'

const NOW = new Date('2026-08-05T00:00:00Z')

function draft(over: Partial<BlogDraftRow> = {}): BlogDraftRow {
  return {
    client_id: 'oztop',
    title: 'Best Waterproof Flooring',
    topic: null,
    created_at: '2026-07-31T00:00:00Z',
    ...over,
  }
}

const CONNECTED: CmsConnectionRow[] = [{ client_id: 'cts', provider: 'github', status: 'connected' }]
const BROKEN: CmsConnectionRow[] = [{ client_id: 'oztop', provider: 'wordpress', status: 'error' }]

describe('hasWorkingChannel', () => {
  it('🔴 connected 才算能发；error 不算', () => {
    expect(hasWorkingChannel('cts', CONNECTED)).toBe(true)
    expect(hasWorkingChannel('oztop', BROKEN)).toBe(false)
  })

  it('🔴 一条连接都没有的客户，也是不能发', () => {
    expect(hasWorkingChannel('magiclab', [])).toBe(false)
  })

  it('别的客户的连接不算数', () => {
    expect(hasWorkingChannel('oztop', CONNECTED)).toBe(false)
  })
})

describe('buildDraftTodos', () => {
  it('🔴 一个客户只出一条待办 —— 三篇草稿刷三条就是噪音', () => {
    const todos = buildDraftTodos(
      [draft({ title: 'A' }), draft({ title: 'B' }), draft({ title: 'C' })],
      BROKEN,
      NOW,
    )
    expect(todos).toHaveLength(1)
    expect(todos[0].what).toContain('3 篇')
  })

  it('🔴 躺了几天要说出来 —— 「写好了」和「写好 5 天没人看」是两件事', () => {
    const todos = buildDraftTodos([draft({ created_at: '2026-07-31T00:00:00Z' })], CONNECTED, NOW)
    expect(todos[0].what).toContain('5 天')
  })

  it('🔴 没有发布通道时，不能让人白跑一趟去点发布', () => {
    const todos = buildDraftTodos([draft()], BROKEN, NOW)
    expect(todos[0].what).toContain('没地方发')
    expect(todos[0].how).toContain('接通')
    // 该去设置页接通道，不是去博客页点发布
    expect(todos[0].href).toContain('/settings')
    expect(todos[0].href).not.toContain('/blog')
  })

  it('有通道时才让人去看去发', () => {
    const todos = buildDraftTodos([draft({ client_id: 'cts' })], CONNECTED, NOW)
    expect(todos[0].how).toContain('点发布')
    expect(todos[0].href).toBe('/dashboard/clients/cts/blog')
  })

  it('取最早那篇算天数 —— 最久没人看的那篇才是问题', () => {
    const todos = buildDraftTodos(
      [
        draft({ created_at: '2026-08-04T00:00:00Z', title: '新的' }),
        draft({ created_at: '2026-07-30T00:00:00Z', title: '老的' }),
      ],
      BROKEN,
      NOW,
    )
    expect(todos[0].what).toContain('6 天')
  })

  it('多个客户各出各的', () => {
    const todos = buildDraftTodos(
      [draft({ client_id: 'oztop' }), draft({ client_id: 'cts' })],
      [...CONNECTED, ...BROKEN],
      NOW,
    )
    expect(todos.map((t) => t.client_id).sort()).toEqual(['cts', 'oztop'])
  })

  it('没有草稿就不出待办', () => {
    expect(buildDraftTodos([], CONNECTED, NOW)).toEqual([])
  })

  it('标题为空时退回 topic，再退回「未命名」，不崩', () => {
    const todos = buildDraftTodos(
      [draft({ title: null, topic: '地板保养' }), draft({ title: null, topic: null })],
      BROKEN,
      NOW,
    )
    expect(todos[0].what).toContain('《地板保养》')
    expect(todos[0].what).toContain('《未命名》')
  })
})

// ---------------------------------------------------------------------------
// 假 supabase 按表建模；认不出的表直接抛。
// 「查不到」和「没有」必须分开 —— 前者伪装成后者正是要防的那个病。
// ---------------------------------------------------------------------------

function fakeSupabase(opts: {
  drafts?: BlogDraftRow[]
  connections?: CmsConnectionRow[]
  draftsError?: string
  connError?: string
}) {
  return {
    from(table: string) {
      if (table === 'blog_posts') {
        const chain: Record<string, unknown> = {}
        chain.select = () => chain
        chain.eq = () => chain
        chain.in = () =>
          Promise.resolve(
            opts.draftsError
              ? { data: null, error: { message: opts.draftsError } }
              : { data: opts.drafts ?? [], error: null },
          )
        return chain
      }
      if (table === 'cms_connections') {
        const chain: Record<string, unknown> = {}
        chain.select = () => chain
        chain.in = () =>
          Promise.resolve(
            opts.connError
              ? { data: null, error: { message: opts.connError } }
              : { data: opts.connections ?? [], error: null },
          )
        return chain
      }
      throw new Error(`fake supabase: table '${table}' is not modelled`)
    },
  } as never
}

describe('fetchBlogDraftTodos', () => {
  it('🔴 假件护栏：问一张没建模的表要直接炸', () => {
    expect(() => (fakeSupabase({}) as unknown as { from: (t: string) => unknown }).from('keywords')).toThrow(
      /not modelled/,
    )
  })

  // 🔴 只断言「返回空」是锁不住的：**主动放弃**和**吞掉错误后正好也没数据**
  //    都返回空。所以这两条同时断言「它说出了原因」——
  //    把守卫拿掉就不会有那句话，测试才会红。
  it('🔴 草稿查询失败 → 不下发，并说明原因（「查不到」不能当成「没有」）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const todos = await fetchBlogDraftTodos(
        fakeSupabase({ drafts: [draft()], draftsError: 'boom' }),
        ['oztop'],
        NOW,
      )
      expect(todos).toEqual([])
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('草稿查询失败'), 'boom')
    } finally {
      warn.mockRestore()
    }
  })

  it('🔴 通道查询失败 → 同样不下发并说明原因。不然会把「有没有通道」说反', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const todos = await fetchBlogDraftTodos(
        fakeSupabase({ drafts: [draft()], connError: 'boom' }),
        ['oztop'],
        NOW,
      )
      expect(todos).toEqual([])
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('发布通道查询失败'), 'boom')
    } finally {
      warn.mockRestore()
    }
  })

  it('没有客户时直接返回空，不去查库', async () => {
    const todos = await fetchBlogDraftTodos(fakeSupabase({}), [], NOW)
    expect(todos).toEqual([])
  })

  it('正常情况：把生产上那三篇的形状跑一遍', async () => {
    const todos = await fetchBlogDraftTodos(
      fakeSupabase({
        drafts: [
          draft({ client_id: 'oztop', title: 'Tiles and Flooring', created_at: '2026-07-31T00:00:00Z' }),
          draft({ client_id: 'oztop', title: 'Waterproof Flooring', created_at: '2026-07-31T00:00:00Z' }),
          draft({ client_id: 'cts', title: 'China Travel Safe', created_at: '2026-08-04T00:00:00Z' }),
        ],
        connections: [...BROKEN, ...CONNECTED],
      }),
      ['oztop', 'cts'],
      NOW,
    )
    expect(todos).toHaveLength(2)
    const oztop = todos.find((t) => t.client_id === 'oztop')!
    const cts = todos.find((t) => t.client_id === 'cts')!
    expect(oztop.what).toContain('2 篇')
    expect(oztop.what).toContain('没地方发')
    expect(cts.what).toContain('1 篇')
    expect(cts.what).not.toContain('没地方发')
  })
})
