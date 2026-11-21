import { describe, expect, it } from 'vitest'
import { DAY_MS } from '../event-window'
import { markNotSentPastWindow, sweepPastWindowAll } from '../expire-pending'

type Row = Record<string, unknown>

function fake(rows: Row[]) {
  const audits: Row[] = []
  const from = (table: string) => {
    const filters: Array<[string, string, unknown]> = []
    let pendingUpdate: Row | null = null
    let wantsIds = false
    const matched = () =>
      table === 'me_sale_outcomes'
        ? rows.filter((r) =>
            filters.every(([op, col, val]) => {
              if (op === 'eq') return r[col] === val
              if (op === 'is') return val === null ? r[col] == null : r[col] === val
              if (op === 'lt') return Date.parse(String(r[col])) < Date.parse(String(val))
              return true
            }),
          )
        : []
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
      order: () => builder,
      limit: () => builder,
      update: (patch: Row) => {
        pendingUpdate = patch
        return builder
      },
      insert: (row: Row) => {
        if (table === 'me_conversion_audit') audits.push(row)
        return Promise.resolve({ error: null })
      },
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
  return { supabase: { from }, audits, rows }
}

const NOW = new Date('2026-11-10T00:00:00Z')

function pending(occurredAt: string, id = 'o1'): Row {
  return {
    id,
    client_id: 'c1',
    occurred_at: occurredAt,
    review_status: 'pending_review',
    redacted_at: null,
  }
}

describe('超过精确 7 天窗口才标不发送', () => {
  it('过了窗口的写成超过时限，并记是哪条规则', async () => {
    const db = fake([pending(new Date(NOW.getTime() - 8 * DAY_MS).toISOString())])
    const n = await sweepPastWindowAll(db.supabase as never, NOW)
    expect(n).toBe(1)
    expect(db.rows[0]).toMatchObject({
      review_status: 'rejected',
      reject_reason: 'past_window',
      reviewed_by: 'ai-auto-review@system',
    })
    expect(db.audits).toContainEqual(
      expect.objectContaining({
        action: 'ai_auto_rejected',
        detail: expect.objectContaining({
          reason: 'expired',
          rule: 'past_event_window',
          reject_reason: 'past_window',
        }),
      }),
    )
  })

  it('正好 7 天不动', async () => {
    const db = fake([pending(new Date(NOW.getTime() - 7 * DAY_MS).toISOString())])
    const n = await sweepPastWindowAll(db.supabase as never, NOW)
    expect(n).toBe(0)
    expect(db.rows[0].review_status).toBe('pending_review')
    expect(db.audits).toHaveLength(0)
  })

  it('已经被处理过的不再写第二条审计', async () => {
    const row = pending(new Date(NOW.getTime() - 8 * DAY_MS).toISOString())
    row.review_status = 'rejected'
    const db = fake([row])
    const marked = await markNotSentPastWindow(db.supabase as never, 'o1', 'note', NOW, 8)
    expect(marked).toBe(false)
    expect(db.audits).toHaveLength(0)
  })
})
