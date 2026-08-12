import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const requireFromHere = createRequire(import.meta.url)
const { autoMergeBlockers, excludeOwnRun, isCleanReview, isEveryCheckGreen } = await import(
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
  const SHA = 'a'.repeat(40)
  const clear = {
    enabled: true,
    isDraft: false,
    mergeable: true,
    everyCheckGreen: true,
    cleanReview: true,
    reviewedSha: SHA,
    headSha: SHA,
    unresolvedThreads: [],
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
    expect(
      autoMergeBlockers({ enabled: false, isDraft: true, mergeable: false, everyCheckGreen: false, cleanReview: false, reviewedSha: 'a', headSha: 'b' }),
    ).toHaveLength(6)
  })

  it('blocks when Codex reviewed a different commit than the one about to merge', () => {
    // Codex finding (PR #931, P1): a clean verdict on commit A must not
    // authorise merging commit B pushed while that review was being written.
    // Passing the head sha to the merge API only stops the branch moving AFTER
    // the gate; this is the review being stale BEFORE it.
    const blockers = autoMergeBlockers({ ...clear, reviewedSha: 'b'.repeat(40) })
    expect(blockers.join(' ')).toContain('review is for')
  })

  it.each([[undefined], [null], [123]])('blocks when the reviewed sha is not a string (%s)', (bad) => {
    expect(autoMergeBlockers({ ...clear, reviewedSha: bad }).join(' ')).toContain('review is for')
  })
})

describe('excludeOwnRun', () => {
  // Field shape taken from a real payload fetched 2026-08-12, not assumed:
  // details_url = https://github.com/{owner}/{repo}/actions/runs/{RUN}/job/{JOB}
  const own = (name: string, job: string) => ({
    name,
    status: 'in_progress',
    conclusion: null,
    details_url: `https://github.com/o/r/actions/runs/31567460404/job/${job}`,
  })
  const other = {
    name: 'ai-orchestrator-tests',
    status: 'completed',
    conclusion: 'success',
    details_url: 'https://github.com/o/r/actions/runs/31567159774/job/94021249406',
  }

  it('drops both jobs of this workflow run and keeps everything else', () => {
    // The bug this exists for: handle-review and merge are check runs on the
    // same sha, in_progress while they are the ones asking. Without this,
    // "every check green" was unsatisfiable and auto-merge could never fire.
    const kept = excludeOwnRun([own('handle-review', '1'), own('merge', '2'), other], '31567460404')
    expect(kept).toEqual([other])
  })

  it('makes an otherwise-green sha actually read as green', () => {
    const runs = [own('merge', '2'), other]
    expect(isEveryCheckGreen(runs)).toBe(false)
    expect(isEveryCheckGreen(excludeOwnRun(runs, '31567460404'))).toBe(true)
  })

  it('does not drop a different run whose id merely shares a prefix', () => {
    const lookalike = { ...other, details_url: 'https://github.com/o/r/actions/runs/315674604041/job/9' }
    expect(excludeOwnRun([lookalike], '31567460404')).toEqual([lookalike])
  })

  it('excludes nothing when the run id is missing, rather than guessing', () => {
    const runs = [own('merge', '2'), other]
    expect(excludeOwnRun(runs, undefined)).toEqual(runs)
    expect(excludeOwnRun(runs, '')).toEqual(runs)
  })
})

describe('autoMergeBlockers: unresolved conversations', () => {
  const SHA2 = 'f'.repeat(40)
  const clear = {
    enabled: true,
    isDraft: false,
    mergeable: true,
    everyCheckGreen: true,
    cleanReview: true,
    reviewedSha: SHA2,
    headSha: SHA2,
    unresolvedThreads: [],
  }

  it('names the unresolved conversations that the ruleset will block on', () => {
    // Codex finding (PR #931, P2): a P3 raised alongside a P1 is never
    // dispatched, so its thread stays open forever; the ruleset then refuses
    // the merge and nothing anywhere says why. The pipeline dead-ends.
    const blockers = autoMergeBlockers({
      ...clear,
      unresolvedThreads: [
        { path: 'src/a.ts', isOutdated: false },
        { path: 'src/b.ts', isOutdated: true },
      ],
    })
    expect(blockers).toHaveLength(1)
    expect(blockers[0]).toContain('2 unresolved review conversation(s)')
    expect(blockers[0]).toContain('src/a.ts')
    expect(blockers[0]).toContain('src/b.ts')
    expect(blockers[0]).toContain('(outdated)')
  })

  it('does not silently resolve them — it only reports them', () => {
    // The alternative fix (auto-resolving threads nobody acted on) would
    // assert work that never happened, which is the same class of lie as the
    // "pushed the change" message that pushed nothing.
    const blockers = autoMergeBlockers({ ...clear, unresolvedThreads: [{ path: 'x', isOutdated: false }] })
    expect(blockers[0]).toContain('resolved')
    expect(blockers[0]).not.toContain('automatically')
  })

  it('truncates a long list but still says how many were hidden', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ path: `f${i}.ts`, isOutdated: false }))
    const blockers = autoMergeBlockers({ ...clear, unresolvedThreads: many })
    expect(blockers[0]).toContain('9 unresolved')
    expect(blockers[0]).toContain('+4 more')
  })
})
