import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const finish = vi.fn(async () => undefined)

vi.mock('@/lib/cron/run-logger', () => ({
  startCronRun: vi.fn(async () => ({ finish })),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: () => ({}) },
}))

import { POST } from './route'
import { startCronRun } from '@/lib/cron/run-logger'

function call(secret?: string): Promise<Response> {
  const headers = new Headers()
  if (secret) headers.set('authorization', `Bearer ${secret}`)
  return POST(new NextRequest('http://localhost/api/cron/viral-discovery-weekly', { method: 'POST', headers }))
}

beforeEach(() => {
  process.env.CRON_SECRET = 's3cret'
  delete process.env.VIRAL_ANALYZER_ENABLED
  delete process.env.YOUTUBE_API_KEY
  finish.mockClear()
  vi.mocked(startCronRun).mockClear()
})

afterEach(() => {
  delete process.env.CRON_SECRET
  delete process.env.VIRAL_ANALYZER_ENABLED
  delete process.env.YOUTUBE_API_KEY
})

describe('POST /api/cron/viral-discovery-weekly', () => {
  it('rejects a bad secret before the switch', async () => {
    const res = await call('wrong')
    expect(res.status).toBe(401)
    expect(startCronRun).not.toHaveBeenCalled()
  })

  it('skips when VIRAL_ANALYZER_ENABLED is unset', async () => {
    const res = await call('s3cret')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      skipped: 'disabled',
      hint: 'set VIRAL_ANALYZER_ENABLED=true to run',
    })
    expect(startCronRun).not.toHaveBeenCalled()
    expect(finish).not.toHaveBeenCalled()
  })

  it('passes the switch when VIRAL_ANALYZER_ENABLED is true', async () => {
    process.env.VIRAL_ANALYZER_ENABLED = 'true'
    const res = await call('s3cret')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'YOUTUBE_API_KEY not configured' })
    expect(startCronRun).toHaveBeenCalledWith('viral-discovery-weekly')
    expect(finish).toHaveBeenCalledWith({ failed: 1, error: 'YOUTUBE_API_KEY not configured' })
  })
})
