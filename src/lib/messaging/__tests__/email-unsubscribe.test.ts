/**
 * The one-click unsubscribe record, as every sender reads it. An unreadable answer must never pass for "not unsubscribed".
 */

import { describe, expect, it } from 'vitest'
import { createQueryStub, fail, ok } from '@/lib/crm/email-templates/__tests__/query-stub'
import { EMAIL_UNSUBSCRIBE_SOURCE, readEmailUnsubscribed } from '../email-unsubscribe'

describe('readEmailUnsubscribed', () => {
  it('a record of this contact means unsubscribed', async () => {
    const stub = createQueryStub({ contact_touchpoints: ok([{ id: 't1' }]) })
    expect(await readEmailUnsubscribed(stub.db, 'client-a', 'contact-1')).toEqual({ ok: true, unsubscribed: true })
    const calls = stub.of('contact_touchpoints')
    expect(calls).toContainEqual({ table: 'contact_touchpoints', method: 'eq', args: ['client_id', 'client-a'] })
    expect(calls).toContainEqual({ table: 'contact_touchpoints', method: 'eq', args: ['contact_id', 'contact-1'] })
    expect(calls).toContainEqual({ table: 'contact_touchpoints', method: 'eq', args: ['source', EMAIL_UNSUBSCRIBE_SOURCE] })
    expect(calls).toContainEqual({ table: 'contact_touchpoints', method: 'eq', args: ['channel', 'email'] })
  })

  it('no record means still subscribed', async () => {
    const stub = createQueryStub({ contact_touchpoints: ok([]) })
    expect(await readEmailUnsubscribed(stub.db, 'client-a', 'contact-1')).toEqual({ ok: true, unsubscribed: false })
  })

  it('a failed read or a reply without rows is a failure, never "not unsubscribed"', async () => {
    const failing = createQueryStub({ contact_touchpoints: fail('boom') })
    expect(await readEmailUnsubscribed(failing.db, 'client-a', 'contact-1')).toEqual({ ok: false, error: 'unsubscribe read: boom' })
    const empty = createQueryStub({ contact_touchpoints: ok(null) })
    expect((await readEmailUnsubscribed(empty.db, 'client-a', 'contact-1')).ok).toBe(false)
  })

  it('is the source the unsubscribe entry will write', () => {
    expect(EMAIL_UNSUBSCRIBE_SOURCE).toBe('me_unsubscribe')
  })
})
