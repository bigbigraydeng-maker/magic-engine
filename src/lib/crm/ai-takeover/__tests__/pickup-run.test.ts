// @vitest-environment node
/**
 * runAiPickup with the REAL Supabase client library; only the network is a stub that applies the filters the code
 * sends (eq / in / gte), so a query that forgets one fails here. The takeover store is the in-memory fake.
 */
import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { PICKUP_ACTOR, pickupSwitches, runAiPickup } from '../pickup-run'
import { recordTakeover } from '../store'
import { takeoverState } from '../state'
import { fakeStore } from './fake-store'

const CLIENT = 'c0000000-0000-4000-8000-000000000001'
const OTHER = 'c0000000-0000-4000-8000-000000000002'
const NOW = new Date('2026-11-16T18:45:00.000Z')
const LEAD = '2026-11-12T01:00:00.000Z'
const at = (minutes: number) => new Date(Date.parse(LEAD) + minutes * 60_000).toISOString()

type Row = Record<string, unknown>
const META_PARAMS = new Set(['select', 'order', 'offset', 'limit'])

function matches(row: Row, key: string, cond: string): boolean {
  const v = row[key]
  if (cond.startsWith('eq.')) return String(v) === cond.slice(3)
  if (cond.startsWith('in.(')) return new Set(cond.slice(4, -1).split(',').map((s) => s.replace(/^"|"$/g, ''))).has(String(v))
  if (cond.startsWith('gte.')) return Date.parse(String(v)) >= Date.parse(cond.slice(4))
  throw new Error(`stub does not understand ${key}=${cond}`)
}

function db(tables: Record<string, Row[]>, writes: string[]) {
  const stub = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const table = url.pathname.split('/').pop() ?? ''
    if ((init?.method ?? 'GET') !== 'GET') {
      writes.push(`${init?.method} ${table}`)
      return new Response('[]', { status: 201, headers: { 'content-type': 'application/json' } })
    }
    let rows = tables[table] ?? []
    url.searchParams.forEach((cond, key) => {
      if (!META_PARAMS.has(key)) rows = rows.filter((r) => matches(r, key, cond))
    })
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return createClient('https://proj.supabase.co', 'service-key', { global: { fetch: stub } })
}

const form = (id: string, contact: string, occurred = LEAD, client = CLIENT): Row =>
  ({ id, client_id: client, contact_id: contact, channel: 'meta_lead_form', direction: 'inbound', occurred_at: occurred, summary: null, raw: null, metadata: {}, source: 'meta_lead_form' })
const voicemail = (id: string, contact: string, minutes: number): Row =>
  ({ id, client_id: CLIENT, contact_id: contact, channel: 'phone', direction: 'outbound', occurred_at: at(minutes), summary: null, raw: null, metadata: { customer_spoke: 'no', outcome: 'spoke', talk_seconds: 30 }, source: 'twilio' })
const talked = (id: string, contact: string, minutes: number): Row => ({ ...voicemail(id, contact, minutes), metadata: { customer_spoke: 'yes', talk_seconds: 200 } })
const contact = (id: string, stage = 'contacted', client = CLIENT): Row => ({ id, client_id: client, do_not_contact: false, stage, snooze_until: null, ai_takeover_since: null })
const email = (contactId: string, client = CLIENT): Row => ({ id: `e-${contactId}`, client_id: client, contact_id: contactId, kind: 'email', value: `${contactId}@x.co` })

function world(): Record<string, Row[]> {
  return {
    contacts: [contact('a'), contact('b'), contact('c', 'new'), contact('d', 'new'), contact('q', 'quoted'), contact('z', 'contacted', OTHER)],
    client_pipeline_stages: [
      { client_id: CLIENT, stage_key: 'new', marketing_action: 'nurture', is_terminal: false, sort_order: 1 },
      { client_id: CLIENT, stage_key: 'contacted', marketing_action: 'nurture', is_terminal: false, sort_order: 2 },
      { client_id: CLIENT, stage_key: 'quoted', marketing_action: 'nurture', is_terminal: false, sort_order: 3 },
    ],
    ad_strategy_configs: [{ client_id: CLIENT, qualified_stage_keys: ['quoted', 'deposit_paid'] }],
    contact_touchpoints: [
      // the client's first tracked call (calls are tracked from 10-12); the stub returns rows in this order
      { ...voicemail('v0', 'old', 0), occurred_at: '2026-10-12T00:00:00.000Z' },
      form('fa', 'a'), voicemail('va', 'a', 60),            // a: rang, voicemail → AI
      form('fb', 'b'), voicemail('vb', 'b', 60), talked('tb', 'b', 300), // b: reached later → staff
      form('fc', 'c', '2026-11-05T01:00:00.000Z'),            // c: 11 days, never rung → AI
      form('fd', 'd'),                                         // d: 4 days, never rung → wait
      form('fq', 'q'), voicemail('vq', 'q', 60),              // q: quoted (qualified) → staff
      form('fz', 'z', LEAD, OTHER), voicemail('vz', 'z', 60),  // another client, not opted in
    ],
    contact_automation_events: [],
    contact_identities: [email('a'), email('b'), email('c'), email('d'), email('q'), email('z', OTHER)],
    crm_bookings: [],
  }
}

describe('runAiPickup', () => {
  it('dry run: decides per the rules, oldest enquiry first, writes nothing', async () => {
    const writes: string[] = []
    const store = fakeStore()
    const r = await runAiPickup(db(world(), writes), { clients: [CLIENT], dryRun: true, dailyMax: 30, now: NOW, store: store.deps })
    expect(r.clients[0].picked).toEqual([
      expect.objectContaining({ contact_id: 'c', rule: 'never_called', write: 'would' }),
      expect.objectContaining({ contact_id: 'a', rule: 'not_reached', write: 'would' }),
    ])
    expect(r.clients).toHaveLength(1)
    expect(writes).toEqual([])
    expect(store.events).toHaveLength(0)
  })

  it('live: marks once per enquiry; a second run writes nothing new', async () => {
    const store = fakeStore()
    const sb = db(world(), [])
    const r1 = await runAiPickup(sb, { clients: [CLIENT], dryRun: false, dailyMax: 30, now: NOW, store: store.deps })
    expect(r1.clients[0].picked.map((p) => [p.contact_id, p.write])).toEqual([['c', 'written'], ['a', 'written']])
    expect(takeoverState(await store.deps.loadEvents(CLIENT, 'a')).on).toBe(true)
    expect(store.events.every((e) => e.actor === PICKUP_ACTOR && e.sourceRef.startsWith('pickup:'))).toBe(true)
    const r2 = await runAiPickup(sb, { clients: [CLIENT], dryRun: false, dailyMax: 30, now: NOW, store: store.deps })
    expect(r2.clients[0].picked.every((p) => p.write === 'skipped')).toBe(true)
    expect(store.events).toHaveLength(2)
  })

  it('daily cap: the rest wait for tomorrow and are listed', async () => {
    const store = fakeStore()
    const r = await runAiPickup(db(world(), []), { clients: [CLIENT], dryRun: false, dailyMax: 1, now: NOW, store: store.deps })
    expect(r.clients[0].picked.map((p) => [p.contact_id, p.write])).toEqual([['c', 'written'], ['a', 'waiting']])
  })

  it('a guest staff or the stop line already decided about is never picked again', async () => {
    const tables = world()
    tables.contact_automation_events = [{ id: 'ev1', client_id: CLIENT, contact_id: 'a' }]
    const r = await runAiPickup(db(tables, []), { clients: [CLIENT], dryRun: true, dailyMax: 30, now: NOW, store: fakeStore().deps })
    expect(r.clients[0].picked.map((p) => p.contact_id)).toEqual(['c'])
  })

  it('a staff click between the read and the write wins (re-read before writing)', async () => {
    const store = fakeStore()
    await recordTakeover({ clientId: CLIENT, contactId: 'a', kind: 'ai_takeover_off', actor: 'lisa@x.co', reason: null, catalogVersion: null, sourceRef: 'off:x' }, store.deps)
    const r = await runAiPickup(db(world(), []), { clients: [CLIENT], dryRun: false, dailyMax: 30, now: NOW, store: store.deps })
    expect(r.clients[0].picked.find((p) => p.contact_id === 'a')?.write).toBe('skipped')
  })
})

describe('runAiPickup: 读不准就不判', () => {
  it('客户没设「哪些阶段算合格客人」→ 整个客户不判，回执里写原因', async () => {
    const tables = world()
    tables.ad_strategy_configs = []
    const r = await runAiPickup(db(tables, []), { clients: [CLIENT], dryRun: true, dailyMax: 30, now: NOW, store: fakeStore().deps })
    expect(r.clients[0].picked).toEqual([])
    expect(r.clients[0].error).toContain('合格客人')
    expect(r.status).toBe('partial')
  })

  it('这次询价之前有一通真接通的电话 → 留给员工', async () => {
    const tables = world()
    tables.contact_touchpoints.push({ ...talked('pre', 'a', -60 * 24 * 3) })
    const r = await runAiPickup(db(tables, []), { clients: [CLIENT], dryRun: true, dailyMax: 30, now: NOW, store: fakeStore().deps })
    expect(r.clients[0].picked.map((p) => p.contact_id)).toEqual(['c'])
  })
})

describe('pickupSwitches', () => {
  it('decides only unless told "live"; nobody unless listed; cap defaults to 30', () => {
    expect(pickupSwitches({})).toEqual({ mode: 'dry_run', clients: [], dailyMax: 30 })
    expect(pickupSwitches({ CRM_AI_PICKUP: ' LIVE ', CRM_AI_PICKUP_CLIENTS: `${CLIENT}, ${OTHER} `, CRM_AI_PICKUP_DAILY_MAX: '5' }))
      .toEqual({ mode: 'live', clients: [CLIENT, OTHER], dailyMax: 5 })
    expect(pickupSwitches({ CRM_AI_PICKUP: 'off' }).mode).toBe('off')
    expect(pickupSwitches({ CRM_AI_PICKUP_DAILY_MAX: 'abc' }).dailyMax).toBe(30)
  })
})
