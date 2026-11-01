// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'

// 用 vi.hoisted 提前声明 insertMock，避免 vi.mock 工厂提升后引用未初始化变量
const { insertMock } = vi.hoisted(() => ({ insertMock: vi.fn() }))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/messaging/provider-events/store', () => ({
  supabaseProviderEventStore: { insert: (row: unknown) => insertMock(row) },
}))

import * as route from '../route'

const SECRET = 'whsec_' + 'ABEiM0RVZneImaq7zN3u/wARIjNEVWZ3'

// 独立实现的 Svix 签名，避免依赖被测代码
function sign(secret: string, id: string, ts: string, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const digest = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')
  return 'v1,' + digest
}

const body = JSON.stringify({
  type: 'email.delivered',
  created_at: '2026-11-01T01:02:03.000Z',
  data: { email_id: 'em_1', to: ['staff@example.com'], subject: 'x' },
})

function makeReq(accountBody: string, headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/api/webhooks/resend/system', {
    method: 'POST',
    headers,
    body: accountBody,
  })
}

function ctx(account: string): { params: Promise<{ account: string }> } {
  return { params: Promise.resolve({ account }) }
}

// 构造合法签名头
function validHeaders(id: string, ts: string, payload: string): Record<string, string> {
  return {
    'svix-id': id,
    'svix-timestamp': ts,
    'svix-signature': sign(SECRET, id, ts, payload),
  }
}

let originalSecret: string | undefined

beforeEach(() => {
  insertMock.mockReset().mockResolvedValue('inserted')
  originalSecret = process.env.RESEND_WEBHOOK_SECRET_SYSTEM
  process.env.RESEND_WEBHOOK_SECRET_SYSTEM = SECRET
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.RESEND_WEBHOOK_SECRET_SYSTEM
  } else {
    process.env.RESEND_WEBHOOK_SECRET_SYSTEM = originalSecret
  }
  vi.restoreAllMocks()
})

describe('POST /api/webhooks/resend/[account]', () => {
  it('accepts a valid signature and inserts the event once', async () => {
    const ts = String(Math.floor(Date.now() / 1000))
    const req = makeReq(body, validHeaders('msg_r1', ts, body))
    const res = await route.POST(req, ctx('system'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(insertMock).toHaveBeenCalledTimes(1)
    const row = insertMock.mock.calls[0][0] as Record<string, unknown>
    expect(row.providerEventId).toBe('msg_r1')
  })

  it('returns 404 for an unknown account', async () => {
    const ts = String(Math.floor(Date.now() / 1000))
    const req = makeReq(body, validHeaders('msg_r1', ts, body))
    const res = await route.POST(req, ctx('client'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ ok: false, error: 'not_found' })
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('returns 503 when the webhook secret is not configured', async () => {
    delete process.env.RESEND_WEBHOOK_SECRET_SYSTEM
    const ts = String(Math.floor(Date.now() / 1000))
    const req = makeReq(body, validHeaders('msg_r1', ts, body))
    const res = await route.POST(req, ctx('system'))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ ok: false, error: 'unavailable' })
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('returns 401 for a forged signature', async () => {
    const ts = String(Math.floor(Date.now() / 1000))
    const forged = sign('whsec_' + 'MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw', 'msg_r1', ts, body)
    const req = makeReq(body, {
      'svix-id': 'msg_r1',
      'svix-timestamp': ts,
      'svix-signature': forged,
    })
    const res = await route.POST(req, ctx('system'))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ ok: false, error: 'invalid_signature' })
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('returns 413 when content-length exceeds the cap', async () => {
    const oversized = 'x'.repeat(256 * 1024 + 1)
    const req = makeReq(oversized, {
      'content-length': String(oversized.length),
    })
    const res = await route.POST(req, ctx('system'))
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ ok: false, error: 'too_large' })
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('returns 413 when the body exceeds the cap without content-length', async () => {
    const oversized = 'x'.repeat(256 * 1024 + 1)
    const req = makeReq(oversized, {})
    const res = await route.POST(req, ctx('system'))
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ ok: false, error: 'too_large' })
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('returns 200 with duplicate flag when the store reports a duplicate', async () => {
    insertMock.mockResolvedValue('duplicate')
    const ts = String(Math.floor(Date.now() / 1000))
    const req = makeReq(body, validHeaders('msg_r1', ts, body))
    const res = await route.POST(req, ctx('system'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, duplicate: true })
  })

  it('returns 500 when the store throws', async () => {
    insertMock.mockRejectedValue(new Error('provider_webhook_events insert failed: 23514'))
    const ts = String(Math.floor(Date.now() / 1000))
    const req = makeReq(body, validHeaders('msg_r1', ts, body))
    const res = await route.POST(req, ctx('system'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ok: false, error: 'store_failed' })
  })

  it('only exports POST and sets dynamic to force-dynamic', () => {
    const mod = route as Record<string, unknown>
    expect(mod.GET).toBeUndefined()
    expect(mod.PUT).toBeUndefined()
    expect(mod.DELETE).toBeUndefined()
    expect(route.dynamic).toBe('force-dynamic')
  })
})
