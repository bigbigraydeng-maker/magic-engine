/**
 * 群发记一笔。
 *
 * 🔴 这条路径最容易一次伤到一大片：一次调用最多 500 人，而取消「别再联系」
 * 是**一次一个人**的，没有批量入口。所以两件事必须钉死：
 *   · 群发的备注永远推不出「别再联系」
 *   · 说过别再联系的人，即使前端传进来也绝不记
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requirePaidClientAccess: vi.fn(),
  from: vi.fn(),
  recordManualTouchpoint: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: mocks.requirePaidClientAccess,
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))
vi.mock('@/lib/crm/touchpoints', () => ({ recordManualTouchpoint: mocks.recordManualTouchpoint }))

import { POST } from '../route'

const CLIENT_ID = 'client-abc'
const ctx = { params: { id: CLIENT_ID } }

function req(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost:3001/api/clients/${CLIENT_ID}/crm/touchpoints/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: 'ref-1', ...body }),
  })
}

/** @param touches 这些人的触点（拒联判据的真相源） */
function stubDb(
  contacts: { id: string; do_not_contact?: boolean }[],
  touches: Record<string, unknown>[] = [],
) {
  mocks.from.mockImplementation((table: string) => {
    if (table === 'contacts') {
      return {
        select: () => ({
          eq: () => ({
            in: async () => ({
              data: contacts.map((c) => ({
                id: c.id,
                last_seen_at: null,
                do_not_contact: c.do_not_contact === true,
              })),
              error: null,
            }),
          }),
        }),
      }
    }
    return {
      select: () => ({
        eq: () => ({
          in: () => ({
            order: () => ({
              order: () => ({ range: async () => ({ data: touches, error: null }) }),
            }),
          }),
        }),
      }),
    }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePaidClientAccess.mockResolvedValue({
    ok: true,
    user: { email: 'fde@test.com' },
    role: 'admin',
    allowedClientId: null,
  })
  mocks.recordManualTouchpoint.mockResolvedValue({ created: true })
})

describe('群发的备注永远推不出「别再联系」', () => {
  /**
   * 🔴 在**入口**挡掉，而不是在下游一处处补。上一版只写死了
   * `do_not_contact: false`，但 `outcome` 仍是 `'do_not_contact'` ——
   * `isDoNotContact()` 同样认那个值。
   *
   * 载体换成中文那句：本 PR 后来把新加的英文退订词表整组退回去了（PO 2026-08-17），
   * 英文页脚现在压根不命中词表，用它测不到这道闸。一次最多 500 人，
   * 而取消是一个一个点的 —— 误伤代价极不对称，这道闸必须有用例钉住。
   */
  it('🔴 备注里带着拒联语义 → 整批不写，并告诉调用方换一句', async () => {
    stubDb([{ id: 'c1' }, { id: 'c2' }])
    const res = await POST(
      req({
        contactIds: ['c1', 'c2'],
        note: '群发了八月行程；客户说别再联系的请单独处理',
      }),
      ctx,
    )

    expect(res.status).toBe(400)
    expect(mocks.recordManualTouchpoint).not.toHaveBeenCalled()
    expect((await res.json()).error).toContain('单独记一笔')
  })

  it('🔴 备注直接写「客户说别再联系」→ 同样挡掉，那不是这批人说的话', async () => {
    stubDb([{ id: 'c1' }])
    const res = await POST(req({ contactIds: ['c1'], note: '客户说别再联系' }), ctx)
    expect(res.status).toBe(400)
    expect(mocks.recordManualTouchpoint).not.toHaveBeenCalled()
  })

  it('正常的群发备注照常记，且不带拒联判词', async () => {
    stubDb([{ id: 'c1' }])
    const res = await POST(req({ contactIds: ['c1'], note: '群发了八月行程' }), ctx)
    expect(res.status).toBe(200)
    const parsed = mocks.recordManualTouchpoint.mock.calls[0][0].parsed
    expect(parsed.do_not_contact).toBe(false)
    expect(parsed.outcome).not.toBe('do_not_contact')
  })
})

describe('说过别再联系的人，群发时绝不记', () => {
  it('镜像列说是 → 跳过', async () => {
    stubDb([{ id: 'c1', do_not_contact: true }, { id: 'c2' }])
    const res = await POST(req({ contactIds: ['c1', 'c2'], note: '群发了一封邮件' }), ctx)

    expect(mocks.recordManualTouchpoint).toHaveBeenCalledTimes(1)
    expect(mocks.recordManualTouchpoint.mock.calls[0][0].contactId).toBe('c2')
    expect((await res.json()).skipped).toBe(1)
  })

  it('只有触点说过（镜像列没写上）→ 一样跳过', async () => {
    stubDb(
      [{ id: 'c1' }],
      [
        {
          id: 't1',
          contact_id: 'c1',
          metadata: { outcome: 'do_not_contact' },
          occurred_at: '2026-07-01T00:00:00Z',
          raw: null,
          direction: 'outbound',
          source: 'me_manual',
        },
      ],
    )
    await POST(req({ contactIds: ['c1'], note: '群发了一封邮件' }), ctx)
    expect(mocks.recordManualTouchpoint).not.toHaveBeenCalled()
  })
})
