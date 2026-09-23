/**
 * Tests for the ai_visibility_runs "did this probe complete?" predicate.
 *
 * The rule under test is a red line, not a preference: a probe we failed to
 * take must never be read as a measurement of zero.
 */

import { describe, it, expect } from 'vitest'
import {
  isRunConclusive,
  partitionConclusiveRuns,
  summariseRunFailures,
  RUN_CONCLUSIVENESS_COLUMNS,
  type RunConclusiveness,
} from '../run-conclusive'

const ok: RunConclusiveness = { error_message: null, parse_error_message: null }
const providerFailed: RunConclusiveness = {
  error_message: '429 You have no credits remaining.',
  parse_error_message: null,
}
const parseFailed: RunConclusiveness = {
  error_message: null,
  parse_error_message: 'LLM parse timeout',
}

describe('isRunConclusive', () => {
  it('accepts a run with no error on either column', () => {
    expect(isRunConclusive(ok)).toBe(true)
  })

  it('rejects a run the provider never answered', () => {
    expect(isRunConclusive(providerFailed)).toBe(false)
  })

  it('rejects a run whose parser failed — the rank was never determined', () => {
    expect(isRunConclusive(parseFailed)).toBe(false)
  })

  it('rejects a row whose error columns are missing entirely (fail-closed)', () => {
    // What a caller that forgot the columns in its .select() hands us. The
    // type forbids it at compile time; this pins the runtime behaviour so a
    // cast (`as`) around the type cannot turn unmeasured runs into evidence.
    const noColumns = { client_brand_rank: null } as unknown as RunConclusiveness
    expect(isRunConclusive(noColumns)).toBe(false)
  })

  it('names both columns a caller must select', () => {
    expect(RUN_CONCLUSIVENESS_COLUMNS).toContain('error_message')
    expect(RUN_CONCLUSIVENESS_COLUMNS).toContain('parse_error_message')
  })
})

describe('partitionConclusiveRuns', () => {
  it('splits a mixed batch and preserves the caller row shape', () => {
    const rows = [
      { ...ok, client_brand_rank: 2 },
      { ...providerFailed, client_brand_rank: null },
      { ...ok, client_brand_rank: null },
      { ...parseFailed, client_brand_rank: null },
    ]
    const { conclusive, failed } = partitionConclusiveRuns(rows)
    expect(conclusive).toHaveLength(2)
    expect(failed).toHaveLength(2)
    // A completed probe that found no mention IS evidence and must survive.
    expect(conclusive.map(r => r.client_brand_rank)).toEqual([2, null])
  })

  it('returns an empty conclusive set when every probe failed', () => {
    const { conclusive, failed } = partitionConclusiveRuns([providerFailed, parseFailed])
    expect(conclusive).toEqual([])
    expect(failed).toHaveLength(2)
  })
})

describe('summariseRunFailures', () => {
  it('buckets by cause so a reader can tell a provider outage from a parser bug', () => {
    const summary = summariseRunFailures([providerFailed, providerFailed, parseFailed])
    expect(summary).toBe('provider_error×2, parse_error×1')
  })

  it('flags rows whose error columns were never selected', () => {
    const noColumns = {} as unknown as RunConclusiveness
    expect(summariseRunFailures([noColumns])).toBe('missing_error_columns×1')
  })
})
