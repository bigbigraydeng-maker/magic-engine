import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn(async () => ({ ok: true, allowedClientId: 'client-a', user: { email: 's@c.nz' } })),
}))
vi.mock('@/lib/microsoft/mail-send-new-prod', () => ({ createMailNewDeps: vi.fn(() => ({ marker: 'deps' })) }))
vi.mock('@/lib/microsoft/mail-send-new', () => ({ previewCompose: vi.fn() }))
vi.mock('@/lib/crm/email-compose/ai-draft', () => ({ generateFirstEmailDraft: vi.fn() }))

import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { previewCompose } from '@/lib/microsoft/mail-send-new'
import { generateFirstEmailDraft } from '@/lib/crm/email-compose/ai-draft'
import { POST } from './route'

const call = () => POST(new NextRequest('http://x/api', { method: 'POST' }), { params: { id: 'client-a', cid: 'contact-1' } })
const can = { canCompose: true, recipient: 'a@b.com', mailbox: 'i@c.nz', sentToContactLast7Days: 0 }

beforeEach(() => vi.clearAllMocks())

describe('POST email/compose/draft', () => {
  it('returns subject + body when allowed', async () => {
    ;(previewCompose as ReturnType<typeof vi.fn>).mockResolvedValueOnce(can)
    ;(generateFirstEmailDraft as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, draft: { subject: 'S', body: 'B' } })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ subject: 'S', body: 'B' })
    expect(generateFirstEmailDraft).toHaveBeenCalledWith('client-a', 'contact-1')
  })

  it('feature off / not an enquirer → 409 and the AI is never called', async () => {
    ;(previewCompose as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ canCompose: false, reason: 'disabled', message: '未开通' })
    const res = await call()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: '未开通', reason: 'disabled' })
    expect(generateFirstEmailDraft).not.toHaveBeenCalled()
  })

  it('unauthenticated → 401, nothing else runs', async () => {
    ;(requirePaidClientAccess as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, status: 401, error: 'login' })
    const res = await call()
    expect(res.status).toBe(401)
    expect(previewCompose).not.toHaveBeenCalled()
  })

  it('AI failure → 502 with the reason', async () => {
    ;(previewCompose as ReturnType<typeof vi.fn>).mockResolvedValueOnce(can)
    ;(generateFirstEmailDraft as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, reason: 'no_ai', message: 'x' })
    const res = await call()
    expect(res.status).toBe(502)
  })
})
