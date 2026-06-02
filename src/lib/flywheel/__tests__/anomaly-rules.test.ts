/**
 * Unit tests for AnomalyDetector rules (P22.D.1).
 * All rules are pure functions — no DB, no network.
 */

import { ANOMALY_RULES } from '../anomaly/rules'

function ruleById(id: string) {
  const rule = ANOMALY_RULES.find(r => r.id === id)
  if (!rule) throw new Error(`Rule "${id}" not found`)
  return rule
}

// ── seo-avg-position-drop ──────────────────────────────────────────────────

describe('seo-avg-position-drop', () => {
  const rule = ruleById('seo-avg-position-drop')

  it('returns null when history < 3', () => {
    expect(rule.detect(15, [10, 10])).toBeNull()
  })

  it('returns null when drop is <= 5', () => {
    // Reference avg = 10, current = 15 → drop = 5 (not > 5)
    expect(rule.detect(15, [10, 10, 10, 10])).toBeNull()
  })

  it('fires when 3-day avg drops > 5 positions', () => {
    // Reference avg of last 3 = 10, current = 16 → drop = 6
    const result = rule.detect(16, [8, 8, 10, 10, 10])
    expect(result).not.toBeNull()
    expect(result!.deltaPct).toBeGreaterThan(0) // position number went up = worse
    expect(result!.description).toContain('ranking dropped')
  })
})

// ── geo-visibility-score-drop ──────────────────────────────────────────────

describe('geo-visibility-score-drop', () => {
  const rule = ruleById('geo-visibility-score-drop')

  it('returns null when no history', () => {
    expect(rule.detect(0.5, [])).toBeNull()
  })

  it('returns null when drop is < 15%', () => {
    // 0.9 → 0.8 = -11.1%
    expect(rule.detect(0.8, [0.9])).toBeNull()
  })

  it('fires when drop > 15%', () => {
    // 0.8 → 0.65 = -18.75%
    const result = rule.detect(0.65, [0.8])
    expect(result).not.toBeNull()
    expect(result!.deltaPct).toBeLessThan(-15)
    expect(result!.description).toContain('mention rate dropped')
  })
})

// ── ads-cpa-spike ──────────────────────────────────────────────────────────

describe('ads-cpa-spike', () => {
  const rule = ruleById('ads-cpa-spike')

  it('returns null when history < 7', () => {
    expect(rule.detect(50, [30, 30, 30])).toBeNull()
  })

  it('returns null when rise is <= 30%', () => {
    // Avg = 30, current = 39 → +30% (not > 30)
    expect(rule.detect(39, [30, 30, 30, 30, 30, 30, 30])).toBeNull()
  })

  it('fires when CPA rises > 30%', () => {
    // Avg = 30, current = 42 → +40%
    const result = rule.detect(42, [30, 30, 30, 30, 30, 30, 30])
    expect(result).not.toBeNull()
    expect(result!.deltaPct).toBeGreaterThan(30)
    expect(result!.description).toContain('CPA rose')
  })
})

// ── social-engagement-rate-drop ────────────────────────────────────────────

describe('social-engagement-rate-drop', () => {
  const rule = ruleById('social-engagement-rate-drop')

  it('returns null when history < 7', () => {
    expect(rule.detect(0.02, [0.05])).toBeNull()
  })

  it('returns null when drop is <= 40%', () => {
    // Avg = 0.05, current = 0.031 → -38%
    expect(rule.detect(0.031, [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05])).toBeNull()
  })

  it('fires when engagement drops > 40%', () => {
    // Avg = 0.05, current = 0.025 → -50%
    const result = rule.detect(0.025, [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05])
    expect(result).not.toBeNull()
    expect(result!.deltaPct).toBeLessThan(-40)
    expect(result!.description).toContain('engagement rate dropped')
  })
})

// ── seo-clicks-drop ────────────────────────────────────────────────────────

describe('seo-clicks-drop', () => {
  const rule = ruleById('seo-clicks-drop')

  it('returns null when history < 7', () => {
    expect(rule.detect(100, [200])).toBeNull()
  })

  it('returns null when drop is <= 20%', () => {
    // Avg = 500, current = 401 → -19.8%
    expect(rule.detect(401, [500, 500, 500, 500, 500, 500, 500])).toBeNull()
  })

  it('fires when clicks drop > 20%', () => {
    // Avg = 500, current = 350 → -30%
    const result = rule.detect(350, [500, 500, 500, 500, 500, 500, 500])
    expect(result).not.toBeNull()
    expect(result!.deltaPct).toBeLessThan(-20)
    expect(result!.description).toContain('clicks dropped')
  })
})

// ── ANOMALY_RULES registry ─────────────────────────────────────────────────

describe('ANOMALY_RULES registry', () => {
  it('contains exactly 5 rules', () => {
    expect(ANOMALY_RULES).toHaveLength(5)
  })

  it('all rule ids are unique', () => {
    const ids = ANOMALY_RULES.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
