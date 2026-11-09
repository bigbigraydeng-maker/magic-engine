import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

beforeEach(() => {
  process.env.CRON_SECRET = 'test-secret'
})

describe('GET /api/cron/diagnostic-weekly (retired)', () => {
  it('returns 410 and does not import the scheduled diagnostic runner', async () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/cron/diagnostic-weekly/route.ts'),
      'utf8',
    )
    expect(source).not.toContain('scheduled-run')
    expect(source).not.toContain('runScheduledDiagnostics')
    const { GET } = await import('../route')
    const res = await GET(new NextRequest('http://localhost/api/cron/diagnostic-weekly', {
      headers: { authorization: 'Bearer test-secret' },
    }))
    expect(res.status).toBe(410)
    const body = await res.json()
    expect(body.retired).toBe(true)
    expect(body.error).toContain('已废弃')
  })

  it('rejects a missing bearer token', async () => {
    const { GET } = await import('../route')
    const res = await GET(new NextRequest('http://localhost/api/cron/diagnostic-weekly'))
    expect(res.status).toBe(401)
  })
})
