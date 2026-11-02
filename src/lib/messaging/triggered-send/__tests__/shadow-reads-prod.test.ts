import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  checkRequiredMailboxes,
  listClientsWithOpenAuthorization,
  loadLeadContacts,
  loadOpenAuthorization,
} from '../shadow-reads-prod'

// ── Fake Supabase client ────────────────────────────────────────────────────────────────────────────────

type Call = { method: string; args: unknown[] }
type QueryResult = { data: unknown; error: unknown }
type Responder = (table: string, calls: readonly Call[]) => QueryResult

interface FakeQuery extends PromiseLike<QueryResult> {
  select(...args: unknown[]): FakeQuery
  eq(...args: unknown[]): FakeQuery
  in(...args: unknown[]): FakeQuery
  gte(...args: unknown[]): FakeQuery
  is(...args: unknown[]): FakeQuery
  order(...args: unknown[]): FakeQuery
  limit(...args: unknown[]): FakeQuery
}

interface FakeClient {
  db: SupabaseClient
  callsFor(table: string): Call[][]
}

function makeFakeClient(responder: Responder): FakeClient {
  const perTable = new Map<string, Call[][]>()

  function makeQuery(table: string): FakeQuery {
    const calls: Call[] = []
    const list = perTable.get(table)
    if (list) list.push(calls)
    else perTable.set(table, [calls])

    const query: FakeQuery = {
      select(...args) {
        calls.push({ method: 'select', args })
        return query
      },
      eq(...args) {
        calls.push({ method: 'eq', args })
        return query
      },
      in(...args) {
        calls.push({ method: 'in', args })
        return query
      },
      gte(...args) {
        calls.push({ method: 'gte', args })
        return query
      },
      is(...args) {
        calls.push({ method: 'is', args })
        return query
      },
      order(...args) {
        calls.push({ method: 'order', args })
        return query
      },
      limit(...args) {
        calls.push({ method: 'limit', args })
        return query
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve(responder(table, calls)).then(onFulfilled, onRejected)
      },
    }

    // Any other method name must fail the test: writes are forbidden.
    return new Proxy(query, {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && !(prop in target)) {
          throw new Error(`forbidden method: ${prop}`)
        }
        return Reflect.get(target, prop, receiver)
      },
    })
  }

  const db = {
    from(table: string) {
      return makeQuery(table)
    },
  } as unknown as SupabaseClient

  return {
    db,
    callsFor(table: string) {
      return perTable.get(table) ?? []
    },
  }
}

// ── listClientsWithOpenAuthorization ────────────────────────────────────────────────────────────────────

describe('listClientsWithOpenAuthorization', () => {
  it('applies the exact filters and returns unique sorted client ids', async () => {
    const fake = makeFakeClient(() => ({
      data: [{ client_id: 'b' }, { client_id: 'a' }, { client_id: 'b' }, { client_id: 'c' }],
      error: null,
    }))
    const result = await listClientsWithOpenAuthorization(fake.db)
    expect(result).toEqual({ ok: true, clientIds: ['a', 'b', 'c'] })
    const calls = fake.callsFor('triggered_send_authorizations')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual([
      { method: 'select', args: ['client_id'] },
      { method: 'eq', args: ['trigger_key', 'welcome'] },
      { method: 'eq', args: ['channel', 'email'] },
      { method: 'is', args: ['revoked_at', null] },
    ])
  })

  it('returns ok:false on a query error object', async () => {
    const fake = makeFakeClient(() => ({ data: null, error: { message: 'boom' } }))
    const result = await listClientsWithOpenAuthorization(fake.db)
    expect(result).toEqual({ ok: false, error: 'boom' })
  })

  it('returns ok:false on a thrown exception', async () => {
    const fake = makeFakeClient(() => {
      throw new Error('kaboom')
    })
    const result = await listClientsWithOpenAuthorization(fake.db)
    expect(result).toEqual({ ok: false, error: 'kaboom' })
  })
})

// ── loadOpenAuthorization ───────────────────────────────────────────────────────────────────────────────

describe('loadOpenAuthorization', () => {
  it('applies the exact filters and ordering and maps the row', async () => {
    const fake = makeFakeClient(() => ({
      data: [
        {
          id: 'auth-1',
          client_id: 'client-1',
          rule: { version: 1 },
          rule_sha256: 'sha',
          proposed_at: '2026-11-01T00:00:00Z',
          authorized_at: '2026-11-02T00:00:00Z',
        },
      ],
      error: null,
    }))
    const result = await loadOpenAuthorization(fake.db, 'client-1')
    expect(result).toEqual({
      ok: true,
      row: {
        id: 'auth-1',
        clientId: 'client-1',
        rule: { version: 1 },
        ruleSha256: 'sha',
        proposedAt: '2026-11-01T00:00:00Z',
        authorized: true,
      },
    })
    const calls = fake.callsFor('triggered_send_authorizations')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual([
      { method: 'select', args: ['id, client_id, rule, rule_sha256, proposed_at, authorized_at'] },
      { method: 'eq', args: ['client_id', 'client-1'] },
      { method: 'eq', args: ['trigger_key', 'welcome'] },
      { method: 'eq', args: ['channel', 'email'] },
      { method: 'is', args: ['revoked_at', null] },
      { method: 'order', args: ['proposed_at', { ascending: false }] },
      { method: 'limit', args: [1] },
    ])
  })

  it('maps authorized:false when authorized_at is null', async () => {
    const fake = makeFakeClient(() => ({
      data: [
        {
          id: 'auth-1',
          client_id: 'client-1',
          rule: {},
          rule_sha256: 'sha',
          proposed_at: '2026-11-01T00:00:00Z',
          authorized_at: null,
        },
      ],
      error: null,
    }))
    const result = await loadOpenAuthorization(fake.db, 'client-1')
    expect(result.ok).toBe(true)
    if (result.ok && result.row) expect(result.row.authorized).toBe(false)
  })

  it('returns row:null when there are no rows', async () => {
    const fake = makeFakeClient(() => ({ data: [], error: null }))
    const result = await loadOpenAuthorization(fake.db, 'client-1')
    expect(result).toEqual({ ok: true, row: null })
  })

  it('returns ok:false on a query error object', async () => {
    const fake = makeFakeClient(() => ({ data: null, error: { message: 'nope' } }))
    const result = await loadOpenAuthorization(fake.db, 'client-1')
    expect(result).toEqual({ ok: false, error: 'nope' })
  })

  it('returns ok:false on a thrown exception', async () => {
    const fake = makeFakeClient(() => {
      throw new Error('explode')
    })
    const result = await loadOpenAuthorization(fake.db, 'client-1')
    expect(result).toEqual({ ok: false, error: 'explode' })
  })
})

// ── loadLeadContacts ───────────────────────────────────────────────────────────────────────────────────

function contactRow(id: string, createdAt: string, primaryEmail: unknown) {
  return { id, created_at: createdAt, primary_email: primaryEmail }
}

describe('loadLeadContacts', () => {
  it('runs the three steps with the exact query shapes', async () => {
    const fake = makeFakeClient((table) => {
      if (table === 'contacts') {
        return { data: [contactRow('c1', '2026-11-01T00:00:00Z', ' A@B.CO ')], error: null }
      }
      if (table === 'contact_touchpoints') {
        return { data: [{ contact_id: 'c1' }], error: null }
      }
      if (table === 'contact_identities') {
        return { data: [{ contact_id: 'c1', value: 'a@b.co' }, { contact_id: 'c1', value: 'x@y.co' }], error: null }
      }
      throw new Error(`unexpected table: ${table}`)
    })

    const result = await loadLeadContacts(fake.db, {
      clientId: 'client-1',
      sinceIso: '2026-10-01T00:00:00Z',
      sources: ['lead_form', 'import'],
    })

    expect(result).toEqual({
      ok: true,
      contacts: [
        {
          contactId: 'c1',
          createdAt: '2026-11-01T00:00:00Z',
          primaryEmail: 'a@b.co',
          addresses: ['a@b.co', 'x@y.co'],
        },
      ],
    })

    expect(fake.callsFor('contacts')).toEqual([
      [
        { method: 'select', args: ['id, created_at, primary_email'] },
        { method: 'eq', args: ['client_id', 'client-1'] },
        { method: 'gte', args: ['created_at', '2026-10-01T00:00:00Z'] },
        { method: 'order', args: ['created_at', { ascending: true }] },
        { method: 'limit', args: [1000] },
      ],
    ])
    expect(fake.callsFor('contact_touchpoints')).toEqual([
      [
        { method: 'select', args: ['contact_id'] },
        { method: 'eq', args: ['client_id', 'client-1'] },
        { method: 'in', args: ['source', ['lead_form', 'import']] },
        { method: 'in', args: ['contact_id', ['c1']] },
      ],
    ])
    expect(fake.callsFor('contact_identities')).toEqual([
      [
        { method: 'select', args: ['contact_id, value'] },
        { method: 'eq', args: ['client_id', 'client-1'] },
        { method: 'eq', args: ['kind', 'email'] },
        { method: 'in', args: ['contact_id', ['c1']] },
      ],
    ])
  })

  it('drops contacts without a matching touchpoint and never queries their identities', async () => {
    const fake = makeFakeClient((table) => {
      if (table === 'contacts') {
        return {
          data: [contactRow('c1', '2026-11-01T00:00:00Z', 'a@b.co'), contactRow('c2', '2026-11-02T00:00:00Z', 'b@b.co')],
          error: null,
        }
      }
      if (table === 'contact_touchpoints') {
        return { data: [{ contact_id: 'c1' }], error: null }
      }
      if (table === 'contact_identities') {
        return { data: [], error: null }
      }
      throw new Error(`unexpected table: ${table}`)
    })

    const result = await loadLeadContacts(fake.db, {
      clientId: 'client-1',
      sinceIso: '2026-10-01T00:00:00Z',
      sources: ['lead_form'],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.contacts.map((c) => c.contactId)).toEqual(['c1'])
    }
    const identityCalls = fake.callsFor('contact_identities')
    expect(identityCalls).toHaveLength(1)
    expect(identityCalls[0]).toContainEqual({ method: 'in', args: ['contact_id', ['c1']] })
  })

  it('chunks 250 contacts into 100/100/50 per step', async () => {
    const rows = Array.from({ length: 250 }, (_, i) =>
      contactRow(`c${String(i).padStart(3, '0')}`, `2026-11-01T00:00:${String(i % 60).padStart(2, '0')}Z`, null),
    )
    const fake = makeFakeClient((table, calls) => {
      if (table === 'contacts') return { data: rows, error: null }
      if (table === 'contact_touchpoints') {
        const inCall = calls.find((c) => c.method === 'in' && c.args[0] === 'contact_id')
        const ids = (inCall?.args[1] as string[]) ?? []
        return { data: ids.map((id) => ({ contact_id: id })), error: null }
      }
      if (table === 'contact_identities') return { data: [], error: null }
      throw new Error(`unexpected table: ${table}`)
    })

    const result = await loadLeadContacts(fake.db, {
      clientId: 'client-1',
      sinceIso: '2026-10-01T00:00:00Z',
      sources: ['lead_form'],
    })
    expect(result.ok).toBe(true)

    const touchpointCalls = fake.callsFor('contact_touchpoints')
    expect(touchpointCalls).toHaveLength(3)
    const touchpointSizes = touchpointCalls.map((calls) => {
      const inCall = calls.find((c) => c.method === 'in' && c.args[0] === 'contact_id')
      return (inCall?.args[1] as string[]).length
    })
    expect(touchpointSizes).toEqual([100, 100, 50])

    const identityCalls = fake.callsFor('contact_identities')
    expect(identityCalls).toHaveLength(3)
    const identitySizes = identityCalls.map((calls) => {
      const inCall = calls.find((c) => c.method === 'in' && c.args[0] === 'contact_id')
      return (inCall?.args[1] as string[]).length
    })
    expect(identitySizes).toEqual([100, 100, 50])
  })

  it('normalises the primary e-mail and orders addresses (primary first, unique)', async () => {
    const fake = makeFakeClient((table) => {
      if (table === 'contacts') {
        return {
          data: [
            contactRow('c1', '2026-11-01T00:00:00Z', ' A@B.CO '),
            contactRow('c2', '2026-11-02T00:00:00Z', ''),
          ],
          error: null,
        }
      }
      if (table === 'contact_touchpoints') {
        return { data: [{ contact_id: 'c1' }, { contact_id: 'c2' }], error: null }
      }
      if (table === 'contact_identities') {
        return {
          data: [
            { contact_id: 'c1', value: 'x@y.co' },
            { contact_id: 'c1', value: 'A@B.CO' },
            { contact_id: 'c1', value: '  z@w.co  ' },
            { contact_id: 'c2', value: 'only@c2.co' },
          ],
          error: null,
        }
      }
      throw new Error(`unexpected table: ${table}`)
    })

    const result = await loadLeadContacts(fake.db, {
      clientId: 'client-1',
      sinceIso: '2026-10-01T00:00:00Z',
      sources: ['lead_form'],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const c1 = result.contacts.find((c) => c.contactId === 'c1')
    const c2 = result.contacts.find((c) => c.contactId === 'c2')
    expect(c1?.primaryEmail).toBe('a@b.co')
    expect(c1?.addresses).toEqual(['a@b.co', 'x@y.co', 'z@w.co'])
    expect(c2?.primaryEmail).toBeNull()
    expect(c2?.addresses).toEqual(['only@c2.co'])
  })

  it('sorts by createdAt then contactId', async () => {
    const fake = makeFakeClient((table) => {
      if (table === 'contacts') {
        return {
          data: [
            contactRow('c2', '2026-11-01T00:00:00Z', null),
            contactRow('c1', '2026-11-01T00:00:00Z', null),
            contactRow('c3', '2026-10-31T00:00:00Z', null),
          ],
          error: null,
        }
      }
      if (table === 'contact_touchpoints') {
        return { data: [{ contact_id: 'c1' }, { contact_id: 'c2' }, { contact_id: 'c3' }], error: null }
      }
      if (table === 'contact_identities') return { data: [], error: null }
      throw new Error(`unexpected table: ${table}`)
    })

    const result = await loadLeadContacts(fake.db, {
      clientId: 'client-1',
      sinceIso: '2026-10-01T00:00:00Z',
      sources: ['lead_form'],
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.contacts.map((c) => c.contactId)).toEqual(['c3', 'c1', 'c2'])
  })

  it('fails closed when the window holds 1000 contacts', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) =>
      contactRow(`c${String(i).padStart(4, '0')}`, '2026-11-01T00:00:00Z', null),
    )
    const fake = makeFakeClient((table) => {
      if (table === 'contacts') return { data: rows, error: null }
      throw new Error(`unexpected table: ${table}`)
    })
    const result = await loadLeadContacts(fake.db, {
      clientId: 'client-1',
      sinceIso: '2026-10-01T00:00:00Z',
      sources: ['lead_form'],
    })
    expect(result).toEqual({ ok: false, error: 'too many contacts in the window to check them all' })
    expect(fake.callsFor('contact_touchpoints')).toHaveLength(0)
    expect(fake.callsFor('contact_identities')).toHaveLength(0)
  })

  it('returns ok:false when step 2 errors', async () => {
    const fake = makeFakeClient((table) => {
      if (table === 'contacts') return { data: [contactRow('c1', '2026-11-01T00:00:00Z', null)], error: null }
      if (table === 'contact_touchpoints') return { data: null, error: { message: 'step2 failed' } }
      throw new Error(`unexpected table: ${table}`)
    })
    const result = await loadLeadContacts(fake.db, {
      clientId: 'client-1',
      sinceIso: '2026-10-01T00:00:00Z',
      sources: ['lead_form'],
    })
    expect(result).toEqual({ ok: false, error: 'step2 failed' })
  })

  it('returns ok:false when step 3 errors', async () => {
    const fake = makeFakeClient((table) => {
      if (table === 'contacts') return { data: [contactRow('c1', '2026-11-01T00:00:00Z', null)], error: null }
      if (table === 'contact_touchpoints') return { data: [{ contact_id: 'c1' }], error: null }
      if (table === 'contact_identities') return { data: null, error: { message: 'step3 failed' } }
      throw new Error(`unexpected table: ${table}`)
    })
    const result = await loadLeadContacts(fake.db, {
      clientId: 'client-1',
      sinceIso: '2026-10-01T00:00:00Z',
      sources: ['lead_form'],
    })
    expect(result).toEqual({ ok: false, error: 'step3 failed' })
  })

  it('returns ok:false on a thrown exception', async () => {
    const fake = makeFakeClient(() => {
      throw new Error('db down')
    })
    const result = await loadLeadContacts(fake.db, {
      clientId: 'client-1',
      sinceIso: '2026-10-01T00:00:00Z',
      sources: ['lead_form'],
    })
    expect(result).toEqual({ ok: false, error: 'db down' })
  })

  it('makes only the first query when the window is empty', async () => {
    const fake = makeFakeClient((table) => {
      if (table === 'contacts') return { data: [], error: null }
      throw new Error(`unexpected table: ${table}`)
    })
    const result = await loadLeadContacts(fake.db, {
      clientId: 'client-1',
      sinceIso: '2026-10-01T00:00:00Z',
      sources: ['lead_form'],
    })
    expect(result).toEqual({ ok: true, contacts: [] })
    expect(fake.callsFor('contacts')).toHaveLength(1)
    expect(fake.callsFor('contact_touchpoints')).toHaveLength(0)
    expect(fake.callsFor('contact_identities')).toHaveLength(0)
  })
})

// ── checkRequiredMailboxes ─────────────────────────────────────────────────────────────────────────────

describe('checkRequiredMailboxes', () => {
  it('returns ok:true when every required mailbox is active (mixed case)', async () => {
    const result = await checkRequiredMailboxes(
      async () => [
        { connectionId: 'c1', account: 'Sales@Example.com' },
        { connectionId: 'c2', account: 'support@example.com' },
      ],
      'client-1',
      ['sales@example.com', 'SUPPORT@example.com'],
    )
    expect(result).toEqual({ ok: true })
  })

  it('reports missing mailboxes in the order of `required`', async () => {
    const result = await checkRequiredMailboxes(
      async () => [{ connectionId: 'c1', account: 'sales@example.com' }],
      'client-1',
      ['support@example.com', 'sales@example.com', 'billing@example.com'],
    )
    expect(result).toEqual({
      ok: false,
      reason: 'missing',
      detail: 'missing: support@example.com, billing@example.com',
    })
  })

  it('returns unreadable when the lister rejects', async () => {
    const result = await checkRequiredMailboxes(
      async () => {
        throw new Error('mailbox service down')
      },
      'client-1',
      ['sales@example.com'],
    )
    expect(result).toEqual({ ok: false, reason: 'unreadable', detail: 'mailbox service down' })
  })

  it('returns unreadable when nothing is required', async () => {
    const result = await checkRequiredMailboxes(async () => [], 'client-1', [])
    expect(result).toEqual({ ok: false, reason: 'unreadable', detail: 'no required mailbox configured' })
  })
})
