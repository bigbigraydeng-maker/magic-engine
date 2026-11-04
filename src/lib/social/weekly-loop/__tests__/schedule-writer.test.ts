import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { writeReelSchedule } from '../schedule-writer'

interface Card {
  id: string
  status: string
  input: { subject_key: string }
}

interface TrafficRow {
  id: string
  payload: Record<string, unknown>
}

interface RecordedUpdate {
  table: string
  patch: Record<string, unknown>
  filters: Record<string, unknown>
}

interface FakeState {
  cards: Card[]
  orders: Record<string, Record<string, unknown>>
  traffic: TrafficRow[]
  cardError?: boolean
  updateRows?: number
  updates: RecordedUpdate[]
}

type BuilderMode = 'select' | 'update'

interface Builder {
  select: (cols?: string) => Builder
  eq: (col: string, val: unknown) => Builder
  in: (col: string, vals: unknown[]) => Builder
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
    let inList: unknown[] | null = null

    function resolve(): { data: unknown; error: unknown } {
      if (table === 'action_runs') {
        if (state.cardError) return { data: null, error: { message: 'boom' } }
        const subject = filters['input->>subject_key']
        const statuses = inList ?? []
        const data = state.cards.filter(
          (c) => statuses.includes(c.status) && c.input.subject_key === subject,
        )
        return { data, error: null }
      }
      if (table === 'content_work_orders') {
        if (mode === 'update') {
          state.updates.push({ table, patch, filters: { ...filters } })
          const count = state.updateRows ?? 1
          const data = Array.from({ length: count }, () => ({ id: 'x' }))
          return { data, error: null }
        }
        const id = filters['id']
        const row = typeof id === 'string' ? state.orders[id] : undefined
        return { data: row ?? null, error: null }
      }
      if (table === 'flywheel_actions') {
        return { data: state.traffic, error: null }
      }
      return { data: null, error: null }
    }

    const builder: Builder = {
      select: () => builder,
      eq: (col, val) => {
        filters[col] = val
        return builder
      },
      in: (_col, vals) => {
        inList = vals
        return builder
      },
      update: (p) => {
        mode = 'update'
        patch = p
        return builder
      },
      maybeSingle: () => Promise.resolve(resolve()),
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

function order(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'w1',
    client_id: 'c1',
    status: 'approved',
    brief: { copy: { hook: 'h' }, weekly_pack: { other: 'keep' } },
    review_ref: { approved_at: '2026-11-01T00:00:00Z' },
    published_ref: { video_state: 'DRAFT' },
    updated_at: '2026-11-02T00:00:00Z',
    ...overrides,
  }
}

function baseState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    cards: [],
    orders: { w1: order() },
    traffic: [],
    updates: [],
    ...overrides,
  }
}

const ARGS = {
  clientId: 'c1',
  weekStart: '2026-11-09',
  assignments: [{ id: 'w1', publishOn: '2026-11-09' }],
  dryRun: false,
}

describe('writeReelSchedule', () => {
  it('writes the schedule on success', async () => {
    const state = baseState()
    const db = makeDb(state)
    const result = await writeReelSchedule(db, ARGS)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.written).toEqual([{ id: 'w1', publishOn: '2026-11-09' }])
    expect(state.updates).toHaveLength(1)
    const update = state.updates[0]
    const brief = update.patch.brief as Record<string, unknown>
    const copy = brief.copy as Record<string, unknown>
    const weekly = brief.weekly_pack as Record<string, unknown>
    expect(copy.hook).toBe('h')
    expect(weekly.other).toBe('keep')
    expect(weekly.publish_on).toBe('2026-11-09')
    expect(weekly.scheduled_by).toBe('social-weekly-loop')
    expect(typeof weekly.scheduled_at).toBe('string')
    expect(update.filters.id).toBe('w1')
    expect(update.filters.client_id).toBe('c1')
    expect(update.filters.updated_at).toBe('2026-11-02T00:00:00Z')
  })

  it('skips on client mismatch', async () => {
    const state = baseState({ orders: { w1: order({ client_id: 'other' }) } })
    const result = await writeReelSchedule(makeDb(state), ARGS)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.skipped).toEqual([{ id: 'w1', reason: 'client_mismatch' }])
    expect(state.updates).toHaveLength(0)
  })

  it('skips when already public', async () => {
    const state = baseState({
      orders: { w1: order({ published_ref: { video_state: 'PUBLISHED' } }) },
    })
    const result = await writeReelSchedule(makeDb(state), ARGS)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.skipped).toEqual([{ id: 'w1', reason: 'already_public' }])
    expect(state.updates).toHaveLength(0)
  })

  it('skips when a promote record exists', async () => {
    const previewState = baseState({
      traffic: [{ id: 't1', payload: { promote_preview: { reel: { used: false } } } }],
    })
    const previewResult = await writeReelSchedule(makeDb(previewState), ARGS)
    expect(previewResult.ok).toBe(true)
    if (previewResult.ok) {
      expect(previewResult.skipped).toEqual([{ id: 'w1', reason: 'promote_record_exists' }])
    }

    const authState = baseState({
      traffic: [{ id: 't2', payload: { promote_authorization: { status: 'claimed' } } }],
    })
    const authResult = await writeReelSchedule(makeDb(authState), ARGS)
    expect(authResult.ok).toBe(true)
    if (authResult.ok) {
      expect(authResult.skipped).toEqual([{ id: 'w1', reason: 'promote_record_exists' }])
    }

    const emptyState = baseState({
      traffic: [{ id: 't3', payload: { promote_preview: {} } }],
    })
    const emptyResult = await writeReelSchedule(makeDb(emptyState), ARGS)
    expect(emptyResult.ok).toBe(true)
    if (emptyResult.ok) {
      expect(emptyResult.written).toEqual([{ id: 'w1', publishOn: '2026-11-09' }])
    }
  })

  it('requires review-passed draft', async () => {
    const blocked = baseState({
      orders: {
        w1: order({ status: 'draft', published_ref: { video_state: 'DRAFT' }, review_ref: {} }),
      },
    })
    const blockedResult = await writeReelSchedule(makeDb(blocked), ARGS)
    expect(blockedResult.ok).toBe(true)
    if (blockedResult.ok) {
      expect(blockedResult.skipped).toEqual([{ id: 'w1', reason: 'not_review_passed_draft' }])
    }

    const allowed = baseState({
      orders: {
        w1: order({
          status: 'draft',
          published_ref: { video_state: 'DRAFT' },
          review_ref: { approved_at: '2026-11-01T00:00:00Z' },
        }),
      },
    })
    const allowedResult = await writeReelSchedule(makeDb(allowed), ARGS)
    expect(allowedResult.ok).toBe(true)
    if (allowedResult.ok) {
      expect(allowedResult.written).toEqual([{ id: 'w1', publishOn: '2026-11-09' }])
    }
  })

  it('never overwrites an existing publish_on', async () => {
    const different = baseState({
      orders: {
        w1: order({ brief: { copy: { hook: 'h' }, weekly_pack: { publish_on: '2026-11-10' } } }),
      },
    })
    const differentResult = await writeReelSchedule(makeDb(different), ARGS)
    expect(differentResult.ok).toBe(true)
    if (differentResult.ok) {
      expect(differentResult.skipped).toEqual([{ id: 'w1', reason: 'already_scheduled' }])
    }
    expect(different.updates).toHaveLength(0)

    const same = baseState({
      orders: {
        w1: order({ brief: { copy: { hook: 'h' }, weekly_pack: { publish_on: '2026-11-09' } } }),
      },
    })
    const sameResult = await writeReelSchedule(makeDb(same), ARGS)
    expect(sameResult.ok).toBe(true)
    if (sameResult.ok) {
      expect(sameResult.skipped).toEqual([{ id: 'w1', reason: 'already_scheduled' }])
    }
    expect(same.updates).toHaveLength(0)
  })

  it('reports concurrent_update when the optimistic lock misses', async () => {
    const state = baseState({ updateRows: 0 })
    const result = await writeReelSchedule(makeDb(state), ARGS)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.written).toEqual([])
    expect(result.skipped).toEqual([{ id: 'w1', reason: 'concurrent_update' }])
  })

  it('fails closed when a week card is open', async () => {
    const pending = baseState({
      cards: [
        { id: 'a1', status: 'pending_approval', input: { subject_key: 'social:week-pack:c1:2026-11-09' } },
      ],
    })
    const pendingResult = await writeReelSchedule(makeDb(pending), ARGS)
    expect(pendingResult).toEqual({ ok: false, reason: 'card_open' })
    expect(pending.updates).toHaveLength(0)

    const authorized = baseState({
      cards: [
        { id: 'a2', status: 'authorized', input: { subject_key: 'social:week-pack:c1:2026-11-09' } },
      ],
    })
    const authorizedResult = await writeReelSchedule(makeDb(authorized), ARGS)
    expect(authorizedResult).toEqual({ ok: false, reason: 'card_open' })
    expect(authorized.updates).toHaveLength(0)

    const otherWeek = baseState({
      cards: [
        { id: 'a3', status: 'pending_approval', input: { subject_key: 'social:week-pack:c1:2026-11-16' } },
      ],
    })
    const otherWeekResult = await writeReelSchedule(makeDb(otherWeek), ARGS)
    expect(otherWeekResult.ok).toBe(true)

    const denied = baseState({
      cards: [
        { id: 'a4', status: 'denied', input: { subject_key: 'social:week-pack:c1:2026-11-09' } },
      ],
    })
    const deniedResult = await writeReelSchedule(makeDb(denied), ARGS)
    expect(deniedResult.ok).toBe(true)
  })

  it('blockOnlyPending: an approved card no longer blocks, a card under review still does; scheduled_by is stamped', async () => {
    const authorized = baseState({
      cards: [{ id: 'a2', status: 'authorized', input: { subject_key: 'social:week-pack:c1:2026-11-09' } }],
    })
    const r = await writeReelSchedule(makeDb(authorized), { ...ARGS, blockOnlyPending: true, scheduledBy: 'social-daily-agent' })
    expect(r.ok).toBe(true)
    expect(authorized.updates).toHaveLength(1)
    const brief = authorized.updates[0].patch.brief as { weekly_pack: { scheduled_by: string } }
    expect(brief.weekly_pack.scheduled_by).toBe('social-daily-agent')

    const pending = baseState({
      cards: [{ id: 'a1', status: 'pending_approval', input: { subject_key: 'social:week-pack:c1:2026-11-09' } }],
    })
    expect(await writeReelSchedule(makeDb(pending), { ...ARGS, blockOnlyPending: true })).toEqual({ ok: false, reason: 'card_open' })
  })

  it('fails closed when the card check errors', async () => {
    const state = baseState({ cardError: true })
    const result = await writeReelSchedule(makeDb(state), ARGS)
    expect(result).toEqual({ ok: false, reason: 'card_check_failed' })
    expect(state.updates).toHaveLength(0)
  })

  it('does not write in dryRun mode', async () => {
    const state = baseState()
    const result = await writeReelSchedule(makeDb(state), { ...ARGS, dryRun: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.dryRun).toBe(true)
    expect(result.written).toEqual([{ id: 'w1', publishOn: '2026-11-09' }])
    expect(state.updates).toHaveLength(0)
  })

  it('skips missing orders', async () => {
    const state = baseState()
    const result = await writeReelSchedule(makeDb(state), {
      ...ARGS,
      assignments: [{ id: 'missing', publishOn: '2026-11-09' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.skipped).toEqual([{ id: 'missing', reason: 'not_found' }])
  })
})
