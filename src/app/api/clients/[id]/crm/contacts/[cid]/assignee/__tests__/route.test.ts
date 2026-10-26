/**
 * PATCH /crm/contacts/[cid]/assignee —— 改跟进人（issue #3158 part 3）。
 *
 * 这个接口的闸要钉死：
 *
 * 1. **候选名单校验**：客户的 round-robin 名单里没有这个邮箱 → 400。
 *    不校验的话任何字符串都能塞进 `assigned_to`，污染后面 round-robin
 *    的持有数统计（part 2 的 `countHeldLeads`）。
 * 2. **IDOR**：contact.client_id 跟 path 不一致 → 404。
 * 3. **清空**：assignee = null / '' / 省略都走成 `UPDATE SET assigned_to = NULL`。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requirePaidClientAccess: vi.fn(),
  listAssignees: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: mocks.requirePaidClientAccess,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

vi.mock('@/lib/crm/lead-assignee', () => ({
  listAssignees: mocks.listAssignees,
}))

import { PATCH } from '../route'

const CLIENT_ID = 'client-abc'
const CONTACT_ID = 'contact-1'
const ctx = { params: { id: CLIENT_ID, cid: CONTACT_ID } }

function req(body: unknown) {
  return new NextRequest(
    `http://localhost:3001/api/clients/${CLIENT_ID}/crm/contacts/${CONTACT_ID}/assignee`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  )
}

let updatedPayload: Record<string, unknown> | null = null

function stubDb(opts: { contactRow?: { id: string } | null; updateErr?: string } = {}) {
  const { contactRow = { id: CONTACT_ID }, updateErr } = opts
  updatedPayload = null
  mocks.from.mockImplementation((table: string) => {
    if (table !== 'contacts') throw new Error(`unexpected table ${table}`)
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: contactRow, error: null }) }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        updatedPayload = payload
        return {
          eq: () => ({
            eq: async () => (updateErr ? { error: { message: updateErr } } : { error: null }),
          }),
        }
      },
    }
  })
}

beforeEach(() => {
  mocks.requirePaidClientAccess.mockReset()
  mocks.listAssignees.mockReset()
  mocks.from.mockReset()
  mocks.requirePaidClientAccess.mockResolvedValue({ ok: true, user: { email: 'FDE@example.com' }, tier: 'admin', role: 'admin' })
  mocks.listAssignees.mockResolvedValue([{ email: 'baker@cts.co.nz' }, { email: 'lisa@cts.co.nz' }])
})

describe('改跟进人', () => {
  it('候选名单里的邮箱 → 200，assigned_to 落库（小写）', async () => {
    stubDb()
    const res = await PATCH(req({ assignee: 'Baker@CTS.co.NZ' }), ctx)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { assignee: string | null }
    expect(json.assignee).toBe('baker@cts.co.nz')
    expect(updatedPayload).toEqual({ assigned_to: 'baker@cts.co.nz' })
  })

  it('不在候选名单的邮箱 → 400，不落库', async () => {
    stubDb()
    const res = await PATCH(req({ assignee: 'random@elsewhere.com' }), ctx)
    expect(res.status).toBe(400)
    expect(updatedPayload).toBeNull()
  })

  it('assignee = null → 清空到未分配', async () => {
    stubDb()
    const res = await PATCH(req({ assignee: null }), ctx)
    expect(res.status).toBe(200)
    expect(updatedPayload).toEqual({ assigned_to: null })
    // 清空不需要校验候选名单
    expect(mocks.listAssignees).not.toHaveBeenCalled()
  })

  it('空字符串当成清空（不是拒绝）', async () => {
    stubDb()
    const res = await PATCH(req({ assignee: '' }), ctx)
    expect(res.status).toBe(200)
    expect(updatedPayload).toEqual({ assigned_to: null })
  })

  it('contact 不属于这个 client → 404，不落库', async () => {
    stubDb({ contactRow: null })
    const res = await PATCH(req({ assignee: 'baker@cts.co.nz' }), ctx)
    expect(res.status).toBe(404)
    expect(updatedPayload).toBeNull()
  })

  it('非付费客户 → 403', async () => {
    mocks.requirePaidClientAccess.mockResolvedValue({ ok: false, status: 403, error: 'paid_only' })
    stubDb()
    const res = await PATCH(req({ assignee: 'baker@cts.co.nz' }), ctx)
    expect(res.status).toBe(403)
    expect(updatedPayload).toBeNull()
  })

  it('payload 不是字符串或 null → 400', async () => {
    stubDb()
    const res = await PATCH(req({ assignee: 123 }), ctx)
    expect(res.status).toBe(400)
    expect(updatedPayload).toBeNull()
  })
})
