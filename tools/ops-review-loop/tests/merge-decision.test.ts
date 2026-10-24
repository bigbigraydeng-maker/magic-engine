import { describe, expect, it } from 'vitest'

import { MERGE_DECISION, decideMerge, summariseDecision } from '../src/merge-decision.mjs'

/** A sign-off object claiming both required roles have signed. */
const COMPLETE_SIGNOFF = { complete: true, present: ['codex-astra', 'claude-code'], missing: [] }

/** A sign-off object with one required role still outstanding. */
const INCOMPLETE_SIGNOFF = { complete: false, present: ['codex-astra'], missing: ['claude-code'] }

/** The old three roles, claimed complete. They must not open an A-level gate. */
const OLD_THREE_SIGNOFF = { complete: true, present: ['ziya', 'weizheng', 'direnjie'], missing: [] }

describe('decideMerge — drafts', () => {
  it('blocks a draft PR', () => {
    const result = decideMerge({ risk: 'C', draft: true, fork: false, signoff: COMPLETE_SIGNOFF })
    expect(result.pass).toBe(false)
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    expect(result.tier).toBe('blocked')
  })

  it('blocks a PR whose draft flag is missing, because absence is not readiness', () => {
    const result = decideMerge({ risk: 'C', draft: undefined, fork: false, signoff: COMPLETE_SIGNOFF })
    expect(result.pass).toBe(false)
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    expect(result.tier).toBe('blocked')
  })
})

describe('decideMerge — fork', () => {
  // The BLOCKER 三方审查 found: a caller could pass `fork` and this function
  // would silently drop it because the signature did not destructure it. These
  // tests fire on that shape — a rename that drops `fork` from the signature
  // fails the second one, not just the first.

  it('blocks a fork PR that would otherwise be auto-merged (B)', () => {
    const result = decideMerge({ risk: 'B', draft: false, fork: true, signoff: undefined })
    expect(result.pass).toBe(false)
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    expect(result.tier).toBe('blocked')
    expect(result.reason).toContain('fork')
  })

  it('blocks a fork PR that would otherwise be auto-merged (C)', () => {
    const result = decideMerge({ risk: 'C', draft: false, fork: true, signoff: undefined })
    expect(result.pass).toBe(false)
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    expect(result.tier).toBe('blocked')
  })

  it('blocks a fork PR at A even when both sign-offs are present', () => {
    const result = decideMerge({ risk: 'A', draft: false, fork: true, signoff: COMPLETE_SIGNOFF })
    expect(result.pass).toBe(false)
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    expect(result.tier).toBe('blocked')
  })

  it('blocks when fork is missing, because absence is not proof it is same-repo', () => {
    const result = decideMerge({ risk: 'C', draft: false, fork: undefined, signoff: undefined })
    expect(result.pass).toBe(false)
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    expect(result.tier).toBe('blocked')
  })

  it('blocks when fork is a non-boolean truthy value', () => {
    const result = decideMerge({
      risk: 'C',
      draft: false,
      fork: 'true',
      signoff: undefined,
    })
    expect(result.pass).toBe(false)
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
  })
})

describe('decideMerge — B and C', () => {
  it('enables auto-merge for a non-draft B PR from the same repo', () => {
    const result = decideMerge({ risk: 'B', draft: false, fork: false, signoff: undefined })
    expect(result.pass).toBe(true)
    expect(result.decision).toBe(MERGE_DECISION.ENABLE_AUTO_MERGE)
    expect(result.tier).toBe('auto')
  })

  it('enables auto-merge for a non-draft C PR from the same repo', () => {
    const result = decideMerge({ risk: 'C', draft: false, fork: false, signoff: undefined })
    expect(result.pass).toBe(true)
    expect(result.decision).toBe(MERGE_DECISION.ENABLE_AUTO_MERGE)
    expect(result.tier).toBe('auto')
  })

  it('auto-merges B and C even when every reviewer, old or new, is listed as missing', () => {
    const signoff = {
      complete: false,
      present: [],
      missing: ['ziya', 'weizheng', 'direnjie', 'codex-astra', 'claude-code'],
    }
    for (const risk of ['B', 'C']) {
      const result = decideMerge({ risk, draft: false, fork: false, signoff })
      expect(result.pass, risk).toBe(true)
      expect(result.decision, risk).toBe(MERGE_DECISION.ENABLE_AUTO_MERGE)
      expect(result.tier, risk).toBe('auto')
    }
  })
})

describe('decideMerge — A', () => {
  it('passes but never auto-merges a fully signed A PR', () => {
    const result = decideMerge({ risk: 'A', draft: false, fork: false, signoff: COMPLETE_SIGNOFF })
    expect(result.pass).toBe(true)
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    expect(result.tier).toBe('signed')
  })

  it('blocks an A PR with a role still missing, and names the role', () => {
    const result = decideMerge({ risk: 'A', draft: false, fork: false, signoff: INCOMPLETE_SIGNOFF })
    expect(result.pass).toBe(false)
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    expect(result.reason).toContain('claude-code')
  })

  it('blocks an A PR with no sign-off input, and names both required roles', () => {
    const result = decideMerge({ risk: 'A', draft: false, fork: false, signoff: undefined })
    expect(result.pass).toBe(false)
    expect(result.reason).toContain('codex-astra')
    expect(result.reason).toContain('claude-code')
    expect(result.reason).not.toContain('ziya')
  })

  it('does not treat the old three roles as a completed A-level sign-off', () => {
    const result = decideMerge({ risk: 'A', draft: false, fork: false, signoff: OLD_THREE_SIGNOFF })
    expect(result.pass).toBe(false)
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    expect(result.tier).toBe('blocked')
  })

  it('does not accept a malformed claim of completeness', () => {
    const result = decideMerge({
      risk: 'A',
      draft: false,
      fork: false,
      signoff: { complete: true, missing: 'not-an-array' },
    })
    expect(result.pass).toBe(false)
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
  })
})

describe('decideMerge — unrecognised risk', () => {
  it('treats an unknown level as A and says so', () => {
    const result = decideMerge({ risk: 'nonsense', draft: false, fork: false, signoff: COMPLETE_SIGNOFF })
    expect(result.pass).toBe(false)
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    expect(result.reason).toContain('级别不可识别')
  })
})

describe('decideMerge — the enable implication holds over every combination', () => {
  // Enumerated rather than sampled: the whole point is that no future edit can
  // sneak a new path to `enable` that skips the invariants.
  it('never enables auto-merge unless pass && tier === auto', () => {
    const risks = ['A', 'B', 'C', 'X']
    const drafts = [true, false, undefined]
    const forks = [true, false, undefined]
    const signoffs = [undefined, COMPLETE_SIGNOFF, INCOMPLETE_SIGNOFF]

    for (const risk of risks) {
      for (const draft of drafts) {
        for (const fork of forks) {
          for (const signoff of signoffs) {
            const result = decideMerge({ risk, draft, fork, signoff })
            if (result.decision === MERGE_DECISION.ENABLE_AUTO_MERGE) {
              expect(result.pass, `enable but not pass: ${JSON.stringify({ risk, draft, fork, signoff })}`).toBe(true)
              expect(result.tier, `enable but tier != auto: ${JSON.stringify({ risk, draft, fork, signoff })}`).toBe(
                'auto',
              )
              // And the conditions that made it enable-eligible must all hold.
              expect(draft, `enable but draft !== false`).toBe(false)
              expect(fork, `enable but fork !== false`).toBe(false)
              expect(risk === 'B' || risk === 'C', `enable but risk not in {B,C}`).toBe(true)
            }
          }
        }
      }
    }
  })

  it('never leaves auto-merge enabled on a failing result', () => {
    // A caller reads `decision` to decide whether to call `gh pr merge --auto`
    // or `--disable-auto`. If any failing branch returned `enable`, a stale
    // auto-merge could ride out a later failing evaluation.
    const risks = ['A', 'B', 'C', 'X']
    const drafts = [true, false, undefined]
    const forks = [true, false, undefined]
    const signoffs = [undefined, COMPLETE_SIGNOFF, INCOMPLETE_SIGNOFF]

    for (const risk of risks) {
      for (const draft of drafts) {
        for (const fork of forks) {
          for (const signoff of signoffs) {
            const result = decideMerge({ risk, draft, fork, signoff })
            if (result.pass !== true) {
              expect(result.decision, `pass false but decision enable: ${JSON.stringify({ risk, draft, fork })}`).toBe(
                MERGE_DECISION.DISABLE_AUTO_MERGE,
              )
            }
          }
        }
      }
    }
  })
})

describe('summariseDecision', () => {
  it('renders the ignored-marker line only when the count is positive', () => {
    const decision = decideMerge({ risk: 'C', draft: false, fork: false, signoff: undefined })

    const withIgnored = summariseDecision({
      risk: 'C',
      reasons: ['docs/a.md —— C 级（文档）'],
      decision,
      ignoredMarkers: 2,
    })
    expect(withIgnored).toContain('- 忽略了 2 条非可信身份写的标记')

    const withoutIgnored = summariseDecision({
      risk: 'C',
      reasons: ['docs/a.md —— C 级（文档）'],
      decision,
      ignoredMarkers: 0,
    })
    expect(withoutIgnored).not.toContain('忽略了')
  })

  it('renders （无） when reasons is not an array', () => {
    const decision = decideMerge({ risk: 'C', draft: false, fork: false, signoff: undefined })
    const summary = summariseDecision({ risk: 'C', reasons: undefined, decision })
    expect(summary).toContain('  - （无）')
  })
})
