import { describe, expect, it } from 'vitest'
import {
  MIN_FULL_COVERAGE_RATIO,
  SUCCESSFUL_EMPTY_ERROR_CODES,
  groupQuestionCoverage,
  isSnapshotConclusive,
  partitionConclusiveSnapshots,
  summariseFailureCodes,
} from '../snapshot-conclusive'

describe('isSnapshotConclusive', () => {
  it('treats a clean row as conclusive', () => {
    expect(isSnapshotConclusive({ error_code: null })).toBe(true)
  })

  it('treats no_ai_overview as conclusive — Google showed none, that is a real zero', () => {
    expect(isSnapshotConclusive({ error_code: 'no_ai_overview' })).toBe(true)
  })

  it('treats a failed OpenAI probe as NOT conclusive', () => {
    expect(isSnapshotConclusive({ error_code: 'chatgpt_error' })).toBe(false)
  })

  it('treats a failed DataForSEO probe as NOT conclusive', () => {
    expect(isSnapshotConclusive({ error_code: 'dataforseo_error' })).toBe(false)
  })

  it('fails closed on an unknown future error code', () => {
    expect(isSnapshotConclusive({ error_code: 'some_new_provider_error' })).toBe(false)
  })

  it('keeps the allowlist minimal — only no_ai_overview', () => {
    expect([...SUCCESSFUL_EMPTY_ERROR_CODES]).toEqual(['no_ai_overview'])
  })
})

describe('partitionConclusiveSnapshots', () => {
  it('splits rows and preserves the originals', () => {
    const rows = [
      { question_id: 'q1', error_code: null },
      { question_id: 'q2', error_code: 'no_ai_overview' },
      { question_id: 'q3', error_code: 'chatgpt_error' },
      { question_id: 'q4', error_code: 'dataforseo_error' },
    ]
    const { conclusive, failed } = partitionConclusiveSnapshots(rows)
    expect(conclusive.map(r => r.question_id)).toEqual(['q1', 'q2'])
    expect(failed.map(r => r.question_id)).toEqual(['q3', 'q4'])
  })

  it('returns empty halves for an empty input', () => {
    expect(partitionConclusiveSnapshots([])).toEqual({ conclusive: [], failed: [] })
  })
})

describe('summariseFailureCodes', () => {
  it('counts each code, most frequent first', () => {
    const summary = summariseFailureCodes([
      { error_code: 'dataforseo_error' },
      { error_code: 'chatgpt_error' },
      { error_code: 'dataforseo_error' },
    ])
    expect(summary).toBe('dataforseo_error×2, chatgpt_error×1')
  })

  it('labels a null code as unknown rather than dropping it', () => {
    expect(summariseFailureCodes([{ error_code: null }])).toBe('unknown×1')
  })
})

describe('groupQuestionCoverage', () => {
  const row = (question_id: string, platform: string, error_code: string | null) => ({
    question_id,
    platform,
    error_code,
  })
  const scope = (question_id: string, platforms: string[]) => ({ question_id, platforms })
  const THREE_PLATFORMS = ['chatgpt', 'google_ai_overview', 'google_serp']

  it('classifies a question as fully measured only when every required platform completed', () => {
    const expected = [scope('full', THREE_PLATFORMS), scope('partial', THREE_PLATFORMS), scope('dead', THREE_PLATFORMS)]
    const { fullyMeasured, partialQuestionIds, failedQuestionIds, totalQuestions } =
      groupQuestionCoverage(
        [
          row('full', 'chatgpt', null), row('full', 'google_ai_overview', 'no_ai_overview'), row('full', 'google_serp', null),
          row('partial', 'chatgpt', null), row('partial', 'google_ai_overview', 'dataforseo_error'), row('partial', 'google_serp', null),
          row('dead', 'chatgpt', 'chatgpt_error'), row('dead', 'google_ai_overview', 'dataforseo_error'), row('dead', 'google_serp', 'dataforseo_error'),
        ],
        expected,
      )

    expect([...fullyMeasured.keys()]).toEqual(['full'])
    expect(fullyMeasured.get('full')).toHaveLength(3)
    expect(partialQuestionIds).toEqual(['partial'])
    expect(failedQuestionIds).toEqual(['dead'])
    expect(totalQuestions).toBe(3)
  })

  it('treats a single-platform question as fully measured when its one required platform completed', () => {
    const { fullyMeasured } = groupQuestionCoverage(
      [row('solo', 'chatgpt', null)],
      [scope('solo', ['chatgpt'])],
    )
    expect([...fullyMeasured.keys()]).toEqual(['solo'])
  })

  it('does not count a partially-measured question as fully measured even if it hit', () => {
    // The surviving platform may not be the one that would have hit — that is
    // the whole point of complete-case analysis.
    const { fullyMeasured, partialQuestionIds } = groupQuestionCoverage(
      [row('mixed', 'chatgpt', null), row('mixed', 'google_ai_overview', 'dataforseo_error')],
      [scope('mixed', ['chatgpt', 'google_ai_overview'])],
    )
    expect(fullyMeasured.size).toBe(0)
    expect(partialQuestionIds).toEqual(['mixed'])
  })

  it('handles an empty input', () => {
    const c = groupQuestionCoverage([], [])
    expect(c.totalQuestions).toBe(0)
    expect(c.fullyMeasured.size).toBe(0)
  })

  it('does not count a question with an empty required-platform set as fully measured', () => {
    // Codex review round 2 on PR #1923: `platforms: []` makes
    // conclusiveCount === requiredPlatforms.length via 0 === 0, which would
    // otherwise read as "fully measured" despite zero platforms ever probed.
    const { fullyMeasured, failedQuestionIds } = groupQuestionCoverage(
      [],
      [scope('no-platforms', [])],
    )
    expect(fullyMeasured.size).toBe(0)
    expect(failedQuestionIds).toEqual(['no-platforms'])
  })

  it('counts a question missing from the rows entirely as failed, not invisible', () => {
    // Regression for Codex review on PR #1923: a scoped/partial collection run
    // (limit / platforms query params, or a cron killed mid-batch) only writes
    // rows for the slice it actually attempted. A question in the active
    // config that never got ANY row must still count against totalQuestions —
    // otherwise a 5-question slice of an 18-question active set reads as
    // complete (5/5) instead of the true 5/18.
    const { fullyMeasured, failedQuestionIds, totalQuestions } = groupQuestionCoverage(
      [row('attempted', 'chatgpt', null), row('attempted', 'google_ai_overview', null), row('attempted', 'google_serp', null)],
      [scope('attempted', THREE_PLATFORMS), scope('never-run', THREE_PLATFORMS)],
    )
    expect([...fullyMeasured.keys()]).toEqual(['attempted'])
    expect(failedQuestionIds).toEqual(['never-run'])
    expect(totalQuestions).toBe(2)
  })

  it('does not count a question as fully measured when only some of its required platforms were written', () => {
    // A question requiring 3 platforms but only ever probed on 1 (e.g. the
    // collector ran with ?platforms=chatgpt) must not read as complete just
    // because every row that DOES exist for it is conclusive.
    const { fullyMeasured, partialQuestionIds } = groupQuestionCoverage(
      [row('one-of-three', 'chatgpt', null)],
      [scope('one-of-three', THREE_PLATFORMS)],
    )
    expect(fullyMeasured.size).toBe(0)
    expect(partialQuestionIds).toEqual(['one-of-three'])
  })
})

describe('MIN_FULL_COVERAGE_RATIO', () => {
  it('is pinned at 60% — healthy production days sit at 100% and are unaffected', () => {
    expect(MIN_FULL_COVERAGE_RATIO).toBe(0.6)
  })
})
