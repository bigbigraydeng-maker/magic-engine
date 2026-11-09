/**
 * The one-click unsubscribe record, as every sender reads it: by contact AND by the guest's addresses (the same address
 * can sit on two contact records). An unreadable answer must never pass for "not unsubscribed".
 */

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createQueryStub, fail, ok } from '@/lib/crm/email-templates/__tests__/query-stub'
import { EMAIL_UNSUBSCRIBE_SOURCE, readEmailUnsubscribed } from '../email-unsubscribe'

const CONTACT = 'c0000000-0000-4000-8000-000000000002'
const sha = (a: string) => createHash('sha256').update(a.trim().toLowerCase()).digest('hex')

describe('readEmailUnsubscribed', () => {
  it('asks for a record of this contact or of any of these addresses, e-mail only', async () => {
    const stub = createQueryStub({ contact_touchpoints: ok([{ id: 't1' }]) })
    const read = await readEmailUnsubscribed(stub.db, 'client-a', { contactId: CONTACT, addresses: ['Amy@Example.com ', 'amy@example.com', 'amy.lee@work.com'] })
    expect(read).toEqual({ ok: true, unsubscribed: true })
    const calls = stub.of('contact_touchpoints')
    expect(calls).toContainEqual({ table: 'contact_touchpoints', method: 'eq', args: ['client_id', 'client-a'] })
    expect(calls).toContainEqual({ table: 'contact_touchpoints', method: 'eq', args: ['source', EMAIL_UNSUBSCRIBE_SOURCE] })
    expect(calls).toContainEqual({ table: 'contact_touchpoints', method: 'eq', args: ['channel', 'email'] })
    expect(calls).toContainEqual({
      table: 'contact_touchpoints',
      method: 'or',
      args: [`contact_id.eq.${CONTACT},metadata->>address_sha256.in.(${sha('amy@example.com')},${sha('amy.lee@work.com')})`],
    })
  })

  it('without addresses it still asks about the contact', async () => {
    const stub = createQueryStub({ contact_touchpoints: ok([]) })
    expect(await readEmailUnsubscribed(stub.db, 'client-a', { contactId: CONTACT, addresses: [] })).toEqual({ ok: true, unsubscribed: false })
    expect(stub.of('contact_touchpoints')).toContainEqual({ table: 'contact_touchpoints', method: 'or', args: [`contact_id.eq.${CONTACT}`] })
  })

  it('a contact id that is not a uuid is refused before anything is read (it goes into a filter)', async () => {
    const stub = createQueryStub({ contact_touchpoints: ok([]) })
    const read = await readEmailUnsubscribed(stub.db, 'client-a', { contactId: 'x,client_id.neq.0', addresses: [] })
    expect(read.ok).toBe(false)
    expect(stub.touched('contact_touchpoints')).toBe(false)
  })

  it('a failed read or a reply without rows is a failure, never "not unsubscribed"', async () => {
    const failing = createQueryStub({ contact_touchpoints: fail('boom') })
    expect(await readEmailUnsubscribed(failing.db, 'client-a', { contactId: CONTACT, addresses: [] })).toEqual({ ok: false, error: 'unsubscribe read: boom' })
    const empty = createQueryStub({ contact_touchpoints: ok(null) })
    expect((await readEmailUnsubscribed(empty.db, 'client-a', { contactId: CONTACT, addresses: [] })).ok).toBe(false)
  })

  it('is the source the unsubscribe entry will write', () => {
    expect(EMAIL_UNSUBSCRIBE_SOURCE).toBe('me_unsubscribe')
  })
})
