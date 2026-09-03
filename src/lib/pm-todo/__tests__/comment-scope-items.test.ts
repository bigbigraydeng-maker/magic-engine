/**
 * 「评论读不到」这条待办。
 *
 * 铁律 3 下半句：机器做不了的必须下发，且带齐 what / how / href。
 * 这里验的是——该报的报了、不该报的不刷屏、话说到人不用问第二遍。
 */

import { describe, it, expect } from 'vitest'
import {
  buildCommentScopeTodo,
  fetchCommentScopeTodos,
  type CommentRunResult,
} from '../comment-scope-items'

const NOW = new Date('2026-08-15T12:00:00Z')

function result(over: Partial<CommentRunResult> = {}): CommentRunResult {
  return { client_id: 'cts', page_id: '1616575215312482', posts_scanned: 149, ...over }
}

describe('buildCommentScopeTodo', () => {
  it('🔴 缺权限要报，而且要说清后果 —— 「读不到评论」等于客人的提问没人回', () => {
    const t = buildCommentScopeTodo(result({ permission_denied_count: 12 }))
    expect(t).not.toBeNull()
    expect(t!.kind).toBe('comment_scope_missing')
    expect(t!.what).toContain('149 个帖子里有 12 个')
    expect(t!.what).toContain('pages_read_user_content')
    expect(t!.what).toContain('不会有人回')
  })

  it('🔴 how 要具体到点哪里，href 要能直达', () => {
    const t = buildCommentScopeTodo(result({ permission_denied_count: 1 }))!
    expect(t.how).toContain('Add a Permission')
    expect(t.how).toContain('pages_read_user_content')
    expect(t.how).toContain('META_SYSTEM_USER_TOKEN')
    expect(t.href).toBe('https://developers.facebook.com/tools/explorer/')
  })

  it('主页 ID 要印在待办上 —— 一个客户可能不止一个主页', () => {
    expect(buildCommentScopeTodo(result({ permission_denied_count: 1 }))!.what).toContain('1616575215312482')
  })

  it('样本最多三个，够 spot-check 就行，不刷屏', () => {
    const t = buildCommentScopeTodo(
      result({ permission_denied_count: 9, permission_denied_sample: ['a', 'b', 'c', 'd', 'e'] }),
    )!
    expect(t.what).toContain('（比如 a、b、c）')
    expect(t.what).not.toContain('、d')
  })

  it('🔴 令牌被拒时只报令牌那条 —— 令牌都用不了，再让人去补权限是白跑', () => {
    const t = buildCommentScopeTodo(
      result({ token_invalid: 'Error validating access token', permission_denied_count: 30 }),
    )!
    expect(t.kind).toBe('comment_token_invalid')
    expect(t.what).toContain('Error validating access token')
  })

  it('一切正常就不出待办', () => {
    expect(buildCommentScopeTodo(result({ permission_denied_count: 0 }))).toBeNull()
    expect(buildCommentScopeTodo(result())).toBeNull()
  })

  it('缺 posts_scanned 时也说得出话（只是不带分母）', () => {
    const t = buildCommentScopeTodo({ client_id: 'cts', permission_denied_count: 3 })!
    expect(t.what).toContain('3 个帖子')
  })
})

// ---------------------------------------------------------------------------

/**
 * 只对 cron_run_logs 建模 —— 碰别的表就炸，暴露越界读取。
 *
 * 收一个数组（最新一行在前，模拟 order by started_at desc）或单行；limit(n) 返回
 * 前 n 行。多行是关键：待办层要能越过「最新一行还在跑 / 失败没 summary」拿到上一
 * 条有结果的完成轮，单行的假库根本测不出这条链。
 */
function fakeSupabase(runs: unknown) {
  const rows = runs === null ? [] : Array.isArray(runs) ? runs : [runs]
  return {
    from(table: string) {
      if (table !== 'cron_run_logs') throw new Error(`fake supabase: table '${table}' is not modelled`)
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.order = () => chain
      chain.limit = (n: number) => Promise.resolve({ data: rows.slice(0, n), error: null })
      return chain
    },
  } as never
}

describe('fetchCommentScopeTodos', () => {
  const summary = { results: [result({ permission_denied_count: 12 })] }

  it('读最近一轮的结果', async () => {
    const todos = await fetchCommentScopeTodos(
      fakeSupabase({ finished_at: '2026-08-15T11:31:00Z', summary }),
      NOW,
    )
    expect(todos).toHaveLength(1)
    expect(todos[0].client_id).toBe('cts')
  })

  it('🔴 结果太旧就不说话 —— 「该跑没跑」有别的待办在管，两处都报会重复', async () => {
    const todos = await fetchCommentScopeTodos(
      fakeSupabase({ finished_at: '2026-08-10T00:00:00Z', summary }),
      NOW,
    )
    expect(todos).toEqual([])
  })

  it('跑到一半没写完 finished_at 的不用', async () => {
    expect(await fetchCommentScopeTodos(fakeSupabase({ finished_at: null, summary }), NOW)).toEqual([])
  })

  it('最新一行还在跑（summary 空）时，跳过它回落到上一条有结果的完成轮 —— 不静默清空', async () => {
    const todos = await fetchCommentScopeTodos(
      fakeSupabase([
        { finished_at: null, summary: null }, // 这一轮还在跑
        { finished_at: '2026-08-15T11:31:00Z', summary }, // 上一轮：某客户评论读不到，仍在 2 天窗口内
      ]),
      NOW,
    )
    expect(todos).toHaveLength(1)
    expect(todos[0].kind).toBe('comment_scope_missing')
  })

  it('🔴 最新一行失败没写 summary 时，绝不抹掉上一条已知的令牌被拒待办', async () => {
    const tokenSummary = { results: [result({ token_invalid: 'Error validating access token' })] }
    const todos = await fetchCommentScopeTodos(
      fakeSupabase([
        { finished_at: '2026-08-15T11:58:00Z', summary: null }, // 这一轮失败没带 summary
        { finished_at: '2026-08-15T11:31:00Z', summary: tokenSummary }, // 上一轮：令牌被拒
      ]),
      NOW,
    )
    expect(todos).toHaveLength(1)
    expect(todos[0].kind).toBe('comment_token_invalid')
    expect(todos[0].client_id).toBe('cts')
  })

  it('从没跑过 / 没有 summary 都不出待办，也不炸', async () => {
    expect(await fetchCommentScopeTodos(fakeSupabase(null), NOW)).toEqual([])
    expect(
      await fetchCommentScopeTodos(fakeSupabase({ finished_at: '2026-08-15T11:31:00Z', summary: null }), NOW),
    ).toEqual([])
  })

  it('summary 里混进形状不对的行时跳过它，其余照常', async () => {
    const todos = await fetchCommentScopeTodos(
      fakeSupabase({
        finished_at: '2026-08-15T11:31:00Z',
        summary: { results: [null, { page_id: 'x' }, result({ permission_denied_count: 2 })] },
      }),
      NOW,
    )
    expect(todos).toHaveLength(1)
  })
})
