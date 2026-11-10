import { beforeEach, describe, expect, it } from 'vitest'
import { createFakeDb, type FakeState, type Row } from '@/lib/crm/__tests__/booking-fake-db'
import {
  CLIENT_A,
  CLIENT_B,
  bookingRow,
  contactRow,
  departureRow,
  milestoneRow,
  tourRow,
} from '@/lib/crm/__tests__/booking-fixtures'
import { COUNTDOWN_CADENCE } from '../cadence'
import { buildLetterKey, buildTemplateKey, buildTriggerKey } from '../keys'
import { UNKNOWN_TOUR_NAME, loadBookingFacts } from '../load-bookings'
import { loadMeSends, loadRegistry, recipientStatusOf } from '../load-facts'
import { deriveLetterStatus } from '../aggregate'
import { loadAutoLetterDetail, loadAutoLettersList } from '../load'

const pad = (n: number): string => String(n).padStart(12, '0')
const bid = (n: number): string => `30000000-0000-4000-8000-${pad(n)}`
const mid = (n: number): string => `40000000-0000-4000-8000-${pad(n)}`
const cid = (n: number): string => `c1a1a1a1-0000-4000-8000-${pad(n)}`
const T1 = '10000000-0000-4000-8000-000000000001'
const T2 = '10000000-0000-4000-8000-000000000002'
const D1 = '20000000-0000-4000-8000-000000000001'
const D2 = '20000000-0000-4000-8000-000000000002'
/** 新西兰 2026-11-10（周二）上午 9 点。 */
const NOW = new Date('2026-11-09T20:00:00Z')

let ctx: ReturnType<typeof createFakeDb>
let state: FakeState

function seed(table: string, rows: Row[]): void {
  state.tables[table] = [...(state.tables[table] ?? []), ...rows]
}

interface PaidSpec {
  n: number
  tour?: string
  departure?: string | null
  snapshot?: string | null
  party?: number | null
  status?: 'active' | 'cancelled'
  depositPaid?: boolean
  client?: string
  name?: string | null
}

/** 一张订单 + 它的定金里程碑 + 联系人。 */
function seedBooking(spec: PaidSpec): void {
  const client = spec.client ?? CLIENT_A
  seed('crm_bookings', [
    bookingRow({
      id: bid(spec.n),
      client_id: client,
      contact_id: cid(spec.n),
      tour_id: spec.tour ?? T1,
      departure_id: spec.departure === undefined ? D1 : spec.departure,
      departure_depart_on: spec.snapshot === undefined ? '2027-03-11' : spec.snapshot,
      party_size: spec.party === undefined ? null : spec.party,
      status: spec.status ?? 'active',
    }),
  ])
  seed('crm_booking_milestones', [
    milestoneRow({
      id: mid(spec.n),
      booking_id: bid(spec.n),
      client_id: client,
      kind: 'deposit',
      state: spec.depositPaid === false ? 'unpaid' : 'paid',
    }),
  ])
  seed('contacts', [
    contactRow({ id: cid(spec.n), client_id: client, display_name: spec.name === undefined ? `Guest ${spec.n}` : spec.name }),
  ])
}

function seedCatalog(): void {
  seed('tour_catalog_tours', [
    tourRow({ id: T1, name: 'Tour One' }),
    tourRow({ id: T2, name: 'Tour Two' }),
  ])
  seed('tour_catalog_departures', [
    departureRow({ id: D1, tour_id: T1, depart_on: '2027-03-11' }),
    departureRow({ id: D2, tour_id: T2, depart_on: '2027-05-08' }),
  ])
}

beforeEach(() => {
  ctx = createFakeDb()
  state = ctx.state
})

describe('loadBookingFacts', () => {
  it('uses active, deposit-paid orders only, in this client only', async () => {
    seedCatalog()
    seedBooking({ n: 1, party: 2 })
    seedBooking({ n: 2, depositPaid: false })
    seedBooking({ n: 3, status: 'cancelled' })
    seedBooking({ n: 4, client: CLIENT_B })
    const { facts, notices } = await loadBookingFacts(ctx.db, CLIENT_A)
    expect(facts).toEqual([
      { contactId: cid(1), displayName: 'Guest 1', tourId: T1, tourName: 'Tour One', departOn: '2027-03-11', seats: 2 },
    ])
    expect(notices).toEqual([])
  })

  it('follows the departure date in the catalog; falls back to the date stored on the order', async () => {
    seedCatalog()
    seed('tour_catalog_departures', [departureRow({ id: 'dep-moved', tour_id: T1, depart_on: '2027-03-18' })])
    seedBooking({ n: 1, departure: 'dep-moved', snapshot: '2027-03-11' })
    seedBooking({ n: 2, departure: '20000000-0000-4000-8000-0000000000ff', snapshot: '2027-04-01' })
    const { facts } = await loadBookingFacts(ctx.db, CLIENT_A)
    expect(facts.map((f) => [f.contactId, f.departOn])).toEqual([
      [cid(1), '2027-03-18'],
      [cid(2), '2027-04-01'],
    ])
  })

  it('leaves out orders with no usable departure date or a cancelled departure, and says how many', async () => {
    seedCatalog()
    seed('tour_catalog_departures', [departureRow({ id: 'dep-off', tour_id: T1, depart_on: '2027-03-25', status: 'cancelled' })])
    seedBooking({ n: 1 })
    seedBooking({ n: 2, departure: null, snapshot: null })
    seedBooking({ n: 3, departure: null, snapshot: 'not-a-date' })
    seedBooking({ n: 4, departure: 'dep-off', snapshot: '2027-03-25' })
    const { facts, notices } = await loadBookingFacts(ctx.db, CLIENT_A)
    expect(facts.map((f) => f.contactId)).toEqual([cid(1)])
    expect(notices).toEqual([
      '有 2 张已交定金的订单没有出发日（或日期不对），没排进任何一封信。请先在订单里补上出发日。',
      '有 1 张已交定金的订单，所选的出发日已经取消，没排进任何一封信。请先在订单里改成新的出发日。',
    ])
  })

  it('cleans names (an email-shaped name becomes none) and keeps the order when the tour is not in the catalog', async () => {
    seed('tour_catalog_departures', [departureRow({ id: D1, tour_id: T1, depart_on: '2027-03-11' })])
    seedBooking({ n: 1, name: 'someone@example.test' })
    seedBooking({ n: 2, name: '  Bea   Lee ' })
    const { facts } = await loadBookingFacts(ctx.db, CLIENT_A)
    expect(facts.map((f) => [f.displayName, f.tourName])).toEqual([
      [null, UNKNOWN_TOUR_NAME],
      ['Bea Lee', UNKNOWN_TOUR_NAME],
    ])
  })

  it('nothing to read is not an error', async () => {
    expect(await loadBookingFacts(ctx.db, CLIENT_A)).toEqual({ facts: [], notices: [] })
  })

  it('a read failure throws (the route turns it into 暂时读不到)', async () => {
    state.failTables.add('crm_bookings')
    await expect(loadBookingFacts(ctx.db, CLIENT_A)).rejects.toThrow()
  })
})

describe('loadRegistry', () => {
  it('takes the highest version of each key, for this client only, and never reads who wrote it', async () => {
    seed('crm_email_templates', [
      { client_id: CLIENT_A, template_key: 'auto-a', version: 1, subject: 'old', body: 'b1', created_by: 'staff@x.test' },
      { client_id: CLIENT_A, template_key: 'auto-a', version: 2, subject: 'new', body: 'b2', created_by: 'staff@x.test' },
      { client_id: CLIENT_B, template_key: 'auto-a', version: 9, subject: 'other client', body: 'x', created_by: 'o@x.test' },
      { client_id: CLIENT_A, template_key: 'auto-b', version: 1, subject: null, body: 'only body', created_by: 'staff@x.test' },
    ])
    const registry = await loadRegistry(ctx.db, CLIENT_A, ['auto-a', 'auto-b', 'auto-missing'])
    expect(Object.fromEntries(registry)).toEqual({
      'auto-a': { subject: 'new', previewText: null, bodyText: 'b2' },
      'auto-b': { subject: null, previewText: null, bodyText: 'only body' },
    })
    expect(JSON.stringify(Object.fromEntries(registry))).not.toMatch(/@/)
    const read = state.queries.find((q) => q.table === 'crm_email_templates')
    expect(read?.columns).toBe('template_key, version, subject, body')
  })

  it('no keys means no reads', async () => {
    expect((await loadRegistry(ctx.db, CLIENT_A, [])).size).toBe(0)
    expect(state.queries).toHaveLength(0)
  })
})

describe('recipientStatusOf', () => {
  it('maps the ledger statuses the way the contract says; unknown means still pending, never sent', () => {
    for (const s of ['sent', 'delivered', 'delivery_delayed']) expect(recipientStatusOf(s)).toBe('sent')
    for (const s of ['blocked', 'skipped', 'suppressed']) expect(recipientStatusOf(s)).toBe('blocked')
    for (const s of ['failed', 'bounced', 'complained', 'unknown_outcome']) expect(recipientStatusOf(s)).toBe('failed')
    for (const s of ['pending', 'shadow', 'something_new', '']) expect(recipientStatusOf(s)).toBe('pending')
  })
})

describe('loadMeSends', () => {
  const TRIGGER = 'countdown_20261202_abc1234_20270311_3'
  const OTHER = 'countdown_20261202_def5678_20270508_5'
  let sendCounter = 0
  const send = (over: Row): Row => ({
    id: `s-${String((sendCounter += 1)).padStart(4, '0')}`,
    client_id: CLIENT_A,
    trigger_key: TRIGGER,
    contact_id: cid(1),
    dedupe_scope: 'lifetime',
    status: 'sent',
    reason_code: null,
    to_address_sha256: 'hash-that-must-not-be-read',
    annotations: { would_send: true },
    ...over,
  })

  it('a letter with no proposal and no rows is simply absent (shown as a draft)', async () => {
    expect((await loadMeSends(ctx.db, CLIENT_A, [TRIGGER])).size).toBe(0)
    expect((await loadMeSends(ctx.db, CLIENT_A, [])).size).toBe(0)
  })

  it('an open proposal that carries the template version waits for release', async () => {
    seed('triggered_send_authorizations', [
      { client_id: CLIENT_A, trigger_key: TRIGGER, authorized_at: null, revoked_at: null, template_sha256: 'sha', rule: { recipient_allowlist: ['a@x.test'] } },
      { client_id: CLIENT_A, trigger_key: OTHER, authorized_at: null, revoked_at: null, template_sha256: null },
    ])
    const sends = await loadMeSends(ctx.db, CLIENT_A, [TRIGGER, OTHER])
    expect(sends.get(TRIGGER)).toMatchObject({ channel: 'me', proposalPending: true, proposalApproved: false, recipients: [] })
    expect(sends.has(OTHER)).toBe(false) // the rehearsal-only welcome proposal has no template version: not "waiting"
  })

  it('an approved proposal is not waiting, but it leaves a trace even with no send row (approved, nothing went out)', async () => {
    seed('triggered_send_authorizations', [
      { client_id: CLIENT_A, trigger_key: TRIGGER, authorized_at: '2026-11-20T00:00:00Z', revoked_at: null, template_sha256: 'sha' },
    ])
    const facts = (await loadMeSends(ctx.db, CLIENT_A, [TRIGGER])).get(TRIGGER)
    expect(facts).toMatchObject({ channel: 'me', proposalPending: false, proposalApproved: true, recipients: [] })
  })

  it('a withdrawn proposal leaves no trace (no status can say 撤下了、没发), even one that was approved before it was withdrawn', async () => {
    seed('triggered_send_authorizations', [
      { client_id: CLIENT_A, trigger_key: TRIGGER, authorized_at: null, revoked_at: '2026-11-20T00:00:00Z', template_sha256: 'sha' },
      { client_id: CLIENT_A, trigger_key: OTHER, authorized_at: '2026-11-19T00:00:00Z', revoked_at: '2026-11-20T00:00:00Z', template_sha256: 'sha' },
    ])
    expect((await loadMeSends(ctx.db, CLIENT_A, [TRIGGER, OTHER])).size).toBe(0)
  })

  it('real sends: each person gets the mapped result and reason; the letter counts as sent once anyone really got it', async () => {
    seed('triggered_sends', [
      send({ contact_id: cid(1), status: 'delivered' }),
      send({ contact_id: cid(2), status: 'blocked', reason_code: 'frequency_full' }),
      send({ contact_id: cid(3), status: 'bounced' }),
      send({ contact_id: cid(4), status: 'failed', reason_code: 'bad_email' }),
      send({ contact_id: cid(5), client_id: CLIENT_B }),
    ])
    const facts = (await loadMeSends(ctx.db, CLIENT_A, [TRIGGER])).get(TRIGGER)
    expect(deriveLetterStatus(facts ?? null)).toBe('sent')
    expect(facts?.proposalPending).toBe(false)
    expect(facts?.recipients).toEqual([
      { contactId: cid(1), outcome: 'sent', reasonCode: null, opened: null, clicked: null },
      { contactId: cid(2), outcome: 'blocked', reasonCode: 'frequency_full', opened: null, clicked: null },
      { contactId: cid(3), outcome: 'failed', reasonCode: 'bounced', opened: null, clicked: null },
      { contactId: cid(4), outcome: 'failed', reasonCode: 'bad_email', opened: null, clicked: null },
    ])
  })

  it('a letter nobody really got stays a draft: only blocked / skipped / suppressed rows, only failures, only queued rows', async () => {
    const cases: Array<[string, Row[]]> = [
      ['blocked and skipped', [send({ contact_id: cid(1), status: 'blocked', reason_code: 'dnc' }), send({ contact_id: cid(2), status: 'skipped', reason_code: 'stale' })]],
      ['suppressed counts as blocked, not as sent', [send({ contact_id: cid(1), status: 'suppressed', reason_code: 'email_unsubscribed' })]],
      ['all failed', [send({ contact_id: cid(1), status: 'bounced' }), send({ contact_id: cid(2), status: 'failed', reason_code: 'bad_email' })]],
      ['still queued', [send({ contact_id: cid(1), status: 'claimed' }), send({ contact_id: cid(2), status: 'pending' })]],
    ]
    for (const [label, rows] of cases) {
      ctx = createFakeDb()
      state = ctx.state
      seed('triggered_sends', rows)
      const facts = (await loadMeSends(ctx.db, CLIENT_A, [TRIGGER])).get(TRIGGER)
      expect(facts?.recipients.length, label).toBeGreaterThan(0)
      expect(deriveLetterStatus(facts ?? null), label).toBe('draft')
    }
  })

  it('rehearsal rows are rehearsal, never sent, and never make a letter sent; a real row beats a rehearsal row for the same person', async () => {
    seed('triggered_sends', [
      send({ contact_id: cid(1), dedupe_scope: 'shadow', status: 'shadow' }),
      send({ contact_id: cid(2), dedupe_scope: 'shadow', status: 'skipped', reason_code: 'dnc' }),
      send({ contact_id: cid(3), dedupe_scope: 'shadow', status: 'shadow' }),
      send({ contact_id: cid(3), dedupe_scope: 'lifetime', status: 'sent' }),
    ])
    const facts = (await loadMeSends(ctx.db, CLIENT_A, [TRIGGER])).get(TRIGGER)
    const byId = Object.fromEntries((facts?.recipients ?? []).map((r) => [r.contactId, r.outcome]))
    expect(byId).toEqual({ [cid(1)]: 'rehearsal', [cid(2)]: 'rehearsal', [cid(3)]: 'sent' })
    expect(deriveLetterStatus(facts ?? null)).toBe('sent') // person 3's real send
  })

  it('reads only the columns it needs: no rule (it holds the trial mailing list), no address hash, no annotations', async () => {
    seed('triggered_sends', [send({})])
    seed('triggered_send_authorizations', [{ client_id: CLIENT_A, trigger_key: TRIGGER, authorized_at: null, revoked_at: null, template_sha256: 'sha' }])
    await loadMeSends(ctx.db, CLIENT_A, [TRIGGER])
    for (const q of state.queries) {
      expect(q.columns ?? '').not.toMatch(/rule|address|annotations|email|created_by|note|raw/i)
      expect(q.eqs).toContainEqual(['client_id', CLIENT_A])
    }
  })
})

describe('loadAutoLettersList / loadAutoLetterDetail (end to end on a fake database)', () => {
  const identity = (tour: string, depart: string, sendDate: string, monthsLeft: number | 'weekly') => ({
    sendDate,
    tourId: tour,
    departOn: depart,
    monthsLeft,
  })
  const t1Dec = identity(T1, '2027-03-11', '2026-12-02', 3)
  const t2Dec = identity(T2, '2027-05-08', '2026-12-02', 5)

  function seedWorld(): void {
    seedCatalog()
    seedBooking({ n: 1, name: 'Bea Test', party: 2 })
    seedBooking({ n: 2, name: 'Al Test' })
    seedBooking({ n: 3, name: 'Cy Test', tour: T2, departure: D2, snapshot: '2027-05-08', party: 1 })
    seedBooking({ n: 4, depositPaid: false })
    seedBooking({ n: 5, status: 'cancelled' })
    seedBooking({ n: 6, departure: null, snapshot: null })
  }

  it('lists the next batch, the near batches, the count of all letters, and the notice for the order with no date', async () => {
    seedWorld()
    const list = await loadAutoLettersList(ctx.db, CLIENT_A, NOW)
    expect(list.generatedAt).toBe(NOW.toISOString())
    expect(list.nextBatch).toEqual({ sendDate: '2026-12-02', weekdayLabel: '周三', letterCount: 2, recipientCount: 3, phase: 'draft' })
    expect(list.totalDistinctLetters).toBe(16) // tour one: 3 monthly + 4 weekly; tour two: 5 monthly + 4 weekly (contract §8 vectors)
    expect(list.scheduledLetters.map((l) => [l.sendDate, l.audience.tourName, l.audience.monthsLeft])).toEqual([
      ['2026-12-02', 'Tour One', 3],
      ['2026-12-02', 'Tour Two', 5],
      ['2027-01-06', 'Tour One', 2],
      ['2027-01-06', 'Tour Two', 4],
    ])
    expect(list.depositLetters).toEqual([])
    expect(list.notices).toEqual(['有 1 张已交定金的订单没有出发日（或日期不对），没排进任何一封信。请先在订单里补上出发日。'])
  })

  it('shows the registered subject, a waiting proposal, and a real send on the right letters', async () => {
    seedWorld()
    seed('crm_email_templates', [
      { client_id: CLIENT_A, template_key: buildTemplateKey(t1Dec), version: 1, subject: 'draft subject', body: 'x' },
      { client_id: CLIENT_A, template_key: buildTemplateKey(t1Dec), version: 2, subject: 'Your tour: 3 months to go', body: 'Kia ora {{first_name}}' },
    ])
    seed('triggered_send_authorizations', [
      { client_id: CLIENT_A, trigger_key: buildTriggerKey(t1Dec), authorized_at: null, revoked_at: null, template_sha256: 'sha' },
    ])
    seed('triggered_sends', [
      { id: 's1', client_id: CLIENT_A, trigger_key: buildTriggerKey(t2Dec), contact_id: cid(3), dedupe_scope: 'lifetime', status: 'delivered', reason_code: null },
    ])
    const list = await loadAutoLettersList(ctx.db, CLIENT_A, NOW)
    const rowOf = (tour: string, send: string) => list.scheduledLetters.find((l) => l.audience.tourName === tour && l.sendDate === send)
    expect(rowOf('Tour One', '2026-12-02')).toMatchObject({ subject: 'Your tour: 3 months to go', status: 'awaiting_release', channel: 'me' })
    expect(rowOf('Tour Two', '2026-12-02')).toMatchObject({ subject: null, status: 'sent', counts: { recipients: 1, sent: 1, blocked: 0, failed: 0 } })
    expect(rowOf('Tour One', '2027-01-06')).toMatchObject({ subject: null, status: 'draft', counts: { sent: null } })
    expect(list.nextBatch?.phase).toBe('awaiting_release')
  })

  it('a client with no paid orders gets empty lists, not an error', async () => {
    const list = await loadAutoLettersList(ctx.db, CLIENT_A, NOW)
    expect(list).toMatchObject({ nextBatch: null, scheduledLetters: [], depositLetters: [], totalDistinctLetters: 0, notices: [] })
  })

  it('detail: people, translated reasons, rehearsal marked, body from the registry; no email address anywhere', async () => {
    seedWorld()
    const key = buildLetterKey(t1Dec) as string
    seed('crm_email_templates', [
      { client_id: CLIENT_A, template_key: buildTemplateKey(t1Dec), version: 1, subject: 'S', body: 'Kia ora {{first_name}}', created_by: 'staff@x.test' },
    ])
    seed('triggered_sends', [
      { id: 'a', client_id: CLIENT_A, trigger_key: buildTriggerKey(t1Dec), contact_id: cid(1), dedupe_scope: 'lifetime', status: 'blocked', reason_code: 'frequency_full' },
      { id: 'b', client_id: CLIENT_A, trigger_key: buildTriggerKey(t1Dec), contact_id: cid(2), dedupe_scope: 'shadow', status: 'shadow', reason_code: null },
    ])
    const detail = await loadAutoLetterDetail(ctx.db, CLIENT_A, key)
    expect(detail?.letter).toMatchObject({ letterKey: key, subject: 'S', bodyText: 'Kia ora {{first_name}}', previewText: null, status: 'draft' })
    expect(detail?.tiles).toEqual({ recipients: 2, sent: 0, blocked: 1, failed: 0, rehearsal: 1, opened: null })
    expect(detail?.recipients.map((r) => [r.displayName, r.status, r.reasonText, r.seats])).toEqual([
      ['Al Test', 'rehearsal', null, null],
      ['Bea Test', 'blocked', '他最近 7 天已收 2 封', 2],
    ])
    expect(JSON.stringify(detail)).not.toMatch(/@|email|staff/i)
  })

  it('detail: an unknown, malformed or no-longer-planned letter is null (the route answers 404)', async () => {
    seedWorld()
    expect(await loadAutoLetterDetail(ctx.db, CLIENT_A, 'garbage')).toBeNull()
    expect(await loadAutoLetterDetail(ctx.db, CLIENT_A, 'me:countdown_20270106_A_2')).toBeNull()
    expect(await loadAutoLetterDetail(ctx.db, CLIENT_A, buildLetterKey(identity(T1, '2027-03-11', '2026-12-02', 2)) as string)).toBeNull() // wrong month count for that day
    expect(await loadAutoLetterDetail(ctx.db, CLIENT_B, buildLetterKey(t1Dec) as string)).toBeNull() // other client's world is empty
  })

  it('every read is scoped to the client', async () => {
    seedWorld()
    await loadAutoLettersList(ctx.db, CLIENT_A, NOW)
    expect(state.queries.length).toBeGreaterThan(0)
    for (const q of state.queries) expect(q.eqs).toContainEqual(['client_id', CLIENT_A])
  })
})

describe('rhythm, past batches and empty reasons', () => {
  const T1_DEC = { sendDate: '2026-12-02', tourId: T1, departOn: '2027-03-11', monthsLeft: 3 as const }
  const KEY = buildLetterKey(T1_DEC) as string

  function seedTwoGuests(): void {
    seedCatalog()
    seedBooking({ n: 1, name: 'Bea Test', party: 2 })
    seedBooking({ n: 2, name: 'Al Test' })
  }

  it('a client with no rhythm gets an empty page / no such letter, and nothing is read', async () => {
    seedTwoGuests()
    state.queries.length = 0
    expect(await loadAutoLettersList(ctx.db, CLIENT_A, NOW, () => null)).toEqual({
      generatedAt: NOW.toISOString(),
      nextBatch: null,
      depositLetters: [],
      scheduledLetters: [],
      pastLetters: [],
      tourGroups: [],
      totalDistinctLetters: 0,
      cadence: null,
      notices: [],
    })
    expect(await loadAutoLetterDetail(ctx.db, CLIENT_A, KEY, NOW, () => null)).toBeNull()
    expect(state.queries).toHaveLength(0)
  })

  it('the rhythm comes only from the resolver (asked per client): a different one gives different batch days', async () => {
    seedTwoGuests()
    const asked: string[] = []
    const friday = (clientId: string) => {
      asked.push(clientId)
      return { ...COUNTDOWN_CADENCE, batchWeekday: 5 }
    }
    const list = await loadAutoLettersList(ctx.db, CLIENT_A, NOW, friday)
    expect(list.nextBatch).toMatchObject({ sendDate: '2026-12-04', weekdayLabel: '周五' })
    expect(asked).toEqual([CLIENT_A])
    // the default resolver gives the Wednesday rhythm
    expect((await loadAutoLettersList(ctx.db, CLIENT_A, NOW)).nextBatch?.sendDate).toBe('2026-12-02')
  })

  it('a batch that already went out: a person who is planned but has no record is not shown as 待发', async () => {
    seedTwoGuests()
    seed('triggered_sends', [
      { id: 'a', client_id: CLIENT_A, trigger_key: buildTriggerKey(T1_DEC), contact_id: cid(1), dedupe_scope: 'lifetime', status: 'delivered', reason_code: null },
    ])
    const after = await loadAutoLetterDetail(ctx.db, CLIENT_A, KEY, new Date('2026-12-09T20:00:00Z')) // NZ 2026-12-10
    const byName = Object.fromEntries((after?.recipients ?? []).map((r) => [r.displayName, [r.status, r.reasonText]]))
    expect(byName).toEqual({ 'Bea Test': ['sent', null], 'Al Test': ['pending', '这一批发出时他不在名单里（不补发）'] })
    const before = await loadAutoLetterDetail(ctx.db, CLIENT_A, KEY, NOW) // before the send day
    expect((before?.recipients ?? []).every((r) => r.reasonText === null)).toBe(true)
  })

  it('the list carries the rhythm number the page footnote needs, from the same resolver that plans the batches', async () => {
    seedTwoGuests()
    expect((await loadAutoLettersList(ctx.db, CLIENT_A, NOW)).cadence).toEqual({ firstMonth: 6 })
    expect((await loadAutoLettersList(ctx.db, CLIENT_A, NOW, () => ({ ...COUNTDOWN_CADENCE, firstMonth: 4 }))).cadence).toEqual({ firstMonth: 4 })
  })

  describe('history: batches that already went out stay on the list', () => {
    const NOV_4 = { sendDate: '2026-11-04', tourId: T1, departOn: '2027-03-11', monthsLeft: 4 as const }
    const OCT_7 = { sendDate: '2026-10-07', tourId: T1, departOn: '2027-03-11', monthsLeft: 5 as const }
    const NOV_4_TOUR_TWO = { sendDate: '2026-11-04', tourId: T2, departOn: '2027-05-08', monthsLeft: 6 as const }

    function seedHistory(): void {
      seedCatalog()
      seedBooking({ n: 1, name: 'Bea Test', party: 2 })
      seedBooking({ n: 2, name: 'Al Test' })
      seedBooking({ n: 3, name: 'Cy Test', tour: T2, departure: D2, snapshot: '2027-05-08', party: 1 })
      seed('triggered_sends', [
        { id: 'h1', client_id: CLIENT_A, trigger_key: buildTriggerKey(NOV_4), contact_id: cid(1), dedupe_scope: 'lifetime', status: 'delivered', reason_code: null },
        { id: 'h2', client_id: CLIENT_A, trigger_key: buildTriggerKey(NOV_4), contact_id: cid(2), dedupe_scope: 'lifetime', status: 'blocked', reason_code: 'frequency_full' },
      ])
      seed('triggered_send_authorizations', [
        { client_id: CLIENT_A, trigger_key: buildTriggerKey(OCT_7), authorized_at: null, revoked_at: null, template_sha256: 'sha' },
      ])
    }

    it('lists the letters that left a trace, newest first, with their results; the rest of the past stays out', async () => {
      seedHistory()
      const list = await loadAutoLettersList(ctx.db, CLIENT_A, NOW)
      expect(list.pastLetters.map((l) => [l.sendDate, l.audience.tourName, l.audience.monthsLeft, l.status])).toEqual([
        ['2026-11-04', 'Tour One', 4, 'sent'],
        ['2026-10-07', 'Tour One', 5, 'awaiting_release'],
      ])
      expect(list.pastLetters[0].counts).toEqual({ recipients: 2, sent: 1, blocked: 1, failed: 0, rehearsal: 0, opened: null })
      expect(list.pastLetters.map((l) => l.letterKey)).not.toContain(buildLetterKey(NOV_4_TOUR_TWO)) // planned that day, but nothing in the records
    })

    it('a batch that was approved but never went out stays in the history, still a draft, and counts as overdue in its group', async () => {
      seedHistory()
      seed('triggered_send_authorizations', [
        { client_id: CLIENT_A, trigger_key: buildTriggerKey(NOV_4_TOUR_TWO), authorized_at: '2026-11-03T00:00:00Z', revoked_at: null, template_sha256: 'sha' },
      ])
      const list = await loadAutoLettersList(ctx.db, CLIENT_A, NOW)
      const row = list.pastLetters.find((l) => l.letterKey === buildLetterKey(NOV_4_TOUR_TWO))
      expect(row).toMatchObject({ status: 'draft', counts: { sent: null } })
      expect(list.tourGroups.find((g) => g.tourName === 'Tour Two')).toMatchObject({ lettersOverdue: 1, lettersSent: 0 })
    })

    it('the upcoming list and the next batch do not change', async () => {
      seedHistory()
      const list = await loadAutoLettersList(ctx.db, CLIENT_A, NOW)
      expect(list.nextBatch?.sendDate).toBe('2026-12-02')
      expect(list.scheduledLetters.map((l) => l.sendDate)).toEqual(['2026-12-02', '2026-12-02', '2027-01-06', '2027-01-06'])
      expect(list.totalDistinctLetters).toBe(16)
    })

    it('tour groups count what went out, what is ahead and what was due but never went out', async () => {
      seedHistory()
      const { tourGroups } = await loadAutoLettersList(ctx.db, CLIENT_A, NOW)
      const one = tourGroups.find((g) => g.tourName === 'Tour One')
      const two = tourGroups.find((g) => g.tourName === 'Tour Two')
      expect(one).toMatchObject({ departOn: '2027-03-11', recipients: 2, lettersSent: 1, lettersOverdue: 1 })
      expect(one?.lettersAhead).toBe(7) // 3 monthly letters (12/2, 1/6, 2/3) + 4 weekly letters in the last month
      expect(one?.lastSent).toMatchObject({ letterKey: buildLetterKey(NOV_4), sent: 1, blocked: 1, failed: 0, opened: null })
      expect(one?.next).toMatchObject({ sendDate: '2026-12-02', status: 'draft' })
      expect(two).toMatchObject({ departOn: '2027-05-08', recipients: 1, lettersSent: 0, lettersOverdue: 0, lastSent: null })
    })

    it('the history reads stay inside this client and never ask for an address, a rule or who wrote a letter', async () => {
      seedHistory()
      await loadAutoLettersList(ctx.db, CLIENT_A, NOW)
      expect(state.queries.length).toBeGreaterThan(0)
      for (const q of state.queries) expect(q.eqs).toContainEqual(['client_id', CLIENT_A])
      const letterReads = state.queries.filter((q) =>
        ['triggered_sends', 'triggered_send_authorizations', 'crm_email_templates'].includes(q.table),
      )
      expect(letterReads.length).toBeGreaterThan(0)
      for (const q of letterReads) expect(q.columns ?? '').not.toMatch(/rule|address|annotations|email|created_by|note|raw/i)
    })

    it('a letter that already went out still opens from the records after its tour left the plan (orders cancelled)', async () => {
      seedHistory()
      state.tables.crm_bookings = (state.tables.crm_bookings ?? []).map((b) => (b.tour_id === T1 ? { ...b, status: 'cancelled' } : b))
      const detail = await loadAutoLetterDetail(ctx.db, CLIENT_A, buildLetterKey(NOV_4) as string, NOW)
      expect(detail?.letter).toMatchObject({ status: 'sent', audience: { tourName: 'Tour One', departOn: '2027-03-11', monthsLeft: 4 } })
      expect(detail?.tiles).toMatchObject({ recipients: 2, sent: 1, blocked: 1 })
      expect(detail?.recipients.map((r) => [r.displayName, r.status, r.reasonText])).toEqual([
        ['Al Test', 'blocked', '他最近 7 天已收 2 封'],
        ['Bea Test', 'sent', null],
      ])
      expect(JSON.stringify(detail)).not.toMatch(/@|email/i)
    })

    it('a key that is in neither the plan nor the records is still not found', async () => {
      seedHistory()
      state.tables.crm_bookings = (state.tables.crm_bookings ?? []).map((b) => (b.tour_id === T2 ? { ...b, status: 'cancelled' } : b))
      expect(await loadAutoLetterDetail(ctx.db, CLIENT_A, buildLetterKey(NOV_4_TOUR_TWO) as string, NOW)).toBeNull()
    })

    it('a letter rebuilt from the records is read inside this client only', async () => {
      seedHistory()
      state.tables.crm_bookings = (state.tables.crm_bookings ?? []).map((b) => (b.tour_id === T1 ? { ...b, status: 'cancelled' } : b))
      state.queries.length = 0
      await loadAutoLetterDetail(ctx.db, CLIENT_A, buildLetterKey(NOV_4) as string, NOW)
      expect(state.queries.length).toBeGreaterThan(0)
      for (const q of state.queries) expect(q.eqs).toContainEqual(['client_id', CLIENT_A])
    })

    it('a past letter opens in the drawer the same way an upcoming one does', async () => {
      seedHistory()
      const detail = await loadAutoLetterDetail(ctx.db, CLIENT_A, buildLetterKey(NOV_4) as string, NOW)
      expect(detail?.letter.status).toBe('sent')
      expect(detail?.tiles).toMatchObject({ recipients: 2, sent: 1, blocked: 1 })
    })
  })

  it('statuses the ledger leaves without a reason still get a plain one', async () => {
    seedTwoGuests()
    const trigger = buildTriggerKey(T1_DEC)
    seed('triggered_sends', [
      { id: 'a', client_id: CLIENT_A, trigger_key: trigger, contact_id: cid(1), dedupe_scope: 'lifetime', status: 'unknown_outcome', reason_code: null },
      { id: 'b', client_id: CLIENT_A, trigger_key: trigger, contact_id: cid(2), dedupe_scope: 'lifetime', status: 'complained', reason_code: null },
    ])
    const detail = await loadAutoLetterDetail(ctx.db, CLIENT_A, KEY, NOW)
    const byName = Object.fromEntries((detail?.recipients ?? []).map((r) => [r.displayName, [r.status, r.reasonText]]))
    expect(byName).toEqual({ 'Bea Test': ['failed', '发送结果不明，等人核对'], 'Al Test': ['failed', '他投诉过'] })
  })
})
