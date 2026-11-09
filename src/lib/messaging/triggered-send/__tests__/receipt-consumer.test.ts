// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { EmailUnsubscribeRecord, EmailUnsubscribeWrite } from '@/lib/crm/email-unsubscribe'
import { emailAddressSha256 } from '@/lib/crm/address-sha256'
import { readResendReceipt } from '@/lib/messaging/provider-events/resend-receipt'
import type { ReceiptPatch, ReceiptRow } from '../receipt'
import {
  IN_FLIGHT_WINDOW_MS,
  UNBOUND_LOOKBACK_MS,
  applyReceipt,
  identifyLetter,
  unsubscribeTokensIn,
  type LoadedReceipt,
  type ReceiptStore,
  type UpdateResult,
} from '../receipt-consumer'
import { UNSUBSCRIBE_SECRET_ENV, signUnsubscribeToken } from '../unsubscribe-token'

const NOW = new Date('2026-11-10T02:00:00.000Z')
const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const OTHER_CLIENT = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
const SEND = '0b0e8a4e-5d7c-4f0e-9a43-2b1f3c4d5e6f'
const OTHER_SEND = '11111111-2222-4333-8444-555555555555'
const FP = emailAddressSha256('amy@example.com')
const SECRET = 'test-secret-0123456789-abcdefghijklmnop'
const ENV = (name: string): string | undefined => (name === UNSUBSCRIBE_SECRET_ENV ? SECRET : undefined)

function row(over: Partial<ReceiptRow> = {}): ReceiptRow {
  return {
    id: SEND,
    clientId: CLIENT,
    contactId: 'c0000000-0000-4000-8000-000000000002',
    dedupeScope: 'lifetime',
    status: 'sent',
    reasonCode: null,
    providerMessageId: 'em_1',
    toAddressSha256: FP,
    sentAt: '2026-11-10T01:00:00.000Z',
    providerImpact: 'PROVIDER_ACCEPTED',
    firstAttemptAt: '2026-11-10T01:59:00.000Z',
    updatedAt: 'v1',
    ...over,
  }
}

/** An in-memory ledger with compare-and-set on updatedAt, like the real store. */
function fakeStore(rows: ReceiptRow[], opts: { updateResults?: UpdateResult[]; unsubscribe?: EmailUnsubscribeWrite } = {}) {
  const ledger = new Map(rows.map((r) => [r.id, { ...r }]))
  const updates: Array<{ id: string; patch: ReceiptPatch }> = []
  const unsubscribes: EmailUnsubscribeRecord[] = []
  let version = 1
  const store: ReceiptStore = {
    async findByMessageId(messageId) {
      return [...ledger.values()].filter((r) => r.providerMessageId === messageId && r.dedupeScope === 'lifetime').map((r) => ({ ...r }))
    },
    async findById(id) {
      const r = ledger.get(id)
      return r === undefined ? null : { ...r }
    },
    async findUnboundByAddress(fingerprints, sinceIso) {
      return [...ledger.values()]
        .filter(
          (r) =>
            r.dedupeScope === 'lifetime' &&
            r.providerMessageId === null &&
            r.toAddressSha256 !== null &&
            fingerprints.includes(r.toAddressSha256) &&
            (r.firstAttemptAt ?? '') >= sinceIso &&
            (r.status === 'pending' || r.status === 'unknown_outcome' || (r.status === 'failed' && r.reasonCode === 'not_sent_confirmed')),
        )
        .map((r) => ({ ...r }))
    },
    async updateIfUnchanged(r, patch) {
      const scripted = opts.updateResults?.shift()
      if (scripted !== undefined && scripted !== 'updated') return scripted
      const current = ledger.get(r.id)
      if (current === undefined || current.updatedAt !== r.updatedAt) return 'changed'
      updates.push({ id: r.id, patch })
      version += 1
      ledger.set(r.id, {
        ...current,
        status: patch.status ?? current.status,
        providerMessageId: patch.provider_message_id ?? current.providerMessageId,
        reasonCode: patch.reason_code ?? current.reasonCode,
        sentAt: patch.sent_at ?? current.sentAt,
        updatedAt: `v${version}`,
      })
      return 'updated'
    },
    async recordUnsubscribe(input) {
      if (opts.unsubscribe && !opts.unsubscribe.ok) return opts.unsubscribe
      unsubscribes.push(input)
      return opts.unsubscribe ?? { ok: true, created: true, refreshed: false }
    },
  }
  return { store, ledger, updates, unsubscribes }
}

function token(sendId = SEND, clientId = CLIENT): string {
  const signed = signUnsubscribeToken({ sendId, clientId, issuedAt: 1_789_000_000 }, ENV)
  if (!signed.ok) throw new Error('sign failed')
  return signed.token
}

/** A stored Resend receipt run through the real reader and identity step. */
function receipt(type: string, data: Record<string, unknown> = {}, messageId: string | null = 'em_1'): LoadedReceipt {
  return identifyLetter(
    readResendReceipt({
      eventType: type,
      providerMessageId: messageId,
      occurredAt: '2026-11-10T01:30:00.000Z',
      payload: { type, data: { email_id: messageId, to: ['amy@example.com'], created_at: '2026-11-10T01:00:00.000Z', ...data } },
    }),
    ENV,
  )
}

const opts = (lastTry = false) => ({ lastTry, now: NOW })

describe('identifyLetter: the letter names itself, the token never leaves', () => {
  it('takes the send id from the tag and from a correctly signed unsubscribe link', () => {
    const tagged = receipt('email.delivered', { tags: { triggered_send_id: SEND } })
    expect(tagged.hints).toEqual([{ sendId: SEND, clientId: null }])
    const linked = receipt('email.delivered', { headers: [{ name: 'List-Unsubscribe', value: `<https://me.test/api/u/${token()}>` }] })
    expect(linked.hints).toEqual([{ sendId: SEND, clientId: CLIENT }])
    expect(JSON.stringify(linked)).not.toContain(token())
  })

  it('a link with a wrong signature, or a tag that is not a uuid, names nothing', () => {
    const forged = `${token().slice(0, -1)}${token().endsWith('A') ? 'B' : 'A'}`
    expect(receipt('email.delivered', { headers: [{ name: 'List-Unsubscribe', value: `<https://me.test/api/u/${forged}>` }] }).hints).toEqual([])
    expect(receipt('email.delivered', { tags: { triggered_send_id: 'welcome' } }).hints).toEqual([])
  })

  it('finds tokens in header values', () => {
    expect(unsubscribeTokensIn([`<mailto:x@y.test>, <https://me.test/api/u/${token()}>`])).toEqual([token()])
    expect(unsubscribeTokensIn(['<https://me.test/unsubscribe>'])).toEqual([])
  })
})

describe('applyReceipt: only an exactly named letter is ever touched', () => {
  it('1. by its message id', async () => {
    const f = fakeStore([row()])
    expect(await applyReceipt(receipt('email.delivered'), f.store, opts())).toEqual({ outcome: 'applied', sendId: SEND, status: 'delivered' })
    expect(f.updates[0].patch).not.toHaveProperty('provider_message_id')
  })

  it('2. by its own tag, binding the message id to a row that has none (even while pending)', async () => {
    const f = fakeStore([row({ status: 'pending', providerMessageId: null, sentAt: null, providerImpact: 'NONE' })])
    expect(await applyReceipt(receipt('email.sent', { tags: { triggered_send_id: SEND } }), f.store, opts())).toEqual({
      outcome: 'applied',
      sendId: SEND,
      status: 'sent',
    })
    expect(f.updates[0].patch).toMatchObject({ provider_message_id: 'em_1', status: 'sent', provider_impact: 'PROVIDER_ACCEPTED' })
  })

  it('2. by its signed link: an unknown-outcome row is resolved and gets the id', async () => {
    const f = fakeStore([row({ status: 'unknown_outcome', providerMessageId: null, sentAt: null, providerImpact: 'PROVIDER_UNKNOWN' })])
    const r = receipt('email.delivered', { headers: [{ name: 'List-Unsubscribe', value: `<https://me.test/api/u/${token()}>` }] })
    expect(await applyReceipt(r, f.store, opts())).toEqual({ outcome: 'applied', sendId: SEND, status: 'delivered' })
    expect(f.updates[0].patch).toMatchObject({ provider_message_id: 'em_1', sent_at: '2026-11-10T01:00:00.000Z' })
  })

  it('2. a signed link of ANOTHER client names nothing: the row is not written (only reported, as for any same-address mail)', async () => {
    const f = fakeStore([row({ status: 'unknown_outcome', providerMessageId: null })])
    const r = receipt('email.delivered', { headers: [{ name: 'List-Unsubscribe', value: `<https://me.test/api/u/${token(SEND, OTHER_CLIENT)}>` }] })
    expect(await applyReceipt(r, f.store, opts())).toEqual({ outcome: 'unmatched', sendId: SEND })
    expect(f.updates).toEqual([])
    expect(f.ledger.get(SEND)?.providerMessageId).toBeNull()
  })

  it('2. a letter that names a row holding a DIFFERENT message id is a conflict: the row is not written', async () => {
    const f = fakeStore([row({ providerMessageId: 'em_original' })])
    expect(await applyReceipt(receipt('email.delivered', { tags: { triggered_send_id: SEND } }), f.store, opts())).toEqual({
      outcome: 'conflict',
      sendId: SEND,
    })
    expect(f.updates).toEqual([])
  })

  it('2. tag and link naming two different rows: ambiguous, nothing written', async () => {
    const f = fakeStore([row({ providerMessageId: null }), row({ id: OTHER_SEND, providerMessageId: null })])
    const r = receipt('email.delivered', {
      tags: { triggered_send_id: OTHER_SEND },
      headers: [{ name: 'List-Unsubscribe', value: `<https://me.test/api/u/${token()}>` }],
    })
    expect(await applyReceipt(r, f.store, opts())).toEqual({ outcome: 'ambiguous' })
    expect(f.updates).toEqual([])
  })
})

describe('applyReceipt: never by address (review 2026-11-10)', () => {
  it('another mail to the same address never binds an unknown-outcome row; it is reported as unmatched (regression: misbind probe)', async () => {
    const f = fakeStore([row({ status: 'unknown_outcome', providerMessageId: null, sentAt: null })])
    expect(await applyReceipt(receipt('email.delivered', {}, 'em_system_mail'), f.store, opts(false))).toEqual({ outcome: 'unmatched', sendId: SEND })
    expect(f.updates).toEqual([])
    expect(f.ledger.get(SEND)?.providerMessageId).toBeNull()
  })

  it('a fresh pending row of that address is waited for, then reported as unmatched — never bound', async () => {
    const f = fakeStore([row({ status: 'pending', providerMessageId: null, sentAt: null })])
    expect(await applyReceipt(receipt('email.sent', {}, 'em_other'), f.store, opts(false))).toEqual({ outcome: 'in_flight', sendId: SEND })
    expect(await applyReceipt(receipt('email.sent', {}, 'em_other'), f.store, opts(true))).toEqual({ outcome: 'unmatched', sendId: SEND })
    expect(f.updates).toEqual([])
    expect(f.ledger.get(SEND)?.providerMessageId).toBeNull()
  })

  it('a pending row older than the in-flight window is not waited for: unmatched at once', async () => {
    const stale = new Date(NOW.getTime() - IN_FLIGHT_WINDOW_MS - 1000).toISOString()
    const f = fakeStore([row({ status: 'pending', providerMessageId: null, firstAttemptAt: stale })])
    expect(await applyReceipt(receipt('email.sent', {}, 'em_other'), f.store, opts(false))).toEqual({ outcome: 'unmatched', sendId: SEND })
  })

  it('a complaint to the address of an unknown-outcome row is reported (unmatched), and writes nothing it cannot prove', async () => {
    const f = fakeStore([row({ status: 'unknown_outcome', providerMessageId: null })])
    expect(await applyReceipt(receipt('email.complained', {}, 'em_untagged'), f.store, opts(true))).toEqual({ outcome: 'unmatched', sendId: SEND })
    expect(f.unsubscribes).toEqual([])
  })

  it('rows older than the look-back, or that already have an id, make it "not ours"', async () => {
    const old = new Date(NOW.getTime() - UNBOUND_LOOKBACK_MS - 1000).toISOString()
    const f = fakeStore([row({ status: 'unknown_outcome', providerMessageId: null, firstAttemptAt: old })])
    expect(await applyReceipt(receipt('email.delivered', {}, 'em_other'), f.store, opts(true))).toEqual({ outcome: 'not_ours' })
    const bound = fakeStore([row({ providerMessageId: 'em_mine' })])
    expect(await applyReceipt(receipt('email.delivered', {}, 'em_other'), bound.store, opts(true))).toEqual({ outcome: 'not_ours' })
  })

  it('once the sender recorded its id, the waited-for receipt applies by message id', async () => {
    const f = fakeStore([row({ status: 'pending', providerMessageId: null, sentAt: null })])
    expect((await applyReceipt(receipt('email.sent'), f.store, opts())).outcome).toBe('in_flight')
    f.ledger.set(SEND, { ...f.ledger.get(SEND)!, status: 'sent', providerMessageId: 'em_1', updatedAt: 'v9' })
    expect(await applyReceipt(receipt('email.delivered'), f.store, opts())).toEqual({ outcome: 'applied', sendId: SEND, status: 'delivered' })
  })

  it('ME\'s own system mail ends at once', async () => {
    const f = fakeStore([row({ providerMessageId: 'em_other', toAddressSha256: 'b'.repeat(64) })])
    expect(await applyReceipt(receipt('email.delivered'), f.store, opts())).toEqual({ outcome: 'not_ours' })
  })

  it('a stored type the ledger does not follow is not a receipt', async () => {
    expect(await applyReceipt(receipt('email.opened'), fakeStore([row()]).store, opts())).toEqual({ outcome: 'not_a_receipt' })
  })
})

describe('applyReceipt: writing', () => {
  it('a stale receipt changes nothing', async () => {
    const f = fakeStore([row({ status: 'delivered' })])
    expect(await applyReceipt(receipt('email.sent'), f.store, opts())).toEqual({ outcome: 'unchanged', sendId: SEND, reason: 'not_forward' })
    expect(f.updates).toEqual([])
  })

  it('re-reads and decides again when another receipt changed the row meanwhile', async () => {
    const f = fakeStore([row({ status: 'sent' })], { updateResults: ['changed'] })
    f.ledger.set(SEND, { ...row({ status: 'delivered' }), updatedAt: 'v2' })
    expect(await applyReceipt(receipt('email.delivery_delayed'), f.store, opts())).toEqual({ outcome: 'unchanged', sendId: SEND, reason: 'not_forward' })
  })

  it('the ledger\'s own "backward" refusal and an address conflict end without a write', async () => {
    expect(await applyReceipt(receipt('email.delivered'), fakeStore([row()], { updateResults: ['stale'] }).store, opts())).toMatchObject({ outcome: 'unchanged' })
    expect(await applyReceipt(receipt('email.bounced'), fakeStore([row()], { updateResults: ['conflict'] }).store, opts())).toEqual({
      outcome: 'conflict',
      sendId: SEND,
    })
  })

  it('a row that keeps changing is retried later (throws), never written blindly', async () => {
    const f = fakeStore([row()], { updateResults: ['changed', 'changed', 'changed'] })
    await expect(applyReceipt(receipt('email.delivered'), f.store, opts())).rejects.toThrow(/retry/)
  })
})

describe('applyReceipt: a complaint about a named letter always stops e-mail', () => {
  it('records an e-mail unsubscribe for the contact and the address of the letter', async () => {
    const f = fakeStore([row({ status: 'delivered' })])
    expect(await applyReceipt(receipt('email.complained'), f.store, opts())).toMatchObject({ outcome: 'applied', status: 'complained' })
    expect(f.unsubscribes).toEqual([
      {
        clientId: CLIENT,
        contactId: 'c0000000-0000-4000-8000-000000000002',
        addressSha256: FP,
        triggeredSendId: SEND,
        via: 'complaint',
        occurredAt: '2026-11-10T01:30:00.000Z',
      },
    ])
  })

  it('even when the ledger cannot move: already complained, a conflict, or the row holds another id', async () => {
    const already = fakeStore([row({ status: 'complained' })])
    expect((await applyReceipt(receipt('email.complained'), already.store, opts())).outcome).toBe('unchanged')
    expect(already.unsubscribes).toHaveLength(1)
    const conflict = fakeStore([row({ status: 'failed', reasonCode: 'provider_rejected' })], { updateResults: ['conflict'] })
    expect((await applyReceipt(receipt('email.complained'), conflict.store, opts())).outcome).toBe('conflict')
    expect(conflict.unsubscribes).toHaveLength(1)
    const otherId = fakeStore([row({ providerMessageId: 'em_original' })])
    expect((await applyReceipt(receipt('email.complained', { tags: { triggered_send_id: SEND } }), otherId.store, opts())).outcome).toBe('conflict')
    expect(otherId.unsubscribes).toHaveLength(1)
  })

  it('a failed record write throws so the step is retried', async () => {
    const f = fakeStore([row({ status: 'delivered' })], { unsubscribe: { ok: false, error: 'write: 08006' } })
    await expect(applyReceipt(receipt('email.complained'), f.store, opts())).rejects.toThrow(/complaint unsubscribe not recorded/)
  })

  it('a complaint that names no letter records nothing; other receipts record nothing', async () => {
    const none = fakeStore([row({ providerMessageId: 'em_x', toAddressSha256: FP })])
    await applyReceipt(receipt('email.complained', {}, 'em_unknown'), none.store, opts(true))
    expect(none.unsubscribes).toEqual([])
    const bounce = fakeStore([row({ status: 'sent' })])
    await applyReceipt(receipt('email.bounced', { bounce: { type: 'Permanent' } }), bounce.store, opts())
    expect(bounce.unsubscribes).toEqual([])
  })
})
