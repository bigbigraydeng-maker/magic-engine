/**
 * The C-level sampling lane.
 *
 * The property that matters is not "roughly 20%" — it is that the answer for a
 * given commit cannot change. A workflow re-run, a duplicate event delivery, or
 * an author who dislikes being sampled must all get the same result, otherwise
 * the marker ledger records a PR that changed its mind and a second
 * `@codex review` restarts the loop.
 */

import { describe, expect, it } from 'vitest'

import {
  B_SPOT_CHECK_RATE_PERCENT,
  C_SAMPLE_RATE_PERCENT,
  fnv1a32,
  isSampled,
  sampleBucket,
  sampleKey,
  shouldRequestCodexReview,
  shouldRequestLegacySpotCheck,
} from '../src/sampling.mjs'

const sha = (n: number) => n.toString(16).padStart(40, '0')

describe('the sample is stable', () => {
  it('gives the same answer for the same (pr, sha) every time it is asked', () => {
    const input = { pr: 1204, sha: '7a1527bc3b2e5a064815d761ecea7e27848c3108' }
    const first = isSampled(input)
    for (let i = 0; i < 500; i++) {
      expect(isSampled(input)).toBe(first)
    }
  })

  it('depends on the head sha, so a new push is decided afresh', () => {
    const decisions = new Set([0, 1, 2, 3, 4, 5, 6, 7].map((n) => isSampled({ pr: 1, sha: sha(n) })))
    // Not asserting which — only that the sha is genuinely part of the key.
    expect(decisions.size).toBeGreaterThan(0)
    expect(sampleBucket(sampleKey({ pr: 1, sha: sha(0) }))).not.toBe(
      sampleBucket(sampleKey({ pr: 1, sha: sha(1) })),
    )
  })

  it('decides two PRs sharing a head commit independently', () => {
    const shared = sha(42)
    expect(sampleKey({ pr: 1, sha: shared })).not.toBe(sampleKey({ pr: 2, sha: shared }))
  })

  it('hashes deterministically to a known value — a silent hash change breaks re-runs', () => {
    // Pinned so that "the loop suddenly re-sampled everything" cannot happen
    // quietly: change the hash, and this fails first.
    expect(fnv1a32('')).toBe(0x811c9dc5)
    expect(fnv1a32('a')).toBe(0xe40c292c)
    expect(fnv1a32('foobar')).toBe(0xbf9cf968)
  })
})

describe('the sample rate is honoured', () => {
  it('lands near the configured rate over many shas', () => {
    const total = 4000
    let sampled = 0
    for (let i = 0; i < total; i++) {
      if (isSampled({ pr: 7, sha: sha(i) })) sampled++
    }
    const percent = (sampled / total) * 100
    // A wide band on purpose: this asserts the bucketing is not degenerate
    // (never / always / half), not that FNV is a uniform PRNG.
    expect(percent).toBeGreaterThan(C_SAMPLE_RATE_PERCENT - 5)
    expect(percent).toBeLessThan(C_SAMPLE_RATE_PERCENT + 5)
  })

  it('samples nothing at 0% and everything at 100%', () => {
    expect(isSampled({ pr: 1, sha: sha(3), ratePercent: 0 })).toBe(false)
    expect(isSampled({ pr: 1, sha: sha(3), ratePercent: 100 })).toBe(true)
  })

  it('treats a nonsense rate as "sample nothing" rather than crashing mid-run', () => {
    expect(isSampled({ pr: 1, sha: sha(3), ratePercent: Number.NaN })).toBe(false)
  })
})

describe('shouldRequestCodexReview routes by level', () => {
  it('always reviews A', () => {
    expect(shouldRequestCodexReview({ risk: 'A', pr: 1, sha: sha(1) }).review).toBe(true)
  })

  it('always reviews B — and says it is because B is B, not because B is unrecognised', () => {
    // The reason is checked because both branches return `review: true`: a
    // regression that dropped B out of the known levels would still review it,
    // while telling the PR page its level could not be read. Asserting only the
    // boolean cannot tell those apart.
    for (let i = 0; i < 50; i++) {
      const result = shouldRequestCodexReview({ risk: 'B', pr: 1, sha: sha(i) })
      expect(result.review).toBe(true)
      expect(result.reason).toBe('B 级 —— 必过 Codex 复审')
    }
  })

  it('says A is reviewed because it is A', () => {
    expect(shouldRequestCodexReview({ risk: 'A', pr: 1, sha: sha(1) }).reason).toBe('A 级 —— 必过 Codex 复审')
  })

  it('reviews only the sampled share of C', () => {
    const results = Array.from({ length: 200 }, (_, i) =>
      shouldRequestCodexReview({ risk: 'C', pr: 1, sha: sha(i) }).review,
    )
    expect(results).toContain(true)
    expect(results).toContain(false)
  })

  it('reviews an unrecognised level — fail closed, same direction as the rating', () => {
    const result = shouldRequestCodexReview({ risk: 'nonsense', pr: 1, sha: sha(1) })
    expect(result.review).toBe(true)
    expect(result.reason).toContain('无法识别')
  })

  it('explains a C skip in words the PR page can show', () => {
    const skipped = Array.from({ length: 200 }, (_, i) => ({
      i,
      r: shouldRequestCodexReview({ risk: 'C', pr: 1, sha: sha(i) }),
    })).find((x) => !x.r.review)
    expect(skipped?.r.reason).toContain('未被 20% 抽样抽中')
  })
})

describe('legacy spot checks are B-only and never a merge input', () => {
  it('never selects A or C', () => {
    for (let i = 0; i < 40; i++) {
      expect(shouldRequestLegacySpotCheck({ risk: 'A', pr: 1, sha: sha(i) }).review).toBe(false)
      expect(shouldRequestLegacySpotCheck({ risk: 'C', pr: 1, sha: sha(i) }).review).toBe(false)
    }
  })

  it('samples some B heads and skips others, stably', () => {
    const input = { risk: 'B' as const, pr: 7, sha: sha(3) }
    const first = shouldRequestLegacySpotCheck(input)
    expect(shouldRequestLegacySpotCheck(input)).toEqual(first)
    const results = Array.from({ length: 200 }, (_, i) =>
      shouldRequestLegacySpotCheck({ risk: 'B', pr: 1, sha: sha(i) }).review,
    )
    expect(results).toContain(true)
    expect(results).toContain(false)
    expect(B_SPOT_CHECK_RATE_PERCENT).toBe(C_SAMPLE_RATE_PERCENT)
  })

  it('says a miss does not block', () => {
    const skipped = Array.from({ length: 200 }, (_, i) =>
      shouldRequestLegacySpotCheck({ risk: 'B', pr: 1, sha: sha(i) }),
    ).find((result) => !result.review)
    expect(skipped?.reason).toContain('不挡合并')
  })
})
