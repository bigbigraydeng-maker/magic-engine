/**
 * Tests for the three dispatch lines.
 *
 * PM rule (2026-07-28):
 *   costs nothing + not customer-facing + reversible  → auto
 *   touches money / goes outward / hard to undo (ANY) → needs_approval
 *
 * v1 is classify-only: nothing is executed, including `auto`. These tests guard
 * the classification; there is deliberately no executor to test.
 */

import { describe, it, expect } from 'vitest'
import { classifyDisposition, type RemedyProfile } from './disposition'

const SAFE: RemedyProfile = {
  spendsMoney: false,
  customerFacing: false,
  hardToReverse: false,
}

describe('classifyDisposition', () => {
  it('routes the all-clear remedy to auto', () => {
    const verdict = classifyDisposition(SAFE)

    expect(verdict.disposition).toBe('auto')
    expect(verdict.reason).toContain('costs nothing')
  })

  it.each([
    ['spendsMoney', { ...SAFE, spendsMoney: true }, 'spends money'],
    ['customerFacing', { ...SAFE, customerFacing: true }, 'customer-facing'],
    ['hardToReverse', { ...SAFE, hardToReverse: true }, 'hard to reverse'],
  ])('escalates when only %s is set', (_label, remedy, expectedReason) => {
    const verdict = classifyDisposition(remedy as RemedyProfile)

    expect(verdict.disposition).toBe('needs_approval')
    expect(verdict.reason).toContain(expectedReason)
  })

  it('names every gate that tripped, not just the first', () => {
    const verdict = classifyDisposition({
      spendsMoney: true,
      customerFacing: true,
      hardToReverse: true,
    })

    expect(verdict.disposition).toBe('needs_approval')
    expect(verdict.reason).toContain('spends money')
    expect(verdict.reason).toContain('customer-facing')
    expect(verdict.reason).toContain('hard to reverse')
  })

  /**
   * MUTATION GUARDS — each states the weakening it kills.
   */
  describe('mutation guards', () => {
    it('kills "OR becomes AND": one tripped gate must be enough to escalate', () => {
      // Requiring all three gates would let a money-spending fix run itself.
      expect(classifyDisposition({ ...SAFE, spendsMoney: true }).disposition).toBe(
        'needs_approval'
      )
    })

    it('kills "drop the money gate"', () => {
      expect(classifyDisposition({ ...SAFE, spendsMoney: true }).disposition).not.toBe('auto')
    })

    it('kills "drop the customer-facing gate"', () => {
      expect(classifyDisposition({ ...SAFE, customerFacing: true }).disposition).not.toBe('auto')
    })

    it('kills "drop the reversibility gate"', () => {
      expect(classifyDisposition({ ...SAFE, hardToReverse: true }).disposition).not.toBe('auto')
    })

    it('kills "escalate everything": the safe profile must still reach auto', () => {
      // A rule that escalates unconditionally is safe but useless, and would
      // hide the fact that the classifier had stopped working.
      expect(classifyDisposition(SAFE).disposition).toBe('auto')
    })
  })
})
