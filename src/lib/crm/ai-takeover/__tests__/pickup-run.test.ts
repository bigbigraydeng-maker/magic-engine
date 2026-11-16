// @vitest-environment node
/**
 * runAiPickup with the REAL Supabase client library; only the network is a stub that applies the filters the code
 * sends (eq / in / gte), so a query that forgets one fails here. The takeover store is the in-memory fake.
 */
import { describe, expect, it } from 'vitest'
import { PICKUP_ACTOR, pickupSwitches, runAiPickup } from '../pickup-run'
import { recordTakeover } from '../store'
import { takeoverState } from '../state'
import { fakeStore } from './fake-store'

import { CLIENT, OTHER, NOW, db, talked, world } from './pickup-db'

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

describe('runAiPickup: a guest\'s "please call me" from the client site (魏征 P1-1)', () => {
  const ask = (id: string, contact: string, occurred: string) =>
    ({ id, client_id: CLIENT, contact_id: contact, channel: 'web_form', direction: 'inbound', occurred_at: occurred, summary: '官网手册：客人请我们打电话', raw: null, metadata: { callback_at: '2026-11-20T01:00:00.000Z' }, source: 'site_callback_request' })

  it('after an enquiry it is "the guest came back": the guest stays with staff', async () => {
    const w = world()
    w.contact_touchpoints.push(ask('ka', 'a', '2026-11-14T00:00:00.000Z'))
    const r = await runAiPickup(db(w, []), { clients: [CLIENT], dryRun: true, dailyMax: 30, now: NOW, store: fakeStore().deps })
    expect(r.clients[0].picked.map((p) => p.contact_id)).not.toContain('a')
  })

  it('is not itself an enquiry: it does not make an old guest a candidate, nor restart the 7-day clock', async () => {
    const w = world()
    w.contacts.push({ ...w.contacts[2], id: 'e' })
    w.contact_identities.push({ ...w.contact_identities[2], contact_id: 'e' })
    w.contact_touchpoints.push(ask('ke', 'e', '2026-11-05T01:00:00.000Z'))
    const r = await runAiPickup(db(w, []), { clients: [CLIENT], dryRun: true, dailyMax: 30, now: NOW, store: fakeStore().deps })
    expect(r.clients[0].picked.map((p) => p.contact_id)).not.toContain('e')
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
