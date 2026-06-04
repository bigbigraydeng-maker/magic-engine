import { describe, it, expect } from 'vitest'
import { computeExpectedImpact } from '../expected-impact'

describe('computeExpectedImpact', () => {
  // ─── Null / defensive inputs ─────────────────────────────────────────────
  describe('defensive inputs (must return null, not throw)', () => {
    it('returns null for null', () => {
      expect(computeExpectedImpact(null)).toBeNull()
    })
    it('returns null for undefined', () => {
      expect(computeExpectedImpact(undefined)).toBeNull()
    })
    it('returns null for primitives', () => {
      expect(computeExpectedImpact('hello')).toBeNull()
      expect(computeExpectedImpact(42)).toBeNull()
      expect(computeExpectedImpact(true)).toBeNull()
    })
    it('returns null when rule_id is missing', () => {
      expect(computeExpectedImpact({ keyword: 'x', search_volume: 1000 })).toBeNull()
    })
    it('returns null for unknown rule_id', () => {
      expect(
        computeExpectedImpact({ rule_id: 'unknown_rule', search_volume: 1000 }),
      ).toBeNull()
    })
    it('returns null when rule_id is wrong type', () => {
      expect(computeExpectedImpact({ rule_id: 42 })).toBeNull()
    })
  })

  // ─── keyword_opportunity branch ──────────────────────────────────────────
  describe('keyword_opportunity', () => {
    it('estimates clicks using ctr at position 30 × 0.5', () => {
      // 280 * ctrBenchmarkForPosition(30) × 0.5 = 280 * 0.004 * 0.5 = 0.56
      const r = computeExpectedImpact({
        rule_id: 'keyword_opportunity',
        search_volume: 280,
      })
      expect(r).not.toBeNull()
      expect(r!.clicks_per_month).toBeCloseTo(0.56, 4)
      expect(r!.basis).toContain('搜索量 280')
      expect(r!.basis).toContain('第 30 位')
    })

    it('returns null when search_volume is null', () => {
      expect(
        computeExpectedImpact({ rule_id: 'keyword_opportunity', search_volume: null }),
      ).toBeNull()
    })

    it('returns null when search_volume is 0', () => {
      expect(
        computeExpectedImpact({ rule_id: 'keyword_opportunity', search_volume: 0 }),
      ).toBeNull()
    })

    it('returns null when search_volume is negative', () => {
      expect(
        computeExpectedImpact({ rule_id: 'keyword_opportunity', search_volume: -100 }),
      ).toBeNull()
    })

    it('ignores non-numeric search_volume', () => {
      expect(
        computeExpectedImpact({
          rule_id: 'keyword_opportunity',
          search_volume: '280',
        }),
      ).toBeNull()
    })

    it('ignores NaN / Infinity', () => {
      expect(
        computeExpectedImpact({ rule_id: 'keyword_opportunity', search_volume: NaN }),
      ).toBeNull()
      expect(
        computeExpectedImpact({
          rule_id: 'keyword_opportunity',
          search_volume: Infinity,
        }),
      ).toBeNull()
    })
  })

  // ─── phase1_landing_page branch ──────────────────────────────────────────
  describe('phase1_landing_page', () => {
    it('estimates clicks using ctr at position 50 × 0.5', () => {
      // 18100 × ctrBenchmarkForPosition(50) × 0.5 = 18100 × 0.004 × 0.5 = 36.2
      const r = computeExpectedImpact({
        rule_id: 'phase1_landing_page',
        search_volume: 18100,
      })
      expect(r).not.toBeNull()
      expect(r!.clicks_per_month).toBeCloseTo(36.2, 2)
      expect(r!.basis).toContain('搜索量 18100')
      expect(r!.basis).toContain('第 50 位')
    })

    it('returns null when search_volume is missing', () => {
      expect(
        computeExpectedImpact({ rule_id: 'phase1_landing_page' }),
      ).toBeNull()
    })
  })

  // ─── stale_content branch ────────────────────────────────────────────────
  describe('stale_content', () => {
    it('estimates recovered clicks from position climb', () => {
      // 590 × (ctr(4) − ctr(10)) = 590 × (0.07 − 0.035) = 20.65
      const r = computeExpectedImpact({
        rule_id: 'stale_content',
        search_volume: 590,
        prior_position: 4,
        position: 10,
      })
      expect(r).not.toBeNull()
      expect(r!.clicks_per_month).toBeCloseTo(20.65, 2)
      expect(r!.basis).toContain('第 4 位')
      expect(r!.basis).toContain('第 10 位')
    })

    it('returns null when prior_position is missing', () => {
      expect(
        computeExpectedImpact({
          rule_id: 'stale_content',
          search_volume: 590,
          position: 10,
        }),
      ).toBeNull()
    })

    it('returns null when position is missing', () => {
      expect(
        computeExpectedImpact({
          rule_id: 'stale_content',
          search_volume: 590,
          prior_position: 4,
        }),
      ).toBeNull()
    })

    it('returns null when content did not slip (position improved)', () => {
      expect(
        computeExpectedImpact({
          rule_id: 'stale_content',
          search_volume: 590,
          prior_position: 10,
          position: 4,
        }),
      ).toBeNull()
    })

    it('returns null when slip is within same CTR bucket (delta = 0)', () => {
      // both position 6 and 9 fall into the 6–10 bucket → same CTR
      expect(
        computeExpectedImpact({
          rule_id: 'stale_content',
          search_volume: 590,
          prior_position: 6,
          position: 9,
        }),
      ).toBeNull()
    })

    it('returns null when search_volume is missing', () => {
      expect(
        computeExpectedImpact({
          rule_id: 'stale_content',
          prior_position: 4,
          position: 10,
        }),
      ).toBeNull()
    })
  })

  // ─── low_ctr_title branch ────────────────────────────────────────────────
  describe('low_ctr_title', () => {
    it('estimates clicks recovered by CTR uplift', () => {
      // 5000 × (0.11 − 0.02) = 450
      const r = computeExpectedImpact({
        rule_id: 'low_ctr_title',
        impressions: 5000,
        ctr: 0.02,
        ctr_benchmark: 0.11,
      })
      expect(r).not.toBeNull()
      expect(r!.clicks_per_month).toBeCloseTo(450, 2)
      expect(r!.basis).toContain('曝光 5000')
    })

    it('returns null when actual CTR already meets benchmark', () => {
      expect(
        computeExpectedImpact({
          rule_id: 'low_ctr_title',
          impressions: 5000,
          ctr: 0.11,
          ctr_benchmark: 0.11,
        }),
      ).toBeNull()
    })

    it('returns null when actual CTR exceeds benchmark', () => {
      expect(
        computeExpectedImpact({
          rule_id: 'low_ctr_title',
          impressions: 5000,
          ctr: 0.20,
          ctr_benchmark: 0.11,
        }),
      ).toBeNull()
    })

    it('returns null when impressions is 0', () => {
      expect(
        computeExpectedImpact({
          rule_id: 'low_ctr_title',
          impressions: 0,
          ctr: 0.02,
          ctr_benchmark: 0.11,
        }),
      ).toBeNull()
    })

    it('returns null when ctr_benchmark is missing', () => {
      expect(
        computeExpectedImpact({
          rule_id: 'low_ctr_title',
          impressions: 5000,
          ctr: 0.02,
        }),
      ).toBeNull()
    })
  })

  // ─── Real-world Oztop fixtures ───────────────────────────────────────────
  describe('Oztop fde_manual landing pages (real production data)', () => {
    it('vinyl flooring → ~36 clicks/month', () => {
      const r = computeExpectedImpact({
        rule_id: 'phase1_landing_page',
        keyword: 'vinyl flooring',
        search_volume: 18100,
        keyword_difficulty: 15,
      })
      expect(r).not.toBeNull()
      expect(Math.round(r!.clicks_per_month)).toBe(36)
    })

    it('carpet brisbane → ~16 clicks/month', () => {
      // 8100 × 0.004 × 0.5 = 16.2
      const r = computeExpectedImpact({
        rule_id: 'phase1_landing_page',
        keyword: 'carpet brisbane',
        search_volume: 8100,
        keyword_difficulty: 20,
      })
      expect(r).not.toBeNull()
      expect(Math.round(r!.clicks_per_month)).toBe(16)
    })
  })
})
