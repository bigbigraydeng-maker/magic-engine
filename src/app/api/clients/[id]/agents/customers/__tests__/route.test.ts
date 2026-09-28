import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRequire = vi.fn()
vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: (...a: unknown[]) => mockRequire(...a),
}))

// Supabase mock：三张表可配置 —— 每个 test case 单独摆好 contact/identity/leads_config，
// 覆盖魏征二审要求的 3 条判据分支（散客拒绝、空 leads_config、trade happy path）。
let contactMatchesClient = false
let contactEmail = 'agent@hot.co.nz'
let tradeDomains: string[] = ['hot.co.nz']
let clientIndustry: string | null = 'travel'

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
      eq: () => Promise.resolve({ data: [{ value: contactEmail }], error: null }),
    }),
  }),
}))

const clientsSelect = vi.fn().mockImplementation(() => ({
  eq: () => ({
    maybeSingle: () => Promise.resolve({
      // industry: 'travel' —— 这条路由现在也走 clientHasIndustryFeature(id, 'agents') 闸
      // （2026-09-28，堵 NAL 能看到 CTS 专属同行渠道数据那个漏洞），不给这个字段闸会
      // 直接判 false、所有 happy path 测试都会先被 403 挡掉。
      data: { leads_config: { trade_domains: tradeDomains }, industry: clientIndustry },
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

import { POST, PATCH } from '../route'

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
    contactEmail = 'agent@hot.co.nz'
    tradeDomains = ['hot.co.nz']
    clientIndustry = 'travel'
  })

  it('🔴 非旅游客户敲这条 API → 403，行业闸排在其他判据前面（2026-09-28）', async () => {
    clientIndustry = 'logistics'
    contactMatchesClient = true
    contactEmail = 'alex@hot.co.nz'
    const res = await POST(makeReq({
      agentContactId: '00000000-0000-0000-0000-000000000000',
      customerName: 'Chris Brown',
    }), { params: Promise.resolve({ id: 'clientA' }) })
    expect(res.status).toBe(403)
    expect(agentCustomersInsert).not.toHaveBeenCalled()
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

  it('空 leads_config → 明确报"请先在设置页配置同行域名"（不是笼统的"不是同行 Agent"）', async () => {
    contactMatchesClient = true
    tradeDomains = [] // 新客户还没配同行域名清单

    const res = await POST(makeReq({
      agentContactId: '00000000-0000-0000-0000-000000000000',
      customerName: 'Chris Brown',
    }), { params: Promise.resolve({ id: 'clientA' }) })

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('同行域名清单')
    expect(json.error).toContain('设置页')
    expect(agentCustomersInsert).not.toHaveBeenCalled()
  })

  it('拒绝散客（trade 清单里没这个域名）→ 提示改邮箱或加清单', async () => {
    contactMatchesClient = true
    contactEmail = 'guest@gmail.com' // 散客邮箱
    tradeDomains = ['hot.co.nz'] // 只有 HoT 在清单里

    const res = await POST(makeReq({
      agentContactId: '00000000-0000-0000-0000-000000000000',
      customerName: 'Chris Brown',
    }), { params: Promise.resolve({ id: 'clientA' }) })

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('不在同行清单里')
    expect(agentCustomersInsert).not.toHaveBeenCalled()
  })

  it('happy path：trade contact + 匹配域名 → 201 创建成功', async () => {
    contactMatchesClient = true
    contactEmail = 'alex@hot.co.nz'
    tradeDomains = ['hot.co.nz']

    const res = await POST(makeReq({
      agentContactId: '00000000-0000-0000-0000-000000000000',
      customerName: 'Chris Brown',
      pax: 2,
    }), { params: Promise.resolve({ id: 'clientA' }) })

    expect(res.status).toBe(201)
    expect(agentCustomersInsert).toHaveBeenCalledOnce()
    const insertPayload = agentCustomersInsert.mock.calls[0][0] as Record<string, unknown>
    expect(insertPayload.client_id).toBe('clientA')
    expect(insertPayload.customer_name).toBe('Chris Brown')
    expect(insertPayload.pax).toBe(2)
  })
})

describe('PATCH /api/clients/[id]/agents/customers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequire.mockResolvedValue({ ok: true })
    clientIndustry = 'travel'
  })

  it('🔴 非旅游客户敲这条 API → 403，改状态之前就先被挡下来（2026-09-28）', async () => {
    clientIndustry = 'logistics'
    const req = { json: () => Promise.resolve({ stage: 'won' }), url: 'http://localhost/api/clients/clientA/agents/customers?id=ac1' } as Request
    const res = await PATCH(req, { params: Promise.resolve({ id: 'clientA' }) })
    expect(res.status).toBe(403)
  })
})
