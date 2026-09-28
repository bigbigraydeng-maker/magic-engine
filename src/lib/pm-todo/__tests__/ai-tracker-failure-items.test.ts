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
  opts: { engine?: string; errorMsg?: string | null; parseErrorMsg?: string | null } = {},
): AiTrackerRunQuery['rows'] {
  const { engine = 'openai', errorMsg = null, parseErrorMsg = null } = opts
  return Array.from({ length: count }, (_, i) => ({
    client_id: clientId,
    ai_engine: engine,
    error_message: errorMsg,
    parse_error_message: parseErrorMsg,
    // Runs happen on Tuesday of that week, spread across minutes (not hours)
    // to avoid invalid timestamps when count > 9.
    ran_at: `${weekMonday.slice(0, 8)}${String(Number(weekMonday.slice(8)) + 1).padStart(2, '0')}T06:${String(i).padStart(2, '0')}:00Z`,
  }))
}

const NAMES: ClientNameMap = new Map([
  ['client-a', 'East International'],
  ['client-b', 'CTS Tours'],
])

const ACTIVE_AB = new Set(['client-a', 'client-b'])

describe('bucketErrors', () => {
  it('classifies quota errors correctly (account-level evidence only)', () => {
    const buckets = bucketErrors([
      { engine: 'openai', message: '429 You have no credits remaining', isParseError: false },
      { engine: 'openai', message: 'insufficient_quota', isParseError: false },
    ])
    expect(buckets).toHaveLength(1)
    expect(buckets[0]!.key).toBe('quota_exhausted')
    expect(buckets[0]!.count).toBe(2)
  })

  it('a bare 429 / "rate limit" is NOT quota_exhausted — it is rate_limited', () => {
    const buckets = bucketErrors([
      { engine: 'openai', message: 'rate limit exceeded', isParseError: false },
      { engine: 'openai', message: '429 Too Many Requests', isParseError: false },
    ])
    expect(buckets).toHaveLength(1)
    expect(buckets[0]!.key).toBe('rate_limited')
  })

  it('classifies auth errors correctly', () => {
    const buckets = bucketErrors([
      { engine: 'openai', message: 'Invalid API key', isParseError: false },
      { engine: 'openai', message: 'Unauthorized', isParseError: false },
    ])
    expect(buckets).toHaveLength(1)
    expect(buckets[0]!.key).toBe('auth_failed')
    expect(buckets[0]!.count).toBe(2)
  })

  it('classifies provider errors correctly', () => {
    const buckets = bucketErrors([
      { engine: 'google', message: '[GoogleGenerativeAI Error] 500 Internal Server Error', isParseError: false },
    ])
    expect(buckets).toHaveLength(1)
    expect(buckets[0]!.key).toBe('provider_error')
    expect(buckets[0]!.count).toBe(1)
  })

  it('parse failures (isParseError, no error_message) go into their own bucket', () => {
    const buckets = bucketErrors([
      { engine: 'openai', message: null, isParseError: true },
      { engine: 'openai', message: null, isParseError: true },
    ])
    expect(buckets).toHaveLength(1)
    expect(buckets[0]!.key).toBe('parse_error')
    expect(buckets[0]!.count).toBe(2)
  })

  it('sorts by count descending and handles mixed types', () => {
    const buckets = bucketErrors([
      { engine: 'openai', message: '429 credits remaining', isParseError: false },
      { engine: 'openai', message: 'insufficient_quota', isParseError: false },
      { engine: 'google', message: '[GoogleGenerativeAI Error]', isParseError: false },
      { engine: 'openai', message: 'something totally new', isParseError: false },
    ])
    expect(buckets[0]!.key).toBe('quota_exhausted')
    expect(buckets[0]!.count).toBe(2)
  })

  it('null error_message, not a parse error → unknown', () => {
    const buckets = bucketErrors([{ engine: 'openai', message: null, isParseError: false }])
    expect(buckets[0]!.key).toBe('unknown')
  })

  it('tracks the dominant engine per bucket', () => {
    const buckets = bucketErrors([
      { engine: 'google', message: 'insufficient_quota', isParseError: false },
      { engine: 'google', message: 'insufficient_quota', isParseError: false },
      { engine: 'openai', message: 'insufficient_quota', isParseError: false },
    ])
    expect(buckets[0]!.key).toBe('quota_exhausted')
    expect(buckets[0]!.topEngine).toBe('google')
  })
})

describe('summariseRunFailures', () => {
  it('produces human-readable summary', () => {
    const buckets = bucketErrors([
      { engine: 'openai', message: '429 credits remaining', isParseError: false },
      { engine: 'openai', message: 'insufficient_quota', isParseError: false },
      { engine: 'google', message: '[GoogleGenerativeAI Error]', isParseError: false },
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

  it('surfaces query error as a dev-owned item, not the PM-facing kind', () => {
    const items = buildAiTrackerFailureItems(
      { rows: [], error: 'relation "ai_visibility_runs" does not exist' },
      NAMES,
      WED,
    )
    expect(items).toHaveLength(1)
    // Must be ai_alerting_broken (dev lane) — the text says "not your job", so
    // it must not land under ai_tracker_all_failed (PM one_click lane), or it
    // both inflates PM's todo count and renders a broken "go do this" link.
    expect(items[0]!.kind).toBe('ai_alerting_broken')
    expect(items[0]!.client_id).toBe('infra')
    expect(items[0]!.what).toContain('读不出来')
  })

  it('creates item when all probes failed for a client this week', () => {
    const rows = makeRuns('client-a', THIS_MONDAY, 24, { errorMsg: '429 You have no credits remaining' })
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
    // How should tell PM to recharge, and name the right provider (openai here)
    expect(item.how).toContain('充值')
    expect(item.how).toContain('OpenAI')
  })

  it('routes fix guidance to the engine that actually failed, not always OpenAI', () => {
    const rows = makeRuns('client-a', THIS_MONDAY, 24, {
      engine: 'google',
      errorMsg: 'insufficient_quota',
    })
    const items = buildAiTrackerFailureItems({ rows, error: null }, NAMES, WED)
    expect(items).toHaveLength(1)
    // Must point at Gemini, not send the PM to fix an unrelated OpenAI account
    expect(items[0]!.how).toContain('Gemini')
    expect(items[0]!.href).toContain('aistudio.google.com')
    expect(items[0]!.href).not.toContain('openai.com')
  })

  it('a week of pure rate-limiting does not tell the PM to pay', () => {
    const rows = makeRuns('client-a', THIS_MONDAY, 24, { errorMsg: 'rate limit exceeded, please retry' })
    const items = buildAiTrackerFailureItems({ rows, error: null }, NAMES, WED)
    expect(items).toHaveLength(1)
    expect(items[0]!.what).toContain('暂时被限流')
    expect(items[0]!.how).toContain('不用你动手')
    expect(items[0]!.how).not.toContain('充值')
  })

  it('a pure non-actionable week (rate-limited/provider-error/etc) uses the dev-owned kind, not one_click', () => {
    const rows = makeRuns('client-a', THIS_MONDAY, 24, {
      engine: 'google',
      errorMsg: '[GoogleGenerativeAI Error] 500 Internal Server Error',
    })
    const items = buildAiTrackerFailureItems({ rows, error: null }, NAMES, WED)
    expect(items).toHaveLength(1)
    expect(items[0]!.kind).toBe('ai_tracker_all_failed_not_actionable')
  })

  it('a tied split between an actionable and non-actionable cause never hides the actionable one — real incident shape (Codex review 2026-09-28)', () => {
    // Real 2026-09-20 incident: 12 OpenAI quota-exhausted + 12 Google provider
    // errors, evenly split. Provider-error rows listed FIRST here to simulate
    // the query's ran_at DESC ordering putting the later-run engine's rows
    // ahead of the earlier one on a tie — pickGuideBucket must still surface
    // the actionable (quota) bucket regardless of array/tie order.
    const rows = [
      ...makeRuns('client-a', THIS_MONDAY, 12, {
        engine: 'google',
        errorMsg: '[GoogleGenerativeAI Error] 500 Internal Server Error',
      }),
      ...makeRuns('client-a', THIS_MONDAY, 12, {
        engine: 'openai',
        errorMsg: '429 You have no credits remaining',
      }),
    ]
    const items = buildAiTrackerFailureItems({ rows, error: null }, NAMES, WED)
    expect(items).toHaveLength(1)
    // Must be the actionable, one_click kind — not buried behind "not your job"
    expect(items[0]!.kind).toBe('ai_tracker_all_failed')
    expect(items[0]!.how).toContain('充值')
    expect(items[0]!.how).toContain('OpenAI')
  })

  it('parse failures (provider answered, ranking unparseable) still count as 100% failure', () => {
    // error_message is null (the provider call itself succeeded) but
    // parse_error_message is set — orchestrator.ts's processOne leaves
    // runs_succeeded incremented for these, which is exactly the blind spot
    // isRunConclusive exists to close.
    const rows = makeRuns('client-a', THIS_MONDAY, 24, { parseErrorMsg: 'Could not extract ranking from response' })
    const items = buildAiTrackerFailureItems({ rows, error: null }, NAMES, WED)
    expect(items).toHaveLength(1)
    expect(items[0]!.what).toContain('AI 回了但解析不出排名')
    expect(items[0]!.how).toContain('不用你动手')
  })

  it('does NOT flag a client with some successes', () => {
    const failedRuns = makeRuns('client-a', THIS_MONDAY, 20, { errorMsg: '429 credits' })
    const successRuns = makeRuns('client-a', THIS_MONDAY, 4) // 4 succeeded
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
      ...makeRuns('client-a', THIS_MONDAY, 24, { errorMsg: '429 credits remaining' }),
      ...makeRuns('client-b', THIS_MONDAY, 20), // all succeeded
    ]
    const items = buildAiTrackerFailureItems(
      { rows, error: null },
      NAMES,
      WED,
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.client_id).toBe('client-a')
  })

  it('does not alert for a client outside the active roster', () => {
    const rows = makeRuns('client-a', THIS_MONDAY, 24, { errorMsg: '429 credits remaining' })
    // client-a fully failed, but only client-b is in the active roster —
    // a churned client's old failures shouldn't keep generating todos.
    const items = buildAiTrackerFailureItems(
      { rows, error: null },
      NAMES,
      WED,
      new Set(['client-b']),
    )
    expect(items).toHaveLength(0)
  })

  it('alerts normally when activeClientIds includes the failing client', () => {
    const rows = makeRuns('client-a', THIS_MONDAY, 24, { errorMsg: '429 credits remaining' })
    const items = buildAiTrackerFailureItems({ rows, error: null }, NAMES, WED, ACTIVE_AB)
    expect(items).toHaveLength(1)
  })

  it('computes streak across multiple weeks', () => {
    const rows = [
      ...makeRuns('client-a', THIS_MONDAY, 24, { errorMsg: '429 credits' }),
      ...makeRuns('client-a', LAST_MONDAY, 24, { errorMsg: '429 credits' }),
      ...makeRuns('client-a', TWO_WEEKS_AGO, 24, { errorMsg: '429 credits' }),
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
      ...makeRuns('client-a', THIS_MONDAY, 24, { errorMsg: '429 credits' }),
      // Last week had some successes — streak should be 1
      ...makeRuns('client-a', LAST_MONDAY, 20),
      ...makeRuns('client-a', LAST_MONDAY, 4, { errorMsg: '429 credits' }),
      ...makeRuns('client-a', TWO_WEEKS_AGO, 24, { errorMsg: '429 credits' }),
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
    const rows = makeRuns('unknown-client-id-here', THIS_MONDAY, 5, { errorMsg: 'error' })
    const items = buildAiTrackerFailureItems(
      { rows, error: null },
      new Map(),
      WED,
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.client_name).toBe('unknown-')
  })

  it('auth_failed bucket produces different "how" than quota', () => {
    const rows = makeRuns('client-a', THIS_MONDAY, 10, { errorMsg: 'Invalid API key' })
    const items = buildAiTrackerFailureItems(
      { rows, error: null },
      NAMES,
      WED,
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.how).toContain('API Key')
  })

  it('provider_error bucket says "不用你动手"', () => {
    const rows = makeRuns('client-a', THIS_MONDAY, 10, {
      engine: 'google',
      errorMsg: '[GoogleGenerativeAI Error] 500',
    })
    const items = buildAiTrackerFailureItems(
      { rows, error: null },
      NAMES,
      WED,
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.how).toContain('不用你动手')
  })
})
