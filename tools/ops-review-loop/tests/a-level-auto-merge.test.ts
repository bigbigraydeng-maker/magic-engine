import { describe, expect, it } from 'vitest'

import { MERGE_DECISION, decideMerge } from '../src/merge-decision.mjs'
import { requiredChecksAreGreen } from '../src/required-checks.mjs'
import { assessRayMergeHold } from '../src/risk.mjs'
import {
  buildSignoffMarker,
  evaluateClaudeHeadSignoff,
  evaluateCodexHeadReview,
  parseSignoffMarkers,
  reviewConversationsResolved,
} from '../src/signoff-marker.mjs'

const HEAD = '41df899e3454e6df9ab2dbee536bf27330d38a55'
const OLD = '4e40ad46a7ab4da7ed2c9e098caf04c1801863de'
const BASE = '430416afda1dddb5aae0fd9d2b0f685e415e2a5f'
const CODEX = 'chatgpt-codex-connector[bot]'
const CLAUDE = 'claude[bot]'
const AUTHOR = 'pr-author'

function codexComment(sha: string) {
  const payload = { code_review: { commit_sha: sha, status: 'completed', has_unresolved_findings: false } }
  return { author: CODEX, body: `<!-- codex-review-state:v1 ${JSON.stringify(payload)} -->` }
}

function claudeMarker(head: string, base = BASE) {
  const [marker] = parseSignoffMarkers([buildSignoffMarker({ base, head, role: 'claude-code' })])
  return { ...marker, author: CLAUDE }
}

function ready(overrides: Record<string, unknown> = {}) {
  return decideMerge({
    risk: 'A',
    draft: false,
    fork: false,
    codexReview: { clear: true },
    claudeSignoff: { clear: true },
    requiredChecksGreen: true,
    conversationsResolved: true,
    rayHold: false,
    ...overrides,
  })
}

describe('A-level auto-merge', () => {
  it('enables when both sign-offs are on this head, checks are green, and every thread is resolved', () => {
    const codexReview = evaluateCodexHeadReview({
      head: HEAD,
      trustedLogin: CODEX,
      prAuthor: AUTHOR,
      comments: [codexComment(HEAD)],
      reviews: [],
      threads: [],
      threadsReadable: true,
    })
    const claudeSignoff = evaluateClaudeHeadSignoff({
      head: HEAD,
      trustedLogin: CLAUDE,
      prAuthor: AUTHOR,
      comments: [],
      reviews: [],
      markers: [claudeMarker(HEAD, OLD)],
      threads: [],
      threadsReadable: true,
    })
    expect(codexReview.clear).toBe(true)
    expect(claudeSignoff.clear).toBe(true)
    const result = decideMerge({
      risk: 'A',
      draft: false,
      fork: false,
      codexReview,
      claudeSignoff,
      requiredChecksGreen: true,
      conversationsResolved: reviewConversationsResolved({ threads: [], threadsReadable: true }).resolved,
      rayHold: false,
    })
    expect(result.decision).toBe(MERGE_DECISION.ENABLE_AUTO_MERGE)
    expect(result.pass).toBe(true)
    expect(result.tier).toBe('auto')
  })

  it('does not enable when Claude has not signed this head', () => {
    const result = ready({ claudeSignoff: { clear: false, reason: 'Claude Code 还没签过当前这次提交' } })
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    expect(result.pass).toBe(false)
    expect(result.reason).toContain('Claude Code')
  })

  it('does not enable when either sign-off is for an older head', () => {
    const codexReview = evaluateCodexHeadReview({
      head: HEAD,
      trustedLogin: CODEX,
      prAuthor: AUTHOR,
      comments: [codexComment(OLD)],
      reviews: [],
      threads: [],
      threadsReadable: true,
    })
    const claudeSignoff = evaluateClaudeHeadSignoff({
      head: HEAD,
      trustedLogin: CLAUDE,
      prAuthor: AUTHOR,
      comments: [],
      reviews: [{ author: CLAUDE, commitId: OLD, state: 'APPROVED', body: 'LGTM' }],
      markers: [claudeMarker(OLD)],
      threads: [],
      threadsReadable: true,
    })
    expect(codexReview.clear).toBe(false)
    expect(codexReview.reason).toContain('更早的提交')
    expect(claudeSignoff.clear).toBe(false)
    expect(claudeSignoff.reason).toContain('更早的提交')
    const result = decideMerge({
      risk: 'A',
      draft: false,
      fork: false,
      codexReview,
      claudeSignoff,
      requiredChecksGreen: true,
      conversationsResolved: true,
      rayHold: false,
    })
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
  })

  it('accepts an APPROVED review or an explicit sign-off comment on this head, and ignores "no P0/P1" prose', () => {
    const approved = evaluateClaudeHeadSignoff({
      head: HEAD,
      trustedLogin: CLAUDE,
      prAuthor: AUTHOR,
      reviews: [{ author: 'claude', commitId: HEAD, state: 'APPROVED', body: 'Signed off. No unresolved P0/P1.' }],
      threads: [],
      threadsReadable: true,
    })
    const comment = evaluateClaudeHeadSignoff({
      head: HEAD,
      trustedLogin: CLAUDE,
      prAuthor: AUTHOR,
      comments: [{ author: CLAUDE, body: `LGTM ${HEAD}. no P0/P1 left.` }],
      threads: [],
      threadsReadable: true,
    })
    expect(approved.clear).toBe(true)
    expect(comment.clear).toBe(true)
  })

  it('does not let the PR author or an open P0 thread count as Claude sign-off', () => {
    const author = evaluateClaudeHeadSignoff({
      head: HEAD,
      trustedLogin: CLAUDE,
      prAuthor: CLAUDE,
      comments: [{ author: CLAUDE, body: `LGTM ${HEAD}` }],
      threads: [],
      threadsReadable: true,
    })
    const finding = evaluateClaudeHeadSignoff({
      head: HEAD,
      trustedLogin: CLAUDE,
      prAuthor: AUTHOR,
      reviews: [{ author: CLAUDE, commitId: HEAD, state: 'APPROVED', body: 'LGTM' }],
      threads: [
        {
          resolved: false,
          comments: [{ author: CLAUDE, commitId: HEAD, body: 'P0: this still charges the wrong account' }],
        },
      ],
      threadsReadable: true,
    })
    expect(author.clear).toBe(false)
    expect(finding.clear).toBe(false)
    expect(finding.reason).toContain('P0/P1')
  })

  it('treats an open P2 thread as a conversation that blocks A, without calling it a P0/P1', () => {
    const claudeSignoff = evaluateClaudeHeadSignoff({
      head: HEAD,
      trustedLogin: CLAUDE,
      prAuthor: AUTHOR,
      markers: [claudeMarker(HEAD)],
      threads: [{ resolved: false, comments: [{ author: CODEX, commitId: HEAD, body: 'P2: rename this' }] }],
      threadsReadable: true,
    })
    const conversations = reviewConversationsResolved({
      threads: [{ resolved: false, comments: [] }],
      threadsReadable: true,
    })
    expect(claudeSignoff.clear).toBe(true)
    expect(conversations.resolved).toBe(false)
    expect(ready({ conversationsResolved: false }).decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
  })
})

describe('paths Ray still merges by hand', () => {
  const held = (filename: string) => assessRayMergeHold([{ filename }])

  it('holds a migration, a Meta token file, and Meta campaign or budget writes', () => {
    for (const path of [
      'supabase/migrations/20261025_one.sql',
      'src/lib/meta/token-manager.ts',
      'src/lib/meta/campaign-writes.ts',
    ]) {
      const result = held(path)
      expect(result.hold, path).toBe(true)
      expect(
        decideMerge({
          risk: 'A',
          draft: false,
          fork: false,
          codexReview: { clear: true },
          claudeSignoff: { clear: true },
          requiredChecksGreen: true,
          conversationsResolved: true,
          rayHold: result.hold,
        }).decision,
      ).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    }
  })

  it('holds a rename out of a migration path', () => {
    const result = assessRayMergeHold([
      { filename: 'docs/moved.md', previous_filename: 'supabase/migrations/20261025_one.sql', status: 'renamed' },
    ])
    expect(result.hold).toBe(true)
  })

  it('does not hold kernel code, a sitemap budget, Meta insights, or a non-Meta budget', () => {
    for (const path of [
      'src/lib/kernel/state.ts',
      'src/lib/site-audit/sitemap-budget.ts',
      'src/lib/meta/campaign-insights.ts',
      'src/lib/google-ads/budget.ts',
    ]) {
      expect(held(path).hold, path).toBe(false)
    }
  })

  it('fails closed when the file list cannot be read, and a held path blocks B as well', () => {
    expect(assessRayMergeHold(undefined).hold).toBe(true)
    expect(assessRayMergeHold([]).hold).toBe(true)
    const result = decideMerge({
      risk: 'B',
      draft: false,
      fork: false,
      codexReview: { clear: true },
      rayHold: true,
    })
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    expect(result.needsRayMerge).toBe(true)
    expect(result.reason).toContain('Ray')
  })
})

describe('required checks', () => {
  it('ignores a red Risk gate and still requires every other required check', () => {
    expect(
      requiredChecksAreGreen({
        requiredNames: ['Risk gate', 'ops-review-loop-tests'],
        checks: [
          { name: 'Risk gate', status: 'completed', conclusion: 'failure' },
          { name: 'ops-review-loop-tests', status: 'completed', conclusion: 'success' },
        ],
        checksReadable: true,
      }),
    ).toBe(true)
  })

  it('fails closed when the only required check is this gate, or the rollup is unread', () => {
    expect(
      requiredChecksAreGreen({
        requiredNames: ['Risk gate'],
        checks: [{ name: 'Risk gate', status: 'completed', conclusion: 'success' }],
        checksReadable: true,
      }),
    ).toBe(false)
    expect(
      requiredChecksAreGreen({
        requiredNames: ['ops-review-loop-tests'],
        checks: [],
        checksReadable: false,
      }),
    ).toBe(false)
    expect(requiredChecksAreGreen({ requiredNames: [], checks: [], checksReadable: true })).toBe(false)
  })
})
