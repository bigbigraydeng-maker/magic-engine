import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const finish = vi.fn(async () => undefined)
const analyze = vi.fn()
const queries: string[][] = []
const script: Array<{ data?: unknown; error?: { message: string } | null }> = []

function query(result: { data?: unknown; error?: { message: string } | null } = {}) {
  const steps: string[] = []
  queries.push(steps)
  const builder: Record<string, unknown> = {}
  const record = (name: string) => (...args: unknown[]) => {
    steps.push(`${name} ${JSON.stringify(args)}`)
    return builder
  }
  for (const name of ['select', 'update', 'eq', 'in', 'or', 'order', 'limit', 'neq', 'not', 'range']) {
    builder[name] = record(name)
  }
  builder.then = (resolve: (value: unknown) => unknown) => resolve({
    data: result.data ?? [],
    error: result.error ?? null,
  })
  return builder
}

vi.mock('@/lib/cron/run-logger', () => ({
  startCronRun: vi.fn(async () => ({ finish })),
}))
vi.mock('@/lib/reels/viral-analyzer', () => ({
  analyzeViralReference: (...args: unknown[]) => analyze(...args),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: () => query(script.shift()) },
}))

import { POST } from './route'

function call(secret?: string): Promise<Response> {
  const headers = new Headers()
  if (secret) headers.set('authorization', `Bearer ${secret}`)
  return POST(new NextRequest('http://localhost/api/cron/viral-analyzer-worker', { method: 'POST', headers }))
}

const DUE = {
  id: '11111111-2222-3333-4444-555555555555',
  source_url: 'https://www.youtube.com/watch?v=due',
  analysis_status: 'error',
  analysis_error: '[429 Too Many Requests] quota',
  next_retry_at: null,
  updated_at: null,
  created_at: '2026-08-01T00:00:00.000Z',
  platform: 'youtube',
}

beforeEach(() => {
  process.env.CRON_SECRET = 's3cret'
  process.env.VIRAL_ANALYZER_ENABLED = 'true'
  finish.mockClear()
  analyze.mockReset()
  queries.length = 0
  script.length = 0
})

afterEach(() => {
  delete process.env.CRON_SECRET
  delete process.env.VIRAL_ANALYZER_ENABLED
  vi.useRealTimers()
})

describe('POST /api/cron/viral-analyzer-worker', () => {
  it('rejects a bad secret before writing a run', async () => {
    const res = await call('wrong')
    expect(res.status).toBe(401)
    expect(finish).not.toHaveBeenCalled()
    expect(analyze).not.toHaveBeenCalled()
  })

  it('skips when VIRAL_ANALYZER_ENABLED is unset', async () => {
    delete process.env.VIRAL_ANALYZER_ENABLED
    const denied = await call('wrong')
    expect(denied.status).toBe(401)

    const res = await call('s3cret')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      skipped: 'disabled',
      hint: 'set VIRAL_ANALYZER_ENABLED=true to run',
    })
    expect(finish).not.toHaveBeenCalled()
    expect(analyze).not.toHaveBeenCalled()
  })

  it('counts a finished analysis as completed and a thrown one as failed', async () => {
    script.push({}, {}, { data: [] }, { data: [DUE] }, {})
    analyze.mockResolvedValue(undefined)
    const body = await (await call('s3cret')).json()
    expect(body).toMatchObject({ batch: 1, succeeded: 1, failed: 0 })
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ completed: 1, failed: 0 }))
  })

  it('records a real analyzer failure on failed_count', async () => {
    script.push({}, {}, { data: [] }, { data: [DUE] }, {})
    analyze.mockRejectedValue(new Error('[429 Too Many Requests] quota'))
    const res = await call('s3cret')
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ batch: 1, succeeded: 0, failed: 1 })
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({
      processed: 1,
      completed: 0,
      failed: 1,
    }))
    const errorQuery = queries[3].join('\n')
    expect(errorQuery).toContain('"updated_at"')
    expect(errorQuery).toContain('"nullsFirst":true')
  })

  it('does not claim a row that is still inside its backoff window', async () => {
    script.push({}, {}, { data: [] }, { data: [{
      ...DUE,
      next_retry_at: '2099-01-01T00:00:00.000Z',
    }] })
    const res = await call('s3cret')
    const body = await res.json()
    expect(body.processed).toBe(0)
    expect(analyze).not.toHaveBeenCalled()
    expect(finish).toHaveBeenCalledWith({ processed: 0, completed: 0, failed: 0 })
  })

  it('counts every failure in a batch, not the thrown ones as success', async () => {
    script.push({}, {}, { data: [] }, { data: [DUE, { ...DUE, id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', source_url: 'https://www.youtube.com/watch?v=two' }] }, {})
    analyze.mockRejectedValue(new Error('503 Service Unavailable'))
    // Real clock: the route sleeps DELAY_MS (5s) between the two items.
    const body = await (await call('s3cret')).json()
    expect(body).toMatchObject({ batch: 2, succeeded: 0, failed: 2 })
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ completed: 0, failed: 2 }))
  }, 20_000)
})
