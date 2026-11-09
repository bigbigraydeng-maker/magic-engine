import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { whenBackgroundIdle } from '@/lib/cron/dispatch/background'

const finish = vi.fn(async (_summary?: { failed?: number }) => undefined)
const invoke = vi.fn(async (_job: { service: string }, _secret: string) => ({
  status: 200,
  body: 'ok',
}))

vi.mock('@/lib/cron/run-logger', () => ({
  startCronRun: vi.fn(async () => ({ finish })),
}))

vi.mock('@/lib/cron/dispatch/invoke', () => ({
  invokeDispatchJob: (job: { service: string }, secret: string) => invoke(job, secret),
}))

import { POST } from './route'

function call(url: string, secret?: string): Promise<Response> {
  const headers = new Headers()
  if (secret) headers.set('authorization', `Bearer ${secret}`)
  return POST(new NextRequest(url, { method: 'POST', headers }))
}

describe('POST /api/cron/dispatch-frequent', () => {
  afterEach(() => {
    finish.mockClear()
    invoke.mockClear()
    delete process.env.CRON_SECRET
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('rejects a missing or wrong secret before writing a run', async () => {
    process.env.CRON_SECRET = 's3cret'
    const missing = await call('http://localhost/api/cron/dispatch-frequent')
    expect(missing.status).toBe(401)
    expect(finish).not.toHaveBeenCalled()

    delete process.env.CRON_SECRET
    const unset = await call('http://localhost/api/cron/dispatch-frequent', 's3cret')
    expect(unset.status).toBe(500)
  })

  it('returns the due list and does not invoke handlers on dry_run', async () => {
    process.env.CRON_SECRET = 's3cret'
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-24T00:00:05Z'))
    try {
      const res = await call(
        'http://localhost/api/cron/dispatch-frequent?dry_run=1',
        's3cret',
      )
      const body = await res.json()
      expect(res.status).toBe(200)
      expect(body.dry_run).toBe(true)
      expect(body.due).toContain('prospecting-sweep')
      expect(body.due).toContain('viral-analyzer-worker')
      expect(invoke).not.toHaveBeenCalled()
      expect(finish).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('answers 202 and then invokes the due handlers', async () => {
    process.env.CRON_SECRET = 's3cret'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })))
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-24T00:00:05Z'))
    try {
      const res = await call('http://localhost/api/cron/dispatch-frequent', 's3cret')
      const body = await res.json()
      expect(res.status).toBe(202)
      expect(body.accepted).toBe(true)
      expect(body.due).toContain('attribution-cron')
      await vi.runAllTimersAsync()
    } finally {
      vi.useRealTimers()
    }
    await whenBackgroundIdle()
    const called = invoke.mock.calls.map((args) => args[0].service)
    expect(called).toContain('attribution-cron')
    expect(called).not.toContain('seo-patrol-daily')
    expect(finish).toHaveBeenCalled()
    const summary = finish.mock.calls.at(-1)?.[0]
    expect(summary?.failed ?? 0).toBe(0)
  })
})
