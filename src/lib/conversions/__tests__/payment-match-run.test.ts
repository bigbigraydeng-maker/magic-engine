import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../writeback-service', () => ({
  sendApprovedOutcome: vi.fn(async () => ({ status: 'confirmed', message: '已发送', writebackId: 'wb-1' })),
}))

import { sendApprovedOutcome } from '../writeback-service'
import { PAYMENT_MATCH_ACTOR, PAYMENT_MATCH_AUDIT, PAYMENT_MATCH_RULE } from '../payment-match'
import { listPaymentMatchClientIds, readPaymentMatchEnabled, runPaymentMatchAutoSend } from '../payment-match-run'

type Row = Record<string, unknown>

const CLIENT = 'client-1'
const OTHER = 'client-2'
const CONTACT = 'contact-1'
const NOW = new Date('2026-11-10T00:00:00.000Z')
const OCCURRED = new Date(NOW.getTime() - 2 * 86_400_000).toISOString()

function pending(over: Row = {}): Row {
  return {
    id: 'o1',
    client_id: CLIENT,
    contact_id: CONTACT,
    outcome_kind: 'purchase',
    customer_email: 'guest@example.com',
    customer_phone: null,
    amount_minor: 499900,
    currency: 'NZD',
    occurred_at: OCCURRED,
    review_status: 'pending_review',
    redacted_at: null,
    ...over,
  }
}

function tables(over: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  return {
    clients: [
      { id: CLIENT, conversion_payment_match_enabled: true, default_phone_country: '64' },
      { id: OTHER, conversion_payment_match_enabled: false, default_phone_country: '61' },
    ],
    me_sale_outcomes: [pending()],
    contact_identities: [{ client_id: CLIENT, contact_id: CONTACT, kind: 'email', value: 'guest@example.com' }],
    crm_bookings: [
      {
        id: 'b1',
        client_id: CLIENT,
        contact_id: CONTACT,
        tour_id: 't1',
        departure_id: 'd1',
        status: 'active',
      },
    ],
    crm_booking_milestones: [{ booking_id: 'b1', client_id: CLIENT, kind: 'deposit', state: 'paid' }],
    tour_catalog_tours: [{ id: 't1', client_id: CLIENT, display_price_text: 'From NZD $4,999 per person' }],
    tour_catalog_departures: [{ id: 'd1', client_id: CLIENT, price_text_override: null }],
    me_conversion_audit: [],
    ...over,
  }
}

function fakeSupabase(db: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: Array<{ op: string; col: string; val: unknown }> = []
      let pendingUpdate: Row | null = null
      let limitN: number | null = null
      let orderCol: string | null = null
      let wantRows = false
      const matched = () => {
        let rows = (db[table] ?? []).filter((row) =>
          filters.every((filter) => {
            const value = row[filter.col]
            if (filter.op === 'eq') return value === filter.val
            if (filter.op === 'neq') return value !== filter.val
            if (filter.op === 'in') return (filter.val as unknown[]).includes(value)
            if (filter.op === 'is') return filter.val === null ? value == null : value === filter.val
            if (filter.op === 'gte') return String(value) >= String(filter.val)
            return false
          }),
        )
        if (orderCol) {
          const col = orderCol
          rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1))
        }
        return limitN == null ? rows : rows.slice(0, limitN)
      }
      const builder: Record<string, unknown> = {
        select: () => {
          if (pendingUpdate) wantRows = true
          return builder
        },
        eq: (col: string, val: unknown) => {
          filters.push({ op: 'eq', col, val })
          return builder
        },
        neq: (col: string, val: unknown) => {
          filters.push({ op: 'neq', col, val })
          return builder
        },
        in: (col: string, val: unknown) => {
          filters.push({ op: 'in', col, val })
          return builder
        },
        is: (col: string, val: unknown) => {
          filters.push({ op: 'is', col, val })
          return builder
        },
        gte: (col: string, val: unknown) => {
          filters.push({ op: 'gte', col, val })
          return builder
        },
        order: (col: string) => {
          orderCol = col
          return builder
        },
        limit: (n: number) => {
          limitN = n
          return builder
        },
        maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
        update: (patch: Row) => {
          pendingUpdate = patch
          return builder
        },
        insert: (row: Row) => {
          ;(db[table] ?? []).push(row)
          return Promise.resolve({ error: null })
        },
        then: (resolve: (value: { data: Row[] | null; error: null }) => unknown) => {
          if (pendingUpdate) {
            const rows = matched()
            for (const row of rows) Object.assign(row, pendingUpdate)
            return resolve({ data: wantRows ? rows.map((row) => ({ id: row.id as string })) : null, error: null })
          }
          return resolve({ data: matched(), error: null })
        },
      }
      return builder
    },
  }
}

function run(db: Record<string, Row[]>) {
  return runPaymentMatchAutoSend({
    supabase: fakeSupabase(db) as never,
    sendDeps: { writer: {} as never, fetcher: fetch },
    now: NOW,
  })
}

beforeEach(() => {
  vi.mocked(sendApprovedOutcome).mockClear()
  vi.mocked(sendApprovedOutcome).mockResolvedValue({ status: 'confirmed', message: '已发送', writebackId: 'wb-1' })
})

describe('runPaymentMatchAutoSend', () => {
  it('金额等于每人标价且定金已收 → 走现有发送，台账写下规则和两边金额，发送不带判断时间', async () => {
    const db = tables()
    const summary = await run(db)
    expect(summary).toMatchObject({ enabledClientIds: [CLIENT], scanned: 1, sent: 1, held: 0 })
    expect(sendApprovedOutcome).toHaveBeenCalledTimes(1)
    expect(sendApprovedOutcome).toHaveBeenCalledWith('o1', expect.not.objectContaining({ now: expect.anything() }))
    expect(db.me_sale_outcomes[0]).toMatchObject({ review_status: 'approved', reviewed_by: PAYMENT_MATCH_ACTOR })
    const audit = db.me_conversion_audit.find((row) => row.action === PAYMENT_MATCH_AUDIT)
    expect(audit?.detail).toMatchObject({
      rule: PAYMENT_MATCH_RULE,
      booking_id: 'b1',
      outcome_amount_minor: 499900,
      tour_price_minor: 499900,
      outcome_currency: 'NZD',
      tour_price_currency: 'NZD',
      price_source: 'tour_display',
    })
    expect(JSON.stringify(audit?.detail)).not.toContain('@')
  })

  it('班期自己的标价优先于团展示价', async () => {
    const db = tables({
      tour_catalog_departures: [{ id: 'd1', client_id: CLIENT, price_text_override: 'From NZD $5,200 per person' }],
      me_sale_outcomes: [pending({ amount_minor: 520000 })],
    })
    await run(db)
    expect(sendApprovedOutcome).toHaveBeenCalledTimes(1)
    expect(db.me_conversion_audit[0].detail).toMatchObject({
      price_source: 'departure_override',
      tour_price_minor: 520000,
      outcome_amount_minor: 520000,
    })
  })

  it('金额对不上、客人不一致、别的客户的预订和身份，都不发，成交仍待核对', async () => {
    const mismatch = tables({ me_sale_outcomes: [pending({ amount_minor: 100 })] })
    expect((await run(mismatch)).heldByReason).toMatchObject({ amount_mismatch: 1 })
    expect(mismatch.me_sale_outcomes[0].review_status).toBe('pending_review')

    const wrongPerson = tables({
      contact_identities: [{ client_id: CLIENT, contact_id: CONTACT, kind: 'email', value: 'other@example.com' }],
    })
    expect((await run(wrongPerson)).heldByReason).toMatchObject({ customer_mismatch: 1 })
    expect(sendApprovedOutcome).not.toHaveBeenCalled()

    const otherClient = tables({
      contact_identities: [{ client_id: OTHER, contact_id: CONTACT, kind: 'email', value: 'guest@example.com' }],
      crm_bookings: [
        {
          id: 'b-other',
          client_id: OTHER,
          contact_id: CONTACT,
          tour_id: 't1',
          departure_id: null,
          status: 'active',
        },
      ],
      crm_booking_milestones: [{ booking_id: 'b-other', client_id: OTHER, kind: 'deposit', state: 'paid' }],
      tour_catalog_tours: [{ id: 't1', client_id: OTHER, display_price_text: 'From NZD $4,999 per person' }],
    })
    expect((await run(otherClient)).heldByReason).toMatchObject({ customer_mismatch: 1 })
    expect(otherClient.me_sale_outcomes[0].review_status).toBe('pending_review')
  })

  it('同一条预订只发最早的一笔；已经批准过相同金额的也不再发', async () => {
    const db = tables({
      me_sale_outcomes: [
        pending({ id: 'older', occurred_at: new Date(NOW.getTime() - 3 * 86_400_000).toISOString() }),
        pending({ id: 'newer', occurred_at: OCCURRED }),
      ],
    })
    const summary = await run(db)
    expect(summary.sent).toBe(1)
    expect(summary.heldByReason.duplicate_booking).toBe(1)
    expect(vi.mocked(sendApprovedOutcome).mock.calls.map((call) => call[0])).toEqual(['older'])

    vi.mocked(sendApprovedOutcome).mockClear()
    const already = tables({
      me_sale_outcomes: [
        pending(),
        {
          id: 'done',
          client_id: CLIENT,
          contact_id: CONTACT,
          outcome_kind: 'purchase',
          amount_minor: 499900,
          currency: 'NZD',
          review_status: 'approved',
          redacted_at: null,
        },
      ],
      me_conversion_audit: [
        { outcome_id: 'done', action: PAYMENT_MATCH_AUDIT, detail: { booking_id: 'b1', rule: PAYMENT_MATCH_RULE } },
      ],
    })
    expect((await run(already)).heldByReason).toMatchObject({ duplicate_booking: 1 })
    expect(sendApprovedOutcome).not.toHaveBeenCalled()
  })

  it('开关关着、或这一列还不在，什么都不发', async () => {
    const db = tables()
    db.clients = db.clients.map((row) => ({ ...row, conversion_payment_match_enabled: false }))
    expect(await run(db)).toMatchObject({ enabledClientIds: [], sent: 0, scanned: 0 })
    expect(sendApprovedOutcome).not.toHaveBeenCalled()

    const missing = {
      from: () => ({
        select: () => ({
          eq: () => {
            const error = { message: 'column conversion_payment_match_enabled does not exist' }
            const node = {
              maybeSingle: async () => ({ data: null, error }),
              then: (resolve: (value: { data: null; error: typeof error }) => unknown) =>
                resolve({ data: null, error }),
            }
            return node
          },
        }),
      }),
    }
    expect(await listPaymentMatchClientIds(missing as never)).toEqual([])
    expect(await readPaymentMatchEnabled(missing as never, CLIENT)).toBe(false)
  })
})
