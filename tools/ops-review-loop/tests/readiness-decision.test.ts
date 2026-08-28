import { describe, expect, it } from 'vitest'

import { evaluateReadiness } from '../src/readiness-decision.mjs'

const COMPLETE_SPECIALIZED = { required: [], missing: [], complete: true, readable: true }

const ALL_SIGNALS = [
  'linked-issue',
  'acceptance-criteria',
  'scope-statement',
  'required-ci-green',
  'build-evidence',
  'test-output',
  'changed-code-has-tests',
  'risk-rated',
  'scope-guard-green',
  'specialized-evidence-complete',
  'reuse-statement',
  'no-unexplained-dependency',
  'failure-handling',
  'observability',
]

describe('evaluateReadiness', () => {
  it('reaches READY when every signal is present and every gate clears', () => {
    const { score, decision } = evaluateReadiness({
      risk: 'C',
      observedSignals: ALL_SIGNALS,
      specialized: COMPLETE_SPECIALIZED,
      shaMatches: true,
      evidenceReadable: true,
      requiredCiPassed: true,
      scopeGuardPassed: true,
      openBlockerCount: 0,
    })
    expect(score.total).toBe(100)
    expect(decision.decision).toBe('READY_FOR_PRODUCT_OWNER')
    expect(decision.blockers).toEqual([])
  })

  /**
   * Codex finding on PR #1211 (P1): the auto-fix blast-radius guard used to
   * be a 5-point scoring signal only — a failure could still leave a
   * C-level PR above threshold. It is now wired through as a hard gate the
   * same way `requiredCiPassed` already was.
   */
  it('blocks on a failed auto-fix blast-radius guard even at a perfect score', () => {
    const { decision } = evaluateReadiness({
      risk: 'C',
      observedSignals: ALL_SIGNALS,
      specialized: COMPLETE_SPECIALIZED,
      shaMatches: true,
      evidenceReadable: true,
      requiredCiPassed: true,
      scopeGuardPassed: false,
      openBlockerCount: 0,
    })
    expect(decision.decision).toBe('BLOCKED')
    expect(decision.blockers.some((b) => b.includes('爆炸半径闸门'))).toBe(true)
  })

  it('blocks when the auto-fix blast-radius guard is unreadable or not yet terminal', () => {
    const { decision } = evaluateReadiness({
      risk: 'C',
      observedSignals: ALL_SIGNALS,
      specialized: COMPLETE_SPECIALIZED,
      shaMatches: true,
      evidenceReadable: true,
      requiredCiPassed: true,
      scopeGuardPassed: null,
      openBlockerCount: 0,
    })
    expect(decision.decision).toBe('BLOCKED')
  })

  it('blocks on a low score even with clean hard gates', () => {
    const { decision } = evaluateReadiness({
      risk: 'C',
      observedSignals: [],
      specialized: COMPLETE_SPECIALIZED,
      shaMatches: true,
      evidenceReadable: true,
      requiredCiPassed: true,
      openBlockerCount: 0,
    })
    expect(decision.decision).toBe('BLOCKED')
    expect(decision.blockers.some((b) => b.includes('质量分'))).toBe(true)
  })

  it('blocks on red CI even at a perfect score', () => {
    const { decision } = evaluateReadiness({
      risk: 'C',
      observedSignals: ALL_SIGNALS,
      specialized: COMPLETE_SPECIALIZED,
      shaMatches: true,
      evidenceReadable: true,
      requiredCiPassed: false,
      openBlockerCount: 0,
    })
    expect(decision.decision).toBe('BLOCKED')
  })

  it('blocks when the sha does not match the rating that was bound to it', () => {
    const { decision } = evaluateReadiness({
      risk: 'C',
      observedSignals: ALL_SIGNALS,
      specialized: COMPLETE_SPECIALIZED,
      shaMatches: false,
      evidenceReadable: true,
      requiredCiPassed: true,
      openBlockerCount: 0,
    })
    expect(decision.decision).toBe('BLOCKED')
    expect(decision.blockers.some((b) => b.includes('对不上'))).toBe(true)
  })

  it('blocks when evidence was not readable, independent of the score', () => {
    const { decision } = evaluateReadiness({
      risk: 'B',
      observedSignals: ALL_SIGNALS,
      specialized: COMPLETE_SPECIALIZED,
      shaMatches: true,
      evidenceReadable: false,
      requiredCiPassed: true,
      openBlockerCount: 0,
    })
    expect(decision.decision).toBe('BLOCKED')
  })

  it('blocks an A-level PR missing its category-matched specialised evidence', () => {
    const { decision } = evaluateReadiness({
      risk: 'A',
      observedSignals: ALL_SIGNALS,
      specialized: {
        required: [{ category: 'control-plane', id: 'control-plane-evidence', label: 'x' }],
        missing: [{ category: 'control-plane', id: 'control-plane-evidence', label: 'x' }],
        complete: false,
        readable: true,
      },
      shaMatches: true,
      evidenceReadable: true,
      requiredCiPassed: true,
      openBlockerCount: 0,
    })
    expect(decision.decision).toBe('BLOCKED')
  })

  it('never produces NEEDS_PRODUCT_DECISION on its own', () => {
    const { decision } = evaluateReadiness({
      risk: 'C',
      observedSignals: [],
      specialized: COMPLETE_SPECIALIZED,
      shaMatches: false,
      evidenceReadable: false,
      requiredCiPassed: false,
      openBlockerCount: 3,
    })
    expect(decision.decision).not.toBe('NEEDS_PRODUCT_DECISION')
  })

  it('blocks when there are still open Codex findings', () => {
    const { decision } = evaluateReadiness({
      risk: 'B',
      observedSignals: ALL_SIGNALS,
      specialized: COMPLETE_SPECIALIZED,
      shaMatches: true,
      evidenceReadable: true,
      requiredCiPassed: true,
      openBlockerCount: 2,
    })
    expect(decision.decision).toBe('BLOCKED')
    expect(decision.blockers.some((b) => b.includes('2 条 Codex'))).toBe(true)
  })
})
