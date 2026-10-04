import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/cron/run-logger', () => ({ startCronRun: async () => ({ finish: async () => undefined }) }))
vi.mock('@/lib/seo-weekly-list/run', () => ({
  runSeoWeeklyList: async (_sb: unknown, o: { dryRun: boolean }) => ({ clients_processed: 1, failed: 0, results: [{ dry_run: o.dryRun, inserted: 0, verified_pass: 0, expired: 0 }] }),
}))

import { GET } from '../route'

const req = (url: string, auth?: string) => new NextRequest(url, { headers: auth ? { authorization: auth } : {} })

describe('GET /api/cron/seo-weekly-list', () => {
  afterEach(() => { delete process.env.CRON_SECRET })

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
})
