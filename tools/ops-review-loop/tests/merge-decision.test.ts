import { describe, expect, it } from 'vitest'

import { MERGE_DECISION, decideMerge, summariseDecision } from '../src/merge-decision.mjs'

/** A sign-off object claiming all three roles have signed. */
const COMPLETE_SIGNOFF = { complete: true, present: ['ziya', 'weizheng', 'direnjie'], missing: [] }

/** A sign-off object with one role still outstanding. */
const INCOMPLETE_SIGNOFF = { complete: false, present: ['ziya', 'weizheng'], missing: ['direnjie'] }

describe('decideMerge — drafts', () => {
  it('blocks a draft PR', () => {
    const result = decideMerge({ risk: 'C', draft: true, signoff: COMPLETE_SIGNOFF })
    expect(result.pass).toBe(false)
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    expect(result.tier).toBe('blocked')
  })

  it('blocks a PR whose draft flag is missing, because absence is not readiness', () => {
    const result = decideMerge({ risk: 'C', draft: undefined, signoff: COMPLETE_SIGNOFF })
    expect(result.pass).toBe(false)
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    expect(result.tier).toBe('blocked')
  })
})

describe('decideMerge — B and C', () => {
  it('enables auto-merge for a non-draft B PR', () => {
    const result = decideMerge({ risk: 'B', draft: false, signoff: undefined })
    expect(result.pass).toBe(true)
    expect(result.decision).toBe(MERGE_DECISION.ENABLE_AUTO_MERGE)
    expect(result.tier).toBe('auto')
  })

  it('enables auto-merge for a non-draft C PR', () => {
    const result = decideMerge({ risk: 'C', draft: false, signoff: undefined })
    expect(result.pass).toBe(true)
    expect(result.decision).toBe(MERGE_DECISION.ENABLE_AUTO_MERGE)
    expect(result.tier).toBe('auto')
  })
})

describe('decideMerge — A', () => {
  it('passes but never auto-merges a fully signed A PR', () => {
    const result = decideMerge({ risk: 'A', draft: false, signoff: COMPLETE_SIGNOFF })
    expect(result.pass).toBe(true)
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    expect(result.tier).toBe('signed')
  })

  it('blocks an A PR with a role still missing, and names the role', () => {
    const result = decideMerge({ risk: 'A', draft: false, signoff: INCOMPLETE_SIGNOFF })
    expect(result.pass).toBe(false)
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    expect(result.reason).toContain('direnjie')
  })

  it('blocks an A PR with no sign-off input, and names all three roles', () => {
    const result = decideMerge({ risk: 'A', draft: false, signoff: undefined })
    expect(result.pass).toBe(false)
    expect(result.reason).toContain('ziya')
    expect(result.reason).toContain('weizheng')
    expect(result.reason).toContain('direnjie')
  })

  it('does not accept a malformed claim of completeness', () => {
    const result = decideMerge({
      risk: 'A',
      draft: false,
      signoff: { complete: true, missing: 'not-an-array' },
    })
    expect(result.pass).toBe(false)
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
  })
})

describe('decideMerge — unrecognised risk', () => {
  it('treats an unknown level as A and says so', () => {
    const result = decideMerge({ risk: 'nonsense', draft: false, signoff: COMPLETE_SIGNOFF })
    expect(result.pass).toBe(false)
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    expect(result.reason).toContain('级别不可识别')
  })
})

describe('decideMerge — the enable implication', () => {
  it('never enables auto-merge unless the decision passed at the auto tier', () => {
    const risks = ['A', 'B', 'C', 'X']
    const drafts = [true, false, undefined]
    const signoffs = [undefined, COMPLETE_SIGNOFF, INCOMPLETE_SIGNOFF]

    for (const risk of risks) {
      for (const draft of drafts) {
        for (const signoff of signoffs) {
          const result = decideMerge({ risk, draft, signoff })
          if (result.decision === MERGE_DECISION.ENABLE_AUTO_MERGE) {
            expect(result.pass).toBe(true)
            expect(result.tier).toBe('auto')
          }
        }
      }
    }
  })
})

describe('summariseDecision', () => {
  it('renders the ignored-marker line only when the count is positive', () => {
    const decision = decideMerge({ risk: 'C', draft: false, signoff: undefined })

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
    const decision = decideMerge({ risk: 'C', draft: false, signoff: undefined })
    const summary = summariseDecision({ risk: 'C', reasons: undefined, decision })
    expect(summary).toContain('  - （无）')
  })
})
