import { describe, expect, it } from 'vitest'

import { MERGE_DECISION, decideMerge, summariseDecision } from '../src/merge-decision.mjs'

/** A sign-off object claiming both required roles have signed. */
const COMPLETE_SIGNOFF = { complete: true, present: ['codex-astra', 'claude-code'], missing: [] }

/** A sign-off object with one required role still outstanding. */
const INCOMPLETE_SIGNOFF = { complete: false, present: ['codex-astra'], missing: ['claude-code'] }

/** The old three roles, claimed complete. They must not open an A-level gate. */
const OLD_THREE_SIGNOFF = { complete: true, present: ['ziya', 'weizheng', 'direnjie'], missing: [] }

/** Codex has reviewed the current head and left no unresolved P0/P1. */
const CODEX_CLEAR = { clear: true, reason: 'Codex 已审过当前这次提交，没有未解决的 P0/P1' }

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
    const result = decideMerge({ risk: 'B', draft: false, fork: true, signoff: undefined, codexReview: CODEX_CLEAR })
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

describe('decideMerge — B and C（签字和 p0 都不挡，Ray 2026-11-16）', () => {
  it('B 级直接开自动合并，不要任何人签字', () => {
    const result = decideMerge({ risk: 'B', draft: false, fork: false, p0: false, signoff: undefined })
    expect(result.pass).toBe(true)
    expect(result.decision).toBe(MERGE_DECISION.ENABLE_AUTO_MERGE)
    expect(result.tier).toBe('auto')
    expect(result.reason).toContain('都不挡')
  })

  it('不是 P0 的 C 级：同上', () => {
    const result = decideMerge({ risk: 'C', draft: false, fork: false, p0: false, signoff: undefined })
    expect(result.pass).toBe(true)
    expect(result.decision).toBe(MERGE_DECISION.ENABLE_AUTO_MERGE)
    expect(result.tier).toBe('auto')
  })

  it('🔴 Codex 那一签已经不是输入了 —— 它的审查 2026-10-15 被停用，等它就是永久阻塞', () => {
    for (const risk of ['B', 'C']) {
      const without = decideMerge({ risk, draft: false, fork: false, p0: false })
      const withStale = decideMerge({
        risk,
        draft: false,
        fork: false,
        p0: false,
        codexReview: { clear: false, reason: 'Codex 审的是更早的提交' },
      })
      expect(without.decision, risk).toBe(MERGE_DECISION.ENABLE_AUTO_MERGE)
      expect(withStale.decision, risk).toBe(MERGE_DECISION.ENABLE_AUTO_MERGE)
    }
  })

  it('人工抽查（子牙/魏征/狄仁杰）缺席不挡 B/C', () => {
    const signoff = {
      complete: false,
      present: [],
      missing: ['ziya', 'weizheng', 'direnjie', 'codex-astra', 'claude-code'],
    }
    for (const risk of ['B', 'C']) {
      const result = decideMerge({ risk, draft: false, fork: false, p0: false, signoff })
      expect(result.decision, risk).toBe(MERGE_DECISION.ENABLE_AUTO_MERGE)
    }
  })

  it('🔴 打了 p0、或读不到 p0、或签字没到，都不挡 B/C（Ray 2026-11-16）', () => {
    for (const risk of ['B', 'C']) {
      for (const p0 of [true, false, 'false', undefined, null, 'yes']) {
        const result = decideMerge({
          risk,
          draft: false,
          fork: false,
          p0,
          claudeSignoff: { clear: false, reason: '签的是更早的提交，当前这次还没签' },
        })
        expect(result.pass, `${risk} ${String(p0)}`).toBe(true)
        expect(result.decision, `${risk} ${String(p0)}`).toBe(MERGE_DECISION.ENABLE_AUTO_MERGE)
        expect(result.reason, `${risk} ${String(p0)}`).not.toContain('标了 p0')
        expect(result.reason, `${risk} ${String(p0)}`).not.toContain('读不到 p0')
      }
    }
  })

  it('🔴 A 级没签字也能放行：检查全绿、对话已解决、确认没碰到留给 Ray 的路径', () => {
    const result = decideMerge({
      risk: 'A',
      draft: false,
      fork: false,
      signoff: undefined,
      codexReview: { clear: false, reason: 'Codex 还没审' },
      claudeSignoff: { clear: false, reason: 'Claude Code 还没签过当前这次提交' },
      requiredChecksGreen: true,
      conversationsResolved: true,
      rayHold: false,
    })
    expect(result.pass).toBe(true)
    expect(result.decision).toBe(MERGE_DECISION.ENABLE_AUTO_MERGE)
    expect(result.tier).toBe('auto')
    expect(result.needsRayMerge).toBe(false)
    expect(result.reason).not.toContain('Claude Code')
  })

  it('🔴 A 级必过检查没绿，或对话没解决，照旧不放行', () => {
    const checksRed = decideMerge({
      risk: 'A',
      draft: false,
      fork: false,
      claudeSignoff: { clear: true },
      requiredChecksGreen: false,
      conversationsResolved: true,
      rayHold: false,
    })
    expect(checksRed.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    expect(checksRed.reason).toContain('必过检查还没全绿')

    const threadsOpen = decideMerge({
      risk: 'A',
      draft: false,
      fork: false,
      requiredChecksGreen: true,
      conversationsResolved: false,
      rayHold: false,
    })
    expect(threadsOpen.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    expect(threadsOpen.reason).toContain('审查对话')

    const stringly = decideMerge({
      risk: 'A',
      draft: false,
      fork: false,
      requiredChecksGreen: 'true',
      conversationsResolved: 'true',
      rayHold: false,
    })
    expect(stringly.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
  })

  it('🔴 A 级碰库表/Meta 凭证/广告花费（rayHold）→ 签了也不自动合', () => {
    const result = decideMerge({
      risk: 'A',
      draft: false,
      fork: false,
      claudeSignoff: { clear: true },
      requiredChecksGreen: true,
      conversationsResolved: true,
      rayHold: true,
    })
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    expect(result.needsRayMerge).toBe(true)
  })
})

describe('decideMerge — A', () => {
  it('does not treat a base-and-head marker pair as an A auto-merge by itself', () => {
    const result = decideMerge({ risk: 'A', draft: false, fork: false, signoff: COMPLETE_SIGNOFF, rayHold: false })
    expect(result.pass).toBe(false)
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    expect(result.tier).toBe('blocked')
  })

  it('A 级没签字、但检查和对话也没确认 → 仍拦住，原因不提签字', () => {
    const result = decideMerge({ risk: 'A', draft: false, fork: false, signoff: INCOMPLETE_SIGNOFF, rayHold: false })
    expect(result.pass).toBe(false)
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    expect(result.reason).toContain('必过检查还没全绿')
    expect(result.reason).not.toContain('Claude Code')
    expect(result.reason).not.toContain('ziya')
  })

  it('does not treat the old three roles as a reason to skip the checks', () => {
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
    const codexReviews = [undefined, { clear: false }, { clear: true }, { clear: 'true' }]
    const claudeSignoffs = [undefined, { clear: false }, { clear: true }, { clear: 'true' }]
    const checks = [undefined, false, true, 'true']
    const conversations = [undefined, false, true]
    const holds = [undefined, false, true]

    for (const risk of risks) {
      for (const draft of drafts) {
        for (const fork of forks) {
          for (const signoff of signoffs) {
            for (const codexReview of codexReviews) {
              for (const claudeSignoff of claudeSignoffs) {
                for (const requiredChecksGreen of checks) {
                  for (const conversationsResolved of conversations) {
                    for (const rayHold of holds) {
                     for (const p0 of [true, false, 'false', undefined, null]) {
                      const result = decideMerge({
                        risk,
                        draft,
                        fork,
                        p0,
                        signoff,
                        codexReview,
                        claudeSignoff,
                        requiredChecksGreen,
                        conversationsResolved,
                        rayHold,
                      })
                      if (result.decision === MERGE_DECISION.ENABLE_AUTO_MERGE) {
                        const label = JSON.stringify({
                          risk,
                          draft,
                          fork,
                          p0,
                          codexReview,
                          claudeSignoff,
                          requiredChecksGreen,
                          conversationsResolved,
                          rayHold,
                        })
                        expect(result.pass, `enable but not pass: ${label}`).toBe(true)
                        expect(result.tier, `enable but tier != auto: ${label}`).toBe('auto')
                        expect(draft, 'enable but draft !== false').toBe(false)
                        expect(fork, 'enable but fork !== false').toBe(false)
                        expect(rayHold, `enable while Ray must merge: ${label}`).not.toBe(true)
                        if (risk === 'A') {
                          // 签字不是放行条件（Ray 2026-11-16）。检查、对话、rayHold 一个都不能少。
                          expect(requiredChecksGreen, label).toBe(true)
                          expect(conversationsResolved, label).toBe(true)
                          expect(rayHold, label).toBe(false)
                        } else {
                          expect(risk === 'B' || risk === 'C', `enable but risk not in {A,B,C}: ${label}`).toBe(true)
                        }
                      }
                     }
                    }
                  }
                }
              }
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
    const codexReviews = [undefined, { clear: false }, CODEX_CLEAR]
    const claudeSignoffs = [undefined, { clear: false }, { clear: true }]
    const checks = [undefined, false, true]
    const conversations = [undefined, false, true]
    const holds = [undefined, false, true]

    for (const risk of risks) {
      for (const draft of drafts) {
        for (const fork of forks) {
          for (const signoff of signoffs) {
            for (const codexReview of codexReviews) {
              for (const claudeSignoff of claudeSignoffs) {
                for (const requiredChecksGreen of checks) {
                  for (const conversationsResolved of conversations) {
                    for (const rayHold of holds) {
                      const result = decideMerge({
                        risk,
                        draft,
                        fork,
                        signoff,
                        codexReview,
                        claudeSignoff,
                        requiredChecksGreen,
                        conversationsResolved,
                        rayHold,
                      })
                      if (result.pass !== true) {
                        expect(
                          result.decision,
                          `pass false but decision enable: ${JSON.stringify({ risk, draft, fork, rayHold })}`,
                        ).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
                      }
                    }
                  }
                }
              }
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
