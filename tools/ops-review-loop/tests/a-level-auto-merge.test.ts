/**
 * A-level auto-merge: both reviews on this head, required checks green,
 * and no path Ray still merges by hand.
 */
import { describe, expect, it } from 'vitest'

import { MERGE_DECISION, decideMerge, requiredChecksAreGreen } from '../src/merge-decision.mjs'
import { assessRayMergeHold } from '../src/risk.mjs'
import { buildSignoffMarker, evaluateClaudeHeadSignoff, evaluateCodexHeadReview } from '../src/signoff-marker.mjs'

const BASE = '430416afda1dddb5aae0fd9d2b0f685e415e2a5f'
const HEAD = '41df899e3454e6df9ab2dbee536bf27330d38a55'
const NEWER = 'b8ae3e8b6015974044d3aff0c0a525d09368c9a1'
const CODEX = 'chatgpt-codex-connector[bot]'
const CLAUDE = 'claude[bot]'

const CODEX_CLEAR = { clear: true, reason: 'Codex 已审过当前这次提交，没有未解决的 P0/P1' }
const CLAUDE_CLEAR = { clear: true, reason: 'Claude Code 已签当前这次提交，没有未解决的 P0/P1' }

function stateComment(sha: string) {
  return `<!-- codex-review-state:v1 ${JSON.stringify({
    code_review: { commit_sha: sha, status: 'completed', has_any_findings: false, has_unresolved_findings: false },
  })} -->`
}

function claudeComment(base: string, head: string) {
  return buildSignoffMarker({ base, head, role: 'claude-code' })
}

function readyA(rayHold: boolean) {
  return decideMerge({
    risk: 'A',
    draft: false,
    fork: false,
    codexReview: CODEX_CLEAR,
    claudeSignoff: CLAUDE_CLEAR,
    requiredChecksGreen: true,
    rayHold,
  })
}

describe('A-level auto-merge', () => {
  it('enables when both sign-offs are on this head and the required checks are green', () => {
    const result = readyA(false)
    expect(result.pass).toBe(true)
    expect(result.decision).toBe(MERGE_DECISION.ENABLE_AUTO_MERGE)
    expect(result.tier).toBe('auto')
    expect(result.needsRayMerge).toBe(false)
  })

  it('holds a migration-path PR even when both reviews are clear and the checks are green', () => {
    const hold = assessRayMergeHold([{ filename: 'supabase/migrations/20261025_one.sql' }])
    expect(hold.hold).toBe(true)
    const result = readyA(hold.hold)
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    expect(result.pass).toBe(false)
    expect(result.needsRayMerge).toBe(true)
  })

  it('a new push invalidates both the Codex review and the Claude sign-off', () => {
    const codex = evaluateCodexHeadReview({
      head: NEWER,
      trustedLogin: CODEX,
      prAuthor: 'someone',
      comments: [{ author: CODEX, body: stateComment(HEAD) }],
      reviews: [],
      threads: [],
      threadsReadable: true,
    })
    const claude = evaluateClaudeHeadSignoff({
      base: BASE,
      head: NEWER,
      trustedLogin: CLAUDE,
      prAuthor: 'someone',
      sources: [{ author: CLAUDE, body: claudeComment(BASE, HEAD) }],
      threads: [],
      threadsReadable: true,
    })
    expect(codex.clear).toBe(false)
    expect(claude.clear).toBe(false)
    const result = decideMerge({
      risk: 'A',
      draft: false,
      fork: false,
      codexReview: codex,
      claudeSignoff: claude,
      requiredChecksGreen: true,
      rayHold: false,
    })
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    expect(result.pass).toBe(false)
  })

  it('accepts the same head for both reviews', () => {
    const codex = evaluateCodexHeadReview({
      head: HEAD,
      trustedLogin: CODEX,
      prAuthor: 'someone',
      comments: [{ author: CODEX, body: stateComment(HEAD) }],
      reviews: [],
      threads: [],
      threadsReadable: true,
    })
    const claude = evaluateClaudeHeadSignoff({
      base: BASE,
      head: HEAD,
      trustedLogin: CLAUDE,
      prAuthor: 'someone',
      sources: [{ author: CLAUDE, body: claudeComment(BASE, HEAD) }],
      threads: [],
      threadsReadable: true,
    })
    expect(codex.clear).toBe(true)
    expect(claude.clear).toBe(true)
    expect(
      decideMerge({
        risk: 'A',
        draft: false,
        fork: false,
        codexReview: codex,
        claudeSignoff: claude,
        requiredChecksGreen: true,
        rayHold: false,
      }).decision,
    ).toBe(MERGE_DECISION.ENABLE_AUTO_MERGE)
  })

  it('does not let a Claude P2 block, and does let an unresolved P1 block', () => {
    const p2 = evaluateClaudeHeadSignoff({
      base: BASE,
      head: HEAD,
      trustedLogin: CLAUDE,
      prAuthor: 'someone',
      sources: [{ author: CLAUDE, body: claudeComment(BASE, HEAD) }],
      threadsReadable: true,
      threads: [{ resolved: false, comments: [{ author: CLAUDE, commitId: HEAD, body: 'P2 suggestion' }] }],
    })
    expect(p2.clear).toBe(true)
    const p1 = evaluateClaudeHeadSignoff({
      base: BASE,
      head: HEAD,
      trustedLogin: CLAUDE,
      prAuthor: 'someone',
      sources: [{ author: CLAUDE, body: claudeComment(BASE, HEAD) }],
      threadsReadable: true,
      threads: [{ resolved: false, comments: [{ author: CLAUDE, commitId: HEAD, body: 'P1 must fix' }] }],
    })
    expect(p1.clear).toBe(false)
  })
})

describe('paths Ray still merges by hand', () => {
  it('holds SQL, token storage, and ad-spend writes', () => {
    for (const filename of [
      'notes/manual.sql',
      'src/lib/meta/token-manager.ts',
      'src/lib/meta/campaign-writes.ts',
      'src/lib/capabilities/ads/cut-campaign-budget.ts',
      '.env.local',
    ]) {
      expect(assessRayMergeHold([{ filename }]).hold, filename).toBe(true)
    }
  })

  it('does not hold a kernel change or a non-ad budget file', () => {
    expect(assessRayMergeHold([{ filename: 'src/lib/kernel/state.ts' }]).hold).toBe(false)
    expect(assessRayMergeHold([{ filename: 'src/lib/site-audit/sitemap-budget.ts' }]).hold).toBe(false)
  })

  it('holds a rename whose old path was a migration', () => {
    const hold = assessRayMergeHold([
      { filename: 'docs/moved.md', previous_filename: 'supabase/migrations/001.sql', status: 'renamed' },
    ])
    expect(hold.hold).toBe(true)
  })

  it('holds an unreadable file list', () => {
    expect(assessRayMergeHold(undefined).hold).toBe(true)
    expect(assessRayMergeHold([]).hold).toBe(true)
  })
})

describe('requiredChecksAreGreen', () => {
  it('ignores this gate and requires every other required check to be a completed success', () => {
    const checks = [
      { name: 'Risk gate', status: 'completed', conclusion: 'failure' },
      { name: 'ops-review-loop-tests', status: 'completed', conclusion: 'success' },
    ]
    expect(requiredChecksAreGreen({ required: ['Risk gate', 'ops-review-loop-tests'], checks })).toBe(true)
    expect(
      requiredChecksAreGreen({
        required: ['Risk gate', 'ops-review-loop-tests'],
        checks: [{ name: 'ops-review-loop-tests', status: 'completed', conclusion: 'failure' }],
      }),
    ).toBe(false)
    expect(requiredChecksAreGreen({ required: ['Risk gate'], checks })).toBe(false)
    expect(requiredChecksAreGreen({ required: [], checks })).toBe(false)
  })
})
