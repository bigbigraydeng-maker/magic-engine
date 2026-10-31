import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pushConversionReviewItems } from '../conversion-review-items'
import type { ManualItem } from '../manual-items'

type Row = Record<string, unknown>
const NOW = new Date('2026-10-31T00:00:00.000Z')
const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CONTACT = '11111111-1111-4111-8111-111111111111'
const BOOKING = '30000000-0000-4000-8000-0000000000a1'

function cell(row: Row, path: string): unknown {
  let cur: unknown = row
  for (const part of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Row)[part]
  }
  return cur
}

function fake(tables: Record<string, Row[]>): SupabaseClient {
  return {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = []
      let cap: number | null = null
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (col: string, val: unknown) => (filters.push((row) => cell(row, col) === val), b),
        is: (col: string, val: unknown) => (filters.push((row) => (cell(row, col) ?? null) === val), b),
        in: (col: string, values: unknown[]) => (filters.push((row) => values.includes(cell(row, col))), b),
        gte: (col: string, val: unknown) => (filters.push((row) => String(cell(row, col) ?? '') >= String(val)), b),
        contains: () => b,
        like: () => b,
        not: () => b,
        order: () => b,
        limit: (n: number) => {
          cap = n
          return b
        },
        then: (resolve: (value: { data: Row[]; error: null }) => unknown) => {
          let out = (tables[table] ?? []).filter((row) => filters.every((fn) => fn(row)))
          if (cap != null) out = out.slice(0, cap)
          return resolve({ data: out, error: null })
        },
      }
      return b
    },
  } as unknown as SupabaseClient
}

const names = new Map([[CLIENT, { name: '示例客户' }]])

function autoDeal(id: string): Row {
  return {
    id,
    client_id: CLIENT,
    outcome_kind: 'purchase',
    occurred_at: '2026-10-28T00:00:00.000Z',
    review_status: 'approved',
    reviewed_by: 'system:crm-deal-auto',
    redacted_at: null,
    customer_first: 'A',
    customer_last: 'B',
    amount_minor: 100,
    currency: 'NZD',
    order_ref: null,
  }
}

describe('自动通过之后的今日待办', () => {
  it('says a sent deal needs no approval, and says what a failed one is missing', async () => {
    const items: ManualItem[] = []
    await pushConversionReviewItems(fake({
      me_sale_outcomes: [autoDeal('sent'), autoDeal('miss')],
      me_conversion_writebacks: [
        { outcome_id: 'sent', status: 'confirmed', payload_preview: null },
        { outcome_id: 'miss', status: 'failed', payload_preview: null },
      ],
    }), items, names, NOW)
    const note = items.find((item) => item.what.includes('已自动通过'))
    expect(note?.what).toContain('没有发出去')
    expect(note?.what).toContain('发送没有成功')
    expect(note?.what).toContain('不用再批准')
    expect(note?.what).toContain('1 笔已经发出去')
    expect(note?.href).toMatch(/^https:\/\/app\.magicengine\.com\.au\/dashboard\/conversions\?/)
  })

  it('一条发成功不算整笔都发了', async () => {
    const items: ManualItem[] = []
    await pushConversionReviewItems(fake({
      me_sale_outcomes: [autoDeal('both')],
      me_conversion_writebacks: [
        { outcome_id: 'both', status: 'confirmed', payload_preview: null },
        { outcome_id: 'both', status: 'failed', payload_preview: null },
      ],
    }), items, names, NOW)
    const note = items.find((item) => item.what.includes('已自动通过'))
    expect(note?.what).toContain('另一条还没发出去')
    expect(note?.what).not.toContain('已自动发给广告平台')
  })

  it('does not add a second line for a send the allow-list already held', async () => {
    const items: ManualItem[] = []
    await pushConversionReviewItems(fake({
      me_sale_outcomes: [autoDeal('held')],
      me_conversion_writebacks: [
        { id: 'wb', outcome_id: 'held', status: 'queued', payload_preview: { held: true }, me_sale_outcomes: {
          client_id: CLIENT, outcome_kind: 'purchase', occurred_at: '2026-10-28T00:00:00.000Z', review_status: 'approved', redacted_at: null,
        } },
      ],
    }), items, names, NOW)
    expect(items.some((item) => item.what.includes('已自动通过') || item.what.includes('已自动发给'))).toBe(false)
    expect(items.some((item) => item.what.includes('名单先停住'))).toBe(true)
  })

  it('asks for a headcount when a paid booking has none and no live deal', async () => {
    const items: ManualItem[] = []
    await pushConversionReviewItems(fake({
      clients: [{ id: CLIENT, conversion_stage: 'live', leads_config: { capi_deal_milestone: 'deposit' } }],
      crm_booking_milestones: [{ client_id: CLIENT, booking_id: BOOKING, kind: 'deposit', paid_on: '2026-10-28' }],
      crm_bookings: [{ id: BOOKING, client_id: CLIENT, contact_id: CONTACT, party_size: null }],
      me_sale_outcomes: [],
    }), items, names, NOW)
    const note = items.find((item) => item.what.includes('出行人数'))
    expect(note?.what).toContain('1 笔')
    expect(note?.what).toContain('自动发给广告平台')
    expect(note?.how).toContain('填上出行人数')
    expect(note?.href).toBe(`https://app.magicengine.com.au/dashboard/clients/${CLIENT}/crm/all?contact=${CONTACT}&focus=bookings`)
  })

  it('stays quiet when the booking already has a headcount or a deal that was not rejected', async () => {
    const items: ManualItem[] = []
    await pushConversionReviewItems(fake({
      clients: [{ id: CLIENT, conversion_stage: 'live', leads_config: { capi_deal_milestone: 'deposit' } }],
      crm_booking_milestones: [
        { client_id: CLIENT, booking_id: BOOKING, kind: 'deposit', paid_on: '2026-10-28' },
        { client_id: CLIENT, booking_id: 'other', kind: 'deposit', paid_on: '2026-10-28' },
      ],
      crm_bookings: [
        { id: BOOKING, client_id: CLIENT, contact_id: CONTACT, party_size: 2 },
        { id: 'other', client_id: CLIENT, contact_id: CONTACT, party_size: null },
      ],
      me_sale_outcomes: [{ source_kind: 'crm_stage_manual', source_ref: `crm_deal:${CONTACT}:other`, review_status: 'approved' }],
    }), items, names, NOW)
    expect(items.some((item) => item.what.includes('出行人数'))).toBe(false)
  })
})
