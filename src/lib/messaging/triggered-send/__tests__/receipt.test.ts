// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  NOT_SENT_CONFIRMED,
  PROVIDER_FAILED_REASON,
  RECEIPT_KINDS,
  decideReceipt,
  rankOf,
  type ReceiptFacts,
  type ReceiptKind,
  type ReceiptRow,
} from '../receipt'
import { RESEND_RECEIPT_KINDS } from '../../provider-events/resend-receipt'

const NOW = '2026-11-10T02:00:00.000Z'

function row(over: Partial<ReceiptRow> = {}): ReceiptRow {
  return {
    id: '0b0e8a4e-5d7c-4f0e-9a43-2b1f3c4d5e6f',
    clientId: 'c0000000-0000-0000-0000-000000000000',
    contactId: 'c0000000-0000-4000-8000-000000000002',
    dedupeScope: 'lifetime',
    status: 'sent',
    reasonCode: null,
    providerMessageId: 'em_1',
    toAddressSha256: 'a'.repeat(64),
    sentAt: '2026-11-10T01:00:00.000Z',
    providerImpact: 'PROVIDER_ACCEPTED',
    firstAttemptAt: '2026-11-10T00:59:59.000Z',
    updatedAt: '2026-11-10T01:00:01.123456+00:00',
    ...over,
  }
}

function facts(kind: ReceiptKind, over: Partial<ReceiptFacts> = {}): ReceiptFacts {
  return {
    kind,
    eventType: `email.${kind}`,
    messageId: 'em_1',
    occurredAt: '2026-11-10T01:30:00.000Z',
    emailCreatedAt: '2026-11-10T01:00:00.000Z',
    bounceKind: null,
    ...over,
  }
}

describe('the levels match the ledger migration', () => {
  it('every status level here is the one triggered_send_status_rank() gives', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261102130000_triggered_send_ledger.sql'), 'utf8')
    const body = sql.slice(sql.indexOf('function public.triggered_send_status_rank'), sql.indexOf('$$;', sql.indexOf('function public.triggered_send_status_rank')))
    const levels = Object.fromEntries(Array.from(body.matchAll(/when '([a-z_]+)' then (\d+)/g)).map((m) => [m[1], Number(m[2])]))
    expect(levels).toEqual({
      pending: 1,
      unknown_outcome: 2,
      sent: 3,
      delivery_delayed: 4,
      delivered: 5,
      suppressed: 6,
      failed: 6,
      bounced: 7,
      complained: 8,
    })
    for (const [status, level] of Object.entries(levels)) expect(rankOf(status)).toBe(level)
    expect(rankOf('shadow')).toBeNull()
    expect(rankOf('blocked')).toBeNull()
  })

  it('every kind the Resend reader produces is a kind the ledger follows, and back', () => {
    expect([...new Set(Object.values(RESEND_RECEIPT_KINDS))].sort()).toEqual([...RECEIPT_KINDS].sort())
  })
})

describe('decideReceipt: only forward', () => {
  it('moves forward and records which event did it', () => {
    expect(decideReceipt(row(), facts('delivered'), null, NOW)).toEqual({
      kind: 'update',
      status: 'delivered',
      patch: { status: 'delivered', last_event_type: 'email.delivered', last_event_at: '2026-11-10T01:30:00.000Z' },
    })
  })

  it('a receipt that would move back or sideways changes nothing (out-of-order receipts converge)', () => {
    expect(decideReceipt(row({ status: 'delivered' }), facts('sent'), null, NOW)).toEqual({ kind: 'unchanged', reason: 'not_forward' })
    expect(decideReceipt(row({ status: 'delivered' }), facts('delivered'), null, NOW)).toEqual({ kind: 'unchanged', reason: 'not_forward' })
    expect(decideReceipt(row({ status: 'bounced' }), facts('delivered'), null, NOW)).toEqual({ kind: 'unchanged', reason: 'not_forward' })
    expect(decideReceipt(row({ status: 'complained' }), facts('bounced'), null, NOW)).toEqual({ kind: 'unchanged', reason: 'not_forward' })
    expect(decideReceipt(row({ status: 'failed', reasonCode: 'provider_rejected' }), facts('suppressed'), null, NOW)).toEqual({ kind: 'unchanged', reason: 'not_forward' })
  })

  it('delivered then bounced moves on; bounced then delivered stays bounced', () => {
    const delivered = row({ status: 'delivered' })
    expect(decideReceipt(delivered, facts('bounced'), null, NOW)).toMatchObject({ kind: 'update', status: 'bounced' })
    expect(decideReceipt(row({ status: 'bounced' }), facts('delivered'), null, NOW).kind).toBe('unchanged')
  })

  it('every type from every send status: allowed exactly when its level is higher', () => {
    const statuses = ['pending', 'unknown_outcome', 'sent', 'delivery_delayed', 'delivered', 'suppressed', 'bounced', 'complained']
    for (const status of statuses) {
      for (const target of RECEIPT_KINDS) {
        const decision = decideReceipt(row({ status }), facts(target), null, NOW)
        const forward = (rankOf(target) ?? 0) > (rankOf(status) ?? 0)
        const failedAfterDelivery = target === 'failed' && (rankOf(status) ?? 0) >= 5
        expect(decision.kind === 'update', `${status} + ${target}`).toBe(forward && !failedAfterDelivery)
      }
    }
  })

  it('rows that are not live sends never change', () => {
    for (const r of [row({ dedupeScope: 'shadow', status: 'shadow' }), row({ status: 'blocked' }), row({ status: 'skipped' })]) {
      expect(decideReceipt(r, facts('delivered'), null, NOW)).toEqual({ kind: 'unchanged', reason: 'not_a_send' })
    }
  })
})

describe('decideReceipt: the two exceptions of the design', () => {
  it('a person\'s "not sent" mark is overridden by any real receipt from sent up', () => {
    const marked = row({ status: 'failed', reasonCode: NOT_SENT_CONFIRMED, providerMessageId: null, sentAt: null })
    for (const kind of ['sent', 'delivery_delayed', 'delivered', 'suppressed', 'bounced', 'complained'] as const) {
      expect(decideReceipt(marked, facts(kind), 'em_9', NOW), kind).toMatchObject({ kind: 'update', status: kind })
    }
  })

  it('but a "failed" receipt never touches a "not sent" row (the reason may not change while failed)', () => {
    const marked = row({ status: 'failed', reasonCode: NOT_SENT_CONFIRMED })
    expect(decideReceipt(marked, facts('failed'), null, NOW)).toEqual({ kind: 'unchanged', reason: 'person_marked_not_sent' })
  })

  it('a "failed" receipt never applies once the letter was delivered (failed would release the address)', () => {
    for (const status of ['delivered', 'suppressed', 'bounced', 'complained']) {
      const decision = decideReceipt(row({ status }), facts('failed'), null, NOW)
      expect(decision.kind, status).toBe('unchanged')
    }
    expect(decideReceipt(row({ status: 'delivered' }), facts('failed'), null, NOW)).toEqual({ kind: 'unchanged', reason: 'failed_after_delivery' })
  })
})

describe('decideReceipt: the columns that go with the status', () => {
  it('failed always carries its reason in the same update', () => {
    expect(decideReceipt(row({ status: 'sent' }), facts('failed'), null, NOW)).toMatchObject({
      kind: 'update',
      patch: { status: 'failed', reason_code: PROVIDER_FAILED_REASON },
    })
  })

  it('a bounce carries its kind; an unknown kind is "undetermined"', () => {
    expect(decideReceipt(row(), facts('bounced', { bounceKind: 'permanent' }), null, NOW)).toMatchObject({ patch: { bounce_kind: 'permanent' } })
    expect(decideReceipt(row(), facts('bounced', { bounceKind: null }), null, NOW)).toMatchObject({ patch: { bounce_kind: 'undetermined' } })
  })

  it('fills sent_at only when it is empty and the letter left the provider, from the letter\'s own creation time', () => {
    const unknown = row({ status: 'unknown_outcome', sentAt: null, providerMessageId: null, providerImpact: 'PROVIDER_UNKNOWN' })
    expect(decideReceipt(unknown, facts('delivered'), 'em_1', NOW)).toEqual({
      kind: 'update',
      status: 'delivered',
      patch: {
        status: 'delivered',
        provider_message_id: 'em_1',
        sent_at: '2026-11-10T01:00:00.000Z',
        provider_impact: 'PROVIDER_ACCEPTED',
        last_event_type: 'email.delivered',
        last_event_at: '2026-11-10T01:30:00.000Z',
      },
    })
    const suppressed = decideReceipt(unknown, facts('suppressed'), 'em_1', NOW)
    expect(suppressed.kind === 'update' && 'sent_at' in suppressed.patch).toBe(false)
    const already = decideReceipt(row({ sentAt: '2026-11-10T00:00:00.000Z' }), facts('delivered'), null, NOW)
    expect(already.kind === 'update' && 'sent_at' in already.patch).toBe(false)
  })

  it('falls back to the event time, then to now, when the receipt has no times', () => {
    const unknown = row({ status: 'pending', sentAt: null })
    expect(decideReceipt(unknown, facts('sent', { emailCreatedAt: null }), null, NOW)).toMatchObject({ patch: { sent_at: '2026-11-10T01:30:00.000Z' } })
    expect(decideReceipt(unknown, facts('sent', { emailCreatedAt: null, occurredAt: null }), null, NOW)).toMatchObject({
      patch: { sent_at: NOW, last_event_at: NOW },
    })
  })

  it('only records a message id on a row that has none', () => {
    const decision = decideReceipt(row({ status: 'sent', providerMessageId: 'em_1' }), facts('delivered'), 'em_other', NOW)
    expect(decision.kind === 'update' && 'provider_message_id' in decision.patch).toBe(false)
  })
})
