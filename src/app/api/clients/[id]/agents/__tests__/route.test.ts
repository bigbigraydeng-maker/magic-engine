import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRequire = vi.fn()
vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: (...a: unknown[]) => mockRequire(...a),
}))

// 每个 test case 单独摆好 leads_config / 身份 / 客户行，覆盖三条判据分支。
let tradeDomains: string[] = ['hot.co.nz']
let identityRows: Array<{ contact_id: string; value: string }> = []
let customerRows: Array<Record<string, unknown>> = []
let contactRows: Array<{ id: string; display_name: string | null }> = []
let clientIndustry: string | null = 'travel'

/** 可链式调用、也可 await 的 mock：select/eq/in/order 都返回自身。 */
function chain(result: { data: unknown; error: null }) {
  const node: Record<string, unknown> = {}
  const self = () => node
  node.select = self
  node.eq = self
  node.in = self
  node.order = self
  node.maybeSingle = () => Promise.resolve(result)
  node.then = (onFulfilled: (v: { data: unknown; error: null }) => unknown) =>
    Promise.resolve(result).then(onFulfilled)
  return node
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'clients') {
        // industry: 'travel' —— 这条路由现在也走 clientHasIndustryFeature(id, 'agents') 闸
        // （2026-09-28，堵 NAL 能看到 CTS 专属同行渠道数据那个漏洞），不给这个字段闸会
        // 直接判 false、所有 happy path 测试都会先被 403 挡掉。
        return chain({ data: { leads_config: { trade_domains: tradeDomains }, industry: clientIndustry }, error: null })
      }
      if (table === 'contact_identities') {
        return chain({ data: identityRows, error: null })
      }
      if (table === 'agent_customers') {
        return chain({ data: customerRows, error: null })
      }
      if (table === 'contacts') {
        return chain({ data: contactRows, error: null })
      }
      return chain({ data: null, error: null })
    },
  },
}))

import { GET } from '../route'

interface AgentJson {
  contactId: string
  primaryEmail: string | null
  customerCount: number
  lastContactAt: string | null
  customers: Array<{ customerName: string | null }>
}

function makeReq(): Request {
  return new Request('http://localhost/api/clients/clientA/agents')
}

describe('GET /api/clients/[id]/agents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequire.mockResolvedValue({ ok: true })
    tradeDomains = ['hot.co.nz']
    identityRows = []
    customerRows = []
    contactRows = []
    clientIndustry = 'travel'
  })

  it('🔴 非旅游客户（如 NAL 物流）敲这条 API → 403，不是只藏页面按钮（2026-09-28）', async () => {
    clientIndustry = 'logistics'
    const res = await GET(makeReq(), { params: Promise.resolve({ id: 'clientA' }) })
    expect(res.status).toBe(403)
  })

  it('0 条 agent_customers + 2 个 trade 联系人 + 1 个散客 → 2 个 agent、各 customers: []、散客不出现', async () => {
    identityRows = [
      { contact_id: 'a', value: 'alice@hot.co.nz' },
      { contact_id: 'b', value: 'bob@mail.hot.co.nz' },
      { contact_id: 'g', value: 'guest@gmail.com' },
    ]
    customerRows = []
    contactRows = [
      { id: 'a', display_name: 'Alice' },
      { id: 'b', display_name: 'Bob' },
      { id: 'g', display_name: 'Guest' },
    ]

    const res = await GET(makeReq(), { params: Promise.resolve({ id: 'clientA' }) })

    expect(res.status).toBe(200)
    const json = (await res.json()) as { agents: AgentJson[] }
    expect(json.agents.length).toBe(2)
    expect(new Set(json.agents.map((a) => a.contactId))).toEqual(new Set(['a', 'b']))
    for (const agent of json.agents) {
      expect(agent.customers).toEqual([])
      expect(agent.customerCount).toBe(0)
    }
    const alice = json.agents.find((a) => a.contactId === 'a')
    expect(alice?.primaryEmail).toBe('alice@hot.co.nz')
    expect(json.agents.some((a) => a.contactId === 'g')).toBe(false)
  })

  it('1 条客户挂在 A → A 在前带 1 个客户，B 在后 customers: []', async () => {
    identityRows = [
      { contact_id: 'a', value: 'alice@hot.co.nz' },
      { contact_id: 'b', value: 'bob@mail.hot.co.nz' },
    ]
    customerRows = [
      {
        id: 'ac1',
        agent_contact_id: 'a',
        customer_name: 'Chris Brown',
        pax: 2,
        trip_type: null,
        travel_dates: null,
        specific_needs: null,
        stage: 'new',
        last_contact_at: '2026-09-20T00:00:00Z',
        last_contact_summary: null,
        conversation_id: null,
        notes: null,
        updated_at: '2026-09-20T00:00:00Z',
      },
    ]
    contactRows = [
      { id: 'a', display_name: 'Alice' },
      { id: 'b', display_name: 'Bob' },
    ]

    const res = await GET(makeReq(), { params: Promise.resolve({ id: 'clientA' }) })

    expect(res.status).toBe(200)
    const json = (await res.json()) as { agents: AgentJson[] }
    expect(json.agents[0].contactId).toBe('a')
    expect(json.agents[0].customerCount).toBe(1)
    expect(json.agents[0].customers[0].customerName).toBe('Chris Brown')
    expect(json.agents[0].lastContactAt).toBe('2026-09-20T00:00:00Z')
    expect(json.agents[1].contactId).toBe('b')
    expect(json.agents[1].customers).toEqual([])
  })

  it('leads_config 空 → 0 个 agent，不报错', async () => {
    tradeDomains = []
    identityRows = [
      { contact_id: 'a', value: 'alice@hot.co.nz' },
      { contact_id: 'b', value: 'bob@mail.hot.co.nz' },
      { contact_id: 'g', value: 'guest@gmail.com' },
    ]
    customerRows = []
    contactRows = [
      { id: 'a', display_name: 'Alice' },
      { id: 'b', display_name: 'Bob' },
      { id: 'g', display_name: 'Guest' },
    ]

    const res = await GET(makeReq(), { params: Promise.resolve({ id: 'clientA' }) })

    expect(res.status).toBe(200)
    const json = (await res.json()) as { agents: AgentJson[] }
    expect(json.agents).toEqual([])
  })
})
