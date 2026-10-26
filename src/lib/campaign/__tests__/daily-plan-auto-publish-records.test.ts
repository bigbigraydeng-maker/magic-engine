import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { classifyAttempts, readAutoPublishRecords } from '../daily-plan-auto-publish-records'
import type { AttemptRecord } from '../daily-plan-auto-publish-worker-store'

function row(over: Partial<AttemptRecord>): AttemptRecord {
  return {
    id: 'a', auth_id: null, client_id: 'c', plan_id: 'p', date: '2026-10-12', attempt_no: 1,
    status: 'published', reason_code: null, request_id: 'r', provider_impact: 'FB_SCHEDULED',
    post_id: 'post-1', scheduled_publish_time: '2026-10-12T19:00:00Z', next_retry_at: null,
    ...over,
  } as AttemptRecord
}

describe('classifyAttempts', () => {
  it('published row whose post is not in the receipt → unrecorded post', () => {
    const out = classifyAttempts([row({})], new Set())
    expect(out.posts).toEqual([{ date: '2026-10-12', post_id: 'post-1', scheduled_publish_time: '2026-10-12T19:00:00Z' }])
    expect(out.unconfirmed).toEqual([])
  })
  it('published row already in the receipt → nothing', () => {
    expect(classifyAttempts([row({})], new Set(['post-1']))).toEqual({ posts: [], unconfirmed: [] })
  })
  it('claimed and unknown_outcome rows are unconfirmed; blocked/failed rows are neither', () => {
    const out = classifyAttempts(
      [row({ status: 'claimed', post_id: null, date: '2026-10-13' }), row({ status: 'unknown_outcome', post_id: null, date: '2026-10-14' }),
       row({ status: 'blocked', post_id: null, date: '2026-10-15' }), row({ status: 'failed_final', post_id: null, date: '2026-10-16' })],
      new Set(),
    )
    expect(out.unconfirmed).toEqual([{ date: '2026-10-13', status: 'claimed' }, { date: '2026-10-14', status: 'unknown_outcome' }])
    expect(out.posts).toEqual([])
  })
})

describe('readAutoPublishRecords', () => {
  const base = { planId: 'p', clientId: 'c', dates: ['2026-10-12'], receiptPostIds: new Set<string>() }
  it('returns the classified view with status OK', async () => {
    const out = await readAutoPublishRecords({ ...base, read: async () => [row({})] })
    expect(out.status).toBe('OK')
    expect(out.posts).toHaveLength(1)
  })
  it('🔴 a read failure is UNKNOWN, never an empty OK', async () => {
    const out = await readAutoPublishRecords({ ...base, read: async () => { throw new Error('boom') } })
    expect(out).toEqual({ status: 'UNKNOWN', posts: [], unconfirmed: [] })
  })
  it('a missing table (no unattended publisher here) is a checked empty OK', async () => {
    const out = await readAutoPublishRecords({ ...base, read: async () => { throw { code: '42P01', message: 'x' } } })
    expect(out).toEqual({ status: 'OK', posts: [], unconfirmed: [] })
  })
})
