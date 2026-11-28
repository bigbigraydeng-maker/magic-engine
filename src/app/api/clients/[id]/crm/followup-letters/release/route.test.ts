// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { marker: 'db' } }))
vi.mock('@/lib/crm/followup-progress/letter-list-prod', () => ({ createLetterListDeps: vi.fn(async () => ({ marker: 'deps' })) }))
vi.mock('@/lib/crm/followup-progress/letter-list', () => ({ checkLetterRelease: vi.fn() }))
vi.mock('@/lib/crm/email-compose/follow-up-draft', () => ({ checkFollowUpLetter: vi.fn() }))
vi.mock('@/lib/crm/email-templates/send-template-email', () => ({ sendTemplateEmail: vi.fn() }))

import { NextRequest } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { checkLetterRelease } from '@/lib/crm/followup-progress/letter-list'
import { checkFollowUpLetter } from '@/lib/crm/email-compose/follow-up-draft'
import { sendTemplateEmail } from '@/lib/crm/email-templates/send-template-email'
import { POST } from './route'

const access = requirePaidClientAccess as ReturnType<typeof vi.fn>
const still = checkLetterRelease as ReturnType<typeof vi.fn>
const checks = checkFollowUpLetter as ReturnType<typeof vi.fn>
const send = sendTemplateEmail as ReturnType<typeof vi.fn>

const CLIENT = 'c0000000-0000-4000-8000-000000000001'
const GUEST = 'a0000000-0000-4000-8000-000000000002'
const REQ = 'b0000000-0000-5000-8000-000000000003'
const good = { contactId: GUEST, subject: 'Hello', body: 'Kia ora', requestId: REQ, expectedRecipient: 'g@example.com' }

function post(body: unknown) {
  return POST(new NextRequest('https://x.test/api', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), { params: { id: CLIENT } })
}

beforeEach(() => {
  vi.clearAllMocks()
  access.mockResolvedValue({ ok: true, user: { email: ' Staff@Example.com ' } })
  still.mockResolvedValue({ ok: true })
  checks.mockResolvedValue({ ok: true, checks: [{ id: 'prices', status: 'pass', label: '价格', detail: '没问题' }, { id: 'length', status: 'warn', label: '长度', detail: '160 词' }] })
  send.mockResolvedValue({ ok: true, messageId: 'm1', conversationId: 'v1' })
})

describe('POST followup-letters/release', () => {
  it('no access → the access answer, nothing checked, nothing sent', async () => {
    access.mockResolvedValue({ ok: false, status: 403, error: 'no' })
    const res = await post(good)
    expect(res.status).toBe(403)
    expect(still).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('a signed-in person without an email cannot be the sender on record', async () => {
    access.mockResolvedValue({ ok: true, user: { email: null } })
    expect((await post(good)).status).toBe(403)
    expect(send).not.toHaveBeenCalled()
  })

  it('a malformed request is refused before any read', async () => {
    for (const bad of ['not json', {}, { ...good, contactId: 'x' }, { ...good, requestId: 'not-a-uuid' }, { ...good, subject: '  ' }, { ...good, body: '' }]) {
      expect((await post(bad)).status).toBe(400)
    }
    expect(still).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('everything stands: the guest is judged again, the text is checked again, then the existing send runs as the signed-in person', async () => {
    const res = await post(good)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, duplicate: false })
    expect(still).toHaveBeenCalledWith({ marker: 'deps' }, { contactId: GUEST, requestId: REQ }, expect.any(Date))
    expect(checks).toHaveBeenCalledWith(CLIENT, GUEST, { subject: 'Hello', body: 'Kia ora' })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({ clientId: CLIENT, contactId: GUEST, actorEmail: 'staff@example.com', requestId: REQ, subject: 'Hello', body: 'Kia ora', expectedRecipient: 'g@example.com', template: null })
  })

  it('a warning does not stop a letter; only a failed check does', async () => {
    expect((await post(good)).status).toBe(200)
  })

  it('the guest is no longer the AI\'s to write to (a staff member rang since): 409 with the reason, nothing sent, the text is not even checked', async () => {
    still.mockResolvedValue({ ok: false, reason: 'recent_activity', message: '名单打开之后有人联系过他，这封没有发。' })
    const res = await post(good)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: '名单打开之后有人联系过他，这封没有发。', reason: 'recent_activity' })
    expect(checks).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('a failed check on the text as it will be sent: 409, the checks come back, nothing sent', async () => {
    const failed = [{ id: 'conversation_claim', status: 'fail', label: '没通上话就不说「我们通话时」', detail: '信里写了 "When we spoke"' }]
    checks.mockResolvedValue({ ok: true, checks: failed })
    const res = await post(good)
    const json = await res.json()
    expect(res.status).toBe(409)
    expect(json.reason).toBe('check_failed')
    expect(json.error).toContain('没通上话就不说')
    expect(json.checks).toEqual(failed)
    expect(send).not.toHaveBeenCalled()
  })

  it('the checks cannot be run (catalogue unreadable, do-not-contact): nothing is sent', async () => {
    checks.mockResolvedValue({ ok: false, reason: 'facts_unreadable', message: '暂时读不到团目录' })
    const res = await post(good)
    expect(res.status).toBe(409)
    expect(send).not.toHaveBeenCalled()
  })

  it('the re-check itself breaking is a refusal that says nothing was sent', async () => {
    still.mockRejectedValue(new Error('rows unreadable'))
    const res = await post(good)
    expect(res.status).toBe(409)
    expect((await res.json()).reason).toBe('recheck_failed')
    expect(send).not.toHaveBeenCalled()
  })

  it('the send path\'s own answers pass through: a refusal with its status, a crash as "may have sent", a replay as duplicate', async () => {
    send.mockResolvedValueOnce({ ok: false, status: 429, reason: 'frequency_cap', error: '这周发满了' })
    const refused = await post(good)
    expect(refused.status).toBe(429)
    expect(await refused.json()).toEqual({ error: '这周发满了', reason: 'frequency_cap' })
    send.mockResolvedValueOnce({ crashed: true, mayHaveSent: true, message: '不确定发没发' })
    expect((await post(good)).status).toBe(503)
    send.mockResolvedValueOnce({ ok: true, messageId: 'm', conversationId: 'v', duplicate: true })
    expect(await (await post(good)).json()).toMatchObject({ ok: true, duplicate: true })
  })
})
