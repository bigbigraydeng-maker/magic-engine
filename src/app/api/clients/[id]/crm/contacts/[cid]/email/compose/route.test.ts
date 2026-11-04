import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn(async () => ({ ok: true, allowedClientId: 'client-a', user: { email: 'Sales@Client.co.nz ' } })),
}))
vi.mock('@/lib/microsoft/mail-send-new-prod', () => ({ createMailNewDeps: vi.fn(() => ({ marker: 'deps' })) }))
vi.mock('@/lib/microsoft/mail-send-new', async () => {
  // The real error class: the route tells "the send had started" apart from other exceptions with instanceof.
  const actual = await vi.importActual<typeof import('@/lib/microsoft/mail-send-new')>('@/lib/microsoft/mail-send-new')
  return { sendMailNew: vi.fn(), SendStartedError: actual.SendStartedError }
})
vi.mock('@/lib/crm/email-templates/send-record-prod', () => ({ recordSendAttemptProd: vi.fn(async () => undefined) }))

import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { SendStartedError, sendMailNew } from '@/lib/microsoft/mail-send-new'
import { emptyMeta } from '@/lib/crm/email-templates/send-gates'
import { createMailNewDeps } from '@/lib/microsoft/mail-send-new-prod'
import { recordSendAttemptProd } from '@/lib/crm/email-templates/send-record-prod'
import { POST } from './route'

const post = (body: unknown, raw?: string) =>
  POST(new NextRequest('http://x/api', { method: 'POST', body: raw ?? JSON.stringify(body) }), { params: { id: 'client-a', cid: 'contact-1' } })

beforeEach(() => vi.clearAllMocks())

describe('POST email/compose', () => {
  it('passes client, contact, normalised sender email and the body fields to sendMailNew', async () => {
    ;(sendMailNew as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, messageId: 'm1', conversationId: 'c1' })
    const res = await post({ subject: 'S', body: 'B', requestId: 'r', expectedRecipient: 'a@b.com' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, messageId: 'm1', conversationId: 'c1', duplicate: false })
    expect(sendMailNew).toHaveBeenCalledWith(
      { clientId: 'client-a', contactId: 'contact-1', subject: 'S', body: 'B', sentByEmail: 'sales@client.co.nz', requestId: 'r', expectedRecipient: 'a@b.com' },
      { marker: 'deps' },
    )
  })

  it('maps a failure to its status + reason + message', async () => {
    ;(sendMailNew as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, status: 403, reason: 'do_not_contact', error: 'no' })
    const res = await post({})
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'no', reason: 'do_not_contact' })
  })

  it('rejects unauthenticated callers without touching sendMailNew', async () => {
    ;(requirePaidClientAccess as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, status: 401, error: 'login' })
    const res = await post({})
    expect(res.status).toBe(401)
    expect(sendMailNew).not.toHaveBeenCalled()
  })

  it('refuses when the sender identity cannot be confirmed', async () => {
    ;(requirePaidClientAccess as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, allowedClientId: 'client-a', user: { email: null } })
    const res = await post({})
    expect(res.status).toBe(403)
    expect(sendMailNew).not.toHaveBeenCalled()
  })

  it('400 on malformed JSON, and a non-object JSON body is passed on as empty fields (sendMailNew rejects it as invalid_input)', async () => {
    const bad = await post(null, '{not json')
    expect(bad.status).toBe(400)
    expect(sendMailNew).not.toHaveBeenCalled()
    ;(sendMailNew as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, status: 400, reason: 'invalid_input', error: 'x' })
    const arr = await post(null, '[1,2]')
    expect(arr.status).toBe(400)
    expect(sendMailNew).toHaveBeenCalledTimes(1)
  })

  describe('with a template', () => {
    const template = {
      key: 'post-call-single-tour',
      version: 3,
      catalogVersion: 7,
      picks: [{ tourId: 't1', departOn: '2027-03-11' }],
      inputs: {},
      callBasis: 'staff_attested',
    }
    const fields = { subject: 'S', body: 'B', requestId: '22222222-2222-4222-8222-222222222222', expectedRecipient: 'a@b.com' }

    it('builds the gates for THIS client and passes the parsed template on', async () => {
      ;(sendMailNew as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, messageId: 'm1', conversationId: 'c1' })
      await post({ ...fields, template })
      expect(createMailNewDeps).toHaveBeenCalledWith('client-a')
      expect(sendMailNew).toHaveBeenCalledWith(expect.objectContaining({ template }), { marker: 'deps' })
    })

    it('400 on a malformed template, without sending anything or recording anything', async () => {
      const res = await post({ ...fields, template: { ...template, version: 'three' } })
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ reason: 'invalid_input' })
      expect(sendMailNew).not.toHaveBeenCalled()
      expect(recordSendAttemptProd).not.toHaveBeenCalled()
    })

    it('records every outcome right after it is known: sent and refused alike', async () => {
      const sent = { ok: true, messageId: 'm1', conversationId: 'c1' }
      ;(sendMailNew as ReturnType<typeof vi.fn>).mockResolvedValueOnce(sent)
      await post({ ...fields, template })
      expect(recordSendAttemptProd).toHaveBeenLastCalledWith({
        clientId: 'client-a',
        contactId: 'contact-1',
        requestId: fields.requestId,
        actorEmail: 'sales@client.co.nz',
        result: sent,
      })
      const refused = { ok: false, status: 409, reason: 'frequency_cap', error: 'cap' }
      ;(sendMailNew as ReturnType<typeof vi.fn>).mockResolvedValueOnce(refused)
      const res = await post({ ...fields, template })
      expect(res.status).toBe(409)
      expect(recordSendAttemptProd).toHaveBeenLastCalledWith(expect.objectContaining({ result: refused }))
    })

    it('an exception that did not come from the send itself (nothing left the building, no audit row) is answered 503 "not sent" and recorded as failed, never as unknown', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      ;(sendMailNew as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('db exploded'))
      const res = await post({ ...fields, template })
      expect(res.status).toBe(503)
      const body = (await res.json()) as { error: string; reason: string }
      expect(body.reason).toBe('internal_error')
      expect(body.error).toContain('没有发出')
      expect(body.error).not.toContain('不确定')
      const call = (recordSendAttemptProd as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        result: { ok: boolean; reason: string; meta: { templateKey: string; templateVersion: number; callBasis: string; blockDetail: string } }
      }
      expect(call.result).toMatchObject({ ok: false, reason: 'internal_error' })
      expect(call.result.meta).toMatchObject({ templateKey: 'post-call-single-tour', templateVersion: 3, callBasis: 'none', blockDetail: 'route_exception' })
    })

    it('a crash on a free-written email is also a clear 503 (and nothing is recorded: no settings era to account to)', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      ;(sendMailNew as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('db exploded'))
      const res = await post(fields)
      expect(res.status).toBe(503)
      expect(recordSendAttemptProd).not.toHaveBeenCalled()
    })

    describe('a crash after the send had started (SendStartedError)', () => {
      const crash = (meta: ReturnType<typeof emptyMeta> | null) => new SendStartedError(new Error('db exploded'), meta)
      const recorded = () =>
        (recordSendAttemptProd as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
          requestId: string
          result: { ok: boolean; status: number; reason: string; meta: ReturnType<typeof emptyMeta> }
        }

      it('a free-written email on versioned settings is recorded as "unknown" too, with what the send had learned', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const meta = { ...emptyMeta(), finalSha256: 'f'.repeat(64), mailbox: 'info@client.co.nz' }
        ;(sendMailNew as ReturnType<typeof vi.fn>).mockRejectedValueOnce(crash(meta))
        const res = await post(fields)
        expect(res.status).toBe(503)
        const body = (await res.json()) as { reason: string; error: string }
        expect(body.reason).toBe('internal_error')
        expect(body.error).toContain('不确定') // the mail may have gone out: "do not send again", never "not sent"
        const call = recorded()
        expect(call.requestId).toBe(fields.requestId)
        expect(call.result).toMatchObject({ ok: false, status: 503, reason: 'send_unknown' })
        expect(call.result.meta).toMatchObject({ templateKey: null, finalSha256: 'f'.repeat(64), mailbox: 'info@client.co.nz', blockDetail: 'route_exception' })
      })

      it('a template email keeps the catalog version, call basis and fingerprints the send had already worked out', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const meta = { ...emptyMeta(), templateKey: 'post-call-single-tour', templateVersion: 3, catalogVersion: 7, callBasis: 'staff_attested' as const, finalSha256: 'a'.repeat(64) }
        ;(sendMailNew as ReturnType<typeof vi.fn>).mockRejectedValueOnce(crash(meta))
        await post({ ...fields, template })
        expect(recorded().result.meta).toMatchObject({ templateVersion: 3, catalogVersion: 7, callBasis: 'staff_attested', finalSha256: 'a'.repeat(64), blockDetail: 'route_exception' })
      })

      it('a client without versioned settings gets no receipt (as before), still a clear 503 that says the mail MAY have gone out', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        ;(sendMailNew as ReturnType<typeof vi.fn>).mockRejectedValueOnce(crash(null))
        const res = await post(fields)
        expect(res.status).toBe(503)
        // no receipt does not mean nothing was sent: the staff member must still be told not to send again
        expect(((await res.json()) as { error: string }).error).toContain('不确定')
        expect(recordSendAttemptProd).not.toHaveBeenCalled()
      })
    })
  })
})
