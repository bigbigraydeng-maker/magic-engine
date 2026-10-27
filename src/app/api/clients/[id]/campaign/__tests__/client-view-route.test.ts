import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ access: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: mocks.access }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))

import { GET, POST } from '../route'
import { PATCH } from '../[campaignId]/route'

const NOTE = 'PM 2026-10-06 指令：停放中，刻意的。竞品调研见附件。'
const stored = {
  id: 'camp-1',
  client_id: 'client-1',
  status: 'active',
  title: '春季团',
  description: NOTE,
  parsed_content: '竞品页全文',
  semrush_keywords: [{ keyword: 'rival tour' }],
  offer: '早鸟',
}

const clientAccess = {
  ok: true,
  role: 'client-viewer',
  tier: 'paid_client',
  allowedClientId: 'client-1',
  user: { id: 'u', email: 'partner@client.example' },
}
const internalAccess = {
  ok: true,
  role: 'admin',
  tier: 'admin',
  allowedClientId: null,
  user: { id: 'u', email: 'pm@magiclab.com' },
}

function listBuilder(data: unknown) {
  const builder = {
    select() { return builder },
    eq() { return builder },
    order() { return builder },
    then(resolve: (value: { data: unknown; error: null }) => unknown) {
      return Promise.resolve({ data, error: null }).then(resolve)
    },
  }
  return builder
}

describe('推广活动接口按身份裁剪', () => {
  const updates: Record<string, unknown>[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    updates.length = 0
  })

  it('客户角色的列表不含内部备注和竞品词', async () => {
    mocks.access.mockResolvedValue(clientAccess)
    mocks.from.mockReturnValue(listBuilder([stored]))
    const res = await GET(
      new NextRequest('http://localhost/api/clients/client-1/campaign'),
      { params: { id: 'client-1' } },
    )
    const body = await res.json()
    expect(body.viewer).toBe('client')
    expect(body.campaigns[0].title).toBe('春季团')
    expect(body.campaigns[0].description).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('PM 2026-10-06')
    expect(JSON.stringify(body)).not.toContain('rival tour')
  })

  it('内部账号的列表仍含备注', async () => {
    mocks.access.mockResolvedValue(internalAccess)
    mocks.from.mockReturnValue(listBuilder([stored]))
    const res = await GET(
      new NextRequest('http://localhost/api/clients/client-1/campaign'),
      { params: { id: 'client-1' } },
    )
    const body = await res.json()
    expect(body.viewer).toBe('internal')
    expect(body.campaigns[0].description).toBe(NOTE)
  })

  it('客户保存不会把内部备注写成空，返回里也没有备注', async () => {
    mocks.access.mockResolvedValue(clientAccess)
    const builder = {
      update(payload: Record<string, unknown>) { updates.push(payload); return builder },
      eq() { return builder },
      select() { return builder },
      single() { return Promise.resolve({ data: stored, error: null }) },
    }
    mocks.from.mockReturnValue(builder)
    const res = await PATCH(
      new NextRequest('http://localhost/api/clients/client-1/campaign/camp-1', {
        method: 'PATCH',
        body: JSON.stringify({ title: '新名字', description: null }),
      }),
      { params: { id: 'client-1', campaignId: 'camp-1' } },
    )
    expect(updates[0]).not.toHaveProperty('description')
    expect(updates[0]).toMatchObject({ title: '新名字' })
    const body = await res.json()
    expect(body.campaign.description).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('竞品')
  })

  it('客户新建活动写不进 description', async () => {
    mocks.access.mockResolvedValue(clientAccess)
    const inserted: Record<string, unknown>[] = []
    const builder = {
      insert(payload: Record<string, unknown>) { inserted.push(payload); return builder },
      select() { return builder },
      single() { return Promise.resolve({ data: { ...stored, description: null }, error: null }) },
    }
    mocks.from.mockReturnValue(builder)
    const res = await POST(
      new NextRequest('http://localhost/api/clients/client-1/campaign', {
        method: 'POST',
        body: JSON.stringify({ title: '新活动', description: NOTE }),
      }),
      { params: { id: 'client-1' } },
    )
    expect(inserted[0]?.description).toBeNull()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.campaign.description).toBeUndefined()
  })
})
