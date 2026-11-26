import { describe, expect, it } from 'vitest'
import { createQueryStub, type RecordedCall, type StubResult } from '@/lib/crm/email-templates/__tests__/query-stub'
import { readAddressHistory } from '../shadow-ports-prod'
import { addressSha256 } from '../shadow-store'
import type { ShadowContact } from '../types'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const CONTACT = '22222222-2222-4222-8222-222222222222'

const has = (query: readonly RecordedCall[], method: string, ...args: unknown[]): boolean =>
  query.some((c) => c.method === method && JSON.stringify(c.args) === JSON.stringify(args))

/** The calls of each separate query of the table, in order (a query starts at its `from`). */
function queriesOf(calls: readonly RecordedCall[]): RecordedCall[][] {
  const out: RecordedCall[][] = []
  for (const call of calls) {
    if (call.method === 'from') out.push([])
    out[out.length - 1]?.push(call)
  }
  return out
}

function contact(over: Partial<ShadowContact> = {}): ShadowContact {
  return { contactId: CONTACT, createdAt: '2026-11-09T00:00:00Z', primaryEmail: 'lead@example.org', addresses: ['lead@example.org', 'other@example.org'], ...over }
}

const HASHES = ['lead@example.org', 'other@example.org'].map(addressSha256)
const found = (when: (q: RecordedCall[]) => boolean) => (q: RecordedCall[]): StubResult => ({ data: when(q) ? [{ id: 'x' }] : [], error: null })

describe('readAddressHistory — ME’s own ledger of complaints and permanent bounces', () => {
  it('🔴 a complaint on any of the guest’s letters (this contact, or one of its addresses on another contact) counts', async () => {
    const stub = createQueryStub({ triggered_sends: found((q) => has(q, 'eq', 'status', 'complained')) })
    expect(await readAddressHistory(stub.db, CLIENT, contact())).toEqual({ ok: true, complained: true, hardBounced: false })
    const complaint = queriesOf(stub.calls).find((q) => has(q, 'eq', 'status', 'complained'))
    expect(has(complaint ?? [], 'or', `contact_id.eq.${CONTACT},to_address_sha256.in.(${HASHES.join(',')})`)).toBe(true)
  })

  it('🔴 only a PERMANENT bounce of one of the addresses counts, and only real rows of this client', async () => {
    const stub = createQueryStub({ triggered_sends: found((q) => has(q, 'eq', 'bounce_kind', 'permanent')) })
    expect(await readAddressHistory(stub.db, CLIENT, contact())).toEqual({ ok: true, complained: false, hardBounced: true })
    const queries = queriesOf(stub.calls)
    expect(queries).toHaveLength(2)
    for (const q of queries) {
      expect(has(q, 'eq', 'client_id', CLIENT)).toBe(true)
      expect(has(q, 'neq', 'dedupe_scope', 'shadow')).toBe(true)
      expect(has(q, 'limit', 1)).toBe(true)
    }
    const bounce = queries.find((q) => has(q, 'eq', 'status', 'bounced'))
    expect(has(bounce ?? [], 'in', 'to_address_sha256', HASHES)).toBe(true)
  })

  it('🔴 a failed read is never "nothing known"; the answer names a code, never an address', async () => {
    const stub = createQueryStub({
      triggered_sends: (q) => (has(q, 'eq', 'status', 'bounced') ? { data: null, error: { code: '08006', message: 'lead@example.org' } } : { data: [], error: null }),
    })
    expect(await readAddressHistory(stub.db, CLIENT, contact())).toEqual({ ok: false, error: 'address history: 08006' })
  })

  it('a contact id that is not a uuid is refused before any query; no address means only the contact is looked up', async () => {
    const bad = createQueryStub({ triggered_sends: { data: [], error: null } })
    expect(await readAddressHistory(bad.db, CLIENT, contact({ contactId: 'x),or(1.eq.1' }))).toMatchObject({ ok: false })
    expect(bad.calls).toHaveLength(0)
    const none = createQueryStub({ triggered_sends: { data: [], error: null } })
    expect(await readAddressHistory(none.db, CLIENT, contact({ primaryEmail: null, addresses: [] }))).toEqual({ ok: true, complained: false, hardBounced: false })
    const queries = queriesOf(none.calls)
    expect(queries).toHaveLength(1)
    expect(has(queries[0], 'or', `contact_id.eq.${CONTACT}`)).toBe(true)
  })
})
