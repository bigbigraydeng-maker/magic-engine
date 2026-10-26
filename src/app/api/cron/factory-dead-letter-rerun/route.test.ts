import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type Row = {
  id: string
  client_id: string
  status: string
  reject_reason: string | null
  review_ref: unknown
  brief: unknown
  reclaim_count: number | null
}

const db = vi.hoisted(() => ({
  rows: [] as Row[],
  listError: null as { message: string } | null,
  updateError: null as { message: string } | null,
  updates: [] as unknown[],
  vanishOnRead: false,
}))

const mocks = vi.hoisted(() => ({
  finish: vi.fn(),
  startCronRun: vi.fn(),
}))

vi.mock('@/lib/cron/run-logger', () => ({ startCronRun: mocks.startCronRun }))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => {
      const filters: Array<(row: Row) => boolean> = []
      let patch: Record<string, unknown> | null = null
      let window: [number, number] | null = null
      const query = {
        select: () => query,
        update: (value: Record<string, unknown>) => {
          patch = value
          db.updates.push(value)
          return query
        },
        eq: (key: string, value: unknown) => {
          filters.push((row) => row[key as keyof Row] === value)
          return query
        },
        order: () => query,
        range: (from: number, to: number) => {
          window = [from, to]
          return query
        },
        maybeSingle: async () => {
          const found = db.rows.find((row) => filters.every((filter) => filter(row)))
          if (db.vanishOnRead && found) found.status = 'queued'
          return { data: found ? { review_ref: found.review_ref } : null, error: null }
        },
        then: (resolve: (value: unknown) => unknown) => {
          if (patch) {
            if (db.updateError) return resolve({ data: null, error: db.updateError })
            const matched = db.rows.filter((row) => filters.every((filter) => filter(row)))
            for (const row of matched) Object.assign(row, patch)
            return resolve({ data: matched.map((row) => ({ id: row.id })), error: null })
          }
          if (db.listError) return resolve({ data: null, error: db.listError })
          const found = db.rows.filter((row) => filters.every((filter) => filter(row)))
          return resolve({ data: window ? found.slice(window[0], window[1] + 1) : found, error: null })
        },
      }
      return query
    },
  },
}))

import { GET } from './route'

function request(secret?: string, dryRun = false) {
  const url = `http://localhost/api/cron/factory-dead-letter-rerun${dryRun ? '?dry_run=1' : ''}`
  return new NextRequest(url, { headers: secret === undefined ? {} : { authorization: `Bearer ${secret}` } })
}

function missingFile(id = 'order-1'): Row {
  return {
    id,
    client_id: 'client-1',
    status: 'dead_letter',
    reject_reason: 'ENOENT missing local file',
    review_ref: null,
    brief: null,
    reclaim_count: 0,
  }
}

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'local-test')
  mocks.startCronRun.mockResolvedValue({ finish: mocks.finish })
  db.rows = []
  db.listError = null
  db.updateError = null
  db.updates = []
  db.vanishOnRead = false
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('factory-dead-letter-rerun', () => {
  it('rejects a missing secret without reading work orders', async () => {
    db.rows = [missingFile()]
    const response = await GET(request())
    expect(response.status).toBe(401)
    expect(mocks.startCronRun).not.toHaveBeenCalled()
    expect(db.updates).toEqual([])
    expect(db.rows[0]?.status).toBe('dead_letter')
  })

  it('dry_run plans a rerun and writes nothing', async () => {
    db.rows = [missingFile()]
    const response = await GET(request('local-test', true))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, dryRun: true, planned: 1, rerun: 0 })
    expect(db.updates).toEqual([])
    expect(mocks.finish).toHaveBeenCalledWith(expect.objectContaining({ completed: 0, failed: 0 }))
  })

  it('a real rerun queues the work order and keeps the previous review note', async () => {
    db.rows = [missingFile()]
    db.rows[0]!.review_ref = { reviewer: 'kept' }
    const response = await GET(request('local-test'))
    expect(response.status).toBe(200)
    expect(db.rows[0]).toMatchObject({
      status: 'queued',
      attempt_count: 0,
      reclaim_count: 1,
      reject_reason: null,
      review_ref: {
        reviewer: 'kept',
        auto_rerun_count: 1,
        revived_by: 'factory-dead-letter-rerun',
      },
    })
  })

  it('does not rerun a held work order or a file that is too large', async () => {
    db.rows = [
      missingFile('90506421-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
      { ...missingFile('too-big'), reject_reason: '413 Payload Too Large' },
    ]
    const response = await GET(request('local-test'))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ held: 1, escalated: 1, rerun: 0 })
    expect(db.updates).toEqual([])
    expect(db.rows.every((row) => row.status === 'dead_letter')).toBe(true)
  })

  it('reaches a rerunnable work order behind 100 report-only ones', async () => {
    const blocked = Array.from({ length: 100 }, (_, i) => ({
      ...missingFile(`a-${String(i).padStart(3, '0')}`),
      reject_reason: '413 Payload Too Large',
    }))
    db.rows = [...blocked, missingFile('z-last')]
    const response = await GET(request('local-test'))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ processed: 101, escalated: 100, rerun: 1 })
    expect(db.rows.find((row) => row.id === 'z-last')?.status).toBe('queued')
  })

  it('an unreadable failure is HTTP 500 and is not written as success', async () => {
    db.rows = [{ ...missingFile(), reject_reason: null }]
    const response = await GET(request('local-test'))
    const body = await response.json()
    expect(response.status).toBe(500)
    expect(body.ok).toBe(false)
    expect(body.reason).toBe('读不到')
    expect(db.updates).toEqual([])
  })

  it('a write that matches nothing is not success', async () => {
    db.rows = [missingFile()]
    db.vanishOnRead = true
    const response = await GET(request('local-test'))
    const body = await response.json()
    expect(response.status).toBe(500)
    expect(body.reason).toBe('work order no longer in dead_letter')
    expect(body.ok).toBe(false)
  })

  it('a blank database error is written as unreadable', async () => {
    db.listError = { message: '   ' }
    const response = await GET(request('local-test'))
    const body = await response.json()
    expect(response.status).toBe(500)
    expect(body.reason).toBe('读不到')
  })
})
