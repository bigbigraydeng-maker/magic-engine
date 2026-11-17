// @vitest-environment node
/**
 * Receipts, complaints and the unsubscribe link work for every real letter, not only the welcome letter's lifetime
 * rows (design 2026-11-17 §4.4): a `letter:<key>` row is a real send; only the rehearsal's `shadow` rows are not.
 */
import { describe, expect, it, vi } from 'vitest'
import type { EmailUnsubscribeRecord } from '@/lib/crm/email-unsubscribe'
import { buildAuthorizationChangedEvent } from '@/lib/inngest/triggered-send-events'
import { decideReceipt, type ReceiptFacts, type ReceiptRow } from '../receipt'
import { applyReceipt, type ReceiptStore } from '../receipt-consumer'
import { isLiveScope, letterKeyOfScope, letterScope, notSentTimelineLine } from '../trigger-scope'
import { DONE_PAGE, handleUnsubscribePost, INVALID_PAGE, type UnsubscribeEntryDeps, type UnsubscribeSendRow } from '../unsubscribe-entry'
import { signUnsubscribeToken, UNSUBSCRIBE_SECRET_ENV } from '../unsubscribe-token'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const SEND = '0b0e8a4e-5d7c-4f0e-9a43-2b1f3c4d5e6f'
const NOW = new Date('2026-11-20T02:00:00.000Z')
const SECRET = 'test-secret-0123456789-abcdefghijklmnop'
const ENV = (name: string): string | undefined => (name === UNSUBSCRIBE_SECRET_ENV ? SECRET : undefined)

function row(over: Partial<ReceiptRow> = {}): ReceiptRow {
  return {
    id: SEND, clientId: CLIENT, contactId: 'c0000000-0000-4000-8000-000000000002', dedupeScope: 'letter:catalogue_2027', status: 'sent', reasonCode: null,
    providerMessageId: 'em_1', toAddressSha256: 'a'.repeat(64), sentAt: '2026-11-20T01:00:00.000Z', providerImpact: 'PROVIDER_ACCEPTED',
    firstAttemptAt: '2026-11-20T00:59:59.000Z', updatedAt: 'v1', ...over,
  }
}

const facts = (kind: ReceiptFacts['kind']): ReceiptFacts => ({ kind, eventType: `email.${kind}`, messageId: 'em_1', occurredAt: '2026-11-20T01:30:00.000Z', emailCreatedAt: '2026-11-20T01:00:00.000Z', bounceKind: null })

describe('the scope values', () => {
  it('a letter scope is live, the rehearsal is not; a letter key reads back from its scope', () => {
    expect(isLiveScope(letterScope('followup_d7'))).toBe(true)
    expect(isLiveScope('lifetime')).toBe(true)
    expect(isLiveScope('shadow')).toBe(false)
    expect(letterKeyOfScope('letter:followup_d7')).toBe('followup_d7')
    expect(letterKeyOfScope('lifetime')).toBeNull()
    expect(letterKeyOfScope('letter:Bad')).toBeNull()
    expect(notSentTimelineLine('welcome')).toBe('ME 自动发信没有发出：欢迎信')
    expect(notSentTimelineLine('crm_ai_followup')).toBe('ME 自动发信没有发出：AI 跟进信')
  })
})

describe('receipts of a letter row', () => {
  it('🔴 a delivery moves a letter row forward; a rehearsal row is still not a send', () => {
    expect(decideReceipt(row(), facts('delivered'), null, NOW.toISOString())).toMatchObject({ kind: 'update', status: 'delivered' })
    expect(decideReceipt(row({ dedupeScope: 'shadow', status: 'shadow' }), facts('delivered'), null, NOW.toISOString())).toEqual({ kind: 'unchanged', reason: 'not_a_send' })
  })

  it('🔴 a complaint about a follow-up letter writes the unsubscribe (so no ME letter goes to that guest again)', async () => {
    const unsubscribes: EmailUnsubscribeRecord[] = []
    const store: ReceiptStore = {
      findByMessageId: async () => [row()],
      findById: async () => row(),
      findUnboundByAddress: async () => [],
      updateIfUnchanged: async () => 'updated',
      recordUnsubscribe: async (input) => {
        unsubscribes.push(input)
        return { ok: true, created: true, refreshed: false }
      },
    }
    const out = await applyReceipt({ facts: facts('complained'), hints: [], toFingerprints: [] }, store, { lastTry: false, now: NOW })
    expect(out).toMatchObject({ outcome: 'applied', status: 'complained' })
    expect(unsubscribes).toEqual([expect.objectContaining({ triggeredSendId: SEND, via: 'complaint', addressSha256: 'a'.repeat(64) })])
  })
})

describe('the unsubscribe link of a letter row', () => {
  function deps(sendRow: UnsubscribeSendRow) {
    const records: EmailUnsubscribeRecord[] = []
    const d: UnsubscribeEntryDeps = {
      env: ENV,
      loadSend: vi.fn(async () => ({ ok: true as const, row: sendRow })),
      record: async (input) => {
        records.push(input)
        return { ok: true, created: true, refreshed: false }
      },
      now: () => NOW,
      log: () => undefined,
    }
    return { d, records }
  }
  const signed = signUnsubscribeToken({ sendId: SEND, clientId: CLIENT, issuedAt: 1_789_000_000 }, ENV)
  const token = signed.ok ? signed.token : ''

  it('🔴 a follow-up letter\'s link unsubscribes the guest; a rehearsal row\'s id is still not a link we sent', async () => {
    const base: UnsubscribeSendRow = { id: SEND, clientId: CLIENT, contactId: 'c0000000-0000-4000-8000-000000000002', channel: 'email', dedupeScope: 'letter:catalogue_2027', toAddressSha256: 'a'.repeat(64) }
    const live = deps(base)
    expect(await handleUnsubscribePost(token, live.d)).toEqual({ status: 200, html: DONE_PAGE })
    expect(live.records).toHaveLength(1)
    const shadow = deps({ ...base, dedupeScope: 'shadow' })
    expect(await handleUnsubscribePost(token, shadow.d)).toEqual({ status: 404, html: INVALID_PAGE })
    expect(shadow.records).toHaveLength(0)
  })
})

describe('the authorization event names its trigger', () => {
  const args = { request_id: 'r', authorization_id: 'a', client_id: CLIENT, change: 'proposed' as const, actor: 'person', rule_sha256: 'x', template_version: 1, template_sha256: 'y', daily_cap: 5, live_from: null, expires_at: null, now: NOW }
  it('absent = the welcome letter (every older caller); given = that trigger', () => {
    expect(buildAuthorizationChangedEvent(args).data.trigger_key).toBe('welcome')
    expect(buildAuthorizationChangedEvent({ ...args, trigger_key: 'crm_ai_followup' }).data).toMatchObject({ trigger_key: 'crm_ai_followup', channel: 'email', no_send: true })
  })
})
