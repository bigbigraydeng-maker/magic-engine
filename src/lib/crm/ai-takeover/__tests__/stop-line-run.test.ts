// @vitest-environment node
/**
 * runStopline with the REAL Supabase client library; only the network is a stub that serves rows per table and
 * records every write. The takeover store is the in-memory fake (same uniqueness as the table).
 */
import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { runStopline } from '../stop-line-run'
import { recordTakeover } from '../store'
import { takeoverState } from '../state'
import { fakeStore } from './fake-store'

const CLIENT = 'c0000000-0000-4000-8000-000000000001'
const P = 'p0000000-0000-4000-8000-000000000001'
const NOW = new Date('2026-11-16T18:30:00.000Z')

interface Tables { [table: string]: Array<Record<string, unknown>> }

function db(tables: Tables, writes: string[]) {
  const stub = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const table = url.pathname.split('/').pop() ?? ''
    const method = init?.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD') {
      writes.push(`${method} ${table}`)
      return new Response('[]', { status: 201, headers: { 'content-type': 'application/json' } })
    }
    // Apply the filters the code sends (client_id=eq.X, contact_id=in.(…)), so a query that forgets one fails here.
    let rows = tables[table] ?? []
    const client = url.searchParams.get('client_id')
    if (client !== null) rows = rows.filter((r) => `eq.${String(r.client_id)}` === client)
    const ids = url.searchParams.get('contact_id')
    if (ids !== null && ids.startsWith('in.(')) {
      const set = new Set(ids.slice(4, -1).split(',').map((v) => v.replace(/^"|"$/g, '')))
      rows = rows.filter((r) => set.has(String(r.contact_id)))
    }
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return createClient('https://proj.supabase.co', 'service-key', { global: { fetch: stub } })
}

async function onSince(store: ReturnType<typeof fakeStore>): Promise<string> {
  await recordTakeover({ clientId: CLIENT, contactId: P, kind: 'ai_takeover_on', actor: 'lisa@x.co', reason: null, catalogVersion: 'v10', sourceRef: 'catalogue:r1' }, store.deps)
  const s = takeoverState(await store.deps.loadEvents(CLIENT, P))
  if (!s.on) throw new Error('setup')
  return s.since
}

function tables(since: string, extra: Partial<Tables> = {}): Tables {
  return {
    contacts: [{ id: P, client_id: CLIENT, ai_takeover_since: since, do_not_contact: false, stage: 'contacted' }],
    client_pipeline_stages: [{ client_id: CLIENT, stage_key: 'contacted', label: '已联系', marketing_action: 'nurture', is_terminal: false }],
    contact_touchpoints: [],
    crm_bookings: [],
    ...extra,
  }
}

const talkedCall = (at: string) => ({ id: 't1', client_id: CLIENT, contact_id: P, channel: 'phone', direction: 'outbound', occurred_at: at, summary: null, raw: null, source: 'twilio', metadata: { customer_spoke: 'yes' } })
const later = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * 60_000).toISOString()

describe('runStopline', () => {
  it('a guest a staff member talked with is taken off AI follow-up, once', async () => {
    const store = fakeStore()
    const since = await onSince(store)
    const sb = db(tables(since, { contact_touchpoints: [talkedCall(later(since, 300))] }), [])
    const r1 = await runStopline(sb, { dryRun: false, now: NOW, store: store.deps })
    expect(r1.clients[0].stopped).toEqual([expect.objectContaining({ contact_id: P, rule: 'talked', write: 'written' })])
    expect(takeoverState(await store.deps.loadEvents(CLIENT, P)).on).toBe(false)
    expect(store.mirror.get(`${CLIENT}/${P}`)).toBeNull()
    // the next morning, with the guest still listed by a stale read, writes nothing new
    const r2 = await runStopline(sb, { dryRun: false, now: NOW, store: store.deps })
    expect(r2.clients[0].stopped[0].write).toBe('skipped')
    expect(store.events.filter((e) => e.kind === 'ai_takeover_off')).toHaveLength(1)
  })

  it('dry run decides and writes nothing (no event, no database write)', async () => {
    const store = fakeStore()
    const since = await onSince(store)
    const writes: string[] = []
    const before = store.events.length
    const r = await runStopline(db(tables(since, { contact_touchpoints: [talkedCall(later(since, 300))] }), writes), { dryRun: true, now: NOW, store: store.deps })
    expect(r.clients[0].stopped[0].write).toBe('would')
    expect(store.events.length).toBe(before)
    expect(writes).toEqual([])
  })

  it('an old do-not-contact correction outranks a stale flag: the guest is not stopped as do-not-contact', async () => {
    const store = fakeStore()
    const since = await onSince(store)
    const cleared = { id: 'n0', client_id: CLIENT, contact_id: P, channel: 'phone', direction: 'outbound', occurred_at: later(since, -600), summary: null, raw: null, source: 'me_manual', metadata: { outcome: 'dnc_cleared' } }
    const t = tables(since, { contact_touchpoints: [cleared] })
    t.contacts[0].do_not_contact = true
    const r = await runStopline(db(t, []), { dryRun: true, now: NOW, store: store.deps })
    expect(r.clients[0].stopped).toEqual([])
  })

  it('a guest whose follow-up changed after the read (staff took back, or a new catalogue) is left alone', async () => {
    const store = fakeStore()
    const since = await onSince(store)
    const sb = db(tables(since, { contact_touchpoints: [talkedCall(later(since, 300))] }), [])
    await recordTakeover({ clientId: CLIENT, contactId: P, kind: 'ai_takeover_off', actor: 'lisa@x.co', reason: null, catalogVersion: null, sourceRef: 'off:k' }, store.deps)
    await recordTakeover({ clientId: CLIENT, contactId: P, kind: 'ai_takeover_on', actor: 'lisa@x.co', reason: null, catalogVersion: 'v10', sourceRef: 'catalogue:r2' }, store.deps)
    const r = await runStopline(sb, { dryRun: false, now: NOW, store: store.deps })
    expect(r.clients[0].stopped[0].write).toBe('skipped')
    expect(takeoverState(await store.deps.loadEvents(CLIENT, P)).on).toBe(true)
  })

  it('the same fact in a later round of follow-up is a new stop, not a silent duplicate', async () => {
    const store = fakeStore()
    const since1 = await onSince(store)
    const won = (since: string) => {
      const t = tables(since)
      t.contacts[0].stage = 'won'
      t.client_pipeline_stages.push({ client_id: CLIENT, stage_key: 'won', label: '已成交', marketing_action: 'won', is_terminal: true })
      return t
    }
    expect((await runStopline(db(won(since1), []), { dryRun: false, now: NOW, store: store.deps })).clients[0].stopped[0].write).toBe('written')
    await recordTakeover({ clientId: CLIENT, contactId: P, kind: 'ai_takeover_on', actor: 'lisa@x.co', reason: null, catalogVersion: 'v10', sourceRef: 'catalogue:r2' }, store.deps)
    const s2 = takeoverState(await store.deps.loadEvents(CLIENT, P))
    if (!s2.on) throw new Error('setup')
    const r = await runStopline(db(won(s2.since), []), { dryRun: false, now: NOW, store: store.deps })
    expect(r.clients[0].stopped[0].write).toBe('written')
    expect(takeoverState(await store.deps.loadEvents(CLIENT, P)).on).toBe(false)
  })

  it('a stage key missing from the stage list is reported, not silently ignored', async () => {
    const store = fakeStore()
    const since = await onSince(store)
    const t = tables(since)
    t.contacts[0].stage = 'mystery'
    const r = await runStopline(db(t, []), { dryRun: true, now: NOW, store: store.deps })
    expect(r.clients[0].unknown_stage).toEqual([P])
  })

  it('another client\'s rows never decide for this client (every read is scoped by client_id)', async () => {
    const store = fakeStore()
    const since = await onSince(store)
    const OTHER = 'c0000000-0000-4000-8000-000000000002'
    const t = tables(since, { contact_touchpoints: [{ ...talkedCall(later(since, 300)), client_id: OTHER }] })
    t.crm_bookings = [{ id: 'b9', client_id: OTHER, contact_id: P, status: 'active' }]
    const r = await runStopline(db(t, []), { dryRun: true, now: NOW, store: store.deps })
    expect(r.clients[0].stopped).toEqual([])
  })

  it('a mirror out of line with the log is repaired instead of being skipped silently every day', async () => {
    const store = fakeStore()
    const since = await onSince(store)
    await recordTakeover({ clientId: CLIENT, contactId: P, kind: 'ai_takeover_off', actor: 'lisa@x.co', reason: null, catalogVersion: null, sourceRef: 'off:k' }, store.deps)
    store.mirror.set(`${CLIENT}/${P}`, since) // a half-written click left the old time behind
    const r = await runStopline(db(tables(since, { contact_touchpoints: [talkedCall(later(since, 300))] }), []), { dryRun: false, now: NOW, store: store.deps })
    expect(r.clients[0].stopped[0].write).toBe('skipped')
    expect(store.mirror.get(`${CLIENT}/${P}`)).toBeNull()
  })
})
