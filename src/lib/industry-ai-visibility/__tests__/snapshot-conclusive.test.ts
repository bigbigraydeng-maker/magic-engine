import { describe, expect, it } from 'vitest'
import {
  SUCCESSFUL_EMPTY_ERROR_CODES,
  isSnapshotConclusive,
  partitionConclusiveSnapshots,
  summariseFailureCodes,
} from '../snapshot-conclusive'

describe('isSnapshotConclusive', () => {
  it('treats a clean row as conclusive', () => {
    expect(isSnapshotConclusive({ error_code: null })).toBe(true)
  })

  it('treats a missing error_code as conclusive (column absent from select)', () => {
    expect(isSnapshotConclusive({ error_code: undefined })).toBe(true)
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
