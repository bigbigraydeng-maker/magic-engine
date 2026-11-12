import { describe, expect, it } from 'vitest'

import type { SupabaseClient } from '@supabase/supabase-js'

import { readLatestWeeklyPlan, saveWeeklyPlan, stampWeeklyPlan } from './db'
import type { WeeklySocialPlan } from './types'

const CLIENT = '11111111-1111-4111-8111-111111111111'

const plan: WeeklySocialPlan = {
  planKind: 'weekly_slot_plan_v1',
  platform: 'facebook',
  weekStart: '2026-11-16',
  weekEnd: '2026-11-22',
  status: 'ready',
  stage: null,
  stageNote: '阶段未下结论',
  primarySignal: 'on_time_cadence',
  counts: { story: 1, post: 1, reel: 0 },
  countSources: { story: 'client_week', post: 'client_week', reel: 'client_week', mix: 'none' },
  goal: { read: 'none', title: null, reasoning: null, intent: null, subType: null, awarenessSubtype: null, draftBasis: [] },
  themes: { read: 'none', labels: [] },
  items: [],
  gaps: [],
}

describe('weekly plan storage', () => {
  it('reads a saved plan back, skips a duplicate, and reads the stamp back', async () => {
    const db = memoryPlans()
    const client = db as unknown as SupabaseClient
    const saved = await saveWeeklyPlan(client, CLIENT, plan)
    expect(saved).not.toBe('error')
    if (saved === 'error') return
    expect(saved.saved).toBe('inserted')

    const read = await readLatestWeeklyPlan(client, CLIENT, plan.weekStart)
    expect(read).not.toBe('unreadable')
    expect(read).not.toBeNull()
    if (read === 'unreadable' || read === null) return
    expect(read.id).toBe(saved.id)
    expect(read.plan.weekStart).toBe(plan.weekStart)
    expect(read.plan.counts).toEqual(plan.counts)
    expect(read.approval).toBeNull()

    const again = await saveWeeklyPlan(client, CLIENT, plan)
    expect(again).not.toBe('error')
    if (again === 'error') return
    expect(again.saved).toBe('same')
    expect(db.rows).toHaveLength(1)

    const stamped = await stampWeeklyPlan(client, saved.id, CLIENT, {
      status: 'confirmed',
      at: '2026-11-11T00:00:00.000Z',
    })
    expect(stamped).toBe(true)
    const after = await readLatestWeeklyPlan(client, CLIENT, plan.weekStart)
    expect(after).not.toBe('unreadable')
    expect(after).not.toBeNull()
    if (after === 'unreadable' || after === null) return
    expect(after.approval).toEqual({ status: 'confirmed', at: '2026-11-11T00:00:00.000Z' })
  })
})

interface PlanRow {
  id: string
  client_id: string
  platform: string
  plan_data: Record<string, unknown>
  created_at: string
}

function memoryPlans() {
  const rows: PlanRow[] = []
  let serial = 0
  return {
    rows,
    from(table: string) {
      if (table !== 'social_plans') throw new Error(`unexpected table ${table}`)
      return new Query(rows, () => `mem-${++serial}`)
    },
  }
}

class Query {
  private filters: Array<(row: PlanRow) => boolean> = []
  private action: 'select' | 'insert' | 'update' = 'select'
  private payload: Record<string, unknown> | null = null
  private cap = 50

  constructor(private readonly rows: PlanRow[], private readonly nextId: () => string) {}

  select(): this { return this }
  order(): this { return this }
  limit(value: number): this { this.cap = value; return this }
  insert(row: Record<string, unknown>): this { this.action = 'insert'; this.payload = row; return this }
  update(row: Record<string, unknown>): this { this.action = 'update'; this.payload = row; return this }

  eq(column: string, value: unknown): this {
    this.filters.push((row) => cell(row, column) === value)
    return this
  }

  maybeSingle(): Promise<{ data: PlanRow | null; error: null }> {
    const found = this.matched()
    return Promise.resolve({ data: found[0] ?? null, error: null })
  }

  single(): Promise<{ data: { id: string } | null; error: { message: string } | null }> {
    const result = this.run()
    const data = Array.isArray(result.data) ? null : result.data
    return Promise.resolve({ data, error: data ? null : { message: 'missing' } })
  }

  then(resolve: (value: { data: unknown; error: { message: string } | null }) => void): void {
    resolve(this.run())
  }

  private matched(): PlanRow[] {
    return this.rows
      .filter((row) => this.filters.every((keep) => keep(row)))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, this.cap)
  }

  private run(): { data: PlanRow[] | { id: string } | null; error: { message: string } | null } {
    if (this.action === 'insert' && this.payload) {
      const id = this.nextId()
      this.rows.push({ ...(this.payload as Omit<PlanRow, 'id' | 'created_at'>), id, created_at: id })
      return { data: { id }, error: null }
    }
    if (this.action === 'update' && this.payload) {
      const found = this.matched()
      for (const row of found) Object.assign(row, this.payload)
      return { data: found[0] ?? null, error: found.length ? null : { message: 'missing' } }
    }
    return { data: this.matched(), error: null }
  }
}

function cell(row: PlanRow, column: string): unknown {
  const arrow = column.indexOf('->>')
  if (arrow === -1) return (row as unknown as Record<string, unknown>)[column]
  return row.plan_data[column.slice(arrow + 3)]
}
