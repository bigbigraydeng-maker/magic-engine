import { describe, expect, it, vi } from 'vitest'
import { createQueryStub, type RecordedCall } from '@/lib/crm/email-templates/__tests__/query-stub'
import { loadSendContact } from '../send-contact'
import { CLAIM_LEASE_MINUTES, createSendLedger, createSendLocks, replayStoredReceipts, SEND_LOCK_HOLDER } from '../send-store'
import type { LifetimeRow } from '../send-types'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const has = (calls: readonly RecordedCall[], method: string, ...args: unknown[]): boolean =>
  calls.some((c) => c.method === method && JSON.stringify(c.args) === JSON.stringify(args))

const ROW: LifetimeRow = {
  id: 'e0000000-0000-4000-8000-000000000001', contactId: 'b0000000-0000-4000-8000-000000000001', status: 'pending', reasonCode: null,
  authorizationId: 'a0000000-0000-4000-8000-000000000001', idempotencyKey: 'k', renderedSha256: 'r', toAddressSha256: 't',
  firstAttemptAt: '2026-11-19T20:00:00+00:00', providerMessageId: null, updatedAt: '2026-11-19T20:00:01.123456+00:00',
}

describe('the live ledger (production)', () => {
  it('🔴 reads only this client’s REAL welcome rows', async () => {
    const stub = createQueryStub({ triggered_sends: { data: [], error: null } })
    await createSendLedger(stub.db).rowsFor(CLIENT, [ROW.contactId])
    const q = stub.of('triggered_sends')
    for (const f of [['client_id', CLIENT], ['trigger_key', 'welcome'], ['channel', 'email'], ['dedupe_scope', 'lifetime']]) expect(has(q, 'eq', ...f)).toBe(true)
    expect(has(q, 'in', 'contact_id', [ROW.contactId])).toBe(true)
  })

  it('🔴 "sent" is a compare-and-set on the status AND the time the row was read; none written = "changed"', async () => {
    const stub = createQueryStub({ triggered_sends: { data: [], error: null } })
    const res = await createSendLedger(stub.db).markSent(ROW, { messageId: 'msg-1', account: 'cts', sentAt: '2026-11-19T21:00:00.000Z' })
    expect(res).toEqual({ ok: true, result: 'changed' })
    const q = stub.of('triggered_sends')
    expect(has(q, 'update', { status: 'sent', provider_message_id: 'msg-1', provider_account: 'cts', sent_at: '2026-11-19T21:00:00.000Z', provider_impact: 'PROVIDER_ACCEPTED' })).toBe(true)
    expect(has(q, 'eq', 'id', ROW.id) && has(q, 'eq', 'status', 'pending') && has(q, 'eq', 'updated_at', ROW.updatedAt)).toBe(true)
    const written = createQueryStub({ triggered_sends: { data: [{ id: ROW.id }], error: null } })
    expect(await createSendLedger(written.db).markFailed(ROW, { reasonCode: 'provider_rejected', account: 'cts' })).toEqual({ ok: true, result: 'updated' })
  })

  it('🔴 the claim goes to the database function with the lease; its answer is checked, an error is a code only', async () => {
    const stub = createQueryStub({ 'rpc:triggered_send_claim': { data: [{ outcome: 'claimed', send_id: ROW.id, row_status: 'pending', row_idempotency_key: 'k' }], error: null } })
    const input = { authorizationId: ROW.authorizationId as string, contactId: ROW.contactId, toAddressSha256: 'a'.repeat(64), idempotencyKey: 'k', templateKey: 'auto-welcome', templateVersion: 3, templateSha256: 'b'.repeat(64), renderedSha256: 'c'.repeat(64), sourceRef: null, consentBasis: 'form_disclosure_attested' }
    expect(await createSendLedger(stub.db).claim(input)).toEqual({ ok: true, outcome: 'claimed', sendId: ROW.id, idempotencyKey: 'k' })
    const call = stub.calls.find((c) => c.method === 'rpc')
    expect(call?.args[0]).toMatchObject({ p_authorization_id: input.authorizationId, p_rendered_sha256: input.renderedSha256, p_lease_minutes: CLAIM_LEASE_MINUTES })
    const odd = createQueryStub({ 'rpc:triggered_send_claim': { data: [{ outcome: 'something_new' }], error: null } })
    expect(await createSendLedger(odd.db).claim(input)).toEqual({ ok: false, error: 'claim: unexpected answer' })
    const down = createQueryStub({ 'rpc:triggered_send_claim': { data: null, error: { code: '08006', message: 'lead@example.org' } } })
    expect(await createSendLedger(down.db).claim(input)).toEqual({ ok: false, error: 'claim: 08006' })
  })

  it('a decision is inserted as a live blocked/skipped row, or replaces a blocked one with a compare-and-set — never a pending one', async () => {
    const stub = createQueryStub({ triggered_sends: { data: [{ id: ROW.id }], error: null } })
    const ledger = createSendLedger(stub.db)
    const base = { clientId: CLIENT, contactId: ROW.contactId, authorizationId: 'a', status: 'skipped' as const, reasonCode: 'dnc', annotations: {}, toAddressSha256: null, consentBasis: null, sourceRef: null }
    expect(await ledger.recordDecision({ ...base, existing: null })).toEqual({ ok: true })
    expect(stub.calls.some((c) => c.method === 'insert' && JSON.stringify(c.args[0]).includes('"dedupe_scope":"lifetime"'))).toBe(true)
    expect(await ledger.recordDecision({ ...base, existing: { ...ROW, status: 'blocked' } })).toEqual({ ok: true })
    expect(has(stub.calls, 'eq', 'status', 'blocked')).toBe(true)
    expect(await ledger.recordDecision({ ...base, existing: ROW })).toMatchObject({ ok: false })
  })

  it('a guest whose id is not a uuid is refused before any query', async () => {
    const stub = createQueryStub({})
    expect(await loadSendContact(stub.db, { clientId: CLIENT, contactId: 'x', sources: ['meta_lead_form'] })).toMatchObject({ ok: false })
    expect(stub.calls).toHaveLength(0)
  })

  it('receipts already stored are looked up by the message id alone (CTS shares the system account); a failed read is a code', async () => {
    const stub = createQueryStub({ provider_webhook_events: { data: [], error: null } })
    expect(await replayStoredReceipts(stub.db, 'msg-1', () => undefined, () => new Date())).toEqual({ applied: 0, error: null })
    const q = stub.of('provider_webhook_events')
    expect(has(q, 'eq', 'provider', 'resend') && has(q, 'eq', 'provider_message_id', 'msg-1')).toBe(true)
    expect(q.some((c) => c.method === 'eq' && c.args[0] === 'account')).toBe(false)
    const down = createQueryStub({ provider_webhook_events: { data: null, error: { code: '57014', message: 'x' } } })
    expect(await replayStoredReceipts(down.db, 'msg-1', () => undefined, () => new Date())).toEqual({ applied: 0, error: 'receipts read: 57014' })
  })
})

describe('the two locks', () => {
  function store(contact: boolean, recipient: boolean | 'throw') {
    const order: string[] = []
    return {
      order,
      acquireContactLock: vi.fn(async (_c: string, _id: string, holder: string) => { order.push(`take-contact:${holder}`); return contact }),
      releaseContactLock: vi.fn(async () => { order.push('drop-contact') }),
      acquireRecipientLock: vi.fn(async (_c: string, _a: string, holder: string) => {
        order.push(`take-recipient:${holder}`)
        if (recipient === 'throw') throw new Error('db')
        return recipient
      }),
      releaseRecipientLock: vi.fn(async () => { order.push('drop-recipient') }),
    }
  }

  it('🔴 the same two locks as the sales side, contact first; a busy address drops the contact lock again', async () => {
    const both = store(true, true)
    expect(await createSendLocks(both).take(CLIENT, ROW.contactId, 'lead@example.org')).toEqual({ ok: true, held: true })
    await createSendLocks(both).release(CLIENT, ROW.contactId, 'lead@example.org')
    expect(both.order).toEqual([`take-contact:${SEND_LOCK_HOLDER}`, `take-recipient:${SEND_LOCK_HOLDER}`, 'drop-recipient', 'drop-contact'])
    const busy = store(true, false)
    expect(await createSendLocks(busy).take(CLIENT, ROW.contactId, 'lead@example.org')).toEqual({ ok: true, held: false })
    expect(busy.order).toEqual([`take-contact:${SEND_LOCK_HOLDER}`, `take-recipient:${SEND_LOCK_HOLDER}`, 'drop-contact'])
    const broken = store(true, 'throw')
    expect(await createSendLocks(broken).take(CLIENT, ROW.contactId, 'lead@example.org')).toEqual({ ok: false, error: 'lock: Error' })
    expect(broken.order.at(-1)).toBe('drop-contact')
    const contactBusy = store(false, true)
    expect(await createSendLocks(contactBusy).take(CLIENT, ROW.contactId, 'lead@example.org')).toEqual({ ok: true, held: false })
    expect(contactBusy.acquireRecipientLock).not.toHaveBeenCalled()
  })
})
