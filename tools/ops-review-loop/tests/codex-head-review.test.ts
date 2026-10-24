/**
 * Codex's real review shape, pinned to pulls observed on 2026-10-24.
 *
 * Clean (#3086, #3091): no pull-request review object. An issue comment holds
 * `codex-review-state:v1` with the full commit sha. The receipt only has a
 * short sha and "Didn't find any major issues".
 *
 * Findings (#3080): a review whose `commit_id` is the full head, plus an
 * inline comment with a shields badge. P2 does not block. P0/P1 do, until
 * the thread is resolved. An untrusted login is ignored.
 */
import { describe, expect, it } from 'vitest'

import { MERGE_DECISION, decideMerge } from '../src/merge-decision.mjs'
import { evaluateCodexHeadReview, parseCodexReviewStates } from '../src/signoff-marker.mjs'

const HEAD = '8d6681811dd6e88a23ade4bddff0b474e689ede3'
const OLD = '4e40ad46a7ab4da7ed2c9e098caf04c1801863de'
const CODEX = 'chatgpt-codex-connector[bot]'

function stateComment(sha: string, unresolved = false) {
  const payload = {
    code_review: {
      commit_sha: sha,
      has_any_findings: unresolved,
      has_unresolved_findings: unresolved,
      status: 'completed',
    },
  }
  return `<!-- codex-review-state:v1 ${JSON.stringify(payload)} -->`
}

const CLEAN_RECEIPT = `<!-- codex-review-receipt:v1 -->

Codex Review: Didn't find any major issues. Delightful!

**Reviewed commit:** \`8d6681811d\`
`

function finding(severity: 'P0' | 'P1' | 'P2') {
  return `**<sub><sub>![${severity} Badge](https://img.shields.io/badge/${severity}-yellow?style=flat)</sub></sub>  example**

<!-- codex-code-review-finding:v1 -->`
}

function reviewOf(input: Parameters<typeof evaluateCodexHeadReview>[0]) {
  return evaluateCodexHeadReview({
    trustedLogin: CODEX,
    prAuthor: 'someone',
    threads: [],
    threadsReadable: true,
    reviews: [],
    comments: [],
    ...input,
  })
}

describe('parseCodexReviewStates', () => {
  it('reads the full sha from the state comment Codex posts', () => {
    const parsed = parseCodexReviewStates(stateComment(HEAD))
    expect(parsed).toEqual([{ commitSha: HEAD }])
  })

  it('ignores a receipt that only carries a short sha', () => {
    expect(parseCodexReviewStates(CLEAN_RECEIPT)).toEqual([])
  })
})

describe('evaluateCodexHeadReview', () => {
  it('does not clear a head Codex has not reviewed', () => {
    const result = reviewOf({ head: HEAD })
    expect(result.clear).toBe(false)
    expect(result.reviewed).toBe(false)
    expect(decideMerge({ risk: 'B', draft: false, fork: false, codexReview: result }).decision).toBe(
      MERGE_DECISION.DISABLE_AUTO_MERGE,
    )
  })

  it('does not treat a receipt with no state blob as a review of this head', () => {
    const result = reviewOf({
      head: HEAD,
      comments: [{ author: CODEX, body: CLEAN_RECEIPT }],
    })
    expect(result.clear).toBe(false)
    expect(result.reviewed).toBe(false)
  })

  it('clears the current head when the state comment names it and nothing is unresolved P0/P1', () => {
    const result = reviewOf({
      head: HEAD,
      comments: [{ author: CODEX, body: stateComment(HEAD) }],
    })
    expect(result.clear).toBe(true)
    expect(result.reviewed).toBe(true)
    expect(decideMerge({ risk: 'C', draft: false, fork: false, codexReview: result }).decision).toBe(
      MERGE_DECISION.ENABLE_AUTO_MERGE,
    )
  })

  it('accepts the GraphQL login, which drops the [bot] suffix', () => {
    const result = reviewOf({
      head: HEAD,
      comments: [{ author: 'chatgpt-codex-connector', body: stateComment(HEAD) }],
    })
    expect(result.clear).toBe(true)
  })

  it('does not clear when the review is bound to an older head, and the decision disables auto-merge', () => {
    const result = reviewOf({
      head: HEAD,
      comments: [{ author: CODEX, body: stateComment(OLD) }],
      reviews: [{ author: CODEX, commitId: OLD, state: 'COMMENTED', body: 'suggestions' }],
    })
    expect(result.clear).toBe(false)
    expect(result.reviewed).toBe(false)
    expect(result.reason).toContain('更早的提交')
    const decision = decideMerge({ risk: 'B', draft: false, fork: false, codexReview: result })
    expect(decision.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    expect(decision.pass).toBe(false)
  })

  it('clears an unresolved P2 and blocks an unresolved P1 on the current head', () => {
    const comments = [{ author: CODEX, body: stateComment(HEAD, true) }]
    const p2 = reviewOf({
      head: HEAD,
      comments,
      threads: [{ resolved: false, comments: [{ author: CODEX, commitId: HEAD, body: finding('P2') }] }],
    })
    expect(p2.clear).toBe(true)

    const p1 = reviewOf({
      head: HEAD,
      comments,
      threads: [{ resolved: false, comments: [{ author: CODEX, commitId: HEAD, body: finding('P1') }] }],
    })
    expect(p1.clear).toBe(false)
    expect(p1.blocking).toBe(1)
    expect(decideMerge({ risk: 'B', draft: false, fork: false, codexReview: p1 }).decision).toBe(
      MERGE_DECISION.DISABLE_AUTO_MERGE,
    )
  })

  it('clears a P0 once its thread is resolved', () => {
    const result = reviewOf({
      head: HEAD,
      comments: [{ author: CODEX, body: stateComment(HEAD, true) }],
      threads: [{ resolved: true, comments: [{ author: CODEX, commitId: HEAD, body: finding('P0') }] }],
    })
    expect(result.clear).toBe(true)
  })

  it('ignores an untrusted login, the actions bot, and the PR author', () => {
    const body = stateComment(HEAD)
    expect(reviewOf({ head: HEAD, comments: [{ author: 'random-user', body }] }).clear).toBe(false)
    expect(
      reviewOf({
        head: HEAD,
        trustedLogin: 'github-actions[bot]',
        comments: [{ author: 'github-actions[bot]', body }],
      }).clear,
    ).toBe(false)
    expect(
      reviewOf({
        head: HEAD,
        prAuthor: CODEX,
        comments: [{ author: CODEX, body }],
      }).clear,
    ).toBe(false)
  })

  it('does not clear when the thread list could not be read', () => {
    const result = reviewOf({
      head: HEAD,
      comments: [{ author: CODEX, body: stateComment(HEAD) }],
      threadsReadable: false,
    })
    expect(result.reviewed).toBe(true)
    expect(result.clear).toBe(false)
  })

  it('counts a pull-request review commit_id when no state comment exists', () => {
    const result = reviewOf({
      head: HEAD,
      reviews: [{ author: CODEX, commitId: HEAD, state: 'COMMENTED', body: 'Here are some automated review suggestions' }],
    })
    expect(result.clear).toBe(true)
  })
})
