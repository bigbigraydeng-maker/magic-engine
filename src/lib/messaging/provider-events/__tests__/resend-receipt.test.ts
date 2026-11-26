// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { emailAddressSha256 } from '@/lib/crm/address-sha256'
import {
  RESEND_RECEIPT_KINDS,
  bounceKindOf,
  listUnsubscribeOf,
  readResendReceipt,
  recipientFingerprints,
  tagsOf,
} from '../resend-receipt'
import { RESEND_STORED_EVENT_TYPES } from '../types'

const FP = emailAddressSha256('amy@example.com')

function stored(eventType: string, data: Record<string, unknown>) {
  return {
    eventType,
    providerMessageId: 'em_1',
    occurredAt: '2026-11-10T01:30:00.000Z',
    payload: { type: eventType, created_at: '2026-11-10T01:30:00.000Z', data: { email_id: 'em_1', to: ['amy@example.com'], ...data } },
  }
}

describe('readResendReceipt', () => {
  it('maps exactly the event types the intake stores', () => {
    expect(Object.keys(RESEND_RECEIPT_KINDS).sort()).toEqual([...RESEND_STORED_EVENT_TYPES].sort())
  })

  it('reads the kind, the ids, the times and the bounce type, and keeps only fingerprints of the recipients', () => {
    const receipt = readResendReceipt(stored('email.bounced', { created_at: '2026-11-10T01:00:00.000Z', bounce: { type: 'Permanent' } }))
    expect(receipt).toEqual({
      kind: 'bounced',
      eventType: 'email.bounced',
      messageId: 'em_1',
      occurredAt: '2026-11-10T01:30:00.000Z',
      emailCreatedAt: '2026-11-10T01:00:00.000Z',
      bounceKind: 'permanent',
      tags: {},
      listUnsubscribe: [],
      toFingerprints: [FP],
    })
    expect(JSON.stringify(receipt)).not.toContain('@')
  })

  it('a type the ledger does not follow has no kind', () => {
    expect(readResendReceipt(stored('email.opened', {})).kind).toBeNull()
  })

  it('reads tags given as an object or as name/value pairs, dropping anything that is not a plain token', () => {
    expect(tagsOf({ triggered_send_id: 'abc-1', bad: 'has space' })).toEqual({ triggered_send_id: 'abc-1' })
    expect(tagsOf([{ name: 'triggered_send_id', value: 'abc-1' }, { name: 'x', value: 3 }])).toEqual({ triggered_send_id: 'abc-1' })
    expect(tagsOf(null)).toEqual({})
  })

  it('reads the List-Unsubscribe header from either header shape, case-insensitively', () => {
    expect(listUnsubscribeOf([{ name: 'Reply-To', value: 'info@x.test' }, { name: 'List-Unsubscribe', value: '<https://me.test/api/u/t>' }])).toEqual([
      '<https://me.test/api/u/t>',
    ])
    expect(listUnsubscribeOf({ 'list-unsubscribe': '<https://me.test/api/u/t>' })).toEqual(['<https://me.test/api/u/t>'])
    expect(listUnsubscribeOf(undefined)).toEqual([])
  })

  it('reads "Name <address>" recipients and bounce types', () => {
    expect(recipientFingerprints(['Amy Lee <Amy@Example.com>'])).toEqual([FP])
    expect(recipientFingerprints('amy@example.com')).toEqual([FP])
    expect(bounceKindOf(' transient ')).toBe('transient')
    expect(bounceKindOf('Suppressed')).toBeNull()
  })
})
