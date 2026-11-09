import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn(async () => ({ ok: true, allowedClientId: 'client-a', user: { email: 's@c.nz' } })),
}))
vi.mock('@/lib/microsoft/mail-send-new-prod', () => ({ createMailNewDeps: vi.fn(() => ({ marker: 'deps' })) }))
vi.mock('@/lib/microsoft/mail-send-new', () => ({ previewCompose: vi.fn() }))
vi.mock('@/lib/crm/email-compose/ai-draft', () => ({ generateFirstEmailDraft: vi.fn(), claimDraftSlot: vi.fn(() => true) }))
vi.mock('@/lib/crm/email-compose/follow-up-draft', () => ({ generateFollowUpDraft: vi.fn() }))

import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { previewCompose } from '@/lib/microsoft/mail-send-new'
import { claimDraftSlot, generateFirstEmailDraft } from '@/lib/crm/email-compose/ai-draft'
import { generateFollowUpDraft } from '@/lib/crm/email-compose/follow-up-draft'
import { POST } from './route'

const call = () => POST(new NextRequest('http://x/api', { method: 'POST' }), { params: { id: 'client-a', cid: 'contact-1' } })
const callWith = (body: string) =>
  POST(new NextRequest('http://x/api', { method: 'POST', body }), { params: { id: 'client-a', cid: 'contact-1' } })
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
    expect(requirePaidClientAccess).toHaveBeenCalledWith('client-a')
    expect(previewCompose).toHaveBeenCalledWith({ clientId: 'client-a', contactId: 'contact-1' }, { marker: 'deps' })
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

  it('customer said "stop contacting me" on a call → 409 call_dnc, not 502', async () => {
    ;(previewCompose as ReturnType<typeof vi.fn>).mockResolvedValueOnce(can)
    ;(generateFirstEmailDraft as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, reason: 'call_dnc', message: 'x' })
    const res = await call()
    expect(res.status).toBe(409)
    expect((await res.json()).reason).toBe('call_dnc')
  })

  it('cooldown hit → 429 and the AI is never called', async () => {
    ;(previewCompose as ReturnType<typeof vi.fn>).mockResolvedValueOnce(can)
    ;(claimDraftSlot as ReturnType<typeof vi.fn>).mockReturnValueOnce(false)
    const res = await call()
    expect(res.status).toBe(429)
    expect(generateFirstEmailDraft).not.toHaveBeenCalled()
  })

  it('kind follow_up → the follow-up writer, with reading list and checks; the first-email writer is not called', async () => {
    ;(previewCompose as ReturnType<typeof vi.fn>).mockResolvedValueOnce(can)
    const draft = { subject: 'S', body: 'B', read: [{ kind: 'system', text: 'r' }], checks: [{ id: 'links', status: 'pass', label: 'l', detail: 'd' }] }
    ;(generateFollowUpDraft as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, draft })
    const res = await callWith(JSON.stringify({ kind: 'follow_up' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ...draft, kind: 'follow_up' })
    expect(generateFollowUpDraft).toHaveBeenCalledWith('client-a', 'contact-1')
    expect(generateFirstEmailDraft).not.toHaveBeenCalled()
  })

  it('follow_up: not configured / do-not-contact → 409; AI failure → 502', async () => {
    for (const [reason, status] of [['not_configured', 409], ['do_not_contact', 409], ['no_ai', 502]] as const) {
      ;(previewCompose as ReturnType<typeof vi.fn>).mockResolvedValueOnce(can)
      ;(generateFollowUpDraft as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, reason, message: 'm' })
      const res = await callWith(JSON.stringify({ kind: 'follow_up' }))
      expect(res.status).toBe(status)
      expect((await res.json()).reason).toBe(reason)
    }
  })

  it('unknown kind or broken body → 400 before anything else runs', async () => {
    expect((await callWith(JSON.stringify({ kind: 'blast' }))).status).toBe(400)
    expect((await callWith('{not json')).status).toBe(400)
    expect(previewCompose).not.toHaveBeenCalled()
  })
})
