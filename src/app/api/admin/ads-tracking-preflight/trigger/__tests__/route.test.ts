/**
 * POST /api/admin/ads-tracking-preflight/trigger · 手动触发入口。
 * 鉴权沿用仓库现有写法：全局管理员会话，或带 CRON_SECRET 的 Bearer。
 * 只读检查：入口本身只发一个事件（或演练），不写任何东西。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const guardGlobalAdmin = vi.fn<() => Promise<NextResponse | null>>(async () => null)
vi.mock('@/lib/auth/require-admin', () => ({ guardGlobalAdmin: () => guardGlobalAdmin() }))

const sendInngestEvent = vi.fn<(e: { id: string; name: string; data: Record<string, unknown> }) => Promise<{ event_ids: string[] }>>(
  async () => ({ event_ids: ['evt-1'] }),
)
vi.mock('@/lib/workflows/inngest-event', () => ({ sendInngestEvent: (e: { id: string; name: string; data: Record<string, unknown> }) => sendInngestEvent(e) }))

vi.mock('@/lib/ads-tracking-preflight/client-config', () => ({
  listTrackingClientIds: () => ['c1'],
  getTrackingClientConfig: () => null,
}))

import { POST } from '../route'

const SECRET = 'cron-secret-value-0123456789'

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://app.example.test/api/admin/ads-tracking-preflight/trigger', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const call = (r: Request) => POST(r as Parameters<typeof POST>[0])

beforeEach(() => {
  guardGlobalAdmin.mockReset()
  guardGlobalAdmin.mockResolvedValue(null)
  sendInngestEvent.mockClear()
  process.env.CRON_SECRET = SECRET
})

describe('鉴权', () => {
  it('既不是管理员会话也没有正确的 Bearer → 拒绝，什么都不发', async () => {
    guardGlobalAdmin.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const res = await call(req({ kind: 'preflight', client_id: 'c1', dry_run: false }))
    expect(res.status).toBe(401)
    expect(sendInngestEvent).not.toHaveBeenCalled()
  })

  it('Bearer 不对 → 回落到管理员判定（拒绝）', async () => {
    guardGlobalAdmin.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const res = await call(req({ kind: 'preflight', client_id: 'c1', dry_run: false }, { authorization: 'Bearer wrong-wrong-wrong-wrong' }))
    expect(res.status).toBe(401)
    expect(sendInngestEvent).not.toHaveBeenCalled()
  })

  it('环境里没配 CRON_SECRET 时，「Bearer undefined」不能蒙混过关', async () => {
    delete process.env.CRON_SECRET
    guardGlobalAdmin.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    for (const header of ['Bearer undefined', 'Bearer ', 'Bearer']) {
      const res = await call(req({ kind: 'preflight', client_id: 'c1', dry_run: false }, { authorization: header }))
      expect(res.status, header).toBe(401)
    }
    expect(sendInngestEvent).not.toHaveBeenCalled()
  })

  it('CRON_SECRET 配得太短（少于 16 位）时，哪怕请求头一模一样也不放行', async () => {
    process.env.CRON_SECRET = 'short'
    guardGlobalAdmin.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const res = await call(req({ kind: 'preflight', client_id: 'c1', dry_run: false }, { authorization: 'Bearer short' }))
    expect(res.status).toBe(401)
    expect(sendInngestEvent).not.toHaveBeenCalled()
  })

  it('正确的 Bearer CRON_SECRET → 放行，且不用再过管理员判定', async () => {
    const res = await call(req({ kind: 'preflight', client_id: 'c1' }, { authorization: `Bearer ${SECRET}` }))
    expect(res.status).toBe(200)
    expect(guardGlobalAdmin).not.toHaveBeenCalled()
  })

  it('全局管理员会话 → 放行', async () => {
    const res = await call(req({ kind: 'preflight', client_id: 'c1' }))
    expect(res.status).toBe(200)
    expect(guardGlobalAdmin).toHaveBeenCalledTimes(1)
  })
})

describe('默认只演练', () => {
  it('不写 dry_run → 只返回「会发什么」，一个事件都不发；响应写明 no_publish', async () => {
    const res = await call(req({ kind: 'preflight', client_id: 'c1' }))
    const json = await res.json()
    expect(json).toMatchObject({
      ok: true, dry_run: true, no_publish: true,
      would_send: { name: 'ads.tracking_preflight.requested', data: { client_id: 'c1' } },
    })
    expect(sendInngestEvent).not.toHaveBeenCalled()
  })
})

describe('dry_run: false 才真发', () => {
  it('开投前检查：发 ads.tracking_preflight.requested，事件编号以 manual- 开头（每次手动触发都是新的一轮）', async () => {
    const res = await call(req({ kind: 'preflight', client_id: 'c1', dry_run: false }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toMatchObject({ ok: true, dry_run: false, no_publish: true, event_ids: ['evt-1'] })
    expect(sendInngestEvent).toHaveBeenCalledTimes(1)
    const sent = sendInngestEvent.mock.calls[0][0]
    expect(sent.name).toBe('ads.tracking_preflight.requested')
    expect(sent.data).toMatchObject({ client_id: 'c1' })
    expect(sent.id).toMatch(/^manual-preflight-c1-/)
  })

  it('开投后读回：发 ads.tracking_postlaunch.requested，带阶段和开投时刻', async () => {
    // 开投时间必须是合理的（不晚于现在、不早于 7 天前），所以用相对「现在」的时间，不写死日期
    const launchedAt = new Date(Date.now() - 3_600_000).toISOString()
    await call(req({ kind: 'postlaunch', client_id: 'c1', phase: 't1h', launched_at: launchedAt, dry_run: false }))
    const sent = sendInngestEvent.mock.calls[0][0]
    expect(sent.name).toBe('ads.tracking_postlaunch.requested')
    expect(sent.data).toEqual({ client_id: 'c1', phase: 't1h', launched_at: launchedAt })
  })

  it('开投后读回：开投时间晚于现在 / 早于 7 天前 → 400，一个事件都不发（哪怕写了 dry_run: false）', async () => {
    for (const offsetMs of [86_400_000, -8 * 86_400_000]) {
      const launchedAt = new Date(Date.now() + offsetMs).toISOString()
      const res = await call(req({ kind: 'postlaunch', client_id: 'c1', phase: 't1h', launched_at: launchedAt, dry_run: false }))
      expect(res.status, launchedAt).toBe(400)
    }
    expect(sendInngestEvent).not.toHaveBeenCalled()
  })

  it('发送失败 → 502，错误里没有任何令牌 / 事件密钥', async () => {
    sendInngestEvent.mockRejectedValueOnce(new Error('INNGEST_EVENT_SEND_FAILED:401:bad key access_token=SECRET_TOKEN_VALUE_123'))
    const res = await call(req({ kind: 'preflight', client_id: 'c1', dry_run: false }))
    expect(res.status).toBe(502)
    const text = JSON.stringify(await res.json())
    expect(text).not.toContain('SECRET_TOKEN_VALUE_123')
    expect(text).toContain('INNGEST_EVENT_SEND_FAILED')
  })
})

describe('请求内容不对', () => {
  it('不是合法 JSON → 400，不发', async () => {
    const res = await call(req('{not json'))
    expect(res.status).toBe(400)
    expect(sendInngestEvent).not.toHaveBeenCalled()
  })

  it('客户没配置追踪检查 / 缺字段 → 400，不发', async () => {
    for (const body of [
      { kind: 'preflight', client_id: 'stranger', dry_run: false },
      { kind: 'postlaunch', client_id: 'c1', dry_run: false },
      { kind: 'preflight', dry_run: false },
    ]) {
      const res = await call(req(body))
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
    expect(sendInngestEvent).not.toHaveBeenCalled()
  })
})
