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

describe('decideMerge — B and C（Ray 2026-10-26「只有 P0 审」）', () => {
  it('不是 P0 的 B 级：直接开自动合并，不要任何人签字', () => {
    const result = decideMerge({ risk: 'B', draft: false, fork: false, p0: false, signoff: undefined })
    expect(result.pass).toBe(true)
    expect(result.decision).toBe(MERGE_DECISION.ENABLE_AUTO_MERGE)
    expect(result.tier).toBe('auto')
    expect(result.reason).toContain('不是 P0')
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

  it('🔴 打了 p0 标签：必须有 Claude Code 对当前这次提交的签字才开', () => {
    for (const risk of ['B', 'C']) {
      const blocked = decideMerge({ risk, draft: false, fork: false, p0: true })
      expect(blocked.pass, risk).toBe(false)
      expect(blocked.decision, risk).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
      expect(blocked.reason, risk).toContain('标了 p0')

      const signed = decideMerge({ risk, draft: false, fork: false, p0: true, claudeSignoff: { clear: true } })
      expect(signed.pass, risk).toBe(true)
      expect(signed.decision, risk).toBe(MERGE_DECISION.ENABLE_AUTO_MERGE)
    }
  })

  it('🔴 p0 读不出来时当成「是 P0」拦住，但原因要说清是「读不到」而不是「标了」', () => {
    for (const p0 of [undefined, null, 'yes', 1, {}]) {
      const result = decideMerge({ risk: 'B', draft: false, fork: false, p0 })
      expect(result.decision, String(p0)).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
      // 谎称「标了 p0」会让人去找一个不存在的标签
      expect(result.reason, String(p0)).toContain('读不到 p0 标签')
      expect(result.reason, String(p0)).not.toContain('标了 p0')
    }
    // 只有明确的 false / 'false' 才算「不是 P0」
    for (const p0 of [false, 'false']) {
      expect(decideMerge({ risk: 'B', draft: false, fork: false, p0 }).decision, String(p0)).toBe(
        MERGE_DECISION.ENABLE_AUTO_MERGE,
      )
    }
  })

  it('p0 标着、签字只对更早的提交 → 不开', () => {
    const result = decideMerge({
      risk: 'B',
      draft: false,
      fork: false,
      p0: true,
      claudeSignoff: { clear: false, reason: '签的是更早的提交，当前这次还没签' },
    })
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    expect(result.reason).toContain('更早的提交')
  })

  it('🔴 p0 标着时，字符串 "true" 的签字不算签字（失败朝严）', () => {
    const result = decideMerge({
      risk: 'C',
      draft: false,
      fork: false,
      p0: true,
      claudeSignoff: { clear: 'true' },
    })
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
  })

  it('🔴 A 级：Codex 签了也不算，只认 Claude Code 对当前这次提交的签字', () => {
    const result = decideMerge({
      risk: 'A',
      draft: false,
      fork: false,
      signoff: COMPLETE_SIGNOFF,
      codexReview: CODEX_CLEAR,
      claudeSignoff: { clear: false, reason: 'Claude Code 还没签过当前这次提交' },
      requiredChecksGreen: true,
      conversationsResolved: true,
      rayHold: false,
    })
    expect(result.pass).toBe(false)
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    expect(result.tier).toBe('blocked')
    expect(result.reason).toContain('Claude Code')
  })

  it('🔴 A 级：只有 Claude Code 一签 + 检查全绿 + 对话全解决 → 自动合并（Codex 那一签已去掉，等它是永久阻塞）', () => {
    const result = decideMerge({
      risk: 'A',
      draft: false,
      fork: false,
      claudeSignoff: { clear: true },
      requiredChecksGreen: true,
      conversationsResolved: true,
      rayHold: false,
    })
    expect(result.pass).toBe(true)
    expect(result.decision).toBe(MERGE_DECISION.ENABLE_AUTO_MERGE)
    expect(result.tier).toBe('auto')
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

  it('blocks an A PR while Claude Code has not signed this head', () => {
    const result = decideMerge({ risk: 'A', draft: false, fork: false, signoff: INCOMPLETE_SIGNOFF, rayHold: false })
    expect(result.pass).toBe(false)
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    expect(result.reason).toContain('Claude Code')
  })

  it('A 级没有任何签字输入 → 拦住，并点名还缺谁（Codex 已不是签字人）', () => {
    const result = decideMerge({ risk: 'A', draft: false, fork: false, signoff: undefined, rayHold: false })
    expect(result.pass).toBe(false)
    expect(result.reason).toContain('Claude Code')
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
                          // A 级的四个条件一个都不能少（Codex 已不是其中之一）
                          expect(claudeSignoff && claudeSignoff.clear === true, label).toBe(true)
                          expect(requiredChecksGreen, label).toBe(true)
                          expect(conversationsResolved, label).toBe(true)
                          expect(rayHold, label).toBe(false)
                        } else {
                          expect(risk === 'B' || risk === 'C', `enable but risk not in {A,B,C}: ${label}`).toBe(true)
                          // 🔴 B/C 开自动合并，只有两种合法来源：不是 P0，或者 P0 但已签字。
                          //    少了这条，「P0 没签也能开」这种回归会从穷举里溜过去。
                          const notP0 = p0 === false || p0 === 'false'
                          const signed = claudeSignoff !== null && claudeSignoff !== undefined && claudeSignoff.clear === true
                          expect(notP0 || signed, `enable on a P0 without a sign-off: ${label}`).toBe(true)
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
