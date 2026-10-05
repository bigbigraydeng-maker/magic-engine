// Publer IG adapter 单测:全部走注入的 fetchFn/sleep/now,不打真网。
// 重点验:默认草稿、绝不编回执、env 不进错误、UA/授权头、幂等对账 fail closed。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildInstagramReelBody,
  createPublerInstagramAdapter,
  isPublerAccountError,
  isPublerRejectedError,
  assertInstagramBrand,
  jobFailureMessage,
  normalizePostList,
} from './instagram-publer-adapter'
import { encodeIdemTag } from './facebook-reel-adapter'
import type { PublishTarget } from '../types'

const ACCOUNT_ID = 'acc-1'

function target(overrides: Partial<PublishTarget> = {}): PublishTarget {
  return {
    platform: 'publer',
    publer_account_id: ACCOUNT_ID,
    publer_provider: 'instagram',
    expect_brand: 'CTS Tours', // Instagram 必须有可比对的品牌名(生产里由 store 从 master_briefs 取)
    ...overrides,
  }
}

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: Record<string, unknown> | undefined
}

/** 造一个按 URL 分派的假 fetch,并记录每次调用(顺序 + 头 + body)。 */
function makeFetch(handler: (url: string, method: string) => { status?: number; json?: unknown; text?: string }) {
  const calls: Call[] = []
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const headers = (init?.headers ?? {}) as Record<string, string>
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
    calls.push({ url, method, headers, body })
    const r = handler(url, method)
    const status = r.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => r.json ?? {},
      text: async () => r.text ?? JSON.stringify(r.json ?? {}),
    } as Response
  }) as typeof fetch
  return { fetchFn, calls }
}

const ACCOUNTS_OK = { json: [{ id: ACCOUNT_ID, provider: 'instagram', name: 'CTS Tours' }] }

beforeEach(() => {
  process.env.PUBLER_API_KEY = 'test-key'
  process.env.PUBLER_WORKSPACE_ID = 'ws-1'
})

afterEach(() => {
  delete process.env.PUBLER_API_KEY
  delete process.env.PUBLER_WORKSPACE_ID
  vi.restoreAllMocks()
})

describe('buildInstagramReelBody', () => {
  it('draft: state draft, 无 scheduled_at, reel 详情, 首评带 delay', () => {
    const body = buildInstagramReelBody({
      state: 'draft',
      accountId: ACCOUNT_ID,
      mediaId: 'm1',
      text: 'hello',
      firstComment: 'CTA',
    })
    const bulk = body['bulk'] as Record<string, unknown>
    expect(bulk['state']).toBe('draft')
    const post = (bulk['posts'] as Array<Record<string, unknown>>)[0]
    const ig = (post['networks'] as Record<string, unknown>)['instagram'] as Record<string, unknown>
    expect(ig['details']).toEqual({ type: 'reel', feed: true })
    const account = (post['accounts'] as Array<Record<string, unknown>>)[0]
    expect(account['scheduled_at']).toBeUndefined()
    const comments = account['comments'] as Array<Record<string, unknown>>
    expect(comments[0]['delay']).toEqual({ duration: 1, unit: 'Minute' })
  })

  it('scheduled 缺 scheduledAt 抛错', () => {
    expect(() =>
      buildInstagramReelBody({ state: 'scheduled', accountId: ACCOUNT_ID, mediaId: 'm1', text: 'x' }),
    ).toThrow()
  })
})

describe('jobFailureMessage / normalizePostList', () => {
  it('空 failures 返回 null', () => {
    expect(jobFailureMessage({ payload: { failures: {} } })).toBeNull()
    expect(jobFailureMessage({ payload: { failures: [] } })).toBeNull()
    expect(jobFailureMessage({ payload: {} })).toBeNull()
  })

  it('数组 failures 拼接 message', () => {
    expect(jobFailureMessage({ payload: { failures: [{ message: 'a' }, { message: 'b' }] } })).toBe('a; b')
  })

  it('normalizePostList 三种形状', () => {
    expect(normalizePostList([{ id: '1' }])).toHaveLength(1)
    expect(normalizePostList({ posts: [{ id: '1' }] })).toHaveLength(1)
    expect(normalizePostList({ data: [{ id: '1' }] })).toHaveLength(1)
    expect(normalizePostList('nope')).toEqual([])
  })
})

describe('publish', () => {
  it('draft 快乐路径:草稿、media id、onStarted 先于排期、caption 带零宽标记', async () => {
    const order: string[] = []
    const { fetchFn, calls } = makeFetch((url) => {
      if (url.includes('/accounts')) return ACCOUNTS_OK
      if (url.includes('/media/from-url')) return { json: { job_id: 'j1' } }
      if (url.includes('/job_status/j1')) return { json: { status: 'complete', payload: [{ id: 'm1' }] } }
      if (url.includes('/posts/schedule')) return { json: { job_id: 'j2' } }
      if (url.includes('/job_status/j2')) return { json: { status: 'complete', payload: { failures: {} } } }
      if (url.includes('/posts?')) return { json: [] }
      return { status: 404 }
    })
    const adapter = createPublerInstagramAdapter({ fetchFn, sleep: async () => {} })

    const ref = await adapter.publish({
      videoUrl: 'https://cdn/x.mp4',
      caption: 'cap',
      firstComment: 'CTA',
      target: target(),
      idempotencyTag: 'wo-123',
      draft: true,
      onStarted: async (id) => {
        order.push(`started:${id}`)
      },
    })

    expect(ref.provider_state).toBe('draft')
    expect(ref.video_id).toBe('m1')
    expect(ref.video_state).toBeUndefined()

    const schedule = calls.find((c) => c.url.includes('/posts/schedule'))
    expect(schedule).toBeDefined()
    const bulk = schedule!.body!['bulk'] as Record<string, unknown>
    expect(bulk['state']).toBe('draft')
    const post = (bulk['posts'] as Array<Record<string, unknown>>)[0]
    const ig = (post['networks'] as Record<string, unknown>)['instagram'] as Record<string, unknown>
    expect(String(ig['text']).endsWith(encodeIdemTag('wo-123'))).toBe(true)

    // onStarted 必须在排期请求之前发生
    const scheduleIdx = calls.findIndex((c) => c.url.includes('/posts/schedule'))
    expect(order).toEqual(['started:m1'])
    expect(scheduleIdx).toBeGreaterThan(0)
  })

  it('live: state scheduled, scheduled_at = now + 3min', async () => {
    const fixed = new Date('2026-01-01T00:00:00.000Z')
    const { fetchFn, calls } = makeFetch((url) => {
      if (url.includes('/accounts')) return ACCOUNTS_OK
      if (url.includes('/media/from-url')) return { json: { job_id: 'j1' } }
      if (url.includes('/job_status/j1')) return { json: { status: 'complete', payload: [{ id: 'm1' }] } }
      if (url.includes('/posts/schedule')) return { json: { job_id: 'j2' } }
      if (url.includes('/job_status/j2')) return { json: { status: 'complete', payload: { failures: {} } } }
      if (url.includes('/posts?')) return { json: [] }
      return { status: 404 }
    })
    const adapter = createPublerInstagramAdapter({ fetchFn, sleep: async () => {}, now: () => fixed })

    const ref = await adapter.publish({
      videoUrl: 'https://cdn/x.mp4',
      caption: 'cap',
      target: target(),
      idempotencyTag: 'wo-1',
      draft: false,
    })

    expect(ref.provider_state).toBe('scheduled')
    const schedule = calls.find((c) => c.url.includes('/posts/schedule'))!
    const bulk = schedule.body!['bulk'] as Record<string, unknown>
    expect(bulk['state']).toBe('scheduled')
    const post = (bulk['posts'] as Array<Record<string, unknown>>)[0]
    const account = (post['accounts'] as Array<Record<string, unknown>>)[0]
    expect(account['scheduled_at']).toBe('2026-01-01T00:03:00.000Z')
  })

  it('账号不在列表 → account error', async () => {
    const { fetchFn } = makeFetch((url) => {
      if (url.includes('/accounts')) return { json: [{ id: 'other', provider: 'instagram', name: 'X' }] }
      return { status: 404 }
    })
    const adapter = createPublerInstagramAdapter({ fetchFn, sleep: async () => {} })
    await expect(
      adapter.publish({ videoUrl: 'u', caption: 'c', target: target(), idempotencyTag: 'w', draft: true }),
    ).rejects.toSatisfy(isPublerAccountError)
  })

  it('provider 不是 instagram → account error', async () => {
    const { fetchFn } = makeFetch((url) => {
      if (url.includes('/accounts')) return { json: [{ id: ACCOUNT_ID, provider: 'facebook', name: 'CTS Tours' }] }
      return { status: 404 }
    })
    const adapter = createPublerInstagramAdapter({ fetchFn, sleep: async () => {} })
    await expect(
      adapter.publish({ videoUrl: 'u', caption: 'c', target: target(), idempotencyTag: 'w', draft: true }),
    ).rejects.toSatisfy(isPublerAccountError)
  })

  it('品牌不符 → 防误发拦截', async () => {
    const { fetchFn } = makeFetch((url) => {
      if (url.includes('/accounts')) return ACCOUNTS_OK
      return { status: 404 }
    })
    const adapter = createPublerInstagramAdapter({ fetchFn, sleep: async () => {} })
    await expect(
      adapter.publish({
        videoUrl: 'u',
        caption: 'c',
        target: target({ expect_brand: 'MagicLab' }),
        idempotencyTag: 'w',
        draft: true,
      }),
    ).rejects.toThrow(/防误发/)
  })

  it('任务失败 → 抛错且不返回 ref', async () => {
    const { fetchFn } = makeFetch((url) => {
      if (url.includes('/accounts')) return ACCOUNTS_OK
      if (url.includes('/media/from-url')) return { json: { job_id: 'j1' } }
      if (url.includes('/job_status/j1')) return { json: { status: 'complete', payload: [{ id: 'm1' }] } }
      if (url.includes('/posts/schedule')) return { json: { job_id: 'j2' } }
      if (url.includes('/job_status/j2')) {
        return { json: { status: 'complete', payload: { failures: [{ message: 'Instagram rejected' }] } } }
      }
      return { status: 404 }
    })
    const adapter = createPublerInstagramAdapter({ fetchFn, sleep: async () => {} })
    await expect(
      adapter.publish({ videoUrl: 'u', caption: 'c', target: target(), idempotencyTag: 'w', draft: true }),
    ).rejects.toThrow(/Instagram rejected/)
  })

  it('HTTP 401 → account error,消息不含 key', async () => {
    const { fetchFn } = makeFetch(() => ({ status: 401, text: 'nope' }))
    const adapter = createPublerInstagramAdapter({ fetchFn, sleep: async () => {} })
    let caught: unknown
    try {
      await adapter.publish({ videoUrl: 'u', caption: 'c', target: target(), idempotencyTag: 'w', draft: true })
    } catch (e) {
      caught = e
    }
    expect(isPublerAccountError(caught)).toBe(true)
    expect(String((caught as Error).message)).not.toContain('test-key')
  })

  it('每个请求都带 UA 与授权头', async () => {
    const { fetchFn, calls } = makeFetch((url) => {
      if (url.includes('/accounts')) return ACCOUNTS_OK
      if (url.includes('/media/from-url')) return { json: { job_id: 'j1' } }
      if (url.includes('/job_status/j1')) return { json: { status: 'complete', payload: [{ id: 'm1' }] } }
      if (url.includes('/posts/schedule')) return { json: { job_id: 'j2' } }
      if (url.includes('/job_status/j2')) return { json: { status: 'complete', payload: { failures: {} } } }
      if (url.includes('/posts?')) return { json: [] }
      return { status: 404 }
    })
    const adapter = createPublerInstagramAdapter({ fetchFn, sleep: async () => {} })
    await adapter.publish({ videoUrl: 'u', caption: 'c', target: target(), idempotencyTag: 'w', draft: true })
    expect(calls.length).toBeGreaterThan(0)
    for (const c of calls) {
      expect(c.headers['User-Agent']).toBe('Mozilla/5.0')
      expect(c.headers['Authorization']).toBe('Bearer-API test-key')
    }
  })

  it('任务永不完成 → 超时', async () => {
    const { fetchFn } = makeFetch((url) => {
      if (url.includes('/accounts')) return ACCOUNTS_OK
      if (url.includes('/media/from-url')) return { json: { job_id: 'j1' } }
      if (url.includes('/job_status/j1')) return { json: { status: 'pending' } }
      return { status: 404 }
    })
    const adapter = createPublerInstagramAdapter({ fetchFn, sleep: async () => {} })
    await expect(
      adapter.publish({ videoUrl: 'u', caption: 'c', target: target(), idempotencyTag: 'w', draft: true }),
    ).rejects.toThrow(/超时/)
  })
})

describe('findExisting', () => {
  it('draft 列表命中 → provider_state draft', async () => {
    const tag = encodeIdemTag('wo-9')
    const { fetchFn } = makeFetch((url) => {
      if (url.includes('state=draft')) return { json: [{ id: 'p1', text: `cap${tag}`, state: 'draft' }] }
      return { json: [] }
    })
    const adapter = createPublerInstagramAdapter({ fetchFn, sleep: async () => {} })
    const ref = await adapter.findExisting({ target: target(), idempotencyTag: 'wo-9' })
    expect(ref?.post_id).toBe('p1')
    expect(ref?.provider_state).toBe('draft')
  })

  it('三处都没命中 → null', async () => {
    const { fetchFn } = makeFetch(() => ({ json: [] }))
    const adapter = createPublerInstagramAdapter({ fetchFn, sleep: async () => {} })
    expect(await adapter.findExisting({ target: target(), idempotencyTag: 'wo-9' })).toBeNull()
  })

  it('列表 500 → 抛错(fail closed)', async () => {
    const { fetchFn } = makeFetch(() => ({ status: 500, text: 'boom' }))
    const adapter = createPublerInstagramAdapter({ fetchFn, sleep: async () => {} })
    await expect(adapter.findExisting({ target: target(), idempotencyTag: 'wo-9' })).rejects.toThrow()
  })

  it('排期帖命中 → 带上 Publer 记的发布时间(事件契约要用);草稿没有', async () => {
    const tag = encodeIdemTag('wo-9')
    const { fetchFn } = makeFetch((url) => {
      if (url.includes('state=scheduled')) {
        return { json: { posts: [{ id: 'p2', text: `cap${tag}`, state: 'scheduled', scheduled_at: '2026-10-06T12:03:00.000Z' }] } }
      }
      return { json: [] }
    })
    const adapter = createPublerInstagramAdapter({ fetchFn, sleep: async () => {} })
    const ref = await adapter.findExisting({ target: target(), idempotencyTag: 'wo-9' })
    expect(ref?.provider_state).toBe('scheduled')
    expect(ref?.scheduled_at).toBe('2026-10-06T12:03:00.000Z')
  })

  it('命中了标记却读不到 id → 抛错(不能当没发过放行重发)', async () => {
    const tag = encodeIdemTag('wo-9')
    const { fetchFn } = makeFetch((url) => {
      if (url.includes('state=draft')) return { json: [{ text: `cap${tag}`, state: 'draft' }] }
      return { json: [] }
    })
    const adapter = createPublerInstagramAdapter({ fetchFn, sleep: async () => {} })
    await expect(adapter.findExisting({ target: target(), idempotencyTag: 'wo-9' })).rejects.toThrow(/保守不重发/)
  })
})

describe('buildInstagramReelBody 草稿护栏', () => {
  it('草稿即使被传了排期时间,也绝不写进请求(防草稿被当成排期发出去)', () => {
    const body = buildInstagramReelBody({
      state: 'draft', accountId: 'acct_12345678', mediaId: 'media-0001', text: 'cap',
      scheduledAt: '2026-10-06T12:00:00.000Z',
    }) as { bulk: { posts: Array<{ accounts: Array<Record<string, unknown>> }> } }
    expect(body.bulk.posts[0].accounts[0]).not.toHaveProperty('scheduled_at')
  })
})

describe('错误分类:明确拒绝 vs 不知道建没建出来(防重复帖)', () => {
  const run = (handler: (url: string, method: string) => { status?: number; json?: unknown; text?: string }) => {
    const { fetchFn } = makeFetch(handler)
    const adapter = createPublerInstagramAdapter({ fetchFn, sleep: async () => {} })
    return adapter.publish({ videoUrl: 'u', caption: 'c', target: target(), idempotencyTag: 'wo-1', draft: true })
  }
  const happyUntilSchedule = (url: string, method: string) => {
    if (url.endsWith('/accounts')) return ACCOUNTS_OK
    if (url.endsWith('/media/from-url')) return { json: { job_id: 'jm' } }
    if (url.endsWith('/job_status/jm')) return { json: { status: 'complete', payload: [{ id: 'media-0001' }] } }
    return method === 'POST' ? { status: 500, text: 'upstream timeout' } : { json: [] }
  }

  it('建帖请求返回 5xx → 不是明确拒绝(调用方必须先对账再说)', async () => {
    const err = await run(happyUntilSchedule).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(isPublerRejectedError(err)).toBe(false)
    expect(isPublerAccountError(err)).toBe(false)
  })

  it('建帖请求返回 422 → 明确拒绝', async () => {
    const err = await run((u, m) => (u.endsWith('/posts/schedule') ? { status: 422, text: 'bad media' } : happyUntilSchedule(u, m))).catch((e: unknown) => e)
    expect(isPublerRejectedError(err)).toBe(true)
  })

  it('任务完成但失败清单非空 → 明确拒绝', async () => {
    const err = await run((u, m) => {
      if (u.endsWith('/posts/schedule')) return { json: { job_id: 'jp' } }
      if (u.endsWith('/job_status/jp')) return { json: { status: 'complete', payload: { failures: [{ message: 'nope' }] } } }
      return happyUntilSchedule(u, m)
    }).catch((e: unknown) => e)
    expect(isPublerRejectedError(err)).toBe(true)
  })

  it('任务轮询超时 → 不是明确拒绝', async () => {
    const err = await run((u, m) => {
      if (u.endsWith('/posts/schedule')) return { json: { job_id: 'jp' } }
      if (u.endsWith('/job_status/jp')) return { json: { status: 'working' } }
      return happyUntilSchedule(u, m)
    }).catch((e: unknown) => e)
    expect(String((err as Error).message)).toContain('超时')
    expect(isPublerRejectedError(err)).toBe(false)
  })
})

describe('账号名与对账状态', () => {
  it('有期望品牌却读不到 Publer 账号名 → 账号错误,不发(比 Facebook 更严)', async () => {
    const { fetchFn } = makeFetch(() => ({ json: [{ id: ACCOUNT_ID, provider: 'instagram' }] }))
    const adapter = createPublerInstagramAdapter({ fetchFn, sleep: async () => {} })
    const err = await adapter
      .publish({ videoUrl: 'u', caption: 'c', target: target({ expect_brand: 'CTS Tours' }), idempotencyTag: 'w', draft: true })
      .catch((e: unknown) => e)
    expect(isPublerAccountError(err)).toBe(true)
  })

  it('状态以「在哪个列表里找到」为准,帖子自己的 state 字段缺失也不会把草稿判成排期', async () => {
    const tag = encodeIdemTag('wo-9')
    const { fetchFn } = makeFetch((url) => {
      if (url.includes('state=draft')) return { json: [{ id: 'p1', text: `cap${tag}` }] } // 没有 state 字段
      return { json: [] }
    })
    const adapter = createPublerInstagramAdapter({ fetchFn, sleep: async () => {} })
    const ref = await adapter.findExisting({ target: target(), idempotencyTag: 'wo-9' })
    expect(ref?.provider_state).toBe('draft')
  })

  it('对账会翻到第 2 页(新帖排在后面也不漏)', async () => {
    const tag = encodeIdemTag('wo-9')
    const { fetchFn } = makeFetch((url) => {
      if (url.includes('state=draft') && url.includes('page=0')) return { json: [{ id: 'x', text: 'other' }] }
      if (url.includes('state=draft') && url.includes('page=1')) return { json: [{ id: 'p9', text: `cap${tag}` }] }
      return { json: [] }
    })
    const adapter = createPublerInstagramAdapter({ fetchFn, sleep: async () => {} })
    expect((await adapter.findExisting({ target: target(), idempotencyTag: 'wo-9' }))?.post_id).toBe('p9')
  })
})

describe('assertInstagramBrand(防串客户,比 Facebook 严)', () => {
  it('互相包含且够长 → 放行', () => {
    expect(() => assertInstagramBrand('CTS Tours', 'CTS Tours NZ')).not.toThrow()
    expect(() => assertInstagramBrand('Oztop Building Supplies Pty Ltd', 'oztop building supplies')).not.toThrow()
  })
  it('缺任何一边都不放行(账号名空 / 品牌名空 / 品牌是纯中文归一化后为空)', () => {
    expect(() => assertInstagramBrand('', 'CTS Tours')).toThrow()
    expect(() => assertInstagramBrand('CTS Tours', undefined)).toThrow()
    expect(() => assertInstagramBrand('Dairui Logistics', '大瑞')).toThrow()
  })
  it('较短的一边不足 4 个字符不算包含(cts 不能放行 ctsfurniture)', () => {
    expect(() => assertInstagramBrand('CTS Furniture', 'CTS')).toThrow()
  })
  it('完全不符 → 账号错误(防误发拦截)', () => {
    const err = (() => { try { assertInstagramBrand('Other Client', 'CTS Tours') } catch (e) { return e } return null })()
    expect(isPublerAccountError(err)).toBe(true)
  })
  it('publish:没传品牌名 → 账号错误,什么都不上传', async () => {
    const { fetchFn, calls } = makeFetch(() => ACCOUNTS_OK)
    const adapter = createPublerInstagramAdapter({ fetchFn, sleep: async () => {} })
    const err = await adapter
      .publish({ videoUrl: 'u', caption: 'c', target: target({ expect_brand: undefined }), idempotencyTag: 'w', draft: true })
      .catch((e: unknown) => e)
    expect(isPublerAccountError(err)).toBe(true)
    expect(calls.some((c) => c.url.includes('/media/'))).toBe(false)
  })
})

describe('幂等标记读回', () => {
  const run = (listJson: unknown) => {
    const { fetchFn } = makeFetch((url, method) => {
      if (url.endsWith('/accounts')) return ACCOUNTS_OK
      if (url.endsWith('/media/from-url')) return { json: { job_id: 'jm' } }
      if (url.endsWith('/job_status/jm')) return { json: { status: 'complete', payload: [{ id: 'media-0001' }] } }
      if (url.endsWith('/posts/schedule')) return { json: { job_id: 'jp' } }
      if (url.endsWith('/job_status/jp')) return { json: { status: 'complete', payload: { failures: {} } } }
      return method === 'GET' ? { json: listJson } : { json: {} }
    })
    const adapter = createPublerInstagramAdapter({ fetchFn, sleep: async () => {} })
    return adapter.publish({ videoUrl: 'u', caption: 'c', target: target(), idempotencyTag: 'wo-1', draft: true })
  }
  it('读回成功却没找到标记 → 标 idempotency_unverified(防重复的对账可能失效)', async () => {
    expect((await run([])).idempotency_unverified).toBe(true)
  })
  it('读回找到标记 → 不标', async () => {
    const tag = encodeIdemTag('wo-1')
    expect((await run([{ id: 'p1', text: `c\n${tag}` }])).idempotency_unverified).toBeUndefined()
  })
})
