import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const requireFromHere = createRequire(import.meta.url)
const { autoMergeBlockers, isCleanReview, isEveryCheckGreen } = await import(
  join(process.cwd(), 'tools/ops-review-loop/src/merge-gate.mjs')
)
void requireFromHere

const green = (name: string) => ({ name, status: 'completed', conclusion: 'success' })

describe('isEveryCheckGreen', () => {
  it('is true only when every run is completed and non-blocking', () => {
    expect(isEveryCheckGreen([green('a'), green('b')])).toBe(true)
    expect(
      isEveryCheckGreen([green('a'), { name: 'b', status: 'completed', conclusion: 'skipped' }]),
    ).toBe(true)
  })

  it('is false when any single run failed — the exact case the old one-check gate let through', () => {
    // PR #927 ran 4 checks; the predecessor consulted only the one whose name
    // matched /ai-orchestrator/i. A red build alongside a green orchestrator
    // check read as "CI green", which is survivable while a human still opens
    // the page and is not survivable once the machine merges on this answer.
    expect(
      isEveryCheckGreen([
        green('ai-orchestrator-tests'),
        { name: 'build', status: 'completed', conclusion: 'failure' },
      ]),
    ).toBe(false)
  })

  it.each(['cancelled', 'timed_out', 'action_required', 'stale', null])(
    'treats conclusion %s as blocking',
    (conclusion) => {
      expect(isEveryCheckGreen([{ name: 'x', status: 'completed', conclusion }])).toBe(false)
    },
  )

  it('is false while any run is still in progress', () => {
    expect(isEveryCheckGreen([green('a'), { name: 'b', status: 'in_progress', conclusion: null }])).toBe(false)
  })

  it('is false for an empty or missing list — no checks reported is not evidence of passing', () => {
    expect(isEveryCheckGreen([])).toBe(false)
    expect(isEveryCheckGreen(undefined)).toBe(false)
    expect(isEveryCheckGreen(null)).toBe(false)
  })
})

describe('isCleanReview', () => {
  it("matches Codex's observed clean output", () => {
    // Real text, PR #898 2026-08-11 04:15.
    expect(isCleanReview("Codex Review: Didn't find any major issues. What shall we delve into next?")).toBe(true)
  })

  it('is false for an unrecognised, empty, or non-string body', () => {
    // The point of a positive signal: anything it does not recognise — an API
    // error page, a reworded template, a future Codex format — must read as
    // "not clean", never as "clean by default".
    expect(isCleanReview('')).toBe(false)
    expect(isCleanReview('   ')).toBe(false)
    expect(isCleanReview(undefined)).toBe(false)
    expect(isCleanReview('### 💡 Codex Review\n\nHere are some automated review suggestions.')).toBe(false)
    expect(isCleanReview('502 Bad Gateway')).toBe(false)
  })
})

describe('autoMergeBlockers', () => {
  const clear = {
    enabled: true,
    isDraft: false,
    mergeable: true,
    everyCheckGreen: true,
    cleanReview: true,
  }

  it('returns no blockers when everything holds', () => {
    expect(autoMergeBlockers(clear)).toEqual([])
  })

  it.each([
    ['enabled', false, 'auto-merge disabled'],
    ['isDraft', true, 'draft'],
    ['everyCheckGreen', false, 'not every check run'],
    ['cleanReview', false, 'no positive clean signal'],
  ])('blocks when %s is wrong', (key, value, expected) => {
    const blockers = autoMergeBlockers({ ...clear, [key]: value })
    expect(blockers.join(' ')).toContain(expected)
  })

  it('blocks when mergeable is null — GitHub has not computed it yet, which is not a yes', () => {
    expect(autoMergeBlockers({ ...clear, mergeable: null }).join(' ')).toContain('not mergeable')
    expect(autoMergeBlockers({ ...clear, mergeable: false }).join(' ')).toContain('not mergeable')
    expect(autoMergeBlockers({ ...clear, mergeable: undefined }).join(' ')).toContain('not mergeable')
  })

  it('names every failing condition, not just the first', () => {
    // A merge gate that reports one reason at a time turns one fix into N
    // round trips, and hides how far from mergeable the PR actually is.
    expect(autoMergeBlockers({ enabled: false, isDraft: true, mergeable: false, everyCheckGreen: false, cleanReview: false })).toHaveLength(5)
  })
})
