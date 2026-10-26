/**
 * 盯盘去调只暂停入口。不改广告：没密钥不发请求，失败只记原因。
 */
import { describe, expect, it, vi } from 'vitest'
import { requestServicePause, SERVICE_PAUSE_PATH } from '../service-pause-client'
import type { ServicePauseCall } from '../lead-form-types'

const call: ServicePauseCall = {
  client_id: 'c1',
  campaign_id: '333333333333',
  campaign_name: '表单系列',
  ad_account_id: 'act_444444444444',
  fault_code: 'over_daily_cap',
  fault_what: '当天花费超过日预算的 2 倍',
  spend_today_cents: 2500,
  spend_lifetime_cents: 9000,
  currency: 'NZD',
  as_of: '2026-10-27T01:00:00.000Z',
  triggered_by: 'ads-tracking-launch-watch',
  idempotency_key: 'c1:333333333333:over_daily_cap:2026-10-27T01:00:00.000Z',
}

describe('requestServicePause', () => {
  it('没配服务密钥 → 不发请求', async () => {
    const fetchImpl = vi.fn()
    const out = await requestServicePause({ call, fetchImpl, appBase: 'https://app.example.test', serviceKey: null })
    expect(out).toEqual({ called: false, paused: false, reason: 'service_key_missing', idempotent: false })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('密钥只进请求头，不进网址；入口说停了就照记', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ paused: true, reason: 'paused' }), { status: 200 }))
    const out = await requestServicePause({
      call, fetchImpl, appBase: 'https://app.example.test/', serviceKey: 'cron-secret-value',
    })
    expect(out).toEqual({ called: true, paused: true, reason: 'paused', idempotent: false })
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`https://app.example.test${SERVICE_PAUSE_PATH}`)
    expect(url).not.toContain('cron-secret-value')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer cron-secret-value')
    expect(init.method).toBe('POST')
  })

  it('入口不在、网络断了、或返回不是成功，都只记原因，不抛错', async () => {
    const missing = await requestServicePause({
      call,
      fetchImpl: vi.fn(async () => new Response('nope', { status: 404 })),
      appBase: 'https://app.example.test',
      serviceKey: 'k',
    })
    expect(missing).toMatchObject({ called: true, paused: false, reason: 'http_404' })
    const down = await requestServicePause({
      call,
      fetchImpl: vi.fn(async () => { throw new Error('offline') }),
      appBase: 'https://app.example.test',
      serviceKey: 'k',
    })
    expect(down).toMatchObject({ called: true, paused: false, reason: 'pause_unavailable' })
    const off = await requestServicePause({
      call,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ paused: false, reason: 'switch_off' }), { status: 200 })),
      appBase: 'https://app.example.test',
      serviceKey: 'k',
    })
    expect(off).toMatchObject({ paused: false, reason: 'switch_off' })
  })
})
