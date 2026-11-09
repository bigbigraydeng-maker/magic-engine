/**
 * 「评论自动回复回不出去」这条待办。
 *
 * 铁律 3 下半句：机器做不了的必须下发，且带齐 what / how / href。
 * 判据是授权里存着的 scopes（Meta 真正授予的权限），不是引擎那句通用失败原因。
 */

import { describe, it, expect } from 'vitest'
import {
  buildCommentReplyScopeTodos,
  fetchCommentReplyScopeTodos,
  type CommentConfigRow,
  type MetaConnectionRow,
  type FailedReplyRow,
} from '../comment-reply-scope-items'

const NOW = new Date('2026-08-15T12:00:00Z')

function config(over: Partial<CommentConfigRow> = {}): CommentConfigRow {
  return { client_id: 'cts', fb_page_id: 'page-1', ...over }
}

function conn(over: Partial<MetaConnectionRow> = {}): MetaConnectionRow {
  return {
    client_id: 'cts',
    account_id: 'page-1',
    status: 'active',
    scopes: ['pages_read_engagement'],
    ...over,
  }
}

function failed(over: Partial<FailedReplyRow> = {}): FailedReplyRow {
  return { client_id: 'cts', needs_human: false, ...over }
}

describe('buildCommentReplyScopeTodos', () => {
  it('🔴 授权里缺权限要报，而且要说清后果 —— 读得到评论、回不了', () => {
    const todos = buildCommentReplyScopeTodos([config()], [conn()], [])
    expect(todos).toHaveLength(1)
    const t = todos[0]
    expect(t.kind).toBe('comment_reply_scope_missing')
    expect(t.client_id).toBe('cts')
    expect(t.what).toContain('pages_manage_engagement')
    expect(t.what).toContain('读得到、但回不了')
  })

  it('🔴 how 要具体到点哪里，href 要能直达重新授权', () => {
    const t = buildCommentReplyScopeTodos([config()], [conn()], [])[0]
    expect(t.how).toContain('保持所有权限')
    expect(t.href).toContain('connect?client_id=cts&rerequest=1')
  })

  it('授权里有这项权限就不报', () => {
    const todos = buildCommentReplyScopeTodos(
      [config()],
      [conn({ scopes: ['pages_read_engagement', 'pages_manage_engagement'] })],
      [],
    )
    expect(todos).toEqual([])
  })

  it('找不到对应主页的授权就不报 —— 说不清，不猜', () => {
    expect(buildCommentReplyScopeTodos([config()], [], [])).toEqual([])
    expect(
      buildCommentReplyScopeTodos([config()], [conn({ account_id: 'other-page' })], []),
    ).toEqual([])
  })

  it('scopes 不是数组就不报', () => {
    expect(
      buildCommentReplyScopeTodos([config()], [conn({ scopes: null })], []),
    ).toEqual([])
  })

  it('fb_page_id 为空或不是字符串就不报', () => {
    expect(buildCommentReplyScopeTodos([config({ fb_page_id: null })], [conn()], [])).toEqual([])
    expect(buildCommentReplyScopeTodos([config({ fb_page_id: '' })], [conn()], [])).toEqual([])
  })

  it('失败行数进 what，需要人看的单独数出来', () => {
    const todos = buildCommentReplyScopeTodos(
      [config()],
      [conn()],
      [failed(), failed({ needs_human: true }), failed({ needs_human: true })],
    )
    expect(todos).toHaveLength(1)
    expect(todos[0].what).toContain('3 条')
    expect(todos[0].what).toContain('其中 2 条是需要人看的提问或投诉')
  })

  it('没有失败行就用另一句 —— 之后也回不了', () => {
    const todos = buildCommentReplyScopeTodos([config()], [conn()], [])
    expect(todos).toHaveLength(1)
    expect(todos[0].what).toContain('之后客人在帖子下的留言')
    expect(todos[0].what).not.toContain('失败了')
  })

  it('两个客户出两条待办，按 client_id 排序', () => {
    const todos = buildCommentReplyScopeTodos(
      [config({ client_id: 'zeta' }), config({ client_id: 'alpha' })],
      [conn({ client_id: 'zeta' }), conn({ client_id: 'alpha' })],
      [],
    )
    expect(todos).toHaveLength(2)
    expect(todos.map((t) => t.client_id)).toEqual(['alpha', 'zeta'])
  })

  it('account_id 前后有空格照样匹配', () => {
    const todos = buildCommentReplyScopeTodos(
      [config({ fb_page_id: 'page-1' })],
      [conn({ account_id: '  page-1  ' })],
      [],
    )
    expect(todos).toHaveLength(1)
  })

  it('同一个客户多条配置只出一条待办', () => {
    const todos = buildCommentReplyScopeTodos(
      [config(), config({ fb_page_id: 'page-2' })],
      [conn(), conn({ account_id: 'page-2' })],
      [],
    )
    expect(todos).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------

interface FakeResponse {
  data: unknown
  error: unknown
}

interface FakeCalls {
  config: { eq: unknown[][] }
  connections: { eq: unknown[][]; in: unknown[][] }
  engagements: { eq: unknown[][]; gte: unknown[][] }
}

function fakeSupabase(responses: {
  config: FakeResponse
  connections: FakeResponse
  engagements: FakeResponse
}) {
  const calls: FakeCalls = {
    config: { eq: [] },
    connections: { eq: [], in: [] },
    engagements: { eq: [], gte: [] },
  }

  function chainFor(table: string) {
    const record = (bucket: { eq?: unknown[][]; in?: unknown[][]; gte?: unknown[][] }, key: string, args: unknown[]) => {
      const arr = bucket[key as keyof typeof bucket]
      if (arr) arr.push(args)
    }

    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = (col: unknown, val: unknown) => {
      if (table === 'social_comment_config') record(calls.config, 'eq', [col, val])
      if (table === 'platform_oauth_connections') record(calls.connections, 'eq', [col, val])
      if (table === 'social_comment_engagements') record(calls.engagements, 'eq', [col, val])
      return chain
    }
    chain.in = (col: unknown, val: unknown) => {
      if (table === 'platform_oauth_connections') record(calls.connections, 'in', [col, val])
      return chain
    }
    chain.gte = (col: unknown, val: unknown) => {
      if (table === 'social_comment_engagements') record(calls.engagements, 'gte', [col, val])
      return chain
    }
    chain.limit = () => chain
    chain.then = (resolve: (v: FakeResponse) => unknown) => {
      if (table === 'social_comment_config') return Promise.resolve(responses.config).then(resolve)
      if (table === 'platform_oauth_connections') return Promise.resolve(responses.connections).then(resolve)
      if (table === 'social_comment_engagements') return Promise.resolve(responses.engagements).then(resolve)
      throw new Error(`fake supabase: table '${table}' is not modelled`)
    }
    return chain
  }

  return {
    client: {
      from(table: string) {
        if (
          table !== 'social_comment_config' &&
          table !== 'platform_oauth_connections' &&
          table !== 'social_comment_engagements'
        ) {
          throw new Error(`fake supabase: table '${table}' is not modelled`)
        }
        return chainFor(table)
      },
    } as never,
    calls,
  }
}

describe('fetchCommentReplyScopeTodos', () => {
  it('读配置、授权、失败行，出待办，并按表带上过滤条件', async () => {
    const { client, calls } = fakeSupabase({
      config: { data: [config()], error: null },
      connections: { data: [conn()], error: null },
      engagements: { data: [failed()], error: null },
    })

    const todos = await fetchCommentReplyScopeTodos(client, NOW)
    expect(todos).toHaveLength(1)
    expect(todos[0].client_id).toBe('cts')
    expect(todos[0].kind).toBe('comment_reply_scope_missing')

    expect(calls.config.eq).toContainEqual(['enabled', true])
    expect(calls.connections.eq).toContainEqual(['provider', 'meta'])
    expect(calls.connections.in).toContainEqual(['client_id', ['cts']])
    expect(calls.engagements.eq).toContainEqual(['reply_status', 'failed'])
  })

  it('配置查询报错就不说话，也不炸', async () => {
    const { client } = fakeSupabase({
      config: { data: null, error: { message: 'boom' } },
      connections: { data: [], error: null },
      engagements: { data: [], error: null },
    })
    expect(await fetchCommentReplyScopeTodos(client, NOW)).toEqual([])
  })

  it('授权查询报错就不说话', async () => {
    const { client } = fakeSupabase({
      config: { data: [config()], error: null },
      connections: { data: null, error: { message: 'boom' } },
      engagements: { data: [], error: null },
    })
    expect(await fetchCommentReplyScopeTodos(client, NOW)).toEqual([])
  })

  it('失败行查询报错也照常出待办，只是 n = 0', async () => {
    const { client } = fakeSupabase({
      config: { data: [config()], error: null },
      connections: { data: [conn()], error: null },
      engagements: { data: null, error: { message: 'boom' } },
    })
    const todos = await fetchCommentReplyScopeTodos(client, NOW)
    expect(todos).toHaveLength(1)
    expect(todos[0].what).toContain('之后客人在帖子下的留言')
  })

  it('没有配置就不出待办', async () => {
    const { client } = fakeSupabase({
      config: { data: [], error: null },
      connections: { data: [], error: null },
      engagements: { data: [], error: null },
    })
    expect(await fetchCommentReplyScopeTodos(client, NOW)).toEqual([])
  })
})
