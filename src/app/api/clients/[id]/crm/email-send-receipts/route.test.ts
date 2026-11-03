import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
const queries = vi.hoisted(() => ({ calls: [] as Array<[string, unknown[]]>, result: { data: [] as unknown, error: null as { message: string } | null } }))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from(table: string) {
      const builder: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'in']) {
        builder[method] = (...args: unknown[]) => {
          queries.calls.push([`${table}.${method}`, args])
          return builder
        }
      }
      builder.then = (resolve: (value: unknown) => unknown) => resolve(queries.result)
      return builder
    },
  },
}))
vi.mock('@/lib/crm/email-templates/receipt-store', () => ({ listRecentReceipts: vi.fn() }))

import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { listRecentReceipts } from '@/lib/crm/email-templates/receipt-store'
import { GET } from './route'

const ctx = { params: { id: 'client-a' } }
const receipt = (contactId: string) => ({ id: `r-${contactId}`, contactId, outcome: 'sent', requestId: 'req', actorEmail: 'lisa@cts.example' })

beforeEach(() => {
  vi.resetAllMocks()
  queries.calls = []
  queries.result = { data: [], error: null }
  vi.mocked(requirePaidClientAccess).mockResolvedValue({ ok: true, role: 'client', tier: 'paid_client', allowedClientId: null, user: { email: 'a@b.c' } } as never)
})

describe('GET email-send-receipts', () => {
  it('adds the guest name to each receipt, looked up inside this client only', async () => {
    vi.mocked(listRecentReceipts).mockResolvedValue([receipt('c1'), receipt('c2'), receipt('c1')] as never)
    queries.result = { data: [{ id: 'c1', display_name: 'Amy Lee' }], error: null }
    const res = await GET(new NextRequest('http://x/api'), ctx)
    const body = (await res.json()) as { receipts: Array<{ contactId: string; contactName: string | null }> }
    expect(body.receipts.map((r) => r.contactName)).toEqual(['Amy Lee', null, 'Amy Lee'])
    expect(listRecentReceipts).toHaveBeenCalledWith({ from: expect.any(Function) }, 'client-a', 50)
    expect(queries.calls).toContainEqual(['contacts.eq', ['client_id', 'client-a']])
    expect(queries.calls).toContainEqual(['contacts.in', ['id', ['c1', 'c2']]])
  })

  it('asks for no contacts when there are no receipts', async () => {
    vi.mocked(listRecentReceipts).mockResolvedValue([])
    expect(await (await GET(new NextRequest('http://x/api'), ctx)).json()).toEqual({ receipts: [] })
    expect(queries.calls).toEqual([])
  })

  it('passes an access failure through', async () => {
    vi.mocked(requirePaidClientAccess).mockResolvedValue({ ok: false, status: 403, error: 'no' } as never)
    expect((await GET(new NextRequest('http://x/api'), ctx)).status).toBe(403)
    expect(listRecentReceipts).not.toHaveBeenCalled()
  })

  it('503 when a read fails, never a partial list', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(listRecentReceipts).mockResolvedValue([receipt('c1')] as never)
    queries.result = { data: null, error: { message: 'boom' } }
    expect((await GET(new NextRequest('http://x/api'), ctx)).status).toBe(503)
  })
})
