import { describe, it, expect, vi } from 'vitest'
import {
  parseGraphTime,
  foldStatsBuckets,
  parseQualityBody,
  parseAccountBody,
  MAX_STATS_PAGES,
  readMetaFacts,
  type MetaReadInput,
} from '../meta-reader'
import { RETRY_DELAY_MS } from '../retry'
import type { MetaAccountFact } from '../types'
import adspixelsFixture from './fixtures/graph-adspixels.json'
import statsPage1Fixture from './fixtures/graph-stats-page1.json'
import statsPage2Fixture from './fixtures/graph-stats-page2.json'
import datasetQualityFixture from './fixtures/graph-dataset-quality.json'
import accountFixture from './fixtures/graph-account.json'

const NOW = new Date('2026-10-19T10:30:00.000Z')
const TOKEN = 'SECRET_TOKEN_VALUE_123'
const ACCOUNT_ID = 'act_1111111111'
const FOCUS_PIXEL = '2000000000000001'
const OTHER_PIXEL = '2000000000000002'
const UNKNOWN_PIXEL = '2999999999999999'

// ─── helpers ────────────────────────────────────────────────────────────────

interface Bucket {
  start_time?: string
  timestamp?: string
  data?: readonly { value: string; count: number }[]
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function concatBuckets(): Bucket[] {
  const page1 = statsPage1Fixture.data as Bucket[]
  const page2 = statsPage2Fixture.data as Bucket[]
  return [...page1, ...page2]
}

/** 测试里不真等：失败重试前的等待在这里直接略过（要看等待的用例自己传记录器）。 */
const noSleep = async (): Promise<void> => undefined

function makeInput(fetcher: typeof fetch): MetaReadInput {
  return {
    adAccountId: ACCOUNT_ID,
    focusPixelIds: [FOCUS_PIXEL, UNKNOWN_PIXEL],
    token: TOKEN,
    fetcher,
    now: NOW,
    sleep: noSleep,
  }
}

interface RecordedCall {
  url: string
  init: RequestInit | undefined
}

function recordCalls(fetcher: ReturnType<typeof vi.fn>): RecordedCall[] {
  return fetcher.mock.calls.map((call) => {
    const [url, init] = call as [unknown, RequestInit | undefined]
    return { url: String(url), init }
  })
}

function pathOf(url: string): string {
  const parsed = new URL(url)
  // strip the version segment (e.g. /v21.0)
  return parsed.pathname.replace(/^\/v\d+\.\d+\//, '')
}

function searchOf(url: string): URLSearchParams {
  return new URL(url).searchParams
}

function headerOf(init: RequestInit | undefined, name: string): string | null {
  if (!init || !init.headers) return null
  const headers = init.headers
  if (headers instanceof Headers) return headers.get(name)
  if (Array.isArray(headers)) {
    const found = headers.find(([k]) => k.toLowerCase() === name.toLowerCase())
    return found ? found[1] : null
  }
  const record = headers as Record<string, string>
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === name.toLowerCase()) return record[key]
  }
  return null
}

/**
 * Scripted fetcher that serves the happy-path fixtures. Individual tests can
 * override specific routes via the `overrides` map (keyed by pathname).
 */
function makeHappyFetcher(): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input)
    const path = pathOf(url)
    const params = searchOf(url)

    if (path === `${ACCOUNT_ID}/adspixels`) {
      return jsonResponse(adspixelsFixture)
    }
    if (path === ACCOUNT_ID) {
      return jsonResponse(accountFixture)
    }
    if (path === `${FOCUS_PIXEL}/stats`) {
      const after = params.get('after')
      if (after === 'AFTER1') return jsonResponse(statsPage2Fixture)
      return jsonResponse(statsPage1Fixture)
    }
    if (path === 'dataset_quality') {
      return jsonResponse(datasetQualityFixture)
    }
    return jsonResponse({ error: { message: `unexpected path ${path}` } }, 404)
  })
}

// ─── parseGraphTime ─────────────────────────────────────────────────────────

describe('parseGraphTime', () => {
  it('把 Meta 的无冒号时区偏移 +1300 解析成 UTC', () => {
    expect(parseGraphTime('2026-10-19T12:51:21+1300')).toBe('2026-10-18T23:51:21.000Z')
  })

  it('把 -0700 偏移解析成 UTC', () => {
    expect(parseGraphTime('2026-10-19T03:20:54-0700')).toBe('2026-10-19T10:20:54.000Z')
  })

  it('null / undefined / 空串 / 乱码 / 数字都返回 null', () => {
    expect(parseGraphTime(null)).toBeNull()
    expect(parseGraphTime(undefined)).toBeNull()
    expect(parseGraphTime('')).toBeNull()
    expect(parseGraphTime('garbage')).toBeNull()
    expect(parseGraphTime(12345)).toBeNull()
  })

  it('Unix 纪元值（Meta 用来表示「从未触发」）返回 null', () => {
    expect(parseGraphTime('1969-12-31T16:00:00-0800')).toBeNull()
  })
})

// ─── foldStatsBuckets ───────────────────────────────────────────────────────

describe('foldStatsBuckets', () => {
  it('把两页 fixture 的桶合并成 7 天和 24 天的计数', () => {
    const result = foldStatsBuckets(concatBuckets(), NOW)
    expect(result.events_7d).toEqual({ PageView: 73, Lead: 6 })
    expect(result.events_24h).toEqual({ PageView: 11 })
  })

  it('只出现见过的活动，伪事件 __missing_event 被忽略', () => {
    const result = foldStatsBuckets(concatBuckets(), NOW)
    expect(Object.keys(result.events_7d).sort()).toEqual(['Lead', 'PageView'])
    expect(result.events_7d).not.toHaveProperty('__missing_event')
    expect(result.events_24h).not.toHaveProperty('__missing_event')
  })

  it('恰好早于窗口起点 1 小时的桶被排除', () => {
    // 24h window start = 2026-10-18T10:30:00.000Z
    // bucket start = 2026-10-18T09:30:00.000Z → start + 1h = 10:30:00 == windowStart → excluded
    const buckets: Bucket[] = [
      {
        start_time: '2026-10-18T09:30:00.000Z',
        data: [{ value: 'PageView', count: 5 }],
      },
    ]
    const result = foldStatsBuckets(buckets, NOW)
    expect(result.events_24h).toEqual({})
    expect(result.events_7d).toEqual({ PageView: 5 })
  })

  it('早于窗口起点 59 分钟的桶被包含', () => {
    // bucket start = 2026-10-18T09:31:00.000Z → start + 1h = 10:31:00 > windowStart → included
    const buckets: Bucket[] = [
      {
        start_time: '2026-10-18T09:31:00.000Z',
        data: [{ value: 'PageView', count: 5 }],
      },
    ]
    const result = foldStatsBuckets(buckets, NOW)
    expect(result.events_24h).toEqual({ PageView: 5 })
  })

  it('10 天前的桶在两个窗口里都被排除', () => {
    const buckets: Bucket[] = [
      {
        start_time: '2026-10-09T10:30:00.000Z',
        data: [{ value: 'PageView', count: 99 }],
      },
    ]
    const result = foldStatsBuckets(buckets, NOW)
    expect(result.events_24h).toEqual({})
    expect(result.events_7d).toEqual({})
  })

  it('未来的桶（start > now）被排除', () => {
    const buckets: Bucket[] = [
      {
        start_time: '2026-10-20T10:30:00.000Z',
        data: [{ value: 'PageView', count: 99 }],
      },
    ]
    const result = foldStatsBuckets(buckets, NOW)
    expect(result.events_24h).toEqual({})
    expect(result.events_7d).toEqual({})
  })

  it('用 timestamp 键代替 start_time 的桶也被接受', () => {
    const buckets: Bucket[] = [
      {
        timestamp: '2026-10-19T09:00:00.000Z',
        data: [{ value: 'Lead', count: 3 }],
      },
    ]
    const result = foldStatsBuckets(buckets, NOW)
    expect(result.events_24h).toEqual({ Lead: 3 })
    expect(result.events_7d).toEqual({ Lead: 3 })
  })

  it('垃圾条目（null / 字符串 / 没有 data 数组）被跳过且不抛错', () => {
    const buckets: unknown[] = [
      null,
      'not a bucket',
      { start_time: '2026-10-19T09:00:00.000Z' },
      { start_time: '2026-10-19T09:00:00.000Z', data: [{ value: 'Lead', count: 2 }] },
    ]
    const result = foldStatsBuckets(buckets, NOW)
    expect(result.events_24h).toEqual({ Lead: 2 })
    expect(result.events_7d).toEqual({ Lead: 2 })
  })
})

// ─── parseQualityBody ───────────────────────────────────────────────────────

describe('parseQualityBody', () => {
  it('把 fixture 解析成事件名到分数的映射', () => {
    expect(parseQualityBody(datasetQualityFixture)).toEqual({
      Subscribe: 7.7,
      PageView: 6.1,
      Lead: 9.3,
    })
  })

  it('没有 web 数组 / null / 字符串都返回 null', () => {
    expect(parseQualityBody({})).toBeNull()
    expect(parseQualityBody(null)).toBeNull()
    expect(parseQualityBody('nope')).toBeNull()
  })

  it('没有数字 composite_score 的条目被跳过', () => {
    const body = {
      web: [
        { event_name: 'Lead', event_match_quality: { composite_score: 9.3 } },
        { event_name: 'PageView', event_match_quality: {} },
        { event_name: 'Subscribe', event_match_quality: { composite_score: 'high' } },
      ],
    }
    expect(parseQualityBody(body)).toEqual({ Lead: 9.3 })
  })
})

// ─── parseAccountBody ───────────────────────────────────────────────────────

describe('parseAccountBody', () => {
  it('把 fixture 解析成账户事实（字符串金额按最小货币单位转数字）', () => {
    const expected: MetaAccountFact = {
      status: 1,
      disable_reason: 0,
      has_funding_source: true,
      spend_cap_minor: 0,
      amount_spent_minor: 29434,
      currency: 'NZD',
    }
    expect(parseAccountBody(accountFixture)).toEqual(expected)
  })

  it('funding_source 缺失时 has_funding_source 为 null', () => {
    const body = {
      account_status: 1,
      disable_reason: 0,
      currency: 'NZD',
      spend_cap: '0',
      amount_spent: '0',
    }
    expect(parseAccountBody(body).has_funding_source).toBeNull()
  })

  it('funding_source 为空串或 null 时 has_funding_source 为 false', () => {
    const base = {
      account_status: 1,
      disable_reason: 0,
      currency: 'NZD',
      spend_cap: '0',
      amount_spent: '0',
    }
    expect(parseAccountBody({ ...base, funding_source: '' }).has_funding_source).toBe(false)
    expect(parseAccountBody({ ...base, funding_source: null }).has_funding_source).toBe(false)
  })

  it('非数字的 spend_cap / amount_spent 变成 null', () => {
    const body = {
      account_status: 1,
      disable_reason: 0,
      funding_source: '3000000000000001',
      currency: 'NZD',
      spend_cap: 'lots',
      amount_spent: 'n/a',
    }
    const parsed = parseAccountBody(body)
    expect(parsed.spend_cap_minor).toBeNull()
    expect(parsed.amount_spent_minor).toBeNull()
  })

  it('缺少 account_status 时 status 为 null', () => {
    const body = {
      disable_reason: 0,
      funding_source: '3000000000000001',
      currency: 'NZD',
      spend_cap: '0',
      amount_spent: '0',
    }
    expect(parseAccountBody(body).status).toBeNull()
  })
})

// ─── readMetaFacts ──────────────────────────────────────────────────────────

describe('readMetaFacts', () => {
  it('happy path：读取账户数据集、聚焦数据集的事件与质量', async () => {
    const fetcher = makeHappyFetcher()
    const result = await readMetaFacts(makeInput(fetcher as unknown as typeof fetch))

    expect(result.errors).toEqual([])
    expect(result.facts.read).toBe(true)
    expect(result.facts.as_of).toBe(NOW.toISOString())
    expect(result.facts.account_dataset_ids).toEqual([FOCUS_PIXEL, OTHER_PIXEL])
    expect(result.facts.datasets).toHaveLength(2)

    const focused = result.facts.datasets.find((d) => d.id === FOCUS_PIXEL)
    expect(focused).toBeDefined()
    expect(focused?.name).toBe('Main dataset')
    expect(focused?.last_fired_at).toBe('2026-10-18T23:51:21.000Z')
    expect(focused?.events_7d).toEqual({ PageView: 73, Lead: 6 })
    expect(focused?.events_24h).toEqual({ PageView: 11 })
    expect(focused?.match_quality).toEqual({ Subscribe: 7.7, PageView: 6.1, Lead: 9.3 })

    const other = result.facts.datasets.find((d) => d.id === OTHER_PIXEL)
    expect(other).toBeDefined()
    expect(other?.last_fired_at).toBeNull()
    expect(other?.events_24h).toBeNull()
    expect(other?.events_7d).toBeNull()
    expect(other?.match_quality).toBeNull()

    expect(result.facts.account).toEqual(parseAccountBody(accountFixture))
  })

  it('stats 分页用我们自己的 URL 加 after=AFTER1，绝不请求 paging.next', async () => {
    const fetcher = makeHappyFetcher()
    await readMetaFacts(makeInput(fetcher as unknown as typeof fetch))

    const calls = recordCalls(fetcher)
    const statsCalls = calls.filter((c) => pathOf(c.url) === `${FOCUS_PIXEL}/stats`)
    expect(statsCalls.length).toBeGreaterThanOrEqual(2)

    const afterValues = statsCalls.map((c) => searchOf(c.url).get('after'))
    expect(afterValues).toContain(null)
    expect(afterValues).toContain('AFTER1')

    for (const call of calls) {
      expect(call.url).not.toContain('LEAKY_TOKEN_IN_NEXT_URL')
    }
  })

  it('每个请求都是 GET、带 Bearer 头、URL 里没有令牌、redirect 为 error', async () => {
    const fetcher = makeHappyFetcher()
    await readMetaFacts(makeInput(fetcher as unknown as typeof fetch))

    const calls = recordCalls(fetcher)
    expect(calls.length).toBeGreaterThan(0)

    for (const call of calls) {
      const method = call.init?.method
      expect(method === undefined || method === 'GET').toBe(true)
      expect(headerOf(call.init, 'Authorization')).toBe(`Bearer ${TOKEN}`)
      expect(call.url).not.toContain(TOKEN)
      expect(call.url).not.toContain('access_token')
      expect(call.init?.redirect).toBe('error')
    }
  })

  it('stats 请求带 aggregation=event 和 Unix 秒的 start_time / end_time', async () => {
    const fetcher = makeHappyFetcher()
    await readMetaFacts(makeInput(fetcher as unknown as typeof fetch))

    const statsCall = recordCalls(fetcher).find(
      (c) => pathOf(c.url) === `${FOCUS_PIXEL}/stats` && searchOf(c.url).get('after') === null,
    )
    expect(statsCall).toBeDefined()
    const params = searchOf(statsCall!.url)
    expect(params.get('aggregation')).toBe('event')
    const expectedStart = Math.floor((NOW.getTime() - 7 * 24 * 60 * 60 * 1000) / 1000)
    const expectedEnd = Math.floor(NOW.getTime() / 1000)
    expect(params.get('start_time')).toBe(String(expectedStart))
    expect(params.get('end_time')).toBe(String(expectedEnd))
  })

  it('adspixels 返回 400 时 read 为 false，错误里不含令牌', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input)
      const path = pathOf(url)
      if (path === `${ACCOUNT_ID}/adspixels`) {
        return jsonResponse(
          {
            error: {
              message: `Invalid OAuth access token ${TOKEN}`,
              code: 190,
            },
          },
          400,
        )
      }
      if (path === ACCOUNT_ID) return jsonResponse(accountFixture)
      if (path === `${FOCUS_PIXEL}/stats`) return jsonResponse(statsPage1Fixture)
      if (path === 'dataset_quality') return jsonResponse(datasetQualityFixture)
      return jsonResponse({}, 404)
    })

    const result = await readMetaFacts(makeInput(fetcher as unknown as typeof fetch))

    expect(result.facts.read).toBe(false)
    expect(result.facts.account_dataset_ids).toEqual([])
    expect(result.facts.datasets).toEqual([])
    expect(result.errors.length).toBeGreaterThan(0)
    for (const err of result.errors) {
      expect(err).not.toContain(TOKEN)
    }
    expect(JSON.stringify(result)).not.toContain(TOKEN)
    expect(result.facts.account).toEqual(parseAccountBody(accountFixture))
  })

  it('某个数据集的 stats 返回 500 时该数据集事件为 null，其他数据仍返回', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input)
      const path = pathOf(url)
      if (path === `${ACCOUNT_ID}/adspixels`) return jsonResponse(adspixelsFixture)
      if (path === ACCOUNT_ID) return jsonResponse(accountFixture)
      if (path === `${FOCUS_PIXEL}/stats`) {
        return jsonResponse({ error: { message: 'server error' } }, 500)
      }
      if (path === 'dataset_quality') return jsonResponse(datasetQualityFixture)
      return jsonResponse({}, 404)
    })

    const result = await readMetaFacts(makeInput(fetcher as unknown as typeof fetch))

    expect(result.facts.read).toBe(true)
    const focused = result.facts.datasets.find((d) => d.id === FOCUS_PIXEL)
    expect(focused).toBeDefined()
    expect(focused?.events_24h).toBeNull()
    expect(focused?.events_7d).toBeNull()
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.facts.account_dataset_ids).toEqual([FOCUS_PIXEL, OTHER_PIXEL])
  })

  it('分页永不结束时在 MAX_STATS_PAGES 次后停止，事件为 null 且错误提到「分页」', async () => {
    let statsCallCount = 0
    const fetcher = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input)
      const path = pathOf(url)
      if (path === `${ACCOUNT_ID}/adspixels`) return jsonResponse(adspixelsFixture)
      if (path === ACCOUNT_ID) return jsonResponse(accountFixture)
      if (path === `${FOCUS_PIXEL}/stats`) {
        statsCallCount += 1
        return jsonResponse({
          data: [
            {
              start_time: '2026-10-19T09:00:00+1300',
              aggregation: 'event',
              data: [{ value: 'PageView', count: 1 }],
            },
          ],
          // 还有下一页的标志是 paging.next；最后一页即使带 cursors 也不会有 next
          paging: {
            cursors: { before: 'B', after: `AFTER${statsCallCount}` },
            next: `https://graph.facebook.com/v21.0/${FOCUS_PIXEL}/stats?after=AFTER${statsCallCount}`,
          },
        })
      }
      if (path === 'dataset_quality') return jsonResponse(datasetQualityFixture)
      return jsonResponse({}, 404)
    })

    const result = await readMetaFacts(makeInput(fetcher as unknown as typeof fetch))

    expect(statsCallCount).toBe(MAX_STATS_PAGES)
    const focused = result.facts.datasets.find((d) => d.id === FOCUS_PIXEL)
    expect(focused).toBeDefined()
    expect(focused?.events_24h).toBeNull()
    expect(focused?.events_7d).toBeNull()
    expect(result.errors.some((e) => e.includes('分页'))).toBe(true)
  })

  it('说有下一页却没给翻页游标 → 事件为 null，错误提到分页（半截结果不能当完整的）', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const path = pathOf(String(input))
      if (path === `${ACCOUNT_ID}/adspixels`) return jsonResponse(adspixelsFixture)
      if (path === ACCOUNT_ID) return jsonResponse(accountFixture)
      if (path === `${FOCUS_PIXEL}/stats`) {
        return jsonResponse({ data: statsPage1Fixture.data, paging: { next: 'https://graph.facebook.com/v21.0/next' } })
      }
      if (path === 'dataset_quality') return jsonResponse(datasetQualityFixture)
      return jsonResponse({}, 404)
    })

    const result = await readMetaFacts(makeInput(fetcher))

    const focused = result.facts.datasets.find((d) => d.id === FOCUS_PIXEL)
    expect(focused?.events_7d).toBeNull()
    expect(focused?.events_24h).toBeNull()
    expect(result.errors.some((e) => e.includes('分页'))).toBe(true)
  })

  it('网络异常被记录进 errors 且不含令牌，readMetaFacts 不 reject', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input)
      const path = pathOf(url)
      if (path === `${ACCOUNT_ID}/adspixels`) {
        throw new Error(`boom ${TOKEN}`)
      }
      if (path === ACCOUNT_ID) return jsonResponse(accountFixture)
      if (path === `${FOCUS_PIXEL}/stats`) return jsonResponse(statsPage1Fixture)
      if (path === 'dataset_quality') return jsonResponse(datasetQualityFixture)
      return jsonResponse({}, 404)
    })

    const result = await readMetaFacts(makeInput(fetcher as unknown as typeof fetch))

    expect(result.errors.length).toBeGreaterThan(0)
    for (const err of result.errors) {
      expect(err).not.toContain(TOKEN)
    }
    expect(JSON.stringify(result)).not.toContain(TOKEN)
  })

  it('adAccountId 不是 act_<数字> 时一次 fetch 都不发', async () => {
    const fetcher = vi.fn(async (): Promise<Response> => jsonResponse({}))
    const input: MetaReadInput = {
      adAccountId: '../me',
      focusPixelIds: [FOCUS_PIXEL],
      token: TOKEN,
      fetcher: fetcher as unknown as typeof fetch,
      now: NOW,
    }

    const result = await readMetaFacts(input)

    expect(fetcher).not.toHaveBeenCalled()
    expect(result.facts.read).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

// ─── 瞬时故障重试一次 ────────────────────────────────────────────────────────
// 审查整改：读取器永不 reject，函数级的 retries: 2 救不了一次超时。
// 每个 Graph 请求在读取器内部多试一次（只对瞬时故障：网络错误 / 429 / 5xx / Meta 自己标的瞬时错误），
// 永久性错误（令牌失效、权限、参数错）不重试。

type Fail = () => Response | Error

/** 在 happy 路径之上，让指定路径的前 N 次请求按剧本失败，之后恢复正常。 */
function flakyFetcher(failPath: string, failures: Fail[]) {
  const happy = makeHappyFetcher()
  let used = 0
  const order: string[] = []
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = pathOf(String(input))
    if (path === failPath && used < failures.length) {
      const next = failures[used]
      used += 1
      order.push('fetch:fail')
      const failure = next()
      if (failure instanceof Error) throw failure
      return failure
    }
    if (path === failPath) order.push('fetch:ok')
    return happy(input, init)
  })
  return { fetcher, order }
}

function sleepRecorder(order: string[]) {
  const sleeps: number[] = []
  return { sleeps, sleep: async (ms: number): Promise<void> => { sleeps.push(ms); order.push('sleep') } }
}

describe('readMetaFacts · 瞬时故障重试一次', () => {
  it('stats 第一次返回 503、第二次正常 → 读到完整事件统计，没有错误；中间等了一次，且是先等再发第二次', async () => {
    const { fetcher, order } = flakyFetcher(`${FOCUS_PIXEL}/stats`, [
      () => jsonResponse({ error: { message: 'Service Unavailable', code: 2 } }, 503),
    ])
    const rec = sleepRecorder(order)
    const result = await readMetaFacts({ ...makeInput(fetcher as unknown as typeof fetch), sleep: rec.sleep })

    expect(result.errors).toEqual([])
    const focused = result.facts.datasets.find((d) => d.id === FOCUS_PIXEL)
    expect(focused?.events_7d).toEqual({ PageView: 73, Lead: 6 })
    expect(rec.sleeps).toEqual([RETRY_DELAY_MS])
    expect(order.slice(0, 3)).toEqual(['fetch:fail', 'sleep', 'fetch:ok'])
  })

  it('adspixels 第一次抛网络错误、第二次正常 → read 为 true，数据集读到', async () => {
    const { fetcher } = flakyFetcher(`${ACCOUNT_ID}/adspixels`, [() => new Error('socket hang up')])
    const rec = sleepRecorder([])
    const result = await readMetaFacts({ ...makeInput(fetcher as unknown as typeof fetch), sleep: rec.sleep })
    expect(result.facts.read).toBe(true)
    expect(result.facts.account_dataset_ids).toEqual([FOCUS_PIXEL, OTHER_PIXEL])
    expect(result.errors).toEqual([])
    expect(rec.sleeps).toEqual([RETRY_DELAY_MS])
  })

  it('账户读取第一次返回 429 限流 → 再试一次就拿到账户状态', async () => {
    const { fetcher } = flakyFetcher(ACCOUNT_ID, [() => jsonResponse({ error: { message: 'rate', code: 4 } }, 429)])
    const result = await readMetaFacts({ ...makeInput(fetcher as unknown as typeof fetch), sleep: noSleep })
    expect(result.facts.account).toEqual(parseAccountBody(accountFixture))
    expect(result.errors).toEqual([])
  })

  it('Meta 自己标了 is_transient（哪怕 HTTP 状态是 400、错误码平时是永久性的 100）→ 当作瞬时故障重试', async () => {
    const { fetcher } = flakyFetcher(`${FOCUS_PIXEL}/stats`, [
      () => jsonResponse({ error: { message: 'try later', code: 100, is_transient: true } }, 400),
    ])
    const result = await readMetaFacts({ ...makeInput(fetcher as unknown as typeof fetch), sleep: noSleep })
    expect(result.errors).toEqual([])
    expect(result.facts.datasets.find((d) => d.id === FOCUS_PIXEL)?.events_7d).not.toBeNull()
  })

  it('5xx（哪怕错误码不在瞬时清单里）→ 当作瞬时故障重试一次', async () => {
    const { fetcher } = flakyFetcher(`${FOCUS_PIXEL}/stats`, [
      () => jsonResponse({ error: { message: 'internal', code: 99999 } }, 500),
    ])
    const result = await readMetaFacts({ ...makeInput(fetcher as unknown as typeof fetch), sleep: noSleep })
    expect(result.errors).toEqual([])
    expect(result.facts.datasets.find((d) => d.id === FOCUS_PIXEL)?.events_7d).not.toBeNull()
  })

  it('没标 is_transient、状态 400、错误码 100 → 永久性错误，不重试', async () => {
    const { fetcher } = flakyFetcher(`${FOCUS_PIXEL}/stats`, [
      () => jsonResponse({ error: { message: 'invalid parameter', code: 100 } }, 400),
      () => jsonResponse({ error: { message: 'invalid parameter', code: 100 } }, 400),
    ])
    const rec = sleepRecorder([])
    await readMetaFacts({ ...makeInput(fetcher as unknown as typeof fetch), sleep: rec.sleep })
    const statsCalls = recordCalls(fetcher).filter((c) => pathOf(c.url) === `${FOCUS_PIXEL}/stats`)
    expect(statsCalls).toHaveLength(1)
    expect(rec.sleeps).toEqual([])
  })

  it('返回的不是 JSON（网关错误页）→ 当作瞬时故障重试', async () => {
    const { fetcher } = flakyFetcher(`${FOCUS_PIXEL}/stats`, [() => new Response('<html>Bad Gateway</html>', { status: 502 })])
    const result = await readMetaFacts({ ...makeInput(fetcher as unknown as typeof fetch), sleep: noSleep })
    expect(result.errors).toEqual([])
  })

  it('永久性错误（令牌失效 190 / 参数错 100 / 没权限 200）不重试：只发一次，也不等待', async () => {
    for (const [status, code] of [[400, 190], [400, 100], [403, 200]] as const) {
      const { fetcher } = flakyFetcher(`${ACCOUNT_ID}/adspixels`, [
        () => jsonResponse({ error: { message: `permanent ${code}`, code } }, status),
        () => jsonResponse({ error: { message: `permanent ${code}`, code } }, status),
      ])
      const rec = sleepRecorder([])
      const result = await readMetaFacts({ ...makeInput(fetcher as unknown as typeof fetch), sleep: rec.sleep })
      const pixelCalls = recordCalls(fetcher).filter((c) => pathOf(c.url) === `${ACCOUNT_ID}/adspixels`)
      expect(pixelCalls, `code ${code}`).toHaveLength(1)
      expect(rec.sleeps, `code ${code}`).toEqual([])
      expect(result.facts.read, `code ${code}`).toBe(false)
    }
  })

  it('连着两次瞬时故障 → 放弃（该数据集事件为 null，错误里不含令牌），一个请求只发两次', async () => {
    const boom = () => jsonResponse({ error: { message: `down ${TOKEN}`, code: 2 } }, 503)
    const { fetcher } = flakyFetcher(`${FOCUS_PIXEL}/stats`, [boom, boom, boom, boom, boom, boom])
    const result = await readMetaFacts({ ...makeInput(fetcher as unknown as typeof fetch), sleep: noSleep })
    const focused = result.facts.datasets.find((d) => d.id === FOCUS_PIXEL)
    expect(focused?.events_7d).toBeNull()
    expect(result.errors.length).toBeGreaterThan(0)
    expect(JSON.stringify(result)).not.toContain(TOKEN)
    const statsCalls = recordCalls(fetcher).filter((c) => pathOf(c.url) === `${FOCUS_PIXEL}/stats`)
    expect(statsCalls).toHaveLength(2)
  })
})
