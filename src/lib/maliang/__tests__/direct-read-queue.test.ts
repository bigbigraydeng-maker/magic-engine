import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  applyDirectReadFailure,
  orderDirectReadQueue,
  readDirectReadRecord,
  recordDirectReadFailure,
} from '../direct-read-queue'

const at = (iso: string) => new Date(iso)

describe('orderDirectReadQueue', () => {
  it('puts an order that just failed to read behind one that has not been tried', () => {
    const failed = applyDirectReadFailure(
      { video_path: 'a.mp4' },
      'video_url_mismatch',
      at('2026-11-20T00:20:00.000Z'),
    ).output
    const ranked = orderDirectReadQueue([
      { id: 'head', created_at: '2026-11-01T00:00:00.000Z', output: failed },
      { id: 'next', created_at: '2026-11-02T00:00:00.000Z', output: { video_path: 'b.mp4' } },
    ])
    expect(ranked.map((row) => row.id)).toEqual(['next', 'head'])
  })

  it('keeps an earlier failure ahead of the order that was just moved back', () => {
    const older = applyDirectReadFailure({ video_path: 'a.mp4' }, 'video_url_mismatch', at('2026-11-20T00:00:00.000Z')).output
    const newer = applyDirectReadFailure({ video_path: 'b.mp4' }, 'client_not_found', at('2026-11-20T01:00:00.000Z')).output
    const ranked = orderDirectReadQueue([
      { id: 'newer', created_at: '2026-11-01T00:00:00.000Z', output: newer },
      { id: 'older', created_at: '2026-11-03T00:00:00.000Z', output: older },
      { id: 'fresh', created_at: '2026-11-02T00:00:00.000Z', output: { video_path: 'c.mp4' } },
    ])
    expect(ranked.map((row) => row.id)).toEqual(['fresh', 'older', 'newer'])
  })

  it('drops the order after three failed reads and does not write a review verdict', () => {
    let output: unknown = { video_path: 'a.mp4', caption: 'keep' }
    for (const iso of ['2026-11-20T00:00:00.000Z', '2026-11-20T00:20:00.000Z', '2026-11-20T00:40:00.000Z']) {
      output = applyDirectReadFailure(output, 'video_url_mismatch', at(iso)).output
    }
    const record = readDirectReadRecord(output)
    expect(record).toMatchObject({ attempts: 3, skipped: true, last_reason: 'video_url_mismatch' })
    expect(output).toMatchObject({ video_path: 'a.mp4', caption: 'keep' })
    expect(output).not.toHaveProperty('maliang_check')
    const ranked = orderDirectReadQueue([
      { id: 'stuck', created_at: '2026-11-01T00:00:00.000Z', output },
      { id: 'next', created_at: '2026-11-02T00:00:00.000Z', output: { video_path: 'b.mp4' } },
    ])
    expect(ranked.map((row) => row.id)).toEqual(['next'])
  })
})

describe('recordDirectReadFailure', () => {
  function memory(status = 'in_review', output: unknown = { video_path: 'a.mp4' }) {
    const row = { status, output }
    const updates: unknown[] = []
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { status: row.status, output: row.output }, error: null }),
          }),
        }),
        update: (payload: { output: unknown }) => ({
          eq: () => ({
            eq: async () => {
              updates.push(payload)
              row.output = payload.output
              return { error: null }
            },
          }),
        }),
      }),
    }
    return { client: client as unknown as SupabaseClient, row, updates }
  }

  it('bumps the attempt on the stored output and stops writing once skipped', async () => {
    const db = memory()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const first = await recordDirectReadFailure(db.client, 'wo-1', 'video_url_mismatch', at('2026-11-20T00:00:00.000Z'))
    const second = await recordDirectReadFailure(db.client, 'wo-1', 'video_url_mismatch', at('2026-11-20T00:20:00.000Z'))
    const third = await recordDirectReadFailure(db.client, 'wo-1', 'video_url_mismatch', at('2026-11-20T00:40:00.000Z'))
    const fourth = await recordDirectReadFailure(db.client, 'wo-1', 'video_url_mismatch', at('2026-11-20T01:00:00.000Z'))
    expect(first).toMatchObject({ attempts: 1, skipped: false })
    expect(second).toMatchObject({ attempts: 2, skipped: false })
    expect(third).toMatchObject({ attempts: 3, skipped: true, attempted_at: '2026-11-20T00:40:00.000Z' })
    expect(fourth).toEqual(third)
    expect(db.updates).toHaveLength(3)
    expect(db.row.output).toMatchObject({ video_path: 'a.mp4' })
    expect(db.row.output).not.toHaveProperty('maliang_check')
    warn.mockRestore()
  })

  it('does not touch an order that already has a verdict', async () => {
    const db = memory('in_review', { video_path: 'a.mp4', maliang_check: { status: 'pass' } })
    const saved = await recordDirectReadFailure(db.client, 'wo-1', 'video_url_mismatch', at('2026-11-20T00:00:00.000Z'))
    expect(saved).toBeNull()
    expect(db.updates).toHaveLength(0)
  })
})
