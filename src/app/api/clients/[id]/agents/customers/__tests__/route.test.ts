import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRequire = vi.fn()
vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: (...a: unknown[]) => mockRequire(...a),
}))

// Supabase mock：contacts 表按 (id, client_id) 查 —— clientA 查 clientB 的 contact 返回 null
let contactMatchesClient = false
const contactsSelect = vi.fn().mockImplementation(() => ({
  eq: () => ({
    eq: () => ({
      maybeSingle: () => Promise.resolve({
        data: contactMatchesClient ? { id: 'contact-xyz' } : null,
        error: null,
      }),
    }),
  }),
}))

const identitiesSelect = vi.fn().mockImplementation(() => ({
  eq: () => ({
    eq: () => ({
      eq: () => Promise.resolve({ data: [{ value: 'agent@hot.co.nz' }], error: null }),
    }),
  }),
}))

const clientsSelect = vi.fn().mockImplementation(() => ({
  eq: () => ({
    maybeSingle: () => Promise.resolve({
      data: { leads_config: { trade_domains: ['hot.co.nz'] } },
      error: null,
    }),
  }),
}))

const agentCustomersInsert = vi.fn().mockReturnValue({
  select: () => ({ single: () => Promise.resolve({ data: { id: 'ac1' }, error: null }) }),
})

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'contacts') return { select: contactsSelect }
      if (table === 'contact_identities') return { select: identitiesSelect }
      if (table === 'clients') return { select: clientsSelect }
      if (table === 'agent_customers') return { insert: agentCustomersInsert }
      return {}
    },
  },
}))

import { POST } from '../route'

function makeReq(body: unknown): Request {
  // 用最小 Request shape：POST handler 只调 req.json() 和 new URL(req.url)
  return {
    json: () => Promise.resolve(body),
    url: 'http://localhost/api/clients/clientA/agents/customers',
  } as Request
}

describe('POST /api/clients/[id]/agents/customers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequire.mockResolvedValue({ ok: true })
    contactMatchesClient = false
  })

  it('拒绝跨客户的 agentContactId（clientA 想插 clientB 的 contact）', async () => {
    contactMatchesClient = false // maybeSingle 返回 null，模拟"contact 属于 clientB"

    const res = await POST(makeReq({
      agentContactId: '00000000-0000-0000-0000-000000000000',
      customerName: 'Chris Brown',
    }), { params: Promise.resolve({ id: 'clientA' }) })

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('找不到这个联系人')
    expect(agentCustomersInsert).not.toHaveBeenCalled()
  })
})
