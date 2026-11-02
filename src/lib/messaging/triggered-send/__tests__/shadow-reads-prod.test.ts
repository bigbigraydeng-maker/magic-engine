import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  checkRequiredMailboxes,
  listClientsWithOpenAuthorization,
  loadContactsByIds,
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
  range(...args: unknown[]): FakeQuery
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
      range(...args) {
        calls.push({ method: 'range', args })
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

const selectedColumns = (calls: readonly Call[]): unknown => calls.find((c) => c.method === 'select')?.args[0]
const inArg = (calls: readonly Call[], column: string): string[] => {
  const hit = calls.find((c) => c.method === 'in' && c.args[0] === column)
  return (hit?.args[1] as string[] | undefined) ?? []
}

/** Which of the four reads a query is: the lead-form touchpoint page, the contacts, the lead times or the identities. */
function kindOf(table: string, calls: readonly Call[]): 'page' | 'contacts' | 'times' | 'identities' {
  if (table === 'contacts') return 'contacts'
  if (table === 'contact_identities') return 'identities'
  if (table === 'contact_touchpoints') return selectedColumns(calls) === 'contact_id' ? 'page' : 'times'
  throw new Error(`unexpected table: ${table}`)
}

interface LeadFixture {
  page?: Array<{ contact_id: string }>
  contacts?: unknown[]
  times?: Array<{ contact_id: string; occurred_at: unknown }>
  identities?: Array<{ contact_id: string; value: unknown }>
}

function leadClient(fixture: LeadFixture): FakeClient {
  return makeFakeClient((table, calls) => {
    switch (kindOf(table, calls)) {
      case 'page':
        return { data: fixture.page ?? [], error: null }
      case 'contacts':
        return { data: fixture.contacts ?? [], error: null }
      case 'times':
        return { data: fixture.times ?? [], error: null }
      case 'identities':
        return { data: fixture.identities ?? [], error: null }
    }
  })
}

const LEAD_ARGS = { clientId: 'client-1', sinceIso: '2026-10-01T00:00:00Z', sources: ['lead_form', 'import'] }

describe('loadLeadContacts', () => {
  it('runs the steps with the exact query shapes', async () => {
    const fake = leadClient({
      page: [{ contact_id: 'c1' }],
      contacts: [contactRow('c1', '2026-11-01T00:00:00Z', ' A@B.CO ')],
      times: [{ contact_id: 'c1', occurred_at: '2026-11-01T00:00:00Z' }],
      identities: [
        { contact_id: 'c1', value: 'a@b.co' },
        { contact_id: 'c1', value: 'x@y.co' },
      ],
    })

    const result = await loadLeadContacts(fake.db, LEAD_ARGS)

    expect(result).toEqual({
      ok: true,
      contacts: [
        { contactId: 'c1', createdAt: '2026-11-01T00:00:00Z', primaryEmail: 'a@b.co', addresses: ['a@b.co', 'x@y.co'] },
      ],
    })

    const touchpoints = fake.callsFor('contact_touchpoints')
    expect(touchpoints).toHaveLength(2)
    expect(touchpoints[0]).toEqual([
      { method: 'select', args: ['contact_id'] },
      { method: 'eq', args: ['client_id', 'client-1'] },
      { method: 'in', args: ['source', ['lead_form', 'import']] },
      { method: 'gte', args: ['created_at', '2026-10-01T00:00:00Z'] },
      { method: 'order', args: ['created_at', { ascending: true }] },
      { method: 'order', args: ['id', { ascending: true }] },
      { method: 'range', args: [0, 999] },
    ])
    expect(fake.callsFor('contacts')).toEqual([
      [
        { method: 'select', args: ['id, created_at, primary_email'] },
        { method: 'eq', args: ['client_id', 'client-1'] },
        { method: 'in', args: ['id', ['c1']] },
        { method: 'gte', args: ['created_at', '2026-10-01T00:00:00Z'] },
      ],
    ])
    expect(touchpoints[1]).toEqual([
      { method: 'select', args: ['contact_id, occurred_at'] },
      { method: 'eq', args: ['client_id', 'client-1'] },
      { method: 'in', args: ['source', ['lead_form', 'import']] },
      { method: 'in', args: ['contact_id', ['c1']] },
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

  it('asks for each contact once even if it has several lead-form touchpoints', async () => {
    const fake = leadClient({
      page: [{ contact_id: 'c1' }, { contact_id: 'c2' }, { contact_id: 'c1' }, { contact_id: 'c1' }],
      contacts: [contactRow('c1', '2026-11-01T00:00:00Z', null), contactRow('c2', '2026-11-01T00:00:00Z', null)],
    })
    await loadLeadContacts(fake.db, LEAD_ARGS)
    expect(inArg(fake.callsFor('contacts')[0], 'id')).toEqual(['c1', 'c2'])
  })

  // A sync that catches up after an outage stores a weeks-old lead today: its age must be the form time, not today.
  it('takes the lead time from the first lead-form touchpoint when that is earlier than the contact creation', async () => {
    const fake = leadClient({
      page: [{ contact_id: 'c1' }],
      contacts: [contactRow('c1', '2026-11-01T22:00:00Z', 'a@b.co')],
      times: [
        { contact_id: 'c1', occurred_at: '2026-10-12T03:00:00+00:00' },
        { contact_id: 'c1', occurred_at: '2026-10-20T03:00:00+00:00' },
      ],
    })
    const result = await loadLeadContacts(fake.db, LEAD_ARGS)
    expect(result.ok && result.contacts[0].createdAt).toBe('2026-10-12T03:00:00+00:00')
  })

  it('keeps the contact creation time when the touchpoint is later, unreadable or missing', async () => {
    const fake = leadClient({
      page: [{ contact_id: 'c1' }, { contact_id: 'c2' }, { contact_id: 'c3' }],
      contacts: [
        contactRow('c1', '2026-11-01T00:00:00Z', null),
        contactRow('c2', '2026-11-01T00:00:00Z', null),
        contactRow('c3', '2026-11-01T00:00:00Z', null),
      ],
      times: [
        { contact_id: 'c1', occurred_at: '2026-11-01T05:00:00Z' },
        { contact_id: 'c2', occurred_at: 'not-a-time' },
        { contact_id: 'c2', occurred_at: null },
      ],
    })
    const result = await loadLeadContacts(fake.db, LEAD_ARGS)
    expect(result.ok && result.contacts.map((c) => [c.contactId, c.createdAt])).toEqual([
      ['c1', '2026-11-01T00:00:00Z'],
      ['c2', '2026-11-01T00:00:00Z'],
      ['c3', '2026-11-01T00:00:00Z'],
    ])
  })

  it('skips an unreadable touch time even when it comes first, and still finds the real first touch', async () => {
    const fake = leadClient({
      page: [{ contact_id: 'c1' }],
      contacts: [contactRow('c1', '2026-11-01T22:00:00Z', null)],
      times: [
        { contact_id: 'c1', occurred_at: 'not-a-time' },
        { contact_id: 'c1', occurred_at: '2026-10-12T03:00:00+00:00' },
        { contact_id: 'c1', occurred_at: 42 },
      ],
    })
    const result = await loadLeadContacts(fake.db, LEAD_ARGS)
    expect(result.ok && result.contacts[0].createdAt).toBe('2026-10-12T03:00:00+00:00')
  })

  it('returns only the contacts the contacts query kept (created in the window), never the others', async () => {
    const fake = leadClient({
      page: [{ contact_id: 'c1' }, { contact_id: 'old' }],
      contacts: [contactRow('c1', '2026-11-01T00:00:00Z', 'a@b.co')],
    })
    const result = await loadLeadContacts(fake.db, LEAD_ARGS)
    expect(result.ok && result.contacts.map((c) => c.contactId)).toEqual(['c1'])
    // the lead times and identities are asked only for the contacts that were kept
    expect(inArg(fake.callsFor('contact_touchpoints')[1], 'contact_id')).toEqual(['c1'])
    expect(inArg(fake.callsFor('contact_identities')[0], 'contact_id')).toEqual(['c1'])
  })

  it('reads the touchpoint page by page and stops at the first short page', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ contact_id: `c${String(i).padStart(4, '0')}` }))
    const second = [{ contact_id: 'c1000' }, { contact_id: 'c1001' }]
    let pageCalls = 0
    const fake = makeFakeClient((table, calls) => {
      const kind = kindOf(table, calls)
      if (kind === 'page') {
        pageCalls += 1
        return { data: pageCalls === 1 ? full : second, error: null }
      }
      return { data: [], error: null }
    })
    const result = await loadLeadContacts(fake.db, LEAD_ARGS)
    expect(result).toEqual({ ok: true, contacts: [] })
    const pages = fake.callsFor('contact_touchpoints').filter((calls) => selectedColumns(calls) === 'contact_id')
    expect(pages.map((calls) => calls.find((c) => c.method === 'range')?.args)).toEqual([
      [0, 999],
      [1000, 1999],
    ])
    // all 1002 distinct ids go to the contacts query, in chunks of 100
    expect(fake.callsFor('contacts').map((calls) => inArg(calls, 'id').length)).toEqual([
      100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 2,
    ])
  })

  it('fails closed when five full pages of lead-form touchpoints still do not reach the end', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ contact_id: `c${i}` }))
    const fake = makeFakeClient((table, calls) => {
      if (kindOf(table, calls) === 'page') return { data: full, error: null }
      throw new Error(`unexpected table: ${table}`)
    })
    const result = await loadLeadContacts(fake.db, LEAD_ARGS)
    expect(result).toEqual({ ok: false, error: 'too many lead-form touchpoints in the window to check them all' })
    expect(fake.callsFor('contacts')).toHaveLength(0)
    expect(fake.callsFor('contact_touchpoints')).toHaveLength(5)
  })

  it('chunks 250 contacts into 100/100/50 per step', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `c${String(i).padStart(3, '0')}`)
    const fake = makeFakeClient((table, calls) => {
      switch (kindOf(table, calls)) {
        case 'page':
          return { data: ids.map((id) => ({ contact_id: id })), error: null }
        case 'contacts':
          return {
            data: inArg(calls, 'id').map((id, i) => contactRow(id, `2026-11-01T00:00:${String(i % 60).padStart(2, '0')}Z`, null)),
            error: null,
          }
        default:
          return { data: [], error: null }
      }
    })

    const result = await loadLeadContacts(fake.db, LEAD_ARGS)
    expect(result.ok).toBe(true)

    expect(fake.callsFor('contacts').map((calls) => inArg(calls, 'id').length)).toEqual([100, 100, 50])
    const times = fake.callsFor('contact_touchpoints').filter((calls) => selectedColumns(calls) !== 'contact_id')
    expect(times.map((calls) => inArg(calls, 'contact_id').length)).toEqual([100, 100, 50])
    expect(fake.callsFor('contact_identities').map((calls) => inArg(calls, 'contact_id').length)).toEqual([100, 100, 50])
  })

  it('normalises the primary e-mail and orders addresses (primary first, unique)', async () => {
    const fake = leadClient({
      page: [{ contact_id: 'c1' }, { contact_id: 'c2' }],
      contacts: [contactRow('c1', '2026-11-01T00:00:00Z', ' A@B.CO '), contactRow('c2', '2026-11-02T00:00:00Z', '')],
      identities: [
        { contact_id: 'c1', value: 'x@y.co' },
        { contact_id: 'c1', value: 'A@B.CO' },
        { contact_id: 'c1', value: '  z@w.co  ' },
        { contact_id: 'c2', value: 'only@c2.co' },
      ],
    })
    const result = await loadLeadContacts(fake.db, LEAD_ARGS)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const c1 = result.contacts.find((c) => c.contactId === 'c1')
    const c2 = result.contacts.find((c) => c.contactId === 'c2')
    expect(c1?.primaryEmail).toBe('a@b.co')
    expect(c1?.addresses).toEqual(['a@b.co', 'x@y.co', 'z@w.co'])
    expect(c2?.primaryEmail).toBeNull()
    expect(c2?.addresses).toEqual(['only@c2.co'])
  })

  it('sorts by lead time (not by text) and then by contactId', async () => {
    const fake = leadClient({
      page: [{ contact_id: 'c1' }, { contact_id: 'c2' }, { contact_id: 'c3' }, { contact_id: 'c4' }],
      contacts: [
        contactRow('c2', '2026-11-01T00:00:00Z', null),
        contactRow('c1', '2026-11-01T00:00:00Z', null),
        contactRow('c3', '2026-10-30T20:00:00Z', null),
        contactRow('c4', '2026-11-01T09:00:00Z', null),
      ],
      // c4's form was filled at 2026-10-30T11:00Z. As TEXT that is later than c3's 2026-10-30T20:00Z ("...-31T00:00..." > "...-30T20..."),
      // as a point in time it is earlier.
      times: [{ contact_id: 'c4', occurred_at: '2026-10-31T00:00:00+13:00' }],
    })
    const result = await loadLeadContacts(fake.db, LEAD_ARGS)
    expect(result.ok && result.contacts.map((c) => c.contactId)).toEqual(['c4', 'c3', 'c1', 'c2'])
  })

  it('returns ok:false when the touchpoint page errors', async () => {
    const fake = makeFakeClient(() => ({ data: null, error: { message: 'page failed' } }))
    expect(await loadLeadContacts(fake.db, LEAD_ARGS)).toEqual({ ok: false, error: 'page failed' })
  })

  it('returns ok:false when the contacts query errors', async () => {
    const fake = makeFakeClient((table, calls) =>
      kindOf(table, calls) === 'page'
        ? { data: [{ contact_id: 'c1' }], error: null }
        : { data: null, error: { message: 'contacts failed' } },
    )
    expect(await loadLeadContacts(fake.db, LEAD_ARGS)).toEqual({ ok: false, error: 'contacts failed' })
  })

  it('returns ok:false when the lead-time query errors', async () => {
    const fake = makeFakeClient((table, calls) => {
      const kind = kindOf(table, calls)
      if (kind === 'page') return { data: [{ contact_id: 'c1' }], error: null }
      if (kind === 'contacts') return { data: [contactRow('c1', '2026-11-01T00:00:00Z', null)], error: null }
      return { data: null, error: { message: 'times failed' } }
    })
    expect(await loadLeadContacts(fake.db, LEAD_ARGS)).toEqual({ ok: false, error: 'times failed' })
  })

  it('fails closed when a chunk of contacts holds a full page of touchpoints (some may be cut off)', async () => {
    const fake = makeFakeClient((table, calls) => {
      const kind = kindOf(table, calls)
      if (kind === 'page') return { data: [{ contact_id: 'c1' }], error: null }
      if (kind === 'contacts') return { data: [contactRow('c1', '2026-11-01T00:00:00Z', null)], error: null }
      return {
        data: Array.from({ length: 1000 }, () => ({ contact_id: 'c1', occurred_at: '2026-11-01T00:00:00Z' })),
        error: null,
      }
    })
    expect(await loadLeadContacts(fake.db, LEAD_ARGS)).toEqual({
      ok: false,
      error: 'too many lead-form touchpoints to read them all',
    })
  })

  it('returns ok:false when the identities query errors', async () => {
    const fake = makeFakeClient((table, calls) => {
      const kind = kindOf(table, calls)
      if (kind === 'page') return { data: [{ contact_id: 'c1' }], error: null }
      if (kind === 'contacts') return { data: [contactRow('c1', '2026-11-01T00:00:00Z', null)], error: null }
      if (kind === 'times') return { data: [], error: null }
      return { data: null, error: { message: 'identities failed' } }
    })
    expect(await loadLeadContacts(fake.db, LEAD_ARGS)).toEqual({ ok: false, error: 'identities failed' })
  })

  it('returns ok:false on a thrown exception', async () => {
    const fake = makeFakeClient(() => {
      throw new Error('db down')
    })
    expect(await loadLeadContacts(fake.db, LEAD_ARGS)).toEqual({ ok: false, error: 'db down' })
  })

  it('makes only the first query when the window holds no lead-form touchpoint', async () => {
    const fake = leadClient({ page: [] })
    expect(await loadLeadContacts(fake.db, LEAD_ARGS)).toEqual({ ok: true, contacts: [] })
    expect(fake.callsFor('contact_touchpoints')).toHaveLength(1)
    expect(fake.callsFor('contacts')).toHaveLength(0)
    expect(fake.callsFor('contact_identities')).toHaveLength(0)
  })

  it('stops after the contacts query when none of the contacts was created in the window', async () => {
    const fake = leadClient({ page: [{ contact_id: 'old' }], contacts: [] })
    expect(await loadLeadContacts(fake.db, LEAD_ARGS)).toEqual({ ok: true, contacts: [] })
    expect(fake.callsFor('contacts')).toHaveLength(1)
    expect(fake.callsFor('contact_identities')).toHaveLength(0)
    expect(fake.callsFor('contact_touchpoints')).toHaveLength(1)
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

  it('reports how many required mailboxes are missing, without naming them', async () => {
    const result = await checkRequiredMailboxes(
      async () => [{ connectionId: 'c1', account: 'sales@example.com' }],
      'client-1',
      ['support@example.com', 'sales@example.com', 'billing@example.com'],
    )
    expect(result).toEqual({
      ok: false,
      reason: 'missing',
      detail: '2 of 3 required mailboxes are not connected',
    })
    // the detail travels into the plan, the step output and the run log: no mailbox address in it
    expect(JSON.stringify(result)).not.toContain('@')
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

describe('loadContactsByIds', () => {
  const BY_IDS = { clientId: 'c1', sources: ['lead_form'] }

  it('makes no query for an empty list', async () => {
    const fake = makeFakeClient(() => ({ data: [], error: null }))
    expect(await loadContactsByIds(fake.db, { ...BY_IDS, contactIds: [] })).toEqual({ ok: true, contacts: [] })
    expect(fake.callsFor('contacts')).toHaveLength(0)
    expect(fake.callsFor('contact_identities')).toHaveLength(0)
    expect(fake.callsFor('contact_touchpoints')).toHaveLength(0)
  })

  it('reads the contacts, their lead times and e-mail identities with the exact filters, normalised and oldest first', async () => {
    const fake = makeFakeClient((table, calls) => {
      if (table === 'contacts') {
        return {
          data: [
            { id: 'b', created_at: '2026-11-02T02:00:00Z', primary_email: ' B@Example.com ' },
            { id: 'a', created_at: '2026-11-02T01:00:00Z', primary_email: 'a@example.com' },
          ],
          error: null,
        }
      }
      // the lead times and identities are asked for in the order the contacts came back
      expect(inArg(calls, 'contact_id')).toEqual(['b', 'a'])
      if (table === 'contact_touchpoints') return { data: [], error: null }
      return {
        data: [
          { contact_id: 'a', value: 'A@Example.com' },
          { contact_id: 'a', value: 'a.second@example.com' },
          { contact_id: 'b', value: '   ' },
        ],
        error: null,
      }
    })
    const read = await loadContactsByIds(fake.db, { ...BY_IDS, contactIds: ['a', 'b'] })
    expect(read).toEqual({
      ok: true,
      contacts: [
        { contactId: 'a', createdAt: '2026-11-02T01:00:00Z', primaryEmail: 'a@example.com', addresses: ['a@example.com', 'a.second@example.com'] },
        { contactId: 'b', createdAt: '2026-11-02T02:00:00Z', primaryEmail: 'b@example.com', addresses: ['b@example.com'] },
      ],
    })
    // no creation-time filter here: these exact contacts are wanted
    expect(fake.callsFor('contacts')[0]).toEqual([
      { method: 'select', args: ['id, created_at, primary_email'] },
      { method: 'eq', args: ['client_id', 'c1'] },
      { method: 'in', args: ['id', ['a', 'b']] },
    ])
    expect(fake.callsFor('contact_touchpoints')[0]).toEqual([
      { method: 'select', args: ['contact_id, occurred_at'] },
      { method: 'eq', args: ['client_id', 'c1'] },
      { method: 'in', args: ['source', ['lead_form']] },
      { method: 'in', args: ['contact_id', ['b', 'a']] },
    ])
    expect(fake.callsFor('contact_identities')[0]).toEqual([
      { method: 'select', args: ['contact_id, value'] },
      { method: 'eq', args: ['client_id', 'c1'] },
      { method: 'eq', args: ['kind', 'email'] },
      { method: 'in', args: ['contact_id', ['b', 'a']] },
    ])
  })

  it('gives the same lead time as the sweep window read: the earlier of creation and first lead-form touch', async () => {
    const fake = makeFakeClient((table) => {
      if (table === 'contacts') return { data: [{ id: 'a', created_at: '2026-11-02T01:00:00Z', primary_email: null }], error: null }
      if (table === 'contact_touchpoints') return { data: [{ contact_id: 'a', occurred_at: '2026-10-01T05:00:00Z' }], error: null }
      return { data: [], error: null }
    })
    const read = await loadContactsByIds(fake.db, { ...BY_IDS, contactIds: ['a'] })
    expect(read.ok && read.contacts[0].createdAt).toBe('2026-10-01T05:00:00Z')
  })

  it('a contact without any lead-form touchpoint is still returned, with its creation time', async () => {
    const fake = makeFakeClient((table) =>
      table === 'contacts'
        ? { data: [{ id: 'a', created_at: '2026-11-02T01:00:00Z', primary_email: 'a@example.com' }], error: null }
        : { data: [], error: null },
    )
    const read = await loadContactsByIds(fake.db, { ...BY_IDS, contactIds: ['a'] })
    expect(read.ok && read.contacts.map((c) => [c.contactId, c.createdAt])).toEqual([['a', '2026-11-02T01:00:00Z']])
  })

  it('chunks 250 ids into 100/100/50 and returns only the contacts that still exist', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${String(i).padStart(3, '0')}`)
    const fake = makeFakeClient((table, calls) => {
      if (table === 'contacts') {
        // every id exists except id-003
        return {
          data: inArg(calls, 'id')
            .filter((id) => id !== 'id-003')
            .map((id) => ({ id, created_at: '2026-11-02T01:00:00Z', primary_email: `${id}@example.com` })),
          error: null,
        }
      }
      return { data: [], error: null }
    })
    const read = await loadContactsByIds(fake.db, { ...BY_IDS, contactIds: ids })
    expect(fake.callsFor('contacts').map((calls) => inArg(calls, 'id').length)).toEqual([100, 100, 50])
    expect(fake.callsFor('contact_touchpoints').map((calls) => inArg(calls, 'contact_id').length)).toEqual([100, 100, 49])
    expect(fake.callsFor('contact_identities').map((calls) => inArg(calls, 'contact_id').length)).toEqual([100, 100, 49])
    expect(read.ok && read.contacts.length).toBe(249)
    expect(read.ok && read.contacts.some((c) => c.contactId === 'id-003')).toBe(false)
  })

  it('returns ok:false when the contacts, lead-time or identities query fails, and on a thrown exception', async () => {
    const failContacts = makeFakeClient(() => ({ data: null, error: { message: 'contacts down' } }))
    expect(await loadContactsByIds(failContacts.db, { ...BY_IDS, contactIds: ['a'] })).toEqual({ ok: false, error: 'contacts down' })

    const oneContact = { data: [{ id: 'a', created_at: '2026-11-02T01:00:00Z', primary_email: 'a@example.com' }], error: null }
    const failTimes = makeFakeClient((table) =>
      table === 'contacts' ? oneContact : { data: null, error: { message: 'times down' } },
    )
    expect(await loadContactsByIds(failTimes.db, { ...BY_IDS, contactIds: ['a'] })).toEqual({ ok: false, error: 'times down' })

    const failIdentities = makeFakeClient((table) =>
      table === 'contacts'
        ? oneContact
        : table === 'contact_touchpoints'
          ? { data: [], error: null }
          : { data: null, error: { message: 'identities down' } },
    )
    expect(await loadContactsByIds(failIdentities.db, { ...BY_IDS, contactIds: ['a'] })).toEqual({ ok: false, error: 'identities down' })

    const throwing = makeFakeClient(() => {
      throw new Error('kaboom')
    })
    expect(await loadContactsByIds(throwing.db, { ...BY_IDS, contactIds: ['a'] })).toEqual({ ok: false, error: 'kaboom' })
  })
})
