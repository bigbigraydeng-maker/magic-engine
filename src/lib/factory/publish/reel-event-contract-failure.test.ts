/**
 * Contract-failure reasons stay field names. A repeated failure writes once.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ZodError } from 'zod'
import { SOCIAL_READBACK_OUTCOME_ENV } from '@/lib/social/readback-outcome-record'
import { buildReelPublishedEvent } from './reel-published-event'
import {
  contractFailureReason,
  reasonFromZod,
  recordReelContractFailure,
} from './reel-event-contract-failure'

const CLIENT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const WORK = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'

afterEach(() => {
  delete process.env[SOCIAL_READBACK_OUTCOME_ENV]
})

function fake(existing: unknown[] | { message: string }, insertError?: string) {
  const inserts: Array<Record<string, unknown>> = []
  const from = () => {
    const api = {
      select: () => api,
      eq: () => api,
      limit: async () => (
        Array.isArray(existing)
          ? { data: existing, error: null }
          : { data: null, error: existing }
      ),
      insert: (row: Record<string, unknown>) => {
        inserts.push(row)
        const done = insertError ? { error: { message: insertError } } : { error: null }
        return { then: (resolve: (value: unknown) => unknown) => Promise.resolve(done).then(resolve) }
      },
    }
    return api
  }
  return { supabase: { from } as unknown as SupabaseClient, inserts }
}

describe('reel event contract failure', () => {
  it('keeps the field name and drops a long number', () => {
    expect(contractFailureReason('page_id')).toBe('page_id')
    expect(contractFailureReason('1234567890123456')).toBe('unreadable_field')
    expect(contractFailureReason('page_id=not-a-page')).toBe('page_idnotapage')
  })

  it('a schema error names page_id and does not keep the bad value', () => {
    let caught: unknown
    try {
      buildReelPublishedEvent({
        workOrderId: WORK,
        clientId: CLIENT,
        pageId: 'not-a-page',
        videoId: '12345',
        publishedAt: '2026-11-02T07:00:00.000Z',
        requestId: CLIENT,
        createdAt: '2026-11-02T07:00:00.000Z',
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ZodError)
    const reason = reasonFromZod(caught as ZodError)
    expect(reason).toBe('page_id')
    expect(reason).not.toContain('not-a-page')
  })

  it('writes one row, then skips the same work order', async () => {
    process.env[SOCIAL_READBACK_OUTCOME_ENV] = 'true'
    const first = fake([])
    await recordReelContractFailure(first.supabase, { clientId: CLIENT, workOrderId: WORK, reason: 'page_id' })
    expect(first.inserts).toHaveLength(1)
    expect(first.inserts[0]).toMatchObject({
      job_name: 'social-readback-outcome',
      status: 'failed',
      summary: {
        outcome: 'reel_event_contract_invalid',
        reason: 'page_id',
        subject_kind: 'reel',
        subject_ref: WORK,
      },
    })

    const second = fake([{ id: 'already' }])
    await recordReelContractFailure(second.supabase, { clientId: CLIENT, workOrderId: WORK, reason: 'page_id' })
    expect(second.inserts).toHaveLength(0)
  })

  it('a lookup error still writes, and a write error does not throw', async () => {
    process.env[SOCIAL_READBACK_OUTCOME_ENV] = 'true'
    const brokenLookup = fake({ message: 'down' })
    await recordReelContractFailure(brokenLookup.supabase, { clientId: CLIENT, workOrderId: WORK, reason: 'video_id' })
    expect(brokenLookup.inserts).toHaveLength(1)

    const exploding = fake([], 'insert down')
    await expect(recordReelContractFailure(exploding.supabase, {
      clientId: CLIENT,
      workOrderId: WORK,
      reason: 'video_id',
    })).resolves.toBeUndefined()
  })

  it('stays quiet when the switch is not exactly true', async () => {
    const store = fake([])
    await recordReelContractFailure(store.supabase, { clientId: CLIENT, workOrderId: WORK, reason: 'page_id' })
    expect(store.inserts).toHaveLength(0)
  })
})
