// @vitest-environment node
/** "Staff wrote: send the catalogue": the rule, the list on the stubbed world, and the send that leaves the guest with staff. */
import { describe, expect, it } from 'vitest'
import type { ComposePreview } from '@/lib/microsoft/mail-send-new'
import type { SendCatalogueArgs, SendCatalogueResult } from '@/lib/crm/catalogue-line/send-catalogue'
import { sendCatalogueKeepWithStaff, CATALOGUE_UNKNOWN_MESSAGE } from '../actions'
import { decideCatalogueAsk, mentionsCatalogue, type AskInput } from '../catalogue-ask'
import { loadPickupList, type PickupListDeps } from '../pickup-list'
import { fakeStore } from './fake-store'
import { CLIENT, LEAD, NOW, at, db, world, type Row } from './pickup-db'

const note = (id: string, contact: string, minutes: number, raw: string, metadata: Row = {}): Row =>
  ({ id, client_id: CLIENT, contact_id: contact, channel: 'phone', direction: 'outbound', occurred_at: at(minutes), summary: null, raw, metadata, source: 'me_manual' })

const input = (over: Partial<AskInput> = {}): AskInput => ({
  leadAt: LEAD,
  notes: [{ occurredAt: at(90), text: 'Please follow up 2027 catalogue', search: 'Please follow up 2027 catalogue', automated: false }],
  hasTakeoverHistory: false, eligible: true, hasActiveBooking: false, hasEmail: true, crmMailedSinceLead: false, staffMessagedSinceLead: false,
  ...over,
})

describe('decideCatalogueAsk', () => {
  it('a staff note asking for the catalogue after the enquiry → listed, with the note', () => {
    expect(decideCatalogueAsk(input())).toEqual({ leadAt: LEAD, noteAt: at(90), note: 'Please follow up 2027 catalogue' })
  })

  it('reads the words in either language, as typed or as shown', () => {
    expect(mentionsCatalogue('客户想要跟进2027年宣传册。', ['catalog', '宣传册'])).toBe(true)
    expect(mentionsCatalogue('Send BROCHURE pls', ['brochure'])).toBe(true)
    expect(mentionsCatalogue('call back Tuesday', ['catalog', 'brochure'])).toBe(false)
    expect(decideCatalogueAsk(input({ notes: [{ occurredAt: at(90), text: 'call back Tuesday', search: 'call back Tuesday 请周二回电', automated: false }] }))).toBeNull()
  })

  it('the latest asking note is the one shown', () => {
    const d = decideCatalogueAsk(input({ notes: [
      { occurredAt: at(200), text: 'left voicemail, send catalogue', search: 'left voicemail, send catalogue', automated: false },
      { occurredAt: at(90), text: 'catalogue please', search: 'catalogue please', automated: false },
    ] }))
    expect(d).toMatchObject({ noteAt: at(200), note: 'left voicemail, send catalogue' })
  })

  it('a later staff note withdraws the ask: the ask must be the latest thing staff wrote', () => {
    expect(decideCatalogueAsk(input({ notes: [
      { occurredAt: at(90), text: 'send catalogue', search: 'send catalogue', automated: false },
      { occurredAt: at(400), text: '客人说不用发了', search: '客人说不用发了', automated: false },
    ] }))).toBeNull()
  })

  it('a later system-written note does not hide the ask', () => {
    expect(decideCatalogueAsk(input({ notes: [
      { occurredAt: at(90), text: 'send catalogue', search: 'send catalogue', automated: false },
      { occurredAt: at(400), text: '系统修改', search: '系统修改', automated: true },
    ] }))).toMatchObject({ noteAt: at(90) })
  })

  it.each<[string, Partial<AskInput>]>([
    ['no enquiry in the window', { leadAt: null }],
    ['already mailed from the CRM mailbox since the enquiry (never a second catalogue)', { crmMailedSinceLead: true }],
    ['has takeover history', { hasTakeoverHistory: true }],
    ['not eligible (do-not-contact, stage, snooze)', { eligible: false }],
    ['has an active booking', { hasActiveBooking: true }],
    ['has no email address', { hasEmail: false }],
    ['staff messaged the guest personally since the enquiry (the catalogue may have gone from their own mailbox)', { staffMessagedSinceLead: true }],
    ['the only asking note was written by the system', { notes: [{ occurredAt: at(90), text: 'catalogue', search: 'catalogue', automated: true }] }],
    ['no note', { notes: [] }],
  ])('not listed: %s', (_name, over) => {
    expect(decideCatalogueAsk(input(over))).toBeNull()
  })
})

function deps(over: Partial<PickupListDeps> = {}, composed: string[] = []): PickupListDeps {
  return {
    timeZone: 'Pacific/Auckland',
    loadNames: async (ids) => new Map(ids.map((id) => [id, `Guest ${id}`])),
    sentToday: async () => 0,
    hasCatalogue: async () => new Set<string>(),
    compose: async (id): Promise<ComposePreview> => {
      composed.push(id)
      return { canCompose: true, recipient: `${id}@x.co`, mailbox: 'info@client.co', sentToContactLast7Days: 0 }
    },
    ...over,
  }
}

describe('the "交给 AI 跟进" list with catalogue asks', () => {
  it('a guest staff reached and noted "send catalogue" comes first, stays with staff, and takes a place', async () => {
    const tables = world()
    // b: reached on a call (the pickup rules leave b with staff), then staff wrote the note
    tables.contact_touchpoints.push(note('nb', 'b', 310, 'Spoke, wants the 2027 catalogue'))
    const rows = await loadPickupList(db(tables, []), CLIENT, deps(), { now: NOW, dailyMax: 2 })
    expect(rows.map((r) => [r.contactId, r.rule, r.keepWithStaff, r.status])).toEqual([
      ['b', 'catalogue_asked', true, 'ready'],
      ['c', 'never_called', false, 'ready'],
      ['a', 'not_reached', false, 'queued'],
    ])
    expect(rows[0]).toMatchObject({ lastNote: 'Spoke, wants the 2027 catalogue', recipient: 'b@x.co' })
  })

  it('a note written today does not push the guest to tomorrow: the note is today\'s contact', async () => {
    const tables = world()
    // 12:00 UTC on 11-16 is 01:00 on 11-17 in New Zealand: "today" for a run at 07:45 NZ on 11-17
    tables.contact_touchpoints.push({ ...note('nd', 'd', 0, '请跟进2027年的宣传册'), occurred_at: '2026-11-16T12:00:00.000Z' })
    const rows = await loadPickupList(db(tables, []), CLIENT, deps(), { now: NOW, dailyMax: 30 })
    expect(rows[0]).toMatchObject({ contactId: 'd', rule: 'catalogue_asked', status: 'ready' })
  })

  it('a guest the pickup rules already take keeps that rule (rang, never reached → the AI follows up)', async () => {
    const tables = world()
    // a: voicemail at +60, and the note right after it describes that failed call
    tables.contact_touchpoints.push(note('na', 'a', 62, 'Left voicemail, follow up catalogue'))
    const rows = await loadPickupList(db(tables, []), CLIENT, deps(), { now: NOW, dailyMax: 30 })
    expect(rows.filter((r) => r.contactId === 'a').map((r) => [r.rule, r.keepWithStaff])).toEqual([['not_reached', false]])
  })

  it('a quoted guest staff asked a catalogue for is listed too (the pickup rules never take a qualified guest)', async () => {
    const tables = world()
    tables.contact_touchpoints.push(note('nq', 'q', 90, 'send catalogue'))
    const rows = await loadPickupList(db(tables, []), CLIENT, deps(), { now: NOW, dailyMax: 30 })
    expect(rows[0]).toMatchObject({ contactId: 'q', rule: 'catalogue_asked', keepWithStaff: true })
  })

  it('once the catalogue is out (send log) the guest is not listed again', async () => {
    const tables = world()
    tables.contact_touchpoints.push(note('nb', 'b', 310, 'wants the catalogue'))
    tables.conversations = [{ id: 'conv-b', client_id: CLIENT, contact_id: 'b', channel: 'email' }]
    tables.conversation_outbound_log = [{ id: 'log1', client_id: CLIENT, conversation_id: 'conv-b', messaging_type: 'email', status: 'sent', created_at: '2026-11-16T18:00:00.000Z' }]
    const rows = await loadPickupList(db(tables, []), CLIENT, deps(), { now: NOW, dailyMax: 30 })
    expect(rows.map((r) => r.contactId)).toEqual(['c', 'a'])
  })

  const listed = async (tables: Record<string, Row[]>) =>
    (await loadPickupList(db(tables, []), CLIENT, deps(), { now: NOW, dailyMax: 30 })).filter((r) => r.rule === 'catalogue_asked').map((r) => r.contactId)

  it('reads the real rows: only staff notes after the enquiry count, and each "do not list" fact is read from the data', async () => {
    const base = () => { const t = world(); t.contact_touchpoints.push(note('nb', 'b', 310, 'wants the catalogue')); return t }
    expect(await listed(base())).toEqual(['b'])

    const before = world() // the note is older than the enquiry
    before.contact_touchpoints.push(note('nb', 'b', -30, 'wants the catalogue'))
    expect(await listed(before)).toEqual([])

    const notANote = world() // a mail row that happens to mention the word is not a staff note
    notANote.contact_touchpoints.push({ ...note('nb', 'b', 310, 'Our 2027 catalogue'), channel: 'email', source: 'mailchimp' })
    expect(await listed(notANote)).toEqual([])

    const system = world()
    system.contact_touchpoints.push(note('nb', 'b', 310, 'catalogue', { automated: true }))
    expect(await listed(system)).toEqual([])

    const sheet = world() // imported sheet rows carry the enquiry's time, not when it was written
    sheet.contact_touchpoints.push({ ...note('nb', 'b', 310, 'brochure sent', { time_is_approximate: true }), source: 'sheet_followup' })
    expect(await listed(sheet)).toEqual([])

    const dnc = base() // "do not contact" said on a call
    dnc.contact_touchpoints.push({ ...note('nx', 'b', 300, 'asked us to stop', { outcome: 'do_not_contact' }) })
    expect(await listed(dnc)).toEqual([])

    const snoozed = base()
    snoozed.contacts = snoozed.contacts.map((c) => (c.id === 'b' ? { ...c, snooze_until: '2027-01-01T00:00:00.000Z' } : c))
    expect(await listed(snoozed)).toEqual([])

    const booked = base()
    booked.crm_bookings = [{ id: 'bk', client_id: CLIENT, contact_id: 'b', status: 'active' }]
    expect(await listed(booked)).toEqual([])

    const noEmail = base()
    noEmail.contact_identities = noEmail.contact_identities.filter((i) => i.contact_id !== 'b')
    expect(await listed(noEmail)).toEqual([])

    const history = base()
    history.contact_automation_events = [{ id: 'ev', client_id: CLIENT, contact_id: 'b' }]
    expect(await listed(history)).toEqual([])

    const outlook = base() // staff emailed from their own mailbox, then wrote it down
    outlook.contact_touchpoints.push({ id: 'ob', client_id: CLIENT, contact_id: 'b', channel: 'email', direction: 'outbound', occurred_at: at(305), summary: 'Our 2027 brochure', raw: null, metadata: {}, source: 'microsoft_mail' })
    expect(await listed(outlook)).toEqual([])

    const withdrawn = base()
    withdrawn.contact_touchpoints.push(note('nb2', 'b', 400, '客人说不用发了'))
    expect(await listed(withdrawn)).toEqual([])
  })

  it('a guest still inside the hour after an unanswered call is not listed as an ask (the pickup rule takes them once the hour is over)', async () => {
    const tables = world()
    // a: voicemail 30 minutes before NOW, note one minute after it
    const vmAt = new Date(NOW.getTime() - 30 * 60_000).toISOString()
    tables.contact_touchpoints = tables.contact_touchpoints.map((t) => (t.id === 'va' ? { ...t, occurred_at: vmAt } : t))
    tables.contact_touchpoints.push({ ...note('na', 'a', 0, 'Left VM, send catalogue'), occurred_at: new Date(Date.parse(vmAt) + 60_000).toISOString() })
    const rows = await loadPickupList(db(tables, []), CLIENT, deps(), { now: NOW, dailyMax: 30 })
    expect(rows.filter((r) => r.contactId === 'a')).toEqual([])
  })

  it('a guest the send would refuse as "already has the catalogue" is shown as cannot-send with the reason, and uses no place', async () => {
    const tables = world()
    tables.contact_touchpoints.push(note('nb', 'b', 310, 'wants the catalogue'))
    const composed: string[] = []
    const rows = await loadPickupList(db(tables, []), CLIENT, deps({ hasCatalogue: async (ids) => new Set(ids.filter((id) => id === 'b' || id === 'c')) }, composed), { now: NOW, dailyMax: 1 })
    expect(rows.map((r) => [r.contactId, r.status, r.message])).toEqual([
      ['b', 'cannot_send', '这位客人已经发过目录了，不再发第二份。'],
      ['c', 'cannot_send', '这位客人已经发过目录了，不再发第二份。'],
      ['a', 'ready', null],
    ])
    expect(composed).toEqual(['a'])
  })

  it('a client can pass its own words', async () => {
    const tables = world()
    tables.contact_touchpoints.push(note('nb', 'b', 310, 'send the price list'))
    const none = await loadPickupList(db(tables, []), CLIENT, deps(), { now: NOW, dailyMax: 30 })
    const own = await loadPickupList(db(tables, []), CLIENT, deps(), { now: NOW, dailyMax: 30, askWords: ['price list'] })
    expect(none.some((r) => r.rule === 'catalogue_asked')).toBe(false)
    expect(own[0]).toMatchObject({ contactId: 'b', rule: 'catalogue_asked' })
  })
})

const ARGS: SendCatalogueArgs = {
  clientId: 'client-a', contactId: '11111111-1111-4111-8111-111111111111', actorEmail: 'lisa@client.co.nz',
  requestId: '22222222-2222-4222-8222-222222222222', expectedRecipient: 'amy@gmail.com',
}
const OK: SendCatalogueResult = {
  ok: true, messageId: 'm1', conversationId: 'c1', duplicate: false,
  templateKey: 'catalogue-send', templateVersion: 4, versionLabel: 'v9', settingsVersion: 12,
}

describe('sendCatalogueKeepWithStaff', () => {
  it('confirmed send → sent, and NO takeover event: the guest stays on the staff list', async () => {
    const s = fakeStore()
    const r = await sendCatalogueKeepWithStaff(ARGS, { sendCatalogue: async () => OK, store: s.deps })
    expect(r).toEqual({ status: 200, body: { ok: true, sent: true, duplicate: false, versionLabel: 'v9', since: null } })
    expect(s.events).toEqual([])
  })

  it('refused → said plainly; outcome unknown → "先别重发"', async () => {
    const s = fakeStore()
    const no = await sendCatalogueKeepWithStaff(ARGS, { sendCatalogue: async () => ({ ok: false, status: 409, reason: 'frequency_cap', message: '他这周已经收了 2 封邮件。', mayHaveSent: false }), store: s.deps })
    expect(no).toEqual({ status: 409, body: { ok: false, sent: false, reason: 'frequency_cap', message: '他这周已经收了 2 封邮件。' } })
    const unknown = await sendCatalogueKeepWithStaff(ARGS, { sendCatalogue: async () => ({ ok: false, status: 502, reason: 'send_unknown', message: 'x', mayHaveSent: true }), store: s.deps })
    expect(unknown).toEqual({ status: 409, body: { ok: false, sent: 'unknown', reason: 'send_unknown', message: CATALOGUE_UNKNOWN_MESSAGE } })
  })

  it('a guest already in "AI 跟进中" gets no second catalogue; an unreadable log means no send', async () => {
    let sends = 0
    const send = async () => { sends++; return OK }
    const on = fakeStore()
    await on.deps.insertEvent({ clientId: ARGS.clientId, contactId: ARGS.contactId, kind: 'ai_takeover_on', actor: 'x@y.z', reason: '发送目录 v9', catalogVersion: 'v9', sourceRef: 'catalogue:other' })
    expect((await sendCatalogueKeepWithStaff(ARGS, { sendCatalogue: send, store: on.deps })).body).toMatchObject({ ok: false, sent: false, reason: 'already_in_takeover' })
    const broken = { loadEvents: async () => { throw new Error('down') } }
    expect((await sendCatalogueKeepWithStaff(ARGS, { sendCatalogue: send, store: broken })).status).toBe(503)
    expect(sends).toBe(0)
  })
})
