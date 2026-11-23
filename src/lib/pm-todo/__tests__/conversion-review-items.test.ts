import { describe, expect, it } from 'vitest'
import { DAY_MS } from '@/lib/conversions/event-window'
import { pushConversionReviewItems } from '../conversion-review-items'
import type { ManualItem } from '../manual-items'

type Row = Record<string, unknown>

function fake(rows: Row[]) {
  const from = (table: string) => {
    const filters: Array<[string, string, unknown]> = []
    let pendingUpdate: Row | null = null
    let wantsIds = false
    const matched = () => {
      if (table !== 'me_sale_outcomes') return []
      return rows.filter((r) =>
        filters.every(([op, col, val]) => {
          if (op === 'eq') return r[col] === val
          if (op === 'is') return val === null ? r[col] == null : r[col] === val
          if (op === 'lt') return Date.parse(String(r[col])) < Date.parse(String(val))
          if (op === 'gte') return Date.parse(String(r[col])) >= Date.parse(String(val))
          return true
        }),
      )
    }
    const builder: Record<string, unknown> = {
      select: () => {
        if (pendingUpdate) wantsIds = true
        return builder
      },
      eq: (col: string, val: unknown) => {
        filters.push(['eq', col, val])
        return builder
      },
      is: (col: string, val: unknown) => {
        filters.push(['is', col, val])
        return builder
      },
      lt: (col: string, val: unknown) => {
        filters.push(['lt', col, val])
        return builder
      },
      gte: (col: string, val: unknown) => {
        filters.push(['gte', col, val])
        return builder
      },
      order: () => builder,
      limit: () => builder,
      update: (patch: Row) => {
        pendingUpdate = patch
        return builder
      },
      insert: () => Promise.resolve({ error: null }),
      then: (resolve: (v: { data: Row[] | null; error: null }) => unknown) => {
        if (pendingUpdate) {
          const hit = matched()
          for (const r of hit) Object.assign(r, pendingUpdate)
          return resolve({ data: wantsIds ? hit.map((r) => ({ id: r.id })) : null, error: null })
        }
        return resolve({ data: matched(), error: null })
      },
    }
    return builder
  }
  return { from }
}

const NOW = new Date('2026-11-10T00:00:00Z')
const CLIENT = 'c0000000-0000-0000-0000-000000000000'

function row(over: Partial<Row>): Row {
  return {
    id: 'o1',
    client_id: CLIENT,
    outcome_kind: 'lead',
    customer_first: 'maree',
    customer_last: 'wilson',
    amount_minor: null,
    currency: null,
    order_ref: null,
    occurred_at: new Date(NOW.getTime() - 2 * DAY_MS).toISOString(),
    review_status: 'pending_review',
    redacted_at: null,
    ...over,
  }
}

describe('今日待办跟核对页用同一套称呼和天数', () => {
  it('还在窗口里的咨询用名，不用姓的缩写', async () => {
    const rows = [row({ id: 'lead-1' })]
    const items: ManualItem[] = []
    await pushConversionReviewItems(
      fake(rows) as never,
      items,
      new Map([[CLIENT, { name: '示例客户' }]]),
      NOW,
    )
    const item = items.find((i) => i.kind === 'conversion_needs_review')
    expect(item?.what).toContain('Maree')
    expect(item?.what).toContain('天前')
    expect(item?.what).toContain('告诉广告平台')
    expect(item?.what).not.toContain('M W.')
    expect(rows[0].review_status).toBe('pending_review')
  })

  it('已经过窗口的不进待办，并标成超过时限', async () => {
    const rows = [
      row({ id: 'old', occurred_at: new Date(NOW.getTime() - 8 * DAY_MS).toISOString() }),
      row({ id: 'fresh' }),
    ]
    const items: ManualItem[] = []
    await pushConversionReviewItems(
      fake(rows) as never,
      items,
      new Map([[CLIENT, { name: '示例客户' }]]),
      NOW,
    )
    const reviews = items.filter((i) => i.kind === 'conversion_needs_review')
    expect(reviews).toHaveLength(1)
    expect(reviews[0].what).toContain('Maree')
    expect(reviews[0].what).not.toContain('已过去')
    expect(rows.find((r) => r.id === 'old')).toMatchObject({
      review_status: 'rejected',
      reject_reason: 'past_window',
    })
  })
})
