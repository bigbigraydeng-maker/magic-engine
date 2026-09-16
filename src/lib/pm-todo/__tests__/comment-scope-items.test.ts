/**
 * 「评论读不到」这条待办。
 *
 * 铁律 3 下半句：机器做不了的必须下发，且带齐 what / how / href。
 * 这里验的是——该报的报了、不该报的不刷屏、话说到人不用问第二遍。
 */

import { describe, it, expect } from 'vitest'
import {
  buildCommentScopeTodos,
  fetchCommentScopeTodos,
  type CommentRunResult,
} from '../comment-scope-items'

const NOW = new Date('2026-08-15T12:00:00Z')

function result(over: Partial<CommentRunResult> = {}): CommentRunResult {
  return { client_id: 'cts', page_id: '1616575215312482', posts_scanned: 149, ...over }
}

/** 大多数场景只出一条；多出来的那条会被下面专门的用例盯住。 */
function buildCommentScopeTodo(r: CommentRunResult) {
  const todos = buildCommentScopeTodos(r)
  expect(todos.length).toBeLessThanOrEqual(1)
  return todos[0] ?? null
}

describe('buildCommentScopeTodos', () => {
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

  it('🔴 这一轮没扫完要报 —— 带上原话，how 指向客户设置页「内容」标签的检查按钮', () => {
    const t = buildCommentScopeTodo(
      result({
        ok: false,
        scan_error: 'published_posts 1616575215312482: 500 code=1 Please reduce the amount of data',
        error: 'comment scan incomplete: published_posts 1616575215312482: 500 code=1',
      }),
    )!
    expect(t.kind).toBe('comment_scan_failed')
    expect(t.what).toContain('没扫完')
    expect(t.what).toContain('code=1')
    expect(t.how).toContain('检查 Meta 权限')
    // 回帖权限生产上全缺，探针上它必然是 ✗ —— 不说清楚会把人支去走审核，原话到不了开发
    expect(t.how).toContain('「回帖 / 隐藏」那一项打 ✗ 不影响扫描')
    expect(t.href).toBe('https://app.magicengine.com.au/dashboard/clients/cts/settings?tab=content')
  })

  it('没令牌这类没有 scan_error 的失败，也用 error 原话报出来', () => {
    const t = buildCommentScopeTodo({ client_id: 'cts', ok: false, error: 'no Meta token configured' })!
    expect(t.kind).toBe('comment_scan_failed')
    expect(t.what).toContain('no Meta token configured')
  })

  it('🔴 没扫完 + 缺回评论权限 = 两条：一条给开发，一条去授权，谁也不盖住谁', () => {
    const todos = buildCommentScopeTodos(result({ ok: false, error: 'x', engagement_scope_missing: true }))
    expect(todos.map((t) => t.kind)).toEqual(['comment_scan_failed', 'comment_engagement_scope_missing'])
  })

  it('🔴 缺回评论权限要报：说清自动回复已暂停、几条标成人工回、审核这步找开发', () => {
    const t = buildCommentScopeTodo(result({ ok: true, engagement_scope_missing: true, replies_blocked: 4 }))!
    expect(t.kind).toBe('comment_engagement_scope_missing')
    expect(t.what).toContain('自动回复已经暂停')
    expect(t.what).toContain('pages_manage_engagement')
    expect(t.what).toContain('最近一轮新标了 4 条')
    // 下一轮这些评论已经是 pending、计数归零 —— 去哪看人工队列不能跟着消失
    expect(buildCommentScopeTodo(result({ engagement_scope_missing: true, replies_blocked: 0 }))!.what).toContain('最近自动回复里能看到')
    expect(t.how).toContain('勾上 pages_manage_engagement')
    expect(t.how).toContain('应用审核')
    expect(t.href).toBe('https://developers.facebook.com/tools/explorer/')
  })

  it('🔴 Reels / 投放帖子列表被拒要单独报 —— 不算失败，但那类帖子的评论一直是盲区', () => {
    const t = buildCommentScopeTodo(
      result({ ok: true, sources_skipped: ['ads act_123: 400 code=200', 'video_reels 1616575215312482: 400 code=10 (#10) no permission'] }),
    )!
    expect(t.kind).toBe('comment_source_refused')
    expect(t.what).toContain('投放（加热）帖子、Reels')
    expect(t.what).toContain('code=10')
    expect(t.href).toBe('https://app.magicengine.com.au/dashboard/clients/cts/settings?tab=content')
  })

  it('两个权限都缺时合成一条待办，一次授权两项都勾上', () => {
    const t = buildCommentScopeTodo(result({ permission_denied_count: 2, engagement_scope_missing: true }))!
    expect(t.kind).toBe('comment_scope_missing')
    expect(t.how).toContain('勾上 pages_read_user_content、pages_manage_engagement')
    expect(t.what).toContain('另外，评论自动回复已经暂停')
  })

  it('缺 posts_scanned 时也说得出话（只是不带分母）', () => {
    const t = buildCommentScopeTodo({ client_id: 'cts', permission_denied_count: 3 })!
    expect(t.what).toContain('3 个帖子')
  })
})

// ---------------------------------------------------------------------------

function fakeSupabase(run: unknown) {
  return {
    from(table: string) {
      if (table !== 'cron_run_logs') throw new Error(`fake supabase: table '${table}' is not modelled`)
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.order = () => chain
      chain.limit = () => Promise.resolve({ data: run === null ? [] : [run], error: null })
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
