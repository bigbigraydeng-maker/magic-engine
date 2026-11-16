// @vitest-environment node
/** The "交给 AI 跟进" list, on the same stubbed world as the daily run (real Supabase client, stub network). */
import { describe, expect, it } from 'vitest'
import type { ComposePreview } from '@/lib/microsoft/mail-send-new'
import { loadPickupList, type PickupListDeps } from '../pickup-list'
import { CLIENT, NOW, db, world } from './pickup-db'

function deps(over: Partial<PickupListDeps> = {}, composed: string[] = []): PickupListDeps {
  return {
    timeZone: 'Pacific/Auckland',
    loadNames: async (ids) => new Map(ids.map((id) => [id, `Guest ${id}`])),
    sentToday: async () => 0,
    compose: async (id): Promise<ComposePreview> => {
      composed.push(id)
      return { canCompose: true, recipient: `${id}@x.co`, mailbox: 'info@client.co', sentToContactLast7Days: 1 }
    },
    ...over,
  }
}

describe('loadPickupList', () => {
  it('lists today\'s guests oldest enquiry first, with who it goes to and what staff wrote', async () => {
    const rows = await loadPickupList(db(world(), []), CLIENT, deps(), { now: NOW, dailyMax: 30 })
    expect(rows.map((r) => [r.contactId, r.rule, r.status, r.recipient])).toEqual([
      ['c', 'never_called', 'ready', 'c@x.co'],
      ['a', 'not_reached', 'ready', 'a@x.co'],
    ])
    expect(rows[1]).toMatchObject({ name: 'Guest a', dials: 1, sentLast7Days: 1 })
  })

  it('a guest contacted today (client time zone) moves to tomorrow and does not use a place', async () => {
    const tables = world()
    // 12:00 UTC on 11-16 is 01:00 on 11-17 in New Zealand: "today" for a run at 07:45 NZ on 11-17
    tables.contact_touchpoints.push({ id: 'mc', client_id: CLIENT, contact_id: 'c', channel: 'email', direction: 'outbound', occurred_at: '2026-11-16T12:00:00.000Z', summary: null, raw: null, metadata: {}, source: 'mailchimp' })
    const composed: string[] = []
    const rows = await loadPickupList(db(tables, []), CLIENT, deps({}, composed), { now: NOW, dailyMax: 1 })
    expect(rows.map((r) => [r.contactId, r.status])).toEqual([['c', 'tomorrow'], ['a', 'ready']])
    expect(composed).toEqual(['a'])
  })

  it('over the day\'s room the rest are queued, and their mail check is not run', async () => {
    const composed: string[] = []
    const rows = await loadPickupList(db(world(), []), CLIENT, deps({}, composed), { now: NOW, dailyMax: 1 })
    expect(rows.map((r) => [r.contactId, r.status])).toEqual([['c', 'ready'], ['a', 'queued']])
    expect(composed).toEqual(['c'])
  })

  it('catalogues already sent today use up the day\'s room, so a refresh after a batch adds nobody', async () => {
    const rows = await loadPickupList(db(world(), []), CLIENT, deps({ sentToday: async () => 30 }), { now: NOW, dailyMax: 30 })
    expect(rows.map((r) => r.status)).toEqual(['queued', 'queued'])
  })

  it('a mailbox that refuses everyone stops after 2 × dailyMax checks (no time-out)', async () => {
    const composed: string[] = []
    const rows = await loadPickupList(db(world(), []), CLIENT, deps({
      compose: async (id) => { composed.push(id); return { canCompose: false, reason: 'no_mailbox', message: '邮箱没连上。' } },
    }), { now: NOW, dailyMax: 1 })
    expect(composed).toEqual(['c', 'a'])
    expect(rows.map((r) => r.status)).toEqual(['cannot_send', 'cannot_send'])
  })

  it('a guest the CRM mailbox already mailed since the enquiry (a catalogue whose outcome is unknown) is never listed again', async () => {
    const tables = world()
    tables.conversations = [{ id: 'conv-a', client_id: CLIENT, contact_id: 'a', channel: 'email' }]
    tables.conversation_outbound_log = [{ id: 'log1', client_id: CLIENT, conversation_id: 'conv-a', messaging_type: 'email', status: 'pending', created_at: '2026-11-16T18:00:00.000Z' }]
    const rows = await loadPickupList(db(tables, []), CLIENT, deps(), { now: NOW, dailyMax: 30 })
    expect(rows.map((r) => r.contactId)).toEqual(['c'])
  })

  it('a guest the mail check refuses is listed with the reason and does not use a place', async () => {
    const rows = await loadPickupList(db(world(), []), CLIENT, deps({
      compose: async (id) => id === 'c'
        ? { canCompose: false, reason: 'no_recipient', message: '这个客人没有可用的邮箱。' }
        : { canCompose: true, recipient: `${id}@x.co`, mailbox: 'info@client.co', sentToContactLast7Days: 0 },
    }), { now: NOW, dailyMax: 1 })
    expect(rows.map((r) => [r.contactId, r.status, r.message])).toEqual([
      ['c', 'cannot_send', '这个客人没有可用的邮箱。'],
      ['a', 'ready', null],
    ])
  })
})
