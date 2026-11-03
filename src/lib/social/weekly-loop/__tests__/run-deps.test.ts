import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createWeeklyLoopDbDeps,
  listWeeklyLoopClients,
  parseOrderRow,
  weeklyLoopEnabled,
  WEEKLY_LOOP_ORDER_CAP,
} from '../run-deps'

interface RecordedUpdate {
  table: string
  patch: Record<string, unknown>
  filters: Record<string, unknown>
}

interface FakeState {
  clients: Record<string, unknown>[]
  orders: Record<string, unknown>[]
  updateRows: number
  updateError: boolean
  readError: boolean
  updates: RecordedUpdate[]
  limits: number[]
}

type BuilderMode = 'select' | 'update'

interface Builder {
  select: (cols?: string) => Builder
  eq: (col: string, val: unknown) => Builder
  in: (col: string, vals: unknown[]) => Builder
  order: (col: string, opts?: { ascending?: boolean }) => Builder
  limit: (n: number) => Builder
  update: (patch: Record<string, unknown>) => Builder
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>
  then: (
    resolve: (value: { data: unknown; error: unknown }) => void,
    reject?: (reason: unknown) => void,
  ) => void
}

function makeDb(state: FakeState): SupabaseClient {
  function from(table: string): Builder {
    let mode: BuilderMode = 'select'
    let patch: Record<string, unknown> = {}
    const filters: Record<string, unknown> = {}

    function resolve(): { data: unknown; error: unknown } {
      if (state.readError && mode === 'select') {
        return { data: null, error: { message: 'boom' } }
      }
      if (table === 'clients') {
        return { data: state.clients, error: null }
      }
      if (table === 'content_work_orders') {
        if (mode === 'update') {
          state.updates.push({ table, patch, filters: { ...filters } })
          if (state.updateError) return { data: null, error: { message: 'boom' } }
          const count = state.updateRows
          const data = Array.from({ length: count }, () => ({ id: 'x' }))
          return { data, error: null }
        }
        return { data: state.orders, error: null }
      }
      return { data: null, error: null }
    }

    const builder: Builder = {
      select: () => builder,
      eq: (col, val) => {
        filters[col] = val
        return builder
      },
      in: (_col, _vals) => builder,
      order: (_col, _opts) => builder,
      limit: (n) => {
        state.limits.push(n)
        return builder
      },
      update: (p) => {
        mode = 'update'
        patch = p
        return builder
      },
      maybeSingle: () => {
        const result = resolve()
        if (result.error) return Promise.resolve(result)
        const rows = Array.isArray(result.data) ? result.data : []
        return Promise.resolve({ data: rows[0] ?? null, error: null })
      },
      then: (onFulfilled, onRejected) => {
        try {
          onFulfilled(resolve())
        } catch (err) {
          if (onRejected) onRejected(err)
        }
      },
    }
    return builder
  }

  return { from } as never
}

function baseState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    clients: [],
    orders: [],
    updateRows: 1,
    updateError: false,
    readError: false,
    updates: [],
    limits: [],
    ...overrides,
  }
}

function orderRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'w1',
    status: 'approved',
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-02T00:00:00Z',
    angle: { hook: 'h' },
    brief: { copy: { hook: 'h' } },
    output: { caption: 'c' },
    review_ref: { approved_at: '2026-11-01T00:00:00Z' },
    published_ref: { video_state: 'DRAFT' },
    ...overrides,
  }
}

describe('weeklyLoopEnabled', () => {
  it('is true only for boolean true', () => {
    expect(weeklyLoopEnabled({ weekly_loop: { enabled: true } })).toBe(true)
    expect(weeklyLoopEnabled({ weekly_loop: { enabled: 'true' } })).toBe(false)
    expect(weeklyLoopEnabled({})).toBe(false)
    expect(weeklyLoopEnabled(null)).toBe(false)
    expect(weeklyLoopEnabled({ weekly_loop: true })).toBe(false)
  })
})

describe('listWeeklyLoopClients', () => {
  it('keeps only rows whose config is really enabled', async () => {
    const state = baseState({
      clients: [
        { id: 'c1', publishing_calendar_config: { weekly_loop: { enabled: true } } },
        { id: 'c2', publishing_calendar_config: { weekly_loop: { enabled: 'true' } } },
      ],
    })
    const result = await listWeeklyLoopClients(makeDb(state))
    expect(result).toEqual([
      { id: 'c1', config: { weekly_loop: { enabled: true } } },
    ])
  })

  it('throws on read error', async () => {
    const state = baseState({ readError: true })
    await expect(listWeeklyLoopClients(makeDb(state))).rejects.toThrow('clients_read_failed')
  })
})

describe('parseOrderRow', () => {
  it('returns null when updated_at is missing', () => {
    const row = orderRow()
    delete row.updated_at
    expect(parseOrderRow(row)).toBeNull()
  })

  it('copies brief and output when valid', () => {
    const row = orderRow()
    const parsed = parseOrderRow(row)
    expect(parsed).not.toBeNull()
    if (!parsed) return
    expect(parsed.id).toBe('w1')
    expect(parsed.brief).toEqual({ copy: { hook: 'h' } })
    expect(parsed.output).toEqual({ caption: 'c' })
  })
})

describe('loadOrders', () => {
  it('reports truncated and caps rows when the db returns CAP + 1', async () => {
    const rows = Array.from({ length: WEEKLY_LOOP_ORDER_CAP + 1 }, (_, i) =>
      orderRow({ id: `w${i}` }),
    )
    const state = baseState({ orders: rows })
    const deps = createWeeklyLoopDbDeps(makeDb(state))
    const result = await deps.loadOrders('c1')
    expect(result.truncated).toBe(true)
    expect(result.rows).toHaveLength(WEEKLY_LOOP_ORDER_CAP)
    expect(state.limits).toContain(WEEKLY_LOOP_ORDER_CAP + 1)
  })
})

describe('writeFactCheck', () => {
  it('sends only output and updated_at, with the right filters', async () => {
    const state = baseState({ updateRows: 1 })
    const deps = createWeeklyLoopDbDeps(makeDb(state))
    const outcome = await deps.writeFactCheck({
      clientId: 'c1',
      id: 'w1',
      readUpdatedAt: '2026-11-02T00:00:00Z',
      output: { fact_check: { verdict: 'pass' } },
    })
    expect(outcome).toBe('written')
    expect(state.updates).toHaveLength(1)
    const update = state.updates[0]
    expect(Object.keys(update.patch).sort()).toEqual(['output', 'updated_at'])
    expect(update.filters.id).toBe('w1')
    expect(update.filters.client_id).toBe('c1')
    expect(update.filters.updated_at).toBe('2026-11-02T00:00:00Z')
  })

  it('returns conflict when 0 rows come back', async () => {
    const state = baseState({ updateRows: 0 })
    const deps = createWeeklyLoopDbDeps(makeDb(state))
    const outcome = await deps.writeFactCheck({
      clientId: 'c1',
      id: 'w1',
      readUpdatedAt: '2026-11-02T00:00:00Z',
      output: { fact_check: { verdict: 'pass' } },
    })
    expect(outcome).toBe('conflict')
  })

  it('returns failed when the update errors', async () => {
    const state = baseState({ updateError: true })
    const deps = createWeeklyLoopDbDeps(makeDb(state))
    const outcome = await deps.writeFactCheck({
      clientId: 'c1',
      id: 'w1',
      readUpdatedAt: '2026-11-02T00:00:00Z',
      output: { fact_check: { verdict: 'pass' } },
    })
    expect(outcome).toBe('failed')
  })

  it('never sends review_ref or checklist_human', async () => {
    const state = baseState({ updateRows: 1 })
    const deps = createWeeklyLoopDbDeps(makeDb(state))
    await deps.writeFactCheck({
      clientId: 'c1',
      id: 'w1',
      readUpdatedAt: '2026-11-02T00:00:00Z',
      output: { fact_check: { verdict: 'pass' } },
    })
    expect(state.updates).toHaveLength(1)
    const update = state.updates[0]
    expect(Object.keys(update.patch)).not.toContain('review_ref')
    expect(JSON.stringify(update.patch)).not.toContain('checklist_human')
  })
})

describe('loadClient', () => {
  it('returns null when there is no row', async () => {
    const state = baseState({ clients: [] })
    const deps = createWeeklyLoopDbDeps(makeDb(state))
    const client = await deps.loadClient('c1')
    expect(client).toBeNull()
  })

  it('throws on read error', async () => {
    const state = baseState({ readError: true })
    const deps = createWeeklyLoopDbDeps(makeDb(state))
    await expect(deps.loadClient('c1')).rejects.toThrow('client_read_failed')
  })
})
