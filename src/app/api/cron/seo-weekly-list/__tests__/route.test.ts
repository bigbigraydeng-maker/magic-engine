import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/cron/run-logger', () => ({ startCronRun: async () => ({ finish: async () => undefined }) }))
const run = vi.hoisted(() => ({ failed: 0 }))
vi.mock('@/lib/seo-weekly-list/run', () => ({
  runSeoWeeklyList: async (_sb: unknown, o: { dryRun: boolean }) => ({ clients_processed: 1, failed: run.failed, results: [{ dry_run: o.dryRun, inserted: 0, verified_pass: 0, expired: 0 }] }),
}))

import { GET } from '../route'

const req = (url: string, auth?: string) => new NextRequest(url, { headers: auth ? { authorization: auth } : {} })

describe('GET /api/cron/seo-weekly-list', () => {
  afterEach(() => { delete process.env.CRON_SECRET; run.failed = 0 })

  it('fails closed without CRON_SECRET and without the bearer token', async () => {
    expect((await GET(req('http://x/api/cron/seo-weekly-list'))).status).toBe(500)
    process.env.CRON_SECRET = 's'
    expect((await GET(req('http://x/api/cron/seo-weekly-list'))).status).toBe(401)
    expect((await GET(req('http://x/api/cron/seo-weekly-list', 'Bearer wrong'))).status).toBe(401)
  })

  it('passes dry_run through', async () => {
    process.env.CRON_SECRET = 's'
    const res = await GET(req('http://x/api/cron/seo-weekly-list?dry_run=1', 'Bearer s'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.dry_run).toBe(true)
  })

  it('any per-client failure returns HTTP 500 so Render\'s `curl -f` marks the run red', async () => {
    process.env.CRON_SECRET = 's'
    run.failed = 1
    const res = await GET(req('http://x/api/cron/seo-weekly-list', 'Bearer s'))
    expect(res.status).toBe(500)
    expect((await res.json()).success).toBe(false)
  })

  it('rejects a non-UUID client_id with 400 and never echoes it', async () => {
    process.env.CRON_SECRET = 's'
    const res = await GET(req("http://x/api/cron/seo-weekly-list?client_id=x'%20or%201=1", 'Bearer s'))
    expect(res.status).toBe(400)
  })
})

