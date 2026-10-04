import { describe, it, expect, vi } from 'vitest'
import { fetchLiveDraftState } from './draft-live-state'
import { computeMetaFingerprint } from './meta-fingerprint'

/** 假网络：handler 返回 { status?, body }，工厂包装成 Response。 */
type HandlerResult = { status?: number; body: unknown }
type Handler = (url: string) => HandlerResult

/** 记录每次调用的 url 与 init。 */
interface Call {
  url: string
  init?: RequestInit
}

/**
 * 造一个与 fetch 签名一致的假 fetch。
 * 参数用 (input: RequestInfo | URL, init?: RequestInit)，返回 Promise<Response>。
 */
function makeFetch(handler: Handler): { fn: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    calls.push({ url, init })
    const { status = 200, body } = handler(url)
    if (body === 'NOT-JSON') {
      return new Response('NOT-JSON', { status })
    }
    return new Response(JSON.stringify(body), { status })
  }
  return { fn: fn as typeof fetch, calls }
}

/** 默认路由：先匹配更具体的列表路径。 */
function defaultHandler(url: string): HandlerResult {
  if (url.includes('/c1/adsets?')) {
    return { body: { data: [{ id: 's1' }] } }
  }
  if (url.includes('/s1/ads?')) {
    return {
      body: {
        data: [
          {
            id: '111',
            name: 'ad1',
            account_id: '999',
            status: 'PAUSED',
            creative: {
              object_story_spec: {
                page_id: 'p1',
                video_data: {
                  video_id: 'v1',
                  message: 'Join our tour',
                  title: 'Message us',
                  image_hash: 'h1',
                  call_to_action: {
                    type: 'MESSAGE_PAGE',
                    value: { app_destination: 'MESSENGER' },
                  },
                },
              },
            },
          },
          {
            id: '222',
            name: 'ad2',
            account_id: '999',
            status: 'PAUSED',
            creative: {
              object_story_spec: {
                page_id: 'p1',
                video_data: { video_id: 'v2', message: 'Other', title: 'T' },
              },
            },
          },
        ],
      },
    }
  }
  if (url.includes('/c1?')) {
    return {
      body: { id: 'c1', account_id: '999', status: 'PAUSED', objective: 'OUTCOME_ENGAGEMENT' },
    }
  }
  if (url.includes('/s1?')) {
    return {
      body: {
        id: 's1',
        name: 'DM set',
        account_id: '999',
        status: 'PAUSED',
        campaign_id: 'c1',
        optimization_goal: 'CONVERSATIONS',
        destination_type: 'MESSENGER',
        daily_budget: '500',
        end_time: '2026-10-12T09:00:00+1300',
        targeting: {
          geo_locations: { countries: ['NZ'], cities: [{ key: 'k1', name: 'Auckland' }] },
          custom_audiences: [{ id: 'aud1', name: 'A' }],
          expanded_implicit_custom_audiences: [{ id: 'x' }],
          targeting_automation: { advantage_audience: 0 },
        },
      },
    }
  }
  return { status: 404, body: { error: { message: 'unexpected url' } } }
}

const IDS = { campaignId: 'c1', adSetId: 's1', adIds: ['111'] }

/** 跑一次默认成功路径。 */
async function runDefault(handler: Handler = defaultHandler) {
  const { fn, calls } = makeFetch(handler)
  const result = await fetchLiveDraftState('TOKEN123', IDS, fn)
  return { result, calls, fn }
}

describe('fetchLiveDraftState', () => {
  it('成功组装：系列/广告组/兄弟 id/只取要开的广告', async () => {
    const { result } = await runDefault()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const v = result.value
    expect(v.campaign).toEqual({ id: 'c1', accountId: '999', status: 'PAUSED' })
    expect(v.adSet.id).toBe('s1')
    expect(v.adSet.accountId).toBe('999')
    expect(v.adSet.status).toBe('PAUSED')
    expect(v.adSet.dailyBudgetCents).toBe(500)
    expect(v.adSet.endTimeMs).toBe(Date.parse('2026-10-12T09:00:00+1300'))
    expect(v.siblingAdSetIds).toEqual(['s1'])
    expect(v.siblingAdIds).toEqual(['111', '222'])
    expect(v.ads.map((a) => a.id)).toEqual(['111'])
  })

  it('买家文案：adsReadback 只含 111，texts 含 message 与 title', async () => {
    const { result } = await runDefault()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const readback = result.value.adsReadback
    expect(readback.map((a) => a.adId)).toEqual(['111'])
    expect(readback[0].texts).toContain('Join our tour')
    expect(readback[0].texts).toContain('Message us')
  })

  it('adSetReadback：目标/落地/状态与收窄后的 targeting', async () => {
    const { result } = await runDefault()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const rb = result.value.adSetReadback
    expect(rb.optimization_goal).toBe('CONVERSATIONS')
    expect(rb.destination_type).toBe('MESSENGER')
    expect(rb.status).toBe('PAUSED')
    expect(rb.targeting?.geo_locations?.cities).toEqual([{ name: 'Auckland' }])
    expect(rb.targeting?.custom_audiences).toEqual([{ id: 'aud1', name: 'A' }])
    expect(rb.targeting?.expanded_implicit_custom_audiences).toEqual([{ id: 'x' }])
  })

  it('指纹可算：fingerprintRaw 保留 Graph 原始对象', async () => {
    const { result } = await runDefault()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const raw = result.value.fingerprintRaw
    expect(() => computeMetaFingerprint(raw)).not.toThrow()
    const fp = computeMetaFingerprint(raw)
    expect(Object.keys(fp.ads)).toEqual(['111'])
    expect(raw.campaign.objective).toBe('OUTCOME_ENGAGEMENT')
    expect(raw.adSet.daily_budget).toBe('500')
  })

  it('请求参数：token、fields、AbortSignal', async () => {
    const { calls } = await runDefault()
    expect(calls).toHaveLength(4)
    for (const c of calls) {
      expect(c.url).toContain('access_token=TOKEN123')
      expect(c.init?.signal).toBeInstanceOf(AbortSignal)
    }
    const adSetCall = calls.find((c) => c.url.includes('/s1?'))
    expect(adSetCall).toBeDefined()
    expect(adSetCall?.url).toContain('end_time')
    expect(adSetCall?.url).toContain('targeting')
    expect(adSetCall?.url).toContain('frequency_control_specs')
    const adListCall = calls.find((c) => c.url.includes('/s1/ads?'))
    expect(adListCall).toBeDefined()
    expect(adListCall?.url).toContain('creative{')
    expect(adListCall?.url).toContain('degrees_of_freedom_spec')
    expect(adListCall?.url).toContain('url_tags')
  })

  it('翻页：跟随 paging.next 且不拼接坏地址', async () => {
    const handler: Handler = (url) => {
      if (url.includes('/c1/adsets?')) return { body: { data: [{ id: 's1' }] } }
      if (url.includes('after=CURSOR1')) {
        return {
          body: {
            data: [
              {
                id: '333',
                name: 'ad3',
                account_id: '999',
                status: 'PAUSED',
                creative: { object_story_spec: { page_id: 'p1', link_data: { message: 'x' } } },
              },
            ],
          },
        }
      }
      if (url.includes('/s1/ads?')) {
        return {
          body: {
            data: [
              {
                id: '111',
                name: 'ad1',
                account_id: '999',
                status: 'PAUSED',
                creative: { object_story_spec: { page_id: 'p1', video_data: { message: 'm' } } },
              },
            ],
            paging: {
              next: 'https://graph.facebook.com/v21.0/s1/ads?after=CURSOR1&access_token=TOKEN123',
            },
          },
        }
      }
      if (url.includes('/c1?')) {
        return { body: { id: 'c1', account_id: '999', status: 'PAUSED' } }
      }
      if (url.includes('/s1?')) {
        return { body: { id: 's1', account_id: '999', status: 'PAUSED' } }
      }
      return { status: 404, body: { error: { message: 'unexpected' } } }
    }
    const { result, calls } = await runDefault(handler)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.siblingAdIds).toContain('333')
    const page2 = calls.find((c) => c.url.includes('after=CURSOR1'))
    expect(page2).toBeDefined()
    expect(page2?.url.startsWith('https://graph.facebook.com/v21.0/s1/ads?after=CURSOR1')).toBe(true)
    expect(page2?.url).not.toContain('v21.0https')
  })

  it('翻页地址缺 token：请求时被补上', async () => {
    const handler: Handler = (url) => {
      if (url.includes('/c1/adsets?')) return { body: { data: [{ id: 's1' }] } }
      if (url.includes('after=CURSOR2')) {
        return { body: { data: [{ id: '333', name: 'ad3', status: 'PAUSED' }] } }
      }
      if (url.includes('/s1/ads?')) {
        return {
          body: {
            data: [{ id: '111', name: 'ad1', status: 'PAUSED' }],
            paging: { next: 'https://graph.facebook.com/v21.0/s1/ads?after=CURSOR2' },
          },
        }
      }
      if (url.includes('/c1?')) return { body: { id: 'c1', account_id: '999', status: 'PAUSED' } }
      if (url.includes('/s1?')) return { body: { id: 's1', account_id: '999', status: 'PAUSED' } }
      return { status: 404, body: { error: { message: 'unexpected' } } }
    }
    const { result, calls } = await runDefault(handler)
    expect(result.ok).toBe(true)
    const page2 = calls.find((c) => c.url.includes('after=CURSOR2'))
    expect(page2).toBeDefined()
    expect(page2?.url).toContain('access_token=TOKEN123')
  })

  it('拒绝外域：paging.next 指向 evil.example 时不发请求', async () => {
    const handler: Handler = (url) => {
      if (url.includes('/c1/adsets?')) return { body: { data: [{ id: 's1' }] } }
      if (url.includes('/s1/ads?')) {
        return {
          body: {
            data: [{ id: '111', name: 'ad1', status: 'PAUSED' }],
            paging: { next: 'https://evil.example/steal?after=1' },
          },
        }
      }
      if (url.includes('/c1?')) return { body: { id: 'c1', account_id: '999', status: 'PAUSED' } }
      if (url.includes('/s1?')) return { body: { id: 's1', account_id: '999', status: 'PAUSED' } }
      return { status: 404, body: { error: { message: 'unexpected' } } }
    }
    const { result, calls } = await runDefault(handler)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('不是 Meta 官方地址')
    for (const c of calls) {
      expect(c.url).not.toContain('evil.example')
    }
  })

  it('非法翻页地址：ok:false', async () => {
    const handler: Handler = (url) => {
      if (url.includes('/c1/adsets?')) return { body: { data: [{ id: 's1' }] } }
      if (url.includes('/s1/ads?')) {
        return {
          body: {
            data: [{ id: '111', name: 'ad1', status: 'PAUSED' }],
            paging: { next: 'https://' },
          },
        }
      }
      if (url.includes('/c1?')) return { body: { id: 'c1', account_id: '999', status: 'PAUSED' } }
      if (url.includes('/s1?')) return { body: { id: 's1', account_id: '999', status: 'PAUSED' } }
      return { status: 404, body: { error: { message: 'unexpected' } } }
    }
    const { result } = await runDefault(handler)
    expect(result.ok).toBe(false)
  })

  it('翻页超过 25 页仍有 next：ok:false 且提示读不全', async () => {
    let page = 0
    const handler: Handler = (url) => {
      if (url.includes('/c1/adsets?')) return { body: { data: [{ id: 's1' }] } }
      if (url.includes('/s1/ads?')) {
        page += 1
        return {
          body: {
            data: [{ id: '111', name: 'ad1', status: 'PAUSED' }],
            paging: {
              next: `https://graph.facebook.com/v21.0/s1/ads?after=P${page}&access_token=TOKEN123`,
            },
          },
        }
      }
      if (url.includes('/c1?')) return { body: { id: 'c1', account_id: '999', status: 'PAUSED' } }
      if (url.includes('/s1?')) return { body: { id: 's1', account_id: '999', status: 'PAUSED' } }
      return { status: 404, body: { error: { message: 'unexpected' } } }
    }
    const { result } = await runDefault(handler)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('读不全')
  })

  it.each([
    [
      '系列 HTTP 500',
      (url: string): HandlerResult => {
        if (url.includes('/c1?')) return { status: 500, body: { error: { message: 'boom' } } }
        return defaultHandler(url)
      },
      ['500', 'boom'],
    ],
    [
      '广告组返回非 JSON',
      (url: string): HandlerResult => {
        if (url.includes('/s1?')) return { body: 'NOT-JSON' }
        return defaultHandler(url)
      },
      [],
    ],
    [
      '系列返回 id 不一致',
      (url: string): HandlerResult => {
        if (url.includes('/c1?')) return { body: { id: 'other', account_id: '999', status: 'PAUSED' } }
        return defaultHandler(url)
      },
      [],
    ],
    [
      '广告组返回体带 error',
      (url: string): HandlerResult => {
        if (url.includes('/s1?')) return { body: { error: { message: 'nope' } } }
        return defaultHandler(url)
      },
      [],
    ],
    [
      '广告组列表 data 不是数组',
      (url: string): HandlerResult => {
        if (url.includes('/c1/adsets?')) return { body: { data: 'nope' } }
        return defaultHandler(url)
      },
      [],
    ],
  ])('失败：%s → ok:false 且错误信息不含敏感串', async (_name, handler, expected) => {
    const { result } = await runDefault(handler)
    expect(result.ok).toBe(false)
    if (result.ok) return
    for (const token of expected) {
      expect(result.error).toContain(token)
    }
    expect(result.error).not.toContain('TOKEN123')
    expect(result.error).not.toContain('access_token')
    expect(result.error).not.toContain('graph.facebook.com')
  })

  it('失败：广告列表网络异常 → ok:false', async () => {
    const { fn } = makeFetch(defaultHandler)
    const throwing = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('/s1/ads?')) throw new Error('network down')
      return fn(input, init)
    }
    const result = await fetchLiveDraftState('TOKEN123', IDS, throwing as typeof fetch)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).not.toContain('TOKEN123')
    expect(result.error).not.toContain('access_token')
    expect(result.error).not.toContain('graph.facebook.com')
  })

  it('失败：超时（AbortError）→ ok:false', async () => {
    const { fn } = makeFetch(defaultHandler)
    const aborting = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('/s1/ads?')) {
        const err = new Error('aborted')
        err.name = 'AbortError'
        throw err
      }
      return fn(input, init)
    }
    const result = await fetchLiveDraftState('TOKEN123', IDS, aborting as typeof fetch)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).not.toContain('TOKEN123')
    expect(result.error).not.toContain('access_token')
    expect(result.error).not.toContain('graph.facebook.com')
  })

  it('要开的广告 id 不在现场列表：ok:true 但 ads 为空', async () => {
    const { fn } = makeFetch(defaultHandler)
    const result = await fetchLiveDraftState(
      'TOKEN123',
      { campaignId: 'c1', adSetId: 's1', adIds: ['404'] },
      fn,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.ads).toEqual([])
    expect(result.value.siblingAdIds).toEqual(['111', '222'])
  })

  it('缺失字段容错：end_time/daily_budget/account_id/status', async () => {
    const handler: Handler = (url) => {
      if (url.includes('/c1/adsets?')) return { body: { data: [{ id: 's1' }] } }
      if (url.includes('/s1/ads?')) {
        return { body: { data: [{ id: '111', name: 'ad1', status: 'PAUSED' }] } }
      }
      if (url.includes('/c1?')) return { body: { id: 'c1', account_id: '999', status: 'PAUSED' } }
      if (url.includes('/s1?')) {
        return { body: { id: 's1', name: 'DM set', daily_budget: 'abc' } }
      }
      return { status: 404, body: { error: { message: 'unexpected' } } }
    }
    const { result } = await runDefault(handler)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.adSet.endTimeMs).toBeNull()
    expect(result.value.adSet.dailyBudgetCents).toBeNull()
    expect(result.value.adSet.accountId).toBeNull()
    expect(result.value.adSet.status).toBeNull()
  })

  it('缺失字段容错：daily_budget 为小数 → null', async () => {
    const handler: Handler = (url) => {
      if (url.includes('/c1/adsets?')) return { body: { data: [{ id: 's1' }] } }
      if (url.includes('/s1/ads?')) {
        return { body: { data: [{ id: '111', name: 'ad1', status: 'PAUSED' }] } }
      }
      if (url.includes('/c1?')) return { body: { id: 'c1', account_id: '999', status: 'PAUSED' } }
      if (url.includes('/s1?')) return { body: { id: 's1', name: 'DM set', daily_budget: '12.5' } }
      return { status: 404, body: { error: { message: 'unexpected' } } }
    }
    const { result } = await runDefault(handler)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.adSet.dailyBudgetCents).toBeNull()
  })

  it('并行：四个请求在任一返回前已全部发出', async () => {
    const entered: string[] = []
    let release: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      entered.push(url)
      await gate
      const { body, status = 200 } = defaultHandler(url)
      return new Response(JSON.stringify(body), { status })
    }
    const promise = fetchLiveDraftState('TOKEN123', IDS, fn as typeof fetch)
    // 让微任务跑一轮，四个请求应已全部进入。
    await Promise.resolve()
    await Promise.resolve()
    expect(entered).toHaveLength(4)
    if (release) release()
    const result = await promise
    expect(result.ok).toBe(true)
  })
})
