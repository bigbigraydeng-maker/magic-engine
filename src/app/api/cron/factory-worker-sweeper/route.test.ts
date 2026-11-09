import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ from: vi.fn(), startCronRun: vi.fn(), finish: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))
vi.mock('@/lib/cron/run-logger', () => ({ startCronRun: mocks.startCronRun }))
import { GET } from './route'

const now = new Date('2026-09-08T10:00:00Z')
type Row = Record<string, string | number | null>
function database(refreshHeartbeat: boolean) {
  const row: Row = {
    id: 'order-1', status: 'producing', created_at: '2026-09-07T00:00:00Z',
    heartbeat_at: '2026-09-08T09:00:00Z', claimed_by: 'local-worker',
    claimed_at: '2026-09-08T08:00:00Z', reclaim_count: 1, attempt_count: 1,
    reject_reason: 'previous retryable error',
  }
  const updates: Row[] = []
  mocks.from.mockImplementation(() => {
    const filters: Array<(r: Row) => boolean> = []
    let patch: Row | undefined
    let singleton = false
    const query = {
      select: () => query,
      update: (value: Row) => { patch = value; updates.push(value); return query },
      eq: (key: string, value: unknown) => { filters.push(r => r[key] === value); return query },
      in: (key: string, values: unknown[]) => { filters.push(r => values.includes(r[key])); return query },
      lt: (key: string, value: string) => { filters.push(r => r[key] !== null && String(r[key]) < value); return query },
      not: (key: string, _op: string, value: unknown) => { filters.push(r => r[key] !== value); return query },
      order: () => query, limit: () => query,
      maybeSingle: () => { singleton = true; return query },
      then: (resolve: (result: unknown) => unknown) => {
        const matched = filters.every(f => f(row))
        if (patch && matched) Object.assign(row, patch)
        const data = matched ? [{ ...row }] : []
        if (!patch && refreshHeartbeat) row.heartbeat_at = now.toISOString()
        return resolve({ data: singleton ? data[0] ?? null : data, count: data.length, error: null })
      },
    }
    return query
  })
  return { row, updates }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks() })

function allowRunLog() {
  mocks.finish.mockResolvedValue(undefined)
  mocks.startCronRun.mockResolvedValue({ finish: mocks.finish })
}

describe('factory sweeper recovery', () => {
  it.each([false, true])('clears old failure only when stale recovery wins (heartbeat race=%s)', async race => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    vi.stubEnv('CRON_SECRET', 'local-test')
    allowRunLog()
    const db = database(race)
    const response = await GET(new NextRequest('http://localhost/api/cron/factory-worker-sweeper', {
      headers: { authorization: 'Bearer local-test' },
    }))
    expect(response.status).toBe(200)
    expect((await response.json()).reclaimed).toEqual(race ? [] : ['order-1'])
    expect(db.updates[0]).toMatchObject({ status: 'queued', reject_reason: null, claimed_by: null, heartbeat_at: null })
    expect(db.updates[0]).not.toHaveProperty('attempt_count')
    expect(db.row.attempt_count).toBe(1)
    expect(db.row.reject_reason).toBe(race ? 'previous retryable error' : null)
    expect(db.row.status).toBe(race ? 'producing' : 'queued')
    expect(db.row.reclaim_count).toBe(race ? 1 : 2)
    expect(mocks.startCronRun).toHaveBeenCalledWith('factory-worker-sweeper')
    expect(mocks.finish).toHaveBeenCalledWith(expect.objectContaining({
      processed: race ? 0 : 1,
      completed: race ? 0 : 1,
      failed: 0,
    }))
  })

  it('rejects an unauthorized request without querying or updating orders', async () => {
    vi.stubEnv('CRON_SECRET', 'local-test')
    allowRunLog()
    const response = await GET(new NextRequest('http://localhost/api/cron/factory-worker-sweeper'))
    expect(response.status).toBe(401)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.startCronRun).not.toHaveBeenCalled()
  })
})
