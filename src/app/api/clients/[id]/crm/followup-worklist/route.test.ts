/**
 * 跟进名单接口：只读、走 CRM 同一道鉴权、响应里没有邮箱和电话。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn(async () => ({ ok: true, allowedClientId: 'cts' })),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { __marker: 'admin' } }))
vi.mock('@/lib/crm/assignee-worklist', async () => {
  const actual = await vi.importActual<typeof import('@/lib/crm/assignee-worklist')>('@/lib/crm/assignee-worklist')
  return { ...actual, findAssigneeWorklist: vi.fn() }
})

import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { findAssigneeWorklist, type WorklistEntry, type WorklistResult } from '@/lib/crm/assignee-worklist'
import { GET } from './route'

const mockAccess = vi.mocked(requirePaidClientAccess)
const mockFind = vi.mocked(findAssigneeWorklist)

const entry = (over: Partial<WorklistEntry> = {}): WorklistEntry => ({
  contactId: 'c1',
  displayName: 'Sue Masson',
  sources: ['email'],
  waitingSince: '2026-10-25T00:00:00Z',
  waitingHours: 48,
  headline: 'Tour enquiry',
  conversationId: 'conv-1',
  assignedTo: 'lisa@example.com',
  ...over,
})
const result = (entries: WorklistEntry[], over: Partial<WorklistResult> = {}): WorklistResult => ({
  entries,
  detected: { meta_form: 0, email: entries.length, whatsapp: 0 },
  byAssignee: { 'lisa@example.com': entries.length },
  strangerEmails: 0,
  errors: {},
  ...over,
})

const req = (qs = '') => new NextRequest(`http://localhost/api/clients/cts/crm/followup-worklist${qs}`)
const params = { params: { id: 'cts' } }

beforeEach(() => {
  vi.clearAllMocks()
  mockAccess.mockResolvedValue({ ok: true, allowedClientId: 'cts' } as never)
  mockFind.mockResolvedValue(result([entry()]))
})

describe('跟进名单接口', () => {
  it('没权限 → 原样透传状态码，不去查名单', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' } as never)
    const res = await GET(req(), params)
    expect(res.status).toBe(403)
    expect(mockFind).not.toHaveBeenCalled()
  })

  it('鉴权按路径里的客户来（不是请求里别的参数）', async () => {
    await GET(req('?clientId=other'), params)
    expect(mockAccess).toHaveBeenCalledWith('cts')
    expect(mockFind.mock.calls[0][1]).toBe('cts')
  })

  it('assignee 参数：不传 = 全部；unassigned = 没分的；邮箱统一小写', async () => {
    await GET(req(), params)
    expect(mockFind.mock.calls[0][3]).toEqual({ assignee: undefined })
    await GET(req('?assignee=unassigned'), params)
    expect(mockFind.mock.calls[1][3]).toEqual({ assignee: 'unassigned' })
    await GET(req('?assignee=Lisa@Example.com'), params)
    expect(mockFind.mock.calls[2][3]).toEqual({ assignee: 'lisa@example.com' })
  })

  it('🔴 响应里没有邮箱和电话：名字是邮箱地址时被清掉，一行标题里的电话被掐掉', async () => {
    mockFind.mockResolvedValue(
      result([entry({ displayName: 'sue.masson@gmail.com', headline: 'Call me on +64 21 123 4567 about China' })]),
    )
    const res = await GET(req(), params)
    const body = JSON.stringify(await res.json())
    expect(body).not.toContain('@gmail.com')
    expect(body).not.toContain('123 4567')
    expect(body).not.toContain('+64')
  })

  it.each([
    ['Sue +64 21 123 4567', '+64 21 123 4567'],
    ['王女士 0211234567', '0211234567'],
    ['Chris (021 987 6543) Brown', '987 6543'],
  ])('🔴 名字里混着电话（%s）→ 响应里没有那串号码（Codex 复核 PR #3271）', async (displayName, digits) => {
    mockFind.mockResolvedValue(result([entry({ displayName })]))
    const body = (await (await GET(req(), params)).json()) as { entries: Array<{ name: string; headline: string | null }> }
    expect(JSON.stringify(body)).not.toContain(digits)
    // 只查客人写的两个字段：响应里的时间戳本来就有连续的数字，扫整个响应会误报。
    for (const e of body.entries) {
      expect((e.name + ' ' + (e.headline ?? '')).replace(/\D/g, '')).not.toMatch(/\d{6,}/)
    }
  })

  it('每条带直达这位客人抽屉的链接', async () => {
    const body = (await (await GET(req(), params)).json()) as { entries: Array<{ url: string }> }
    expect(body.entries[0].url).toBe('https://app.magicengine.com.au/dashboard/clients/cts/crm/all?contact=c1')
  })

  it('🔴 检测器失败的原因和各渠道人数原样带出（名单不完整要说出来）', async () => {
    mockFind.mockResolvedValue(result([], { errors: { email: '读库超时' }, strangerEmails: 3 }))
    const body = (await (await GET(req(), params)).json()) as Record<string, unknown>
    expect(body.errors).toEqual({ email: '读库超时' })
    expect(body.strangerEmails).toBe(3)
    expect(body.detected).toEqual({ meta_form: 0, email: 0, whatsapp: 0 })
  })

  it('limit：默认 100，上限 500；total 始终是过滤后的全量', async () => {
    const many = Array.from({ length: 130 }, (_, i) => entry({ contactId: `c${i}` }))
    mockFind.mockResolvedValue(result(many))
    let body = (await (await GET(req(), params)).json()) as { total: number; returned: number }
    expect(body).toMatchObject({ total: 130, returned: 100 })
    body = (await (await GET(req('?limit=5'), params)).json()) as { total: number; returned: number }
    expect(body).toMatchObject({ total: 130, returned: 5 })
    body = (await (await GET(req('?limit=99999'), params)).json()) as { total: number; returned: number }
    expect(body).toMatchObject({ total: 130, returned: 130 })
  })
})
