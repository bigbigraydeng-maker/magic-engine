/**
 * `.delete().in('id', …)` goes in the request URL. A few thousand UUIDs blow past
 * the gateway limit (414/400). Query batches stay at PURGE_BATCH_SIZE; each DELETE
 * must stay at or under 100 ids.
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PURGE_BATCH_SIZE, purgeCronRunLogsBatched } from '../cron-run-logs-purge'

const DELETE_ID_CAP = 100
const NOW = new Date('2026-11-27T00:00:00.000Z')
const LATEST = '2099-01-01T00:00:00.000Z'

function ids(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}-${i}`)
}

function noiseRows(count: number) {
  return ids('noise', count).map((id, i) => ({
    id,
    job_name: 'job-a',
    started_at: new Date(Date.UTC(2020, 0, 1, 0, 0, i)).toISOString(),
    processed: 0,
    completed_count: 0,
    failed_count: 0,
  }))
}

interface BuilderState {
  op: 'select' | 'delete'
  columns: string
  eqJob: string | null
  head: boolean
}

function clientFor(rowCount: number) {
  const deleteIdBatches: string[][] = []
  const selectLimits: number[] = []
  let noiseReads = 0
  let expiredReads = 0

  function answer(state: BuilderState) {
    if (state.op === 'delete') return { error: null }
    if (state.eqJob) return { data: [{ started_at: LATEST }], error: null }
    if (state.columns.includes('job_name')) {
      noiseReads += 1
      return { data: noiseReads === 1 ? noiseRows(rowCount) : [], error: null }
    }
    if (state.columns === 'id') {
      expiredReads += 1
      const data = expiredReads === 1 ? ids('expired', rowCount).map((id) => ({ id })) : []
      return { data, error: null }
    }
    if (state.head) return { count: 0, error: null, data: null }
    return { data: [{ started_at: '2026-06-01T00:00:00.000Z' }], error: null }
  }

  function from() {
    const state: BuilderState = { op: 'select', columns: '', eqJob: null, head: false }
    const builder: Record<string, unknown> = {
      select(columns: string, options?: { head?: boolean }) {
        state.columns = columns
        state.head = options?.head === true
        return builder
      },
      delete() {
        state.op = 'delete'
        return builder
      },
      eq(column: string, value: string) {
        if (column === 'job_name') state.eqJob = value
        return builder
      },
      in(column: string, values: string[]) {
        if (state.op === 'delete' && column === 'id') deleteIdBatches.push([...values])
        return builder
      },
      limit(n: number) {
        const isPurgeRead = state.columns === 'id' || state.columns.includes('job_name')
        if (state.op === 'select' && isPurgeRead) selectLimits.push(n)
        return builder
      },
      lt() { return builder },
      gt() { return builder },
      is() { return builder },
      order() { return builder },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(answer(state)).then(resolve, reject)
      },
    }
    return builder
  }

  return {
    supabase: { from } as unknown as SupabaseClient,
    deleteIdBatches,
    selectLimits,
  }
}

describe('purgeCronRunLogsBatched delete id chunks', () => {
  it('keeps the 3000-row read and never puts more than 100 ids in one delete', async () => {
    const rowCount = 250
    const db = clientFor(rowCount)

    const result = await purgeCronRunLogsBatched(db.supabase, { now: NOW })

    expect(result.purged_noise).toBe(rowCount)
    expect(result.purged_expired).toBe(rowCount)
    expect(db.selectLimits.length).toBeGreaterThan(0)
    expect(db.selectLimits.every((n) => n === PURGE_BATCH_SIZE)).toBe(true)
    expect(db.deleteIdBatches.length).toBeGreaterThan(2)
    expect(db.deleteIdBatches.every((batch) => batch.length > 0 && batch.length <= DELETE_ID_CAP)).toBe(true)
    expect(db.deleteIdBatches.some((batch) => batch.length === DELETE_ID_CAP)).toBe(true)
    expect(db.deleteIdBatches.reduce((sum, batch) => sum + batch.length, 0)).toBe(rowCount * 2)
  })
})
