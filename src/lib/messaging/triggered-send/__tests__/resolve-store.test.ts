import { describe, expect, it } from 'vitest'
import { createQueryStub, ok, type RecordedCall } from '@/lib/crm/email-templates/__tests__/query-stub'
import { createReceiptStore } from '../receipt-store-prod'
import { readRecentSends, RECENT_SENDS_LIMIT, UNKNOWN_SENDS_LIMIT } from '../recent-sends'
import { createResolveDeps } from '../resolve-store'
import type { ResolvableRow } from '../resolve-unknown'
import { WELCOME_NOT_SENT_TIMELINE_LINE } from '../send-touchpoint'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const SEND = 'e0000000-0000-4000-8000-000000000001'
const has = (calls: readonly RecordedCall[], method: string, ...args: unknown[]): boolean =>
  calls.some((c) => c.method === method && JSON.stringify(c.args) === JSON.stringify(args))

const DB_ROW = {
  id: SEND,
  client_id: CLIENT,
  status: 'unknown_outcome',
  reason_code: 'expired_20h',
  first_attempt_at: '2026-11-19T00:00:00+00:00',
  annotations: { gate_contract_version: 1 },
  updated_at: '2026-11-19T22:00:00.123456+00:00',
}
const ROW: ResolvableRow = {
  id: SEND,
  clientId: CLIENT,
  status: 'unknown_outcome',
  reasonCode: 'expired_20h',
  firstAttemptAt: DB_ROW.first_attempt_at,
  annotations: DB_ROW.annotations,
  updatedAt: DB_ROW.updated_at,
}

describe('resolve_unknown — the database side', () => {
  it('🔴 reads one REAL welcome row of this client only (never a rehearsal row, never another client’s)', async () => {
    const stub = createQueryStub({ triggered_sends: { data: DB_ROW, error: null } })
    expect(await createResolveDeps(stub.db).load(CLIENT, SEND)).toEqual({ ok: true, row: ROW })
    const q = stub.of('triggered_sends')
    for (const f of [['client_id', CLIENT], ['id', SEND], ['trigger_key', 'welcome'], ['channel', 'email'], ['dedupe_scope', 'lifetime']]) expect(has(q, 'eq', ...f), String(f)).toBe(true)
    const odd = createQueryStub({ triggered_sends: { data: { ...DB_ROW, annotations: ['x'] }, error: null } })
    expect(await createResolveDeps(odd.db).load(CLIENT, SEND)).toMatchObject({ ok: true, row: { annotations: {} } })
    const none = createQueryStub({ triggered_sends: { data: null, error: null } })
    expect(await createResolveDeps(none.db).load(CLIENT, SEND)).toEqual({ ok: true, row: null })
    const down = createQueryStub({ triggered_sends: { data: null, error: { code: '08006', message: 'guest@example.org' } } })
    expect(await createResolveDeps(down.db).load(CLIENT, SEND)).toEqual({ ok: false, error: 'ledger read: 08006' })
  })

  it('🔴 the answer is a compare-and-set from unknown_outcome at the time the row was read; none written = "changed"', async () => {
    const patch = { status: 'failed', reason_code: 'not_sent_confirmed' }
    const stub = createQueryStub({ triggered_sends: { data: [], error: null } })
    expect(await createResolveDeps(stub.db).write(ROW, patch)).toEqual({ ok: true, result: 'changed' })
    const q = stub.of('triggered_sends')
    expect(has(q, 'update', patch)).toBe(true)
    for (const f of [['id', SEND], ['client_id', CLIENT], ['status', 'unknown_outcome'], ['updated_at', ROW.updatedAt]]) expect(has(q, 'eq', ...f), String(f)).toBe(true)
    const written = createQueryStub({ triggered_sends: { data: [{ id: SEND }], error: null } })
    expect(await createResolveDeps(written.db).write(ROW, patch)).toEqual({ ok: true, result: 'updated' })
    const refused = createQueryStub({ triggered_sends: { data: null, error: { code: 'P0001', message: 'row with guest@example.org' } } })
    expect(await createResolveDeps(refused.db).write(ROW, patch)).toEqual({ ok: false, error: 'ledger update: P0001' })
  })

  it('says whether the letter has its own timeline line (by send id); a failed read is "cannot tell"', async () => {
    const one = createQueryStub({ contact_touchpoints: { data: [{ id: 't1' }], error: null } })
    expect(await createResolveDeps(one.db).timelinePresent(CLIENT, SEND)).toBe(true)
    const q = one.of('contact_touchpoints')
    expect(has(q, 'eq', 'source', 'me_send') && has(q, 'eq', 'source_ref', SEND) && has(q, 'eq', 'client_id', CLIENT)).toBe(true)
    expect(await createResolveDeps(createQueryStub({ contact_touchpoints: { data: [], error: null } }).db).timelinePresent(CLIENT, SEND)).toBe(false)
    expect(await createResolveDeps(createQueryStub({ contact_touchpoints: { data: null, error: { message: 'x' } } }).db).timelinePresent(CLIENT, SEND)).toBeNull()
  })

  it('「没发出」 rewrites the letter’s own timeline line (by send id) as cancelled', async () => {
    const stub = createQueryStub({ contact_touchpoints: { data: [{ id: 't1' }], error: null } })
    expect(await createResolveDeps(stub.db).cancelTimeline(CLIENT, SEND)).toEqual({ ok: true, updated: 1 })
    const q = stub.of('contact_touchpoints')
    expect(has(q, 'eq', 'source', 'me_send') && has(q, 'eq', 'source_ref', SEND) && has(q, 'eq', 'client_id', CLIENT)).toBe(true)
    const update = q.find((c) => c.method === 'update')?.args[0] as Record<string, unknown>
    expect(update.summary).toBe(WELCOME_NOT_SENT_TIMELINE_LINE)
    expect(update.metadata).toMatchObject({ triggered_send_id: SEND, send_state: 'cancelled', automated: true })
  })
})

describe('「最近发送」 — the latest live letters', () => {
  const LIVE = {
    id: SEND,
    contact_id: 'b0000000-0000-4000-8000-000000000001',
    status: 'failed',
    reason_code: 'not_sent_confirmed',
    last_block_reason: null,
    bounce_kind: null,
    provider_impact: 'PROVIDER_UNKNOWN',
    attempts: null,
    first_attempt_at: '2026-11-19T00:00:00+00:00',
    sent_at: null,
    last_event_type: null,
    last_event_at: null,
    created_at: '2026-11-19T00:00:00+00:00',
    updated_at: '2026-11-20T01:00:00+00:00',
    annotations: { would_send: true, legacy_campaign_ids: ['c1'], resolution: { outcome: 'not_sent', by: 'pm@example.com', by_user_id: 'u', at: '2026-11-20T01:00:00.000Z', request_id: 'r' } },
  }

  it('🔴 reads only this client’s REAL welcome rows (never the rehearsal’s), newest activity first, at most the page’s limit', async () => {
    const stub = createQueryStub({ triggered_sends: { data: [], error: null } })
    expect(await readRecentSends(stub.db, CLIENT)).toEqual({ ok: true, rows: [], unknownCount: 0, unknownMore: false })
    const q = stub.of('triggered_sends')
    for (const f of [['client_id', CLIENT], ['trigger_key', 'welcome'], ['channel', 'email'], ['dedupe_scope', 'lifetime']]) expect(has(q, 'eq', ...f), String(f)).toBe(true)
    expect(has(q, 'order', 'updated_at', { ascending: false })).toBe(true)
    expect(has(q, 'limit', RECENT_SENDS_LIMIT)).toBe(true)
  })

  it('🔴 never reads an address and passes on only who settled a letter, not the rest of the row’s notes', async () => {
    const stub = createQueryStub({ triggered_sends: { data: [LIVE], error: null } })
    const read = await readRecentSends(stub.db, CLIENT)
    const select = String(stub.of('triggered_sends').find((c) => c.method === 'select')?.args[0])
    expect(select).not.toMatch(/address|email|annotations\s*->/)
    expect(read).toMatchObject({ ok: true, rows: [{ id: SEND, status: 'failed', attempts: 0, resolution: { outcome: 'not_sent', by: 'pm@example.com', at: '2026-11-20T01:00:00.000Z' } }] })
    const row = read.ok ? read.rows[0] : null
    expect(row).not.toHaveProperty('annotations')
    expect(JSON.stringify(row)).not.toContain('legacy_campaign_ids')
    expect(JSON.stringify(row)).not.toContain('request_id')
  })

  it('a failed read is a failure by code, never an empty list', async () => {
    const down = createQueryStub({ triggered_sends: { data: null, error: { code: '08006', message: 'guest@example.org' } } })
    expect(await readRecentSends(down.db, CLIENT)).toEqual({ ok: false, error: 'recent sends: 08006' })
    const odd = createQueryStub({ triggered_sends: { data: { nope: true }, error: null } })
    expect(await readRecentSends(odd.db, CLIENT)).toMatchObject({ ok: false })
    // Either of the two reads failing fails the whole list.
    const isUnknownQuery = (query: readonly RecordedCall[]) => query.some((c) => c.method === 'eq' && c.args[0] === 'status')
    const recentDown = createQueryStub({ triggered_sends: (query) => (isUnknownQuery(query) ? ok([]) : { data: null, error: { code: '57014', message: 'x' } }) })
    expect(await readRecentSends(recentDown.db, CLIENT)).toEqual({ ok: false, error: 'recent sends: 57014' })
  })

  it('🔴 every letter whose outcome is unknown comes first and is counted, however much newer activity there is', async () => {
    const unknown = [{ ...LIVE, id: 'u1', status: 'unknown_outcome', reason_code: 'expired_20h', annotations: {} }, { ...LIVE, id: 'u2', status: 'unknown_outcome', reason_code: 'expired_20h', annotations: {} }]
    const recent = Array.from({ length: RECENT_SENDS_LIMIT }, (_, i) => ({ ...LIVE, id: `b${i}`, status: 'blocked', reason_code: 'lock_busy', annotations: {} }))
    recent[3] = unknown[1] // one unknown is also among the latest: listed once
    const isUnknownQuery = (query: readonly RecordedCall[]) => query.some((c) => c.method === 'eq' && c.args[0] === 'status' && c.args[1] === 'unknown_outcome')
    const stub = createQueryStub({ triggered_sends: (query) => ok(isUnknownQuery(query) ? unknown : recent) })
    const read = await readRecentSends(stub.db, CLIENT)
    expect(read.ok && read.rows.slice(0, 2).map((r) => r.id)).toEqual(['u1', 'u2'])
    expect(read.ok && read.rows.length).toBe(2 + RECENT_SENDS_LIMIT - 1)
    expect(read).toMatchObject({ ok: true, unknownCount: 2, unknownMore: false })
    const limits = stub.calls.filter((c) => c.method === 'limit').map((c) => c.args[0])
    expect(limits).toEqual([UNKNOWN_SENDS_LIMIT + 1, RECENT_SENDS_LIMIT])
    // Exactly the limit: all of them are listed, nothing more. One more: "at least", and only the limit is listed.
    const unknownRows = (n: number) => Array.from({ length: n }, (_, i) => ({ ...LIVE, id: `u${i}`, status: 'unknown_outcome', annotations: {} }))
    const exactly = createQueryStub({ triggered_sends: (query) => ok(isUnknownQuery(query) ? unknownRows(UNKNOWN_SENDS_LIMIT) : []) })
    expect(await readRecentSends(exactly.db, CLIENT)).toMatchObject({ ok: true, unknownCount: UNKNOWN_SENDS_LIMIT, unknownMore: false })
    const many = createQueryStub({ triggered_sends: (query) => ok(isUnknownQuery(query) ? unknownRows(UNKNOWN_SENDS_LIMIT + 1) : []) })
    const read2 = await readRecentSends(many.db, CLIENT)
    expect(read2).toMatchObject({ ok: true, unknownCount: UNKNOWN_SENDS_LIMIT, unknownMore: true })
    expect(read2.ok && read2.rows.length).toBe(UNKNOWN_SENDS_LIMIT)
  })

  it('🔴 flags a person’s answer that a later receipt contradicts (one definition of "left the provider")', async () => {
    const rows = [
      { ...LIVE, id: 'a', status: 'delivered', reason_code: 'not_sent_confirmed' },
      { ...LIVE, id: 'b', status: 'suppressed', reason_code: 'not_sent_confirmed' },
      { ...LIVE, id: 'c', status: 'suppressed', reason_code: 'sent_confirmed', annotations: { resolution: { outcome: 'sent', by: 'pm@example.com', at: 'x' } } },
      { ...LIVE, id: 'd', status: 'delivered', reason_code: 'sent_confirmed', annotations: { resolution: { outcome: 'sent', by: 'pm@example.com', at: 'x' } } },
    ]
    const stub = createQueryStub({ triggered_sends: (query) => ok(query.some((c) => c.method === 'eq' && c.args[0] === 'status') ? [] : rows) })
    const read = await readRecentSends(stub.db, CLIENT)
    const flags = read.ok ? read.rows.map((r) => [r.id, r.went_out_after_not_sent, r.not_sent_after_sent]) : null
    expect(flags).toEqual([['a', true, false], ['b', false, false], ['c', false, true], ['d', false, false]])
  })
})

describe('the receipt side still reports receipts to the address of a letter a person settled', () => {
  it('🔴 a person’s 「已发出」 (no message id) is looked up like a 「没发出」, so an untagged receipt is reported, not dropped', async () => {
    const stub = createQueryStub({ triggered_sends: { data: [], error: null } })
    await createReceiptStore(stub.db).findUnboundByAddress(['a'.repeat(64)], '2026-11-01T00:00:00.000Z')
    const filter = String(stub.of('triggered_sends').find((c) => c.method === 'or')?.args[0])
    expect(filter).toContain('status.in.(pending,unknown_outcome)')
    expect(filter).toContain('and(status.eq.failed,reason_code.eq.not_sent_confirmed)')
    expect(filter).toContain('and(status.eq.sent,reason_code.eq.sent_confirmed)')
    expect(has(stub.of('triggered_sends'), 'is', 'provider_message_id', null)).toBe(true)
  })
})
