/**
 * Facebook 即时表单取数的测试。
 *
 * 钉住的都是「错了会静默丢人」的地方：
 *   · Meta 的时间格式 parse 不了 → 整条 lead 该被丢掉，不能写个假时间进冷热分级
 *   · 完整字段被 Graph 拒 → 必须退回最小字段集重试，而不是整批 lead 丢掉
 *   · 翻页没翻完 → 必须报错，不能让半截看起来像跑完了
 *   · 取数失败 → 错误原文要带出来（缺权限和「今天没人填表」在数据上一模一样）
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchFormLeads, fetchPageLeadForms, normaliseGraphTime } from '../lead-forms'

const okJson = (body: unknown) =>
  ({ ok: true, json: async () => body, text: async () => JSON.stringify(body) }) as Response

const httpError = (status: number, body: string) =>
  ({ ok: false, status, json: async () => ({}), text: async () => body }) as Response

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('normaliseGraphTime', () => {
  it('认 Meta 的 +0000 写法', () => {
    expect(normaliseGraphTime('2026-07-28T04:19:48+0000')).toBe('2026-07-28T04:19:48.000Z')
  })

  it('认标准 ISO', () => {
    expect(normaliseGraphTime('2026-07-28T04:19:48Z')).toBe('2026-07-28T04:19:48.000Z')
  })

  it('认不出来返回 null —— 假时间会污染冷热分级', () => {
    expect(normaliseGraphTime('昨天下午')).toBeNull()
    expect(normaliseGraphTime('')).toBeNull()
    expect(normaliseGraphTime(undefined)).toBeNull()
  })
})

describe('fetchPageLeadForms', () => {
  it('翻页把两页表单都收上来', async () => {
    fetchMock
      .mockResolvedValueOnce(
        okJson({ data: [{ id: 'f1', name: '表单一', status: 'ACTIVE' }], paging: { next: 'p2' } }),
      )
      .mockResolvedValueOnce(okJson({ data: [{ id: 'f2', name: '表单二' }] }))

    const res = await fetchPageLeadForms('page-1', 'tok')
    expect(res.error).toBeNull()
    expect(res.rows.map((f) => f.formId)).toEqual(['f1', 'f2'])
    expect(res.rows[1].status).toBeNull()
  })

  it('权限不足时把 Graph 的原话带回来（不能静默返回空）', async () => {
    fetchMock.mockResolvedValueOnce(
      httpError(403, '{"error":{"message":"(#278) Requires leads_retrieval permission"}}'),
    )

    const res = await fetchPageLeadForms('page-1', 'tok')
    expect(res.rows).toEqual([])
    expect(res.error).toContain('leads_retrieval')
  })
})

describe('fetchFormLeads', () => {
  const SINCE = new Date('2026-07-24T00:00:00Z')

  const rawLead = {
    id: 'lead-1',
    created_time: '2026-07-28T04:19:48+0000',
    ad_id: 'ad1',
    ad_name: 'Reel A',
    adset_id: 'as1',
    campaign_id: 'c1',
    platform: 'fb',
    is_organic: false,
    field_data: [
      { name: 'full_name', values: ['Chris Brown'] },
      { name: 'email', values: ['chris@example.com'] },
      { name: 'phone_number', values: ['p:+6421363598'] },
    ],
  }

  it('拉到的 lead 带齐归因字段', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ data: [rawLead] }))

    const res = await fetchFormLeads('f1', 'tok', SINCE)
    expect(res.error).toBeNull()
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0]).toMatchObject({
      leadId: 'lead-1',
      createdTime: '2026-07-28T04:19:48.000Z',
      adId: 'ad1',
      adsetId: 'as1',
      campaignId: 'c1',
      platform: 'fb',
      isOrganic: false,
    })
    expect(res.rows[0].answers).toHaveLength(3)
  })

  it('把 since 作为 time_created 过滤条件发出去（秒级 unix）', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ data: [] }))
    await fetchFormLeads('f1', 'tok', SINCE)

    const url = String(fetchMock.mock.calls[0][0])
    expect(decodeURIComponent(url)).toContain('"field":"time_created"')
    expect(decodeURIComponent(url)).toContain(`"value":${Math.floor(SINCE.getTime() / 1000)}`)
  })

  it('完整字段被拒 → 退回最小字段集重试，人不能丢', async () => {
    fetchMock
      .mockResolvedValueOnce(httpError(400, '{"error":{"message":"(#100) Unknown field is_organic"}}'))
      .mockResolvedValueOnce(
        okJson({
          data: [
            {
              id: 'lead-1',
              created_time: '2026-07-28T04:19:48+0000',
              field_data: [{ name: 'email', values: ['chris@example.com'] }],
            },
          ],
        }),
      )

    const res = await fetchFormLeads('f1', 'tok', SINCE)
    expect(res.error).toBeNull()
    expect(res.rows).toHaveLength(1)
    // 降级的代价是归因为空 —— 留 NULL 是事实，不是漏了。
    expect(res.rows[0].adId).toBeNull()

    const retryUrl = decodeURIComponent(String(fetchMock.mock.calls[1][0]))
    expect(retryUrl).toContain('fields=id,created_time,field_data')
  })

  it('两次都失败才如实报错', async () => {
    fetchMock
      .mockResolvedValueOnce(httpError(400, 'boom'))
      .mockResolvedValueOnce(httpError(400, 'boom again'))

    const res = await fetchFormLeads('f1', 'tok', SINCE)
    expect(res.rows).toEqual([])
    expect(res.error).toContain('兜底也失败')
  })

  it('时间认不出来的 lead 被丢掉，不是写个假时间', async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({ data: [{ id: 'lead-bad', created_time: '昨天', field_data: [] }] }),
    )

    const res = await fetchFormLeads('f1', 'tok', SINCE)
    expect(res.rows).toEqual([])
    expect(res.error).toBeNull()
  })

  it('翻页翻不完必须报错，不能让半截看起来像跑完了', async () => {
    // 每页都还给一个 next，一直翻到上限。
    fetchMock.mockResolvedValue(okJson({ data: [rawLead], paging: { next: 'more' } }))

    const res = await fetchFormLeads('f1', 'tok', SINCE)
    expect(res.error).toContain('截断')
  })
})
