import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const access = vi.fn()
vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: (id: string) => access(id) }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { supabaseAdmin } from '@/lib/supabase'
import { GET } from './route'

const eqs: Record<string, Array<[string, unknown]>> = {}

function mockDb(opts: { analysis?: { call_id: string } | null; body?: string | null; aErr?: boolean; tErr?: boolean }) {
  eqs.telephony_call_analyses = []
  eqs.telephony_transcripts = []
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = (c: string, v: unknown) => {
      eqs[table].push([c, v])
      return chain
    }
    chain.maybeSingle = async () => {
      if (table === 'telephony_call_analyses') return opts.aErr ? { data: null, error: { message: 'x' } } : { data: opts.analysis ?? null, error: null }
      return opts.tErr ? { data: null, error: { message: 'x' } } : { data: opts.body === undefined || opts.body === null ? null : { body: opts.body }, error: null }
    }
    return chain
  })
}

const call = () => GET(new NextRequest('http://localhost:3001/x'), { params: { id: 'client-a', aid: 'an-1' } })

beforeEach(() => {
  vi.clearAllMocks()
  access.mockResolvedValue({ ok: true, user: { email: 'pm@example.com' }, tier: 'admin', allowedClientId: null })
})

describe('GET call-analyses/[aid]/transcript', () => {
  it('returns the full transcript text, scoped to the client on both tables', async () => {
    mockDb({ analysis: { call_id: 'call-1' }, body: '  Staff: hello\nCustomer: hi  ' })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ text: 'Staff: hello\nCustomer: hi' })
    expect(eqs.telephony_call_analyses).toContainEqual(['client_id', 'client-a'])
    expect(eqs.telephony_transcripts).toContainEqual(['client_id', 'client-a'])
    expect(eqs.telephony_transcripts).toContainEqual(['call_id', 'call-1'])
  })

  it('404 when the analysis does not belong to this client', async () => {
    mockDb({ analysis: null, body: 'x' })
    expect((await call()).status).toBe(404)
  })

  it('404 with a plain message when the call has no transcript', async () => {
    mockDb({ analysis: { call_id: 'call-1' }, body: null })
    const res = await call()
    expect(res.status).toBe(404)
    expect((await res.json()).error).toContain('没有文字稿')
  })

  it('404 when the transcript is only whitespace', async () => {
    mockDb({ analysis: { call_id: 'call-1' }, body: '   ' })
    expect((await call()).status).toBe(404)
  })

  it('500 on a database error, never leaking the message', async () => {
    mockDb({ aErr: true })
    const res = await call()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('"x"')
  })

  it('401/403 straight through when access is denied', async () => {
    access.mockResolvedValue({ ok: false, error: 'no', status: 403 })
    expect((await call()).status).toBe(403)
  })
})
