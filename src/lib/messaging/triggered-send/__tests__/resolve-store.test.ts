import { describe, expect, it } from 'vitest'
import { createQueryStub, type RecordedCall } from '@/lib/crm/email-templates/__tests__/query-stub'
import { readRecentSends, RECENT_SENDS_LIMIT } from '../recent-sends'
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
    expect(await readRecentSends(stub.db, CLIENT)).toEqual({ ok: true, rows: [] })
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
  })
})
