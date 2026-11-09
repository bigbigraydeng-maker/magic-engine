import { beforeEach, describe, expect, it, vi } from 'vitest'

// 开投前追踪检查用：指定事件名近 N 天的次数。沿用 client.test.ts 的 mock 写法。
const mocks = vi.hoisted(() => ({
  getValidTokenForConnection: vi.fn(),
  getValidAccessToken: vi.fn(),
  dedicatedRows: [] as Array<{ id: string; account_id: string; status: string }>,
}))

vi.mock('@/lib/platform-oauth/token-manager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/platform-oauth/token-manager')>()
  return { ...actual, getValidTokenForConnection: mocks.getValidTokenForConnection }
})

vi.mock('@/lib/google-oauth/client', () => ({
  getValidAccessToken: mocks.getValidAccessToken,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => Promise.resolve({ data: mocks.dedicatedRows, error: null })),
          })),
        })),
      })),
    })),
  },
}))

import { fetchGa4EventCounts } from '../client'

const CLIENT_ID = 'client-1'

function report(rows: Array<[string, string]>): Response {
  return new Response(
    JSON.stringify({ rows: rows.map(([name, count]) => ({ dimensionValues: [{ value: name }], metricValues: [{ value: count }] })) }),
    { status: 200 },
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  mocks.dedicatedRows = [{ id: 'canonical-row', account_id: CLIENT_ID, status: 'active' }]
  mocks.getValidTokenForConnection.mockResolvedValue('ga4-token')
})

describe('fetchGa4EventCounts', () => {
  it('只问指定的事件名，返回每个事件的次数（没出现的事件不在结果里）', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(report([['generate_lead', '8']])))

    const counts = await fetchGa4EventCounts('123456789', CLIENT_ID, ['generate_lead', 'enquiry_thank_you'], 7)

    expect(counts).toEqual({ generate_lead: 8 })
    const [url, init] = spy.mock.calls[0]
    expect(String(url)).toBe('https://analyticsdata.googleapis.com/v1beta/properties/123456789:runReport')
    expect((init as RequestInit).method).toBe('POST')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer ga4-token')
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.dimensions).toEqual([{ name: 'eventName' }])
    expect(body.metrics).toEqual([{ name: 'eventCount' }])
    expect(body.dimensionFilter).toEqual({
      filter: { fieldName: 'eventName', inListFilter: { values: ['generate_lead', 'enquiry_thank_you'] } },
    })
  })

  it('时间窗口是「N 天前 → 今天」', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(report([])))

    await fetchGa4EventCounts('properties/55', CLIENT_ID, ['generate_lead'], 7)

    const body = JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body))
    const { startDate, endDate } = body.dateRanges[0] as { startDate: string; endDate: string }
    const days = (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000
    expect(days).toBe(7)
    expect(endDate).toBe(new Date().toISOString().slice(0, 10))
  })

  it('一个事件都没有 → 空对象（是读到了，只是 0），不是 null', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(report([])))
    await expect(fetchGa4EventCounts('1', CLIENT_ID, ['generate_lead'], 7)).resolves.toEqual({})
  })

  it('没有可用的 Google 授权 → null，且不发请求', async () => {
    mocks.dedicatedRows = []
    mocks.getValidAccessToken.mockResolvedValue(null)
    const spy = vi.spyOn(globalThis, 'fetch')

    await expect(fetchGa4EventCounts('1', CLIENT_ID, ['generate_lead'], 7)).resolves.toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('接口返回 403 → 抛 Ga4ApiError（让调用方当「读不到」处理，不当成 0）', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'no access' } }), { status: 403 })),
    )
    await expect(fetchGa4EventCounts('1', CLIENT_ID, ['generate_lead'], 7)).rejects.toMatchObject({ httpStatus: 403 })
  })
})
