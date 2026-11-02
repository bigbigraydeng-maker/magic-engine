import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  SOCIAL_VERIFICATION_VERDICTS_ENV,
  insertSocialVerificationVerdict,
  readEarliestSocialVerificationVerdict,
  socialVerificationRequestId,
  socialVerificationVerdictsEnabled,
  type VerdictInsertInput,
} from '@/lib/social/verification-verdicts'
import { uuidVersion5, VERDICT_REQUEST_NAMESPACE } from '@/lib/social/verification-verdict-id'

const CLIENT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const ACTION = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const REQUEST = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
function verdictEnv(value: string | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'test' }
  env[SOCIAL_VERIFICATION_VERDICTS_ENV] = value
  return env
}

const ON = verdictEnv('true')

function input(overrides: Partial<VerdictInsertInput> = {}): VerdictInsertInput {
  return {
    requestId: REQUEST,
    clientId: CLIENT,
    recordType: 'boost_check',
    contentActionId: ACTION,
    periodKey: null,
    platform: 'facebook',
    verdict: 'boosted',
    readPoint: 't72',
    windowHours: null,
    boostStatus: 'boosted',
    sampleSize: null,
    observedValue: null,
    evidenceReceiptIds: ['dddddddd-dddd-4ddd-8ddd-ddddddddddd1'],
    evidenceVerdictIds: [],
    cohortDefinition: null,
    baselineValue: null,
    notComparableReasons: null,
    reason: null,
    logicVersion: 'wp1.v1',
    subjectKind: 'post',
    subjectRef: 'fixture-subject',
    ...overrides,
  }
}

interface Calls {
  verdictInserts: Record<string, unknown>[]
  updates: number
  deletes: number
  outcomes: Record<string, unknown>[]
  fromCalls: number
  order: { column: string; ascending: boolean } | null
  limit: number | null
}

function verdictClient(options: {
  insertError?: { code: string; message: string } | null
  existing?: Record<string, unknown> | null
  outcomeError?: { message: string } | null
  rows?: Record<string, unknown>[]
}): { supabase: SupabaseClient; calls: Calls } {
  const calls: Calls = {
    verdictInserts: [],
    updates: 0,
    deletes: 0,
    outcomes: [],
    fromCalls: 0,
    order: null,
    limit: null,
  }
  const rows = options.rows ?? []
  const supabase = {
    from(table: string) {
      calls.fromCalls += 1
      if (table === 'cron_run_logs') {
        return {
          insert: (row: Record<string, unknown>) => {
            calls.outcomes.push(row)
            return Promise.resolve({ error: options.outcomeError ?? null })
          },
        }
      }
      if (table !== 'social_verification_verdicts') throw new Error(`unexpected table ${table}`)
      let filtered = rows
      const chain = {
        eq(column: string, value: unknown) {
          filtered = filtered.filter((row) => row[column] === value)
          return chain
        },
        order(column: string, order: { ascending?: boolean }) {
          calls.order = { column, ascending: order.ascending !== false }
          const direction = calls.order.ascending ? 1 : -1
          filtered = [...filtered].sort((left, right) => {
            const a = String(left[column] ?? '')
            const b = String(right[column] ?? '')
            return a < b ? -direction : a > b ? direction : 0
          })
          return chain
        },
        limit(count: number) {
          calls.limit = count
          filtered = filtered.slice(0, count)
          return chain
        },
        maybeSingle: () => Promise.resolve({ data: options.existing ?? null, error: null }),
        then: (
          resolve: (value: { data: Record<string, unknown>[]; error: null }) => void,
          reject?: (reason: unknown) => void,
        ) => Promise.resolve({ data: filtered, error: null }).then(resolve, reject),
      }
      return {
        insert: (row: Record<string, unknown>) => {
          calls.verdictInserts.push(row)
          return Promise.resolve({ error: options.insertError ?? null })
        },
        update: () => {
          calls.updates += 1
          return Promise.resolve({ error: null })
        },
        delete: () => {
          calls.deletes += 1
          return Promise.resolve({ error: null })
        },
        select: () => chain,
      }
    },
  }
  return { supabase: supabase as unknown as SupabaseClient, calls }
}

describe('socialVerificationVerdictsEnabled', () => {
  it('accepts only the exact string true', () => {
    expect(socialVerificationVerdictsEnabled(ON)).toBe(true)
    for (const value of [undefined, '', '1', 'TRUE', 'True', 'yes', 'false']) {
      expect(socialVerificationVerdictsEnabled(verdictEnv(value))).toBe(false)
    }
  })
})

describe('socialVerificationRequestId', () => {
  it('matches uuid v5 of event id and record type', () => {
    expect(uuidVersion5(VERDICT_REQUEST_NAMESPACE, 'http://example.com')).toBe(
      '8c9ddcb0-8084-5a7f-a988-1095ab18b5df',
    )
    expect(socialVerificationRequestId('evt-1', 'boost_check')).toBe(
      '50544971-a0aa-55e9-a3ca-b8618e3e140b',
    )
    expect(socialVerificationRequestId('evt-1', 'story_dm_count')).toBe(
      '3d50f633-482c-5890-8467-0e98a918e9ba',
    )
    expect(socialVerificationRequestId('evt-1', 'boost_check')).toBe(
      socialVerificationRequestId('evt-1', 'boost_check'),
    )
  })

  it('rejects an empty event id and an unknown record type', () => {
    expect(() => socialVerificationRequestId('', 'boost_check')).toThrow(/eventId/)
    expect(() => socialVerificationRequestId('evt-1', 'tiktok')).toThrow(/recordType/)
  })
})

describe('insertSocialVerificationVerdict — T14 ⑦', () => {
  it('does not write when the switch is off', async () => {
    const { supabase, calls } = verdictClient({})
    const result = await insertSocialVerificationVerdict(supabase, input(), verdictEnv('TRUE'))
    expect(result).toEqual({ status: 'disabled' })
    expect(calls.fromCalls).toBe(0)
  })

  it('rejects boost_check with an empty boost status before insert', async () => {
    const { supabase, calls } = verdictClient({})
    await expect(insertSocialVerificationVerdict(supabase, input({
      verdict: 'boosted',
      boostStatus: null,
    }), ON)).rejects.toThrow(/boostStatus/)
    expect(calls.fromCalls).toBe(0)
    expect(calls.verdictInserts).toHaveLength(0)
  })

  it('inserts without a generated subject key', async () => {
    const { supabase, calls } = verdictClient({})
    const result = await insertSocialVerificationVerdict(supabase, input(), ON)
    expect(result).toEqual({ status: 'inserted' })
    expect(calls.verdictInserts).toHaveLength(1)
    expect(calls.verdictInserts[0]).not.toHaveProperty('subject_key')
    expect(calls.verdictInserts[0]).not.toHaveProperty('subject_kind')
    expect(calls.outcomes).toHaveLength(0)
    expect(calls.updates).toBe(0)
  })

  it('treats the same verdict and evidence as already written', async () => {
    const { supabase, calls } = verdictClient({
      insertError: { code: '23505', message: 'duplicate' },
      existing: {
        verdict: 'boosted',
        evidence_receipt_ids: ['dddddddd-dddd-4ddd-8ddd-ddddddddddd1'],
        evidence_verdict_ids: [],
      },
    })
    const result = await insertSocialVerificationVerdict(
      supabase,
      input({ evidenceReceiptIds: ['dddddddd-dddd-4ddd-8ddd-ddddddddddd1'] }),
      ON,
    )
    expect(result).toEqual({ status: 'already_written' })
    expect(calls.outcomes).toHaveLength(0)
    expect(calls.updates).toBe(0)
    expect(calls.deletes).toBe(0)
  })

  it('records verdict_conflict and does not overwrite when the replay differs', async () => {
    const { supabase, calls } = verdictClient({
      insertError: { code: '23505', message: 'duplicate' },
      existing: {
        verdict: 'not_boosted',
        evidence_receipt_ids: [],
        evidence_verdict_ids: [],
      },
    })
    const result = await insertSocialVerificationVerdict(supabase, input(), ON)
    expect(result).toEqual({ status: 'conflict' })
    expect(calls.updates).toBe(0)
    expect(calls.deletes).toBe(0)
    expect(calls.outcomes).toHaveLength(1)
    const outcome = calls.outcomes[0]
    expect(outcome.job_name).toBe('social-readback-outcome')
    expect(outcome.status).toBe('failed')
    expect(outcome.summary).toMatchObject({
      client_id: CLIENT,
      subject_kind: 'post',
      subject_ref: 'fixture-subject',
      outcome: 'verdict_conflict',
      reason: 'request_replay_differs',
    })
    expect(JSON.stringify(outcome)).not.toMatch(/campaign_id|plan_id/)
  })

  it('records identity_occupied when the request id is not the conflicting row', async () => {
    const { supabase, calls } = verdictClient({
      insertError: { code: '23505', message: 'duplicate' },
      existing: null,
    })
    const result = await insertSocialVerificationVerdict(supabase, input(), ON)
    expect(result).toEqual({ status: 'conflict' })
    expect(calls.outcomes[0].summary).toMatchObject({ reason: 'identity_occupied' })
    expect(calls.updates).toBe(0)
  })

  it('throws when the conflict receipt cannot be written', async () => {
    const { supabase, calls } = verdictClient({
      insertError: { code: '23505', message: 'duplicate' },
      existing: null,
      outcomeError: { message: 'log down' },
    })
    await expect(insertSocialVerificationVerdict(supabase, input(), ON)).rejects.toThrow(/log down/)
    expect(calls.updates).toBe(0)
  })
})

describe('readEarliestSocialVerificationVerdict — T14 ⑧', () => {
  it('returns the earliest row when two rows exist', async () => {
    const newer = {
      id: '11111111-1111-4111-8111-111111111111',
      request_id: REQUEST,
      client_id: CLIENT,
      record_type: 'boost_check',
      subject_key: ACTION,
      read_point: 't72',
      logic_version: 'wp1.v1',
      verdict: 'not_boosted',
      created_at: '2026-11-02T02:00:00.000Z',
      evidence_receipt_ids: [],
      evidence_verdict_ids: [],
    }
    const older = { ...newer, id: '22222222-2222-4222-8222-222222222222', verdict: 'boosted', created_at: '2026-11-02T01:00:00.000Z' }
    const { supabase, calls } = verdictClient({ rows: [newer, older] })
    const row = await readEarliestSocialVerificationVerdict(supabase, {
      clientId: CLIENT,
      recordType: 'boost_check',
      subjectKey: ACTION,
      readPoint: 't72',
      logicVersion: 'wp1.v1',
    })
    expect(row?.id).toBe(older.id)
    expect(row?.verdict).toBe('boosted')
    expect(calls.order).toEqual({ column: 'created_at', ascending: true })
    expect(calls.limit).toBe(1)
  })
})

describe('T19 — verdict writer is not on the publish path', () => {
  it('publish worker and inngest index do not import it', () => {
    for (const file of [
      'src/lib/factory/publish/publish-worker.ts',
      'src/lib/inngest/functions/index.ts',
      'src/lib/social/verification-verdicts.ts',
    ]) {
      const src = readFileSync(file, 'utf8')
      expect(src, file).not.toMatch(/FACTORY_PUBLISH_LIVE/)
      if (file.endsWith('index.ts') || file.endsWith('publish-worker.ts')) {
        expect(src, file).not.toMatch(/verification-verdicts/)
      }
    }
  })
})
