/**
 * AI Tracker failure items — make sure 100% probe failure surfaces in PM todo.
 *
 * Real-world incident (2026-09-20): East International 24/24 probes failed,
 * looked identical to "no AI mentions this week". Three days, nobody noticed.
 *
 * These tests exercise the pure-function path (buildAiTrackerFailureItems)
 * with injected data — no Supabase client needed.
 */

import { describe, expect, it } from 'vitest'
import {
  buildAiTrackerFailureItems,
  bucketErrors,
  summariseRunFailures,
  type AiTrackerRunQuery,
  type ClientNameMap,
} from '../ai-tracker-failure-items'

// Monday of a test week — a typical Wednesday when pm-daily-todo runs
const WED = new Date('2026-09-23T19:00:00Z')
const SUN = new Date('2026-09-27T19:00:00Z') // weekly anchor day

// Mondays for week keys
const THIS_MONDAY = '2026-09-21' // Monday of the week containing WED
const LAST_MONDAY = '2026-09-14'
const TWO_WEEKS_AGO = '2026-09-07'

function makeRuns(
  clientId: string,
  weekMonday: string,
  count: number,
  errorMsg: string | null,
): AiTrackerRunQuery['rows'] {
  return Array.from({ length: count }, (_, i) => ({
    client_id: clientId,
    error_message: errorMsg,
    // Runs happen on Tuesday of that week, spread across minutes (not hours)
    // to avoid invalid timestamps when count > 9.
    ran_at: `${weekMonday.slice(0, 8)}${String(Number(weekMonday.slice(8)) + 1).padStart(2, '0')}T06:${String(i).padStart(2, '0')}:00Z`,
  }))
}

const NAMES: ClientNameMap = new Map([
  ['client-a', 'East International'],
  ['client-b', 'CTS Tours'],
])

describe('bucketErrors', () => {
  it('classifies quota errors correctly', () => {
    const buckets = bucketErrors([
      '429 You have no credits remaining',
      'insufficient_quota',
      'rate limit exceeded',
    ])
    expect(buckets).toHaveLength(1)
    expect(buckets[0]!.key).toBe('quota_exhausted')
    expect(buckets[0]!.count).toBe(3)
  })

  it('classifies auth errors correctly', () => {
    const buckets = bucketErrors(['Invalid API key', 'Unauthorized'])
    expect(buckets).toHaveLength(1)
    expect(buckets[0]!.key).toBe('auth_failed')
    expect(buckets[0]!.count).toBe(2)
  })

  it('classifies provider errors correctly', () => {
    const buckets = bucketErrors(['[GoogleGenerativeAI Error] 500 Internal Server Error'])
    expect(buckets).toHaveLength(1)
    expect(buckets[0]!.key).toBe('provider_error')
    expect(buckets[0]!.count).toBe(1)
  })

  it('sorts by count descending and handles mixed types', () => {
    const buckets = bucketErrors([
      '429 quota',
      '429 credits remaining',
      '[GoogleGenerativeAI Error]',
      'something totally new',
    ])
    expect(buckets[0]!.key).toBe('quota_exhausted')
    expect(buckets[0]!.count).toBe(2)
  })

  it('null error_message → unknown', () => {
    const buckets = bucketErrors([null])
    expect(buckets[0]!.key).toBe('unknown')
  })
})

describe('summariseRunFailures', () => {
  it('produces human-readable summary', () => {
    const buckets = bucketErrors([
      '429 credits remaining',
      '429 credits remaining',
      '[GoogleGenerativeAI Error]',
    ])
    const summary = summariseRunFailures(buckets)
    expect(summary).toContain('余额/配额用完×2')
    expect(summary).toContain('供应商内部出错×1')
  })
})

describe('buildAiTrackerFailureItems', () => {
  it('returns empty when no runs exist', () => {
    const items = buildAiTrackerFailureItems(
      { rows: [], error: null },
      NAMES,
      WED,
    )
    expect(items).toHaveLength(0)
  })

  it('surfaces query error as a visible item', () => {
    const items = buildAiTrackerFailureItems(
      { rows: [], error: 'relation "ai_visibility_runs" does not exist' },
      NAMES,
      WED,
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.kind).toBe('ai_tracker_all_failed')
    expect(items[0]!.client_id).toBe('infra')
    expect(items[0]!.what).toContain('读不出来')
  })

  it('creates item when all probes failed for a client this week', () => {
    const rows = makeRuns('client-a', THIS_MONDAY, 24, '429 You have no credits remaining')
    const items = buildAiTrackerFailureItems(
      { rows, error: null },
      NAMES,
      WED,
    )
    expect(items).toHaveLength(1)
    const item = items[0]!
    expect(item.kind).toBe('ai_tracker_all_failed')
    expect(item.client_name).toBe('East International')
    expect(item.client_id).toBe('client-a')
    expect(item.what).toContain('24 条探测全部失败')
    expect(item.what).toContain('余额/配额用完')
    // Must say "没测成" — the core GEO playbook principle (§9)
    expect(item.what).toContain('没测成')
    // How should tell PM to recharge
    expect(item.how).toContain('充值')
  })

  it('does NOT flag a client with some successes', () => {
    const failedRuns = makeRuns('client-a', THIS_MONDAY, 20, '429 credits')
    const successRuns = makeRuns('client-a', THIS_MONDAY, 4, null) // 4 succeeded
    const items = buildAiTrackerFailureItems(
      { rows: [...failedRuns, ...successRuns], error: null },
      NAMES,
      WED,
    )
    expect(items).toHaveLength(0)
  })

  it('does NOT flag a client with zero runs (no data, not failure)', () => {
    const items = buildAiTrackerFailureItems(
      { rows: [], error: null },
      NAMES,
      WED,
    )
    expect(items).toHaveLength(0)
  })

  it('handles multiple clients — only the fully-failed one', () => {
    const rows = [
      ...makeRuns('client-a', THIS_MONDAY, 24, '429 credits remaining'),
      ...makeRuns('client-b', THIS_MONDAY, 20, null), // all succeeded
    ]
    const items = buildAiTrackerFailureItems(
      { rows, error: null },
      NAMES,
      WED,
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.client_id).toBe('client-a')
  })

  it('computes streak across multiple weeks', () => {
    const rows = [
      ...makeRuns('client-a', THIS_MONDAY, 24, '429 credits'),
      ...makeRuns('client-a', LAST_MONDAY, 24, '429 credits'),
      ...makeRuns('client-a', TWO_WEEKS_AGO, 24, '429 credits'),
    ]
    const items = buildAiTrackerFailureItems(
      { rows, error: null },
      NAMES,
      SUN, // weekly anchor day — long streaks only remind on Sundays
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.what).toContain('连续 3 周')
  })

  it('streak is broken by a successful week', () => {
    const rows = [
      ...makeRuns('client-a', THIS_MONDAY, 24, '429 credits'),
      // Last week had some successes — streak should be 1
      ...makeRuns('client-a', LAST_MONDAY, 20, null),
      ...makeRuns('client-a', LAST_MONDAY, 4, '429 credits'),
      ...makeRuns('client-a', TWO_WEEKS_AGO, 24, '429 credits'),
    ]
    const items = buildAiTrackerFailureItems(
      { rows, error: null },
      NAMES,
      WED,
    )
    expect(items).toHaveLength(1)
    // Should say "this week" not "consecutive weeks" since streak = 1
    expect(items[0]!.what).toContain('这周')
  })

  it('falls back to truncated UUID when client name unknown', () => {
    const rows = makeRuns('unknown-client-id-here', THIS_MONDAY, 5, 'error')
    const items = buildAiTrackerFailureItems(
      { rows, error: null },
      new Map(),
      WED,
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.client_name).toBe('unknown-')
  })

  it('auth_failed bucket produces different "how" than quota', () => {
    const rows = makeRuns('client-a', THIS_MONDAY, 10, 'Invalid API key')
    const items = buildAiTrackerFailureItems(
      { rows, error: null },
      NAMES,
      WED,
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.how).toContain('API Key')
  })

  it('provider_error bucket says "不用你动手"', () => {
    const rows = makeRuns('client-a', THIS_MONDAY, 10, '[GoogleGenerativeAI Error] 500')
    const items = buildAiTrackerFailureItems(
      { rows, error: null },
      NAMES,
      WED,
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.how).toContain('不用你动手')
  })
})
