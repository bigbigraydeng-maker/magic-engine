// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { EmailUnsubscribeRecord, EmailUnsubscribeWrite } from '@/lib/crm/email-unsubscribe'
import { emailAddressSha256 } from '@/lib/crm/address-sha256'
import type { ReceiptPatch, ReceiptRow } from '../receipt'
import {
  ADDRESS_MATCH_WINDOW_MS,
  applyReceipt,
  loadReceipt,
  recipientFingerprints,
  tagSendIdOf,
  type LoadedReceipt,
  type ReceiptStore,
  type UpdateResult,
} from '../receipt-consumer'

const NOW = new Date('2026-11-10T02:00:00.000Z')
const SEND = '0b0e8a4e-5d7c-4f0e-9a43-2b1f3c4d5e6f'
const OTHER_SEND = '11111111-2222-4333-8444-555555555555'
const ADDRESS = 'amy@example.com'
const FP = emailAddressSha256(ADDRESS)

function row(over: Partial<ReceiptRow> = {}): ReceiptRow {
  return {
    id: SEND,
    clientId: 'c0000000-0000-0000-0000-000000000000',
    contactId: 'c0000000-0000-4000-8000-000000000002',
    dedupeScope: 'lifetime',
    status: 'sent',
    reasonCode: null,
    providerMessageId: 'em_1',
    toAddressSha256: FP,
    sentAt: '2026-11-10T01:00:00.000Z',
    providerImpact: 'PROVIDER_ACCEPTED',
    firstAttemptAt: '2026-11-10T00:59:59.000Z',
    updatedAt: 'v1',
    ...over,
  }
}

/** An in-memory ledger with compare-and-set on updatedAt, like the real store. */
function fakeStore(rows: ReceiptRow[], opts: { updateResults?: UpdateResult[]; unsubscribe?: EmailUnsubscribeWrite } = {}) {
  const ledger = new Map(rows.map((r) => [r.id, { ...r }]))
  const updates: Array<{ id: string; patch: ReceiptPatch }> = []
  const unsubscribes: EmailUnsubscribeRecord[] = []
  const sinceAsked: string[] = []
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
      sinceAsked.push(sinceIso)
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
      return opts.unsubscribe ?? { ok: true, created: true }
    },
  }
  return { store, ledger, updates, unsubscribes, sinceAsked }
}

function receipt(type: string, data: Record<string, unknown> = {}, messageId: string | null = 'em_1'): LoadedReceipt {
  return loadReceipt({
    eventType: type,
    providerMessageId: messageId,
    occurredAt: '2026-11-10T01:30:00.000Z',
    payload: { type, created_at: '2026-11-10T01:30:00.000Z', data: { email_id: messageId, to: [ADDRESS], created_at: '2026-11-10T01:00:00.000Z', ...data } },
  })
}

describe('loadReceipt', () => {
  it('keeps fingerprints, never the address', () => {
    const loaded = receipt('email.delivered')
    expect(loaded.toFingerprints).toEqual([FP])
    expect(JSON.stringify(loaded)).not.toContain('@')
  })

  it('reads the bounce type, the letter time and the send tag (object or name/value pairs)', () => {
    const asObject = receipt('email.bounced', { bounce: { type: 'Permanent' }, tags: { triggered_send_id: SEND } })
    expect(asObject.facts).toMatchObject({ type: 'email.bounced', bounceKind: 'permanent', emailCreatedAt: '2026-11-10T01:00:00.000Z' })
    expect(asObject.tagSendId).toBe(SEND)
    expect(tagSendIdOf([{ name: 'triggered_send_id', value: SEND }])).toBe(SEND)
    expect(tagSendIdOf({ triggered_send_id: 'not-a-uuid' })).toBeNull()
    expect(tagSendIdOf(null)).toBeNull()
  })

  it('a type the ledger does not follow has no facts', () => {
    expect(receipt('email.opened').facts).toBeNull()
  })

  it('accepts "Name <address>" recipients', () => {
    expect(recipientFingerprints(['Amy Lee <Amy@Example.com>'])).toEqual([FP])
    expect(recipientFingerprints('amy@example.com')).toEqual([FP])
    expect(recipientFingerprints(undefined)).toEqual([])
  })
})

describe('applyReceipt: which letter', () => {
  it('1. by its message id', async () => {
    const f = fakeStore([row()])
    expect(await applyReceipt(receipt('email.delivered'), f.store, { bindPending: false, now: NOW })).toEqual({ outcome: 'applied', sendId: SEND, status: 'delivered' })
    expect(f.updates).toHaveLength(1)
    expect(f.updates[0].patch).not.toHaveProperty('provider_message_id')
  })

  it('4. ME\'s own system mail (no row anywhere) ends at once: nothing written, nothing retried', async () => {
    const f = fakeStore([row({ providerMessageId: 'em_other', toAddressSha256: 'b'.repeat(64) })])
    expect(await applyReceipt(receipt('email.delivered'), f.store, { bindPending: false, now: NOW })).toEqual({ outcome: 'not_ours' })
    expect(f.updates).toEqual([])
  })

  it('2. by the letter\'s own tag, binding the message id to a row that has none (even while pending)', async () => {
    const f = fakeStore([row({ status: 'pending', providerMessageId: null, sentAt: null, providerImpact: 'NONE' })])
    const out = await applyReceipt(receipt('email.sent', { tags: { triggered_send_id: SEND } }), f.store, { bindPending: false, now: NOW })
    expect(out).toEqual({ outcome: 'applied', sendId: SEND, status: 'sent' })
    expect(f.updates[0].patch).toMatchObject({ provider_message_id: 'em_1', status: 'sent', provider_impact: 'PROVIDER_ACCEPTED' })
  })

  it('2. a tag that names a row with a DIFFERENT message id is a conflict, nothing is written', async () => {
    const f = fakeStore([row({ providerMessageId: 'em_original' })])
    const out = await applyReceipt(receipt('email.delivered', { tags: { triggered_send_id: SEND } }), f.store, { bindPending: false, now: NOW })
    expect(out).toEqual({ outcome: 'conflict', sendId: SEND })
    expect(f.updates).toEqual([])
  })

  it('3. by address: an unknown-outcome row without a message id is resolved and gets the id', async () => {
    const f = fakeStore([row({ status: 'unknown_outcome', providerMessageId: null, sentAt: null, providerImpact: 'PROVIDER_UNKNOWN' })])
    const out = await applyReceipt(receipt('email.delivered'), f.store, { bindPending: false, now: NOW })
    expect(out).toEqual({ outcome: 'applied', sendId: SEND, status: 'delivered' })
    expect(f.updates[0].patch).toMatchObject({ provider_message_id: 'em_1', sent_at: '2026-11-10T01:00:00.000Z' })
    expect(f.sinceAsked).toEqual([new Date(NOW.getTime() - ADDRESS_MATCH_WINDOW_MS).toISOString()])
  })

  it('3. by address: a pending row is waited for first (its sender may record the id), then bound on the last try', async () => {
    const f = fakeStore([row({ status: 'pending', providerMessageId: null, sentAt: null })])
    expect(await applyReceipt(receipt('email.sent'), f.store, { bindPending: false, now: NOW })).toEqual({ outcome: 'in_flight', sendId: SEND })
    expect(f.updates).toEqual([])
    expect(await applyReceipt(receipt('email.sent'), f.store, { bindPending: true, now: NOW })).toEqual({ outcome: 'applied', sendId: SEND, status: 'sent' })
  })

  it('3. a person\'s "not sent" row is corrected by a real delivery', async () => {
    const f = fakeStore([row({ status: 'failed', reasonCode: 'not_sent_confirmed', providerMessageId: null, sentAt: null })])
    expect(await applyReceipt(receipt('email.delivered'), f.store, { bindPending: false, now: NOW })).toMatchObject({ outcome: 'applied', status: 'delivered' })
  })

  it('3. older than the window, or two candidate rows: not matched by address', async () => {
    const old = fakeStore([row({ status: 'unknown_outcome', providerMessageId: null, firstAttemptAt: '2026-11-01T00:00:00.000Z' })])
    expect(await applyReceipt(receipt('email.delivered'), old.store, { bindPending: true, now: NOW })).toEqual({ outcome: 'not_ours' })
    const two = fakeStore([
      row({ status: 'unknown_outcome', providerMessageId: null }),
      row({ id: OTHER_SEND, status: 'unknown_outcome', providerMessageId: null }),
    ])
    expect(await applyReceipt(receipt('email.delivered'), two.store, { bindPending: true, now: NOW })).toEqual({ outcome: 'ambiguous' })
    expect(two.updates).toEqual([])
  })

  it('a receipt without a message id can never be bound by address', async () => {
    const f = fakeStore([row({ status: 'unknown_outcome', providerMessageId: null })])
    expect(await applyReceipt(receipt('email.delivered', {}, null), f.store, { bindPending: true, now: NOW })).toEqual({ outcome: 'not_ours' })
  })

  it('a stored type the ledger does not follow is not a receipt', async () => {
    const f = fakeStore([row()])
    expect(await applyReceipt(receipt('email.opened'), f.store, { bindPending: false, now: NOW })).toEqual({ outcome: 'not_a_receipt' })
  })
})

describe('applyReceipt: writing', () => {
  it('a stale receipt changes nothing', async () => {
    const f = fakeStore([row({ status: 'delivered' })])
    expect(await applyReceipt(receipt('email.sent'), f.store, { bindPending: false, now: NOW })).toEqual({ outcome: 'unchanged', sendId: SEND, reason: 'not_forward' })
    expect(f.updates).toEqual([])
  })

  it('re-reads and decides again when another receipt changed the row meanwhile', async () => {
    const f = fakeStore([row({ status: 'sent' })], { updateResults: ['changed'] })
    f.ledger.set(SEND, { ...row({ status: 'delivered' }), updatedAt: 'v2' })
    // The first write lost the race; the fresh row is delivered, so a "delivery delayed" is now stale.
    expect(await applyReceipt(receipt('email.delivery_delayed'), f.store, { bindPending: false, now: NOW })).toEqual({
      outcome: 'unchanged',
      sendId: SEND,
      reason: 'not_forward',
    })
  })

  it('the ledger\'s own "backward" refusal and an address conflict end without a write', async () => {
    const stale = fakeStore([row()], { updateResults: ['stale'] })
    expect(await applyReceipt(receipt('email.delivered'), stale.store, { bindPending: false, now: NOW })).toMatchObject({ outcome: 'unchanged' })
    const conflict = fakeStore([row()], { updateResults: ['conflict'] })
    expect(await applyReceipt(receipt('email.bounced'), conflict.store, { bindPending: false, now: NOW })).toEqual({ outcome: 'conflict', sendId: SEND })
  })

  it('a row that keeps changing is retried later (throws), never written blindly', async () => {
    const f = fakeStore([row()], { updateResults: ['changed', 'changed', 'changed'] })
    await expect(applyReceipt(receipt('email.delivered'), f.store, { bindPending: false, now: NOW })).rejects.toThrow(/retry/)
  })
})

describe('applyReceipt: a complaint stops e-mail', () => {
  it('records an e-mail unsubscribe for the contact and the address of the letter', async () => {
    const f = fakeStore([row({ status: 'delivered' })])
    expect(await applyReceipt(receipt('email.complained'), f.store, { bindPending: false, now: NOW })).toMatchObject({ outcome: 'applied', status: 'complained' })
    expect(f.unsubscribes).toEqual([
      {
        clientId: 'c0000000-0000-0000-0000-000000000000',
        contactId: 'c0000000-0000-4000-8000-000000000002',
        addressSha256: FP,
        triggeredSendId: SEND,
        via: 'complaint',
        occurredAt: '2026-11-10T01:30:00.000Z',
      },
    ])
  })

  it('a repeated complaint (row already complained) still makes sure the record exists', async () => {
    const f = fakeStore([row({ status: 'complained' })])
    expect(await applyReceipt(receipt('email.complained'), f.store, { bindPending: false, now: NOW })).toMatchObject({ outcome: 'unchanged' })
    expect(f.unsubscribes).toHaveLength(1)
  })

  it('a failed record write throws so the step is retried', async () => {
    const f = fakeStore([row({ status: 'delivered' })], { unsubscribe: { ok: false, error: 'write: 08006' } })
    await expect(applyReceipt(receipt('email.complained'), f.store, { bindPending: false, now: NOW })).rejects.toThrow(/complaint unsubscribe not recorded/)
  })

  it('other receipts write no unsubscribe', async () => {
    const f = fakeStore([row({ status: 'sent' })])
    await applyReceipt(receipt('email.bounced', { bounce: { type: 'Permanent' } }), f.store, { bindPending: false, now: NOW })
    expect(f.unsubscribes).toEqual([])
  })
})
