/**
 * The reply rule: a reply to a guest's mail is refused only when the guest unsubscribed AFTER their latest mail in the
 * thread. Unreadable = refused. A thread linked to no contact cannot be matched here and is not refused (documented).
 */

import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn(() => { throw new Error('the default client must not be used in these tests') }) } }))

import { createQueryStub, fail, ok } from '@/lib/crm/email-templates/__tests__/query-stub'
import { GATE_MESSAGES } from '../email-templates/send-gates'
import { REPLY_UNSUBSCRIBE_UNVERIFIABLE_MESSAGE, checkReplyUnsubscribe } from '../reply-unsubscribe-gate'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const CONTACT = 'c0000000-0000-4000-8000-000000000002'
const sha = (a: string) => createHash('sha256').update(a.trim().toLowerCase()).digest('hex')

function db(over: { touchpoints?: ReturnType<typeof ok>; contact?: ReturnType<typeof ok>; identities?: ReturnType<typeof ok> } = {}) {
  return createQueryStub({
    contacts: over.contact ?? ok({ primary_email: 'Amy@Example.com' }),
    contact_identities: over.identities ?? ok([{ value: 'amy.lee@work.com' }]),
    contact_touchpoints: over.touchpoints ?? ok([]),
  })
}

describe('checkReplyUnsubscribe', () => {
  it('allows the reply when there is no unsubscribe after the guest\'s latest mail', async () => {
    const stub = db()
    const gate = await checkReplyUnsubscribe({ clientId: CLIENT, contactId: CONTACT, lastInboundAt: '2026-11-09T01:00:00Z' }, { db: stub.db })
    expect(gate).toEqual({ blocked: false })
    expect(stub.of('contact_touchpoints')).toContainEqual({ table: 'contact_touchpoints', method: 'gt', args: ['occurred_at', '2026-11-09T01:00:00.000Z'] })
  })

  it('refuses it (409) when the guest unsubscribed after that mail', async () => {
    const gate = await checkReplyUnsubscribe(
      { clientId: CLIENT, contactId: CONTACT, lastInboundAt: '2026-11-09T01:00:00Z' },
      { db: db({ touchpoints: ok([{ id: 'u1' }]) }).db },
    )
    expect(gate).toMatchObject({ blocked: true, status: 409, reason: 'email_unsubscribed' })
  })

  it('asks by the contact and every one of its addresses', async () => {
    const stub = db()
    await checkReplyUnsubscribe({ clientId: CLIENT, contactId: CONTACT, lastInboundAt: null }, { db: stub.db })
    expect(stub.of('contact_touchpoints')).toContainEqual({
      table: 'contact_touchpoints',
      method: 'or',
      args: [`contact_id.eq.${CONTACT},metadata->>address_sha256.in.(${sha('amy@example.com')},${sha('amy.lee@work.com')})`],
    })
    expect(stub.of('contacts')).toContainEqual({ table: 'contacts', method: 'eq', args: ['client_id', CLIENT] })
    expect(stub.of('contact_identities')).toContainEqual({ table: 'contact_identities', method: 'eq', args: ['kind', 'email'] })
  })

  it('without the time of the guest\'s latest mail, every unsubscribe counts (no time filter)', async () => {
    const stub = db({ touchpoints: ok([{ id: 'u1' }]) })
    const gate = await checkReplyUnsubscribe({ clientId: CLIENT, contactId: CONTACT, lastInboundAt: null }, { db: stub.db })
    expect(gate).toMatchObject({ blocked: true, status: 409 })
    expect(stub.of('contact_touchpoints').some((c) => c.method === 'gt')).toBe(false)
  })

  it('a thread linked to no contact is not refused and nothing is read', async () => {
    const stub = db({ touchpoints: ok([{ id: 'u1' }]) })
    expect(await checkReplyUnsubscribe({ clientId: CLIENT, contactId: null, lastInboundAt: null }, { db: stub.db })).toEqual({ blocked: false })
    expect(stub.calls).toEqual([])
  })

  it('unreadable addresses or records refuse the reply (503)', async () => {
    const cases = [
      db({ contact: fail('down') }),
      db({ identities: fail('down') }),
      db({ touchpoints: fail('down') }),
    ]
    for (const stub of cases) {
      const gate = await checkReplyUnsubscribe({ clientId: CLIENT, contactId: CONTACT, lastInboundAt: null }, { db: stub.db })
      expect(gate).toMatchObject({ blocked: true, status: 503, reason: 'unsubscribe_unverifiable' })
    }
  })

  it('explains an unreadable answer in the same words as the staff-send gate', () => {
    expect(REPLY_UNSUBSCRIBE_UNVERIFIABLE_MESSAGE).toBe(GATE_MESSAGES.unsubscribe_unverifiable)
  })

  it('a contact id that is not a uuid refuses the reply (it would go into a filter)', async () => {
    const gate = await checkReplyUnsubscribe({ clientId: CLIENT, contactId: 'p1', lastInboundAt: null }, { db: db().db })
    expect(gate).toMatchObject({ blocked: true, status: 503 })
  })
})
