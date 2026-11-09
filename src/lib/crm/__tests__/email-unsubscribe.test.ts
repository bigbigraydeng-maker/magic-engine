/**
 * The one-click unsubscribe record, as every sender reads it: by contact AND by the guest's addresses (the same address
 * can sit on two contact records). An unreadable answer must never pass for "not unsubscribed".
 */

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createQueryStub, fail, ok } from '@/lib/crm/email-templates/__tests__/query-stub'
import {
  EMAIL_UNSUBSCRIBE_SOURCE,
  buildEmailUnsubscribeRow,
  readEmailUnsubscribed,
  recordEmailUnsubscribe,
  type EmailUnsubscribeRecord,
} from '../email-unsubscribe'
import { isAutomatedTouch } from '../automated-touch'

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

describe('readEmailUnsubscribed: threads without a contact, and "only after"', () => {
  it('a thread with no contact is asked about its addresses only', async () => {
    const stub = createQueryStub({ contact_touchpoints: ok([]) })
    const read = await readEmailUnsubscribed(stub.db, 'client-a', { contactId: null, addresses: ['amy@example.com'] })
    expect(read).toEqual({ ok: true, unsubscribed: false })
    expect(stub.of('contact_touchpoints')).toContainEqual({
      table: 'contact_touchpoints',
      method: 'or',
      args: [`metadata->>address_sha256.in.(${sha('amy@example.com')})`],
    })
  })

  it('no contact and no address: nothing can match, nothing is read', async () => {
    const stub = createQueryStub({ contact_touchpoints: ok([{ id: 't1' }]) })
    expect(await readEmailUnsubscribed(stub.db, 'client-a', { contactId: null, addresses: ['  '] })).toEqual({ ok: true, unsubscribed: false })
    expect(stub.touched('contact_touchpoints')).toBe(false)
  })

  it('"after" only counts records made later than that moment', async () => {
    const stub = createQueryStub({ contact_touchpoints: ok([]) })
    await readEmailUnsubscribed(stub.db, 'client-a', { contactId: CONTACT, addresses: [] }, { after: '2026-11-09T01:00:00+13:00' })
    expect(stub.of('contact_touchpoints')).toContainEqual({ table: 'contact_touchpoints', method: 'gt', args: ['occurred_at', '2026-11-08T12:00:00.000Z'] })
  })

  it('without "after" there is no time filter (every record counts)', async () => {
    const stub = createQueryStub({ contact_touchpoints: ok([]) })
    await readEmailUnsubscribed(stub.db, 'client-a', { contactId: CONTACT, addresses: [] })
    expect(stub.of('contact_touchpoints').some((c) => c.method === 'gt')).toBe(false)
  })

  it('an "after" that is not a time is a failure, before anything is read', async () => {
    const stub = createQueryStub({ contact_touchpoints: ok([]) })
    const read = await readEmailUnsubscribed(stub.db, 'client-a', { contactId: CONTACT, addresses: [] }, { after: 'yesterday' })
    expect(read.ok).toBe(false)
    expect(stub.touched('contact_touchpoints')).toBe(false)
  })
})

const RECORD: EmailUnsubscribeRecord = {
  clientId: 'c0000000-0000-0000-0000-000000000000',
  contactId: CONTACT,
  addressSha256: sha('amy@example.com'),
  triggeredSendId: '0b0e8a4e-5d7c-4f0e-9a43-2b1f3c4d5e6f',
  via: 'link',
  occurredAt: '2026-11-10T01:02:03Z',
}

describe('recordEmailUnsubscribe', () => {
  it('writes the row the readers look for: e-mail only, machine-written, one per contact and address', () => {
    expect(buildEmailUnsubscribeRow(RECORD)).toEqual({
      client_id: RECORD.clientId,
      contact_id: CONTACT,
      channel: 'email',
      direction: 'inbound',
      occurred_at: '2026-11-10T01:02:03.000Z',
      summary: expect.stringContaining('退订'),
      raw: null,
      metadata: {
        automated: true,
        kind: 'email_unsubscribed',
        address_sha256: RECORD.addressSha256,
        via: 'link',
        triggered_send_id: RECORD.triggeredSendId,
      },
      source: EMAIL_UNSUBSCRIBE_SOURCE,
      source_ref: `${CONTACT}:${RECORD.addressSha256}`,
    })
  })

  it('a complaint writes the same key (a click and a complaint are one record)', () => {
    const complaint = buildEmailUnsubscribeRow({ ...RECORD, via: 'complaint' })
    expect(complaint.source_ref).toBe(buildEmailUnsubscribeRow(RECORD).source_ref)
    expect(complaint.summary).toContain('垃圾邮件')
    expect(complaint.summary).toContain('打电话不受影响')
  })

  it('the row holds no address, only its fingerprint', () => {
    expect(JSON.stringify(buildEmailUnsubscribeRow(RECORD))).not.toContain('@')
  })

  it('is a machine record, so it never reads as the guest getting in touch', () => {
    const row = buildEmailUnsubscribeRow(RECORD)
    expect(isAutomatedTouch(row.source as string, row.metadata as Record<string, unknown>)).toBe(true)
  })

  it('upserts with "ignore duplicates" on the table\'s unique key, and says whether it was new', async () => {
    const created = createQueryStub({ contact_touchpoints: ok([{ id: 'new' }]) })
    expect(await recordEmailUnsubscribe(created.db, RECORD)).toEqual({ ok: true, created: true })
    expect(created.of('contact_touchpoints')).toContainEqual({
      table: 'contact_touchpoints',
      method: 'upsert',
      args: [buildEmailUnsubscribeRow(RECORD), { onConflict: 'client_id,source,source_ref', ignoreDuplicates: true }],
    })
    const repeat = createQueryStub({ contact_touchpoints: ok([]) })
    expect(await recordEmailUnsubscribe(repeat.db, RECORD)).toEqual({ ok: true, created: false })
  })

  it('a failed write is a failure with no detail from the database', async () => {
    const failing = createQueryStub({ contact_touchpoints: fail('Failing row contains (amy@example.com)') })
    const written = await recordEmailUnsubscribe(failing.db, RECORD)
    expect(written.ok).toBe(false)
    expect(JSON.stringify(written)).not.toContain('@')
  })

  it('refuses malformed input before writing', async () => {
    const bad: EmailUnsubscribeRecord[] = [
      { ...RECORD, clientId: 'x' },
      { ...RECORD, contactId: 'x' },
      { ...RECORD, triggeredSendId: 'x' },
      { ...RECORD, addressSha256: 'amy@example.com' },
      { ...RECORD, via: 'other' as 'link' },
      { ...RECORD, occurredAt: 'soon' },
    ]
    for (const input of bad) {
      const stub = createQueryStub({ contact_touchpoints: ok([]) })
      expect((await recordEmailUnsubscribe(stub.db, input)).ok).toBe(false)
      expect(stub.touched('contact_touchpoints')).toBe(false)
    }
  })
})
