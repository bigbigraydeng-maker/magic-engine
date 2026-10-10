import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Shared mock for the Resend `emails.send` call. Declared via `vi.hoisted` so it
 * exists before the `vi.mock('resend', ...)` factory runs.
 */
const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn(async (_arg: { from: string; to: string[] }) => ({ error: null })),
}))

/**
 * Controls what the Supabase query resolves to. Each test sets `rows` before
 * invoking the route.
 */
const { state } = vi.hoisted(() => ({
  state: { rows: [] as unknown[] },
}))

vi.mock('resend', () => {
  class Resend {
    emails = { send: sendMock }
    constructor(_apiKey: string) {
      void _apiKey
    }
  }
  return { Resend }
})

vi.mock('@/lib/supabase', () => {
  const builder = {
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    order: () => Promise.resolve({ data: state.rows, error: null }),
  }
  return {
    supabaseAdmin: {
      from: () => builder,
    },
  }
})

vi.mock('@/lib/cron/run-logger', () => ({
  startCronRun: vi.fn(async () => ({ finish: vi.fn(async () => undefined) })),
}))

import { GET } from '../route'

const EVENT_ROW = {
  cta_key: 'proposal_view',
  destination: 'acme-corp',
  created_at: '2026-07-24T10:00:00.000Z',
  metadata: {
    visit_id: 'v1',
    seconds: 120,
    scroll_pct: 60,
    section: 'investment',
    country: 'NZ',
    viewport: '1200x800',
  },
}

function makeRequest(authorization = 'Bearer s'): NextRequest {
  return new NextRequest('http://localhost/api/cron/proposal-view-digest', {
    headers: { authorization },
  })
}

describe('GET /api/cron/proposal-view-digest', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 's'
    process.env.RESEND_API_KEY = 'k'
    delete process.env.ME_MAIL_FROM
    sendMock.mockClear()
    state.rows = [EVENT_ROW]
  })

  it('sends exactly one email from the verified-domain sender', async () => {
    const res = await GET(makeRequest())

    expect(res.status).toBe(200)
    expect(sendMock).toHaveBeenCalledTimes(1)

    const arg = sendMock.mock.calls[0][0]
    expect(arg.from.endsWith('<hello@magicengine.cloud>')).toBe(true)
    expect(arg.from).not.toContain('resend.dev')
  })

  it('delivers to the verified-domain inbox', async () => {
    await GET(makeRequest())

    const arg = sendMock.mock.calls[0][0]
    expect(arg.to).toEqual(['hello@magicengine.cloud'])
  })

  it('rejects an unauthorized request and sends nothing', async () => {
    const res = await GET(makeRequest('Bearer wrong'))

    expect(res.status).toBe(401)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('sends nothing on a quiet day', async () => {
    state.rows = []

    const res = await GET(makeRequest())
    const body = (await res.json()) as { sent: boolean }

    expect(res.status).toBe(200)
    expect(body.sent).toBe(false)
    expect(sendMock).not.toHaveBeenCalled()
  })
})
