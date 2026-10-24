import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ from: vi.fn(), finish: vi.fn(), token: vi.fn(), mails: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))
vi.mock('@/lib/cron/run-logger', () => ({ startCronRun: async () => ({ finish: mocks.finish }) }))
vi.mock('@/lib/platform-oauth/token-manager', () => ({ getValidTokenForConnection: mocks.token }))
vi.mock('@/lib/microsoft/mail-graph', () => ({ fetchMailSince: mocks.mails, fetchFormNoticeSource: vi.fn() }))
import { GET } from './route'

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })

describe('paid tagging audience authority', () => {
  it.each([null, ''])('does not reopen a cleared dedicated audience (%s) using old JSON', async value => {
    vi.stubEnv('CRON_SECRET', 'local-test')
    vi.stubEnv('MAILCHIMP_API_KEY', 'test-us19')
    mocks.from.mockImplementation((table: string) => {
      let columns = ''
      const query = {
        select: (value: string) => { columns = value; return query },
        eq: () => query, in: () => query,
        then: (resolve: (result: unknown) => unknown) => resolve({ error: null,
          data: table === 'platform_oauth_connections'
            ? [{ id: 'connection', client_id: 'client-a', account_id: 'owner@example.com' }]
            : columns.includes('mailchimp_audience_id')
              ? [{ id: 'client-a', mailchimp_audience_id: value }]
              : [{ id: 'client-a', name: 'Client A', domain: 'example.com',
                leads_config: { mailchimp_audience_id: 'obsolete-audience' } }],
        }),
      }
      return query
    })
    const response = await GET(new NextRequest('http://localhost/api/cron/mailchimp-paid-tagging?dry=1', {
      headers: { authorization: 'Bearer local-test' },
    }))
    expect(response.status).toBe(200)
    expect((await response.json()).results).toEqual([
      { client: 'Client A', mailbox: 'owner@example.com', skipped: 'no_audience_id' },
    ])
    expect(mocks.token).not.toHaveBeenCalled()
    expect(mocks.mails).not.toHaveBeenCalled()
  })
})
