/**
 * 「评论自动回复回不出去」这条待办。
 *
 * 铁律 3 下半句：机器做不了的必须下发，且带齐 what / how / href。
 * 这里验的是——该报的报了、不该报的不刷屏、话说到人不用问第二遍。
 */

import { describe, it, expect } from 'vitest'
import {
  buildCommentReplyScopeTodos,
  fetchCommentReplyScopeTodos,
  type EngagementRow,
} from '../comment-reply-scope-items'

const NOW = new Date('2026-08-15T12:00:00Z')

const PERMISSION_ERROR =
  '(#200) 需要 pages_manage_engagement 权限才能管理和回复评论'

function row(over: Partial<EngagementRow> = {}): EngagementRow {
  return {
    client_id: 'cts',
    reply_status: 'failed',
    needs_human: false,
    error_message: PERMISSION_ERROR,
    created_at: '2026-08-14T10:00:00Z',
    ...over,
  }
}

describe('buildCommentReplyScopeTodos', () => {
  it('🔴 缺权限要报，而且要说清后果 —— 读得到评论、回不了', () => {
    const todos = buildCommentReplyScopeTodos([row()])
    expect(todos).toHaveLength(1)
    const t = todos[0]
    expect(t.kind).toBe('comment_reply_scope_missing')
    expect(t.client_id).toBe('cts')
    expect(t.what).toContain('1 条')
    expect(t.what).toContain('pages_manage_engagement')
  })

  it('🔴 how 要具体到点哪里，href 要能直达设置抽屉', () => {
    const t = buildCommentReplyScopeTodos([row()])[0]
    expect(t.how).toContain('连接 Meta')
    expect(t.href).toContain('settings=platform')
  })

  it('限流、网络抖动那类失败不报 —— 机器会自己重试，下发等于制造噪音', () => {
    expect(
      buildCommentReplyScopeTodos([row({ error_message: 'rate limit exceeded' })]),
    ).toEqual([])
  })

  it('error_message 为空或不是字符串的失败行不报', () => {
    expect(buildCommentReplyScopeTodos([row({ error_message: null })])).toEqual([])
    expect(buildCommentReplyScopeTodos([row({ error_message: '' })])).toEqual([])
  })

  it('🔴 成功过之后又失败才报 —— 成功之前的失败已经被那次成功证明修好了', () => {
    const todos = buildCommentReplyScopeTodos([
      row({ created_at: '2026-08-10T10:00:00Z' }),
      row({ reply_status: 'replied', error_message: null, created_at: '2026-08-12T10:00:00Z' }),
    ])
    expect(todos).toEqual([])
  })

  it('🔴 成功之后又失败，照样要报', () => {
    const todos = buildCommentReplyScopeTodos([
      row({ reply_status: 'replied', error_message: null, created_at: '2026-08-10T10:00:00Z' }),
      row({ created_at: '2026-08-12T10:00:00Z' }),
    ])
    expect(todos).toHaveLength(1)
    expect(todos[0].kind).toBe('comment_reply_scope_missing')
  })

  it('dm_sent 也算成功，能清掉之前的失败', () => {
    const todos = buildCommentReplyScopeTodos([
      row({ created_at: '2026-08-10T10:00:00Z' }),
      row({ reply_status: 'dm_sent', error_message: null, created_at: '2026-08-12T10:00:00Z' }),
    ])
    expect(todos).toEqual([])
  })

  it('两个客户出两条待办，按 client_id 排序', () => {
    const todos = buildCommentReplyScopeTodos([
      row({ client_id: 'zeta' }),
      row({ client_id: 'alpha' }),
    ])
    expect(todos).toHaveLength(2)
    expect(todos.map((t) => t.client_id)).toEqual(['alpha', 'zeta'])
  })

  it('需要人看的提问或投诉要数出来', () => {
    const todos = buildCommentReplyScopeTodos([
      row({ needs_human: true }),
      row({ needs_human: true }),
      row({ needs_human: false }),
    ])
    expect(todos).toHaveLength(1)
    expect(todos[0].what).toContain('3 条')
    expect(todos[0].what).toContain('其中 2 条是需要人看的提问或投诉')
  })

  it('没有需要人看的就不带那个括号', () => {
    const todos = buildCommentReplyScopeTodos([row({ needs_human: false })])
    expect(todos).toHaveLength(1)
    expect(todos[0].what).not.toContain('需要人看的提问或投诉')
  })

  it('形状不对的行跳过，其余照常', () => {
    const todos = buildCommentReplyScopeTodos([
      null as unknown as EngagementRow,
      { client_id: 'x' } as unknown as EngagementRow,
      row(),
    ])
    expect(todos).toHaveLength(1)
    expect(todos[0].client_id).toBe('cts')
  })

  it('没有失败行就不出待办', () => {
    expect(buildCommentReplyScopeTodos([])).toEqual([])
  })
})

// ---------------------------------------------------------------------------

function fakeSupabase(response: { data: unknown; error: unknown }) {
  return {
    from(table: string) {
      if (table !== 'social_comment_engagements') {
        throw new Error(`fake supabase: table '${table}' is not modelled`)
      }
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.gte = () => chain
      chain.in = () => chain
      chain.order = () => chain
      chain.limit = () => Promise.resolve(response)
      return chain
    },
  } as never
}

describe('fetchCommentReplyScopeTodos', () => {
  it('读最近窗口里的失败行，出待办', async () => {
    const todos = await fetchCommentReplyScopeTodos(
      fakeSupabase({ data: [row()], error: null }),
      NOW,
    )
    expect(todos).toHaveLength(1)
    expect(todos[0].client_id).toBe('cts')
    expect(todos[0].kind).toBe('comment_reply_scope_missing')
  })

  it('查询报错就不说话，也不炸', async () => {
    const todos = await fetchCommentReplyScopeTodos(
      fakeSupabase({ data: null, error: { message: 'boom' } }),
      NOW,
    )
    expect(todos).toEqual([])
  })

  it('没有数据就不出待办', async () => {
    const todos = await fetchCommentReplyScopeTodos(
      fakeSupabase({ data: [], error: null }),
      NOW,
    )
    expect(todos).toEqual([])
  })
})
