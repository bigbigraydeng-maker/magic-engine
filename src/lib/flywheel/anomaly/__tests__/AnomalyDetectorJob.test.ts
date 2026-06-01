/**
 * AnomalyDetectorJob unit tests — P22.D.1
 *
 * Mocks supabaseAdmin so no real DB calls are made.
 * Tests each of the 5 MVP detection rules independently.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SEO_METRIC_KEY, ADS_METRIC_KEY, SOCIAL_METRIC_KEY, GEO_METRIC_KEY } from '../../vocabulary'

// ── Mock supabaseAdmin ────────────────────────────────────────────────────────

// The fluent query chain:
//   .from(table).select(cols).eq().eq().order().limit()
//
// We capture the last .limit() result via mockLimitFn, which is set
// per-test to return whatever rows we want.

const mockLimitFn   = vi.fn()
const mockOrderFn   = vi.fn(() => ({ limit: mockLimitFn }))
const mockEq2Fn     = vi.fn(() => ({ order: mockOrderFn }))
const mockEq1Fn     = vi.fn(() => ({ eq: mockEq2Fn }))
const mockSelectFn  = vi.fn(() => ({ eq: mockEq1Fn }))
const mockInsertFn  = vi.fn().mockResolvedValue({ error: null })

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'anomaly_signals') return { insert: mockInsertFn }
      return { select: mockSelectFn }
    }),
  },
}))

// ── Import SUT after mocks ────────────────────────────────────────────────────

import { AnomalyDetectorJob } from '../AnomalyDetectorJob'

// ── Helpers ───────────────────────────────────────────────────────────────────

const CLIENT_ID = 'client-uuid-001'

/** Build flywheel_metrics rows: newest first */
function metricsRows(values: number[]) {
  return {
    data: values.map((v, i) => ({
      metric_value: v,
      measured_at:  new Date(Date.now() - i * 86400_000).toISOString(),
    })),
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AnomalyDetectorJob.run()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInsertFn.mockResolvedValue({ error: null })
  })

  // Helper: configure all 5 metric queries to return no data (< 2 rows),
  // then override specific ones for individual rule tests.
  function noData() {
    mockLimitFn.mockResolvedValue({ data: [] })
  }

  it('returns [] when no flywheel_metrics data exists for client', async () => {
    noData()
    const job = new AnomalyDetectorJob()
    const result = await job.run(CLIENT_ID)

    expect(result).toEqual([])
    expect(mockInsertFn).not.toHaveBeenCalled()
  })

  // ── Rule 1: SEO avg_position drop > 5 over 3 days ────────────────────────

  describe('Rule 1 — seo.avg_position.drop_5_3days', () => {
    it('fires when position drops > 5 across 3 consecutive readings', async () => {
      // Sequence: rows[0]=latest(20), rows[1]=mid, rows[2]=baseline(10)
      // delta = 20 - 10 = 10 > 5 → fires
      mockLimitFn
        .mockResolvedValueOnce(metricsRows([20, 15, 10]))  // avg_position: 3 rows
        .mockResolvedValue({ data: [] })                    // all other queries: no data

      const job = new AnomalyDetectorJob()
      const result = await job.run(CLIENT_ID)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        clientId:      CLIENT_ID,
        flywheel:      'seo',
        ruleId:        'seo.avg_position.drop_5_3days',
        severity:      'high',
        currentValue:  20,
        baselineValue: 10,
        status:        'new',
      })
      expect(result[0].pctChange).toBeCloseTo(100)
    })

    it('does NOT fire when position drops <= 5', async () => {
      mockLimitFn
        .mockResolvedValueOnce(metricsRows([14, 12, 10]))  // delta = 4, not > 5
        .mockResolvedValue({ data: [] })

      const job = new AnomalyDetectorJob()
      const result = await job.run(CLIENT_ID)

      expect(result).toEqual([])
    })

    it('does NOT fire when fewer than 3 readings available', async () => {
      mockLimitFn
        .mockResolvedValueOnce({ data: [{ metric_value: 20, measured_at: new Date().toISOString() }] }) // only 1 row
        .mockResolvedValue({ data: [] })

      const job = new AnomalyDetectorJob()
      const result = await job.run(CLIENT_ID)

      expect(result).toEqual([])
    })
  })

  // ── Rule 2: SEO GSC clicks drop > 20% WoW ────────────────────────────────

  describe('Rule 2 — seo.gsc_clicks.drop_20pct_wow', () => {
    it('fires when clicks drop > 20% week-over-week', async () => {
      // Rule 1 query fires first → no data (3 rows needed, we return empty)
      // Rule 2 query → [700, 1000] (30% drop)
      mockLimitFn
        .mockResolvedValueOnce({ data: [] })      // rule 1: avg_position (no 3-row data)
        .mockResolvedValueOnce(metricsRows([700, 1000])) // rule 2: clicks
        .mockResolvedValue({ data: [] })

      const job = new AnomalyDetectorJob()
      const result = await job.run(CLIENT_ID)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        ruleId:        'seo.gsc_clicks.drop_20pct_wow',
        severity:      'medium',
        currentValue:  700,
        baselineValue: 1000,
      })
      expect(result[0].pctChange).toBeCloseTo(-30)
    })

    it('does NOT fire when clicks drop <= 20%', async () => {
      mockLimitFn
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce(metricsRows([820, 1000]))  // 18% drop — under threshold
        .mockResolvedValue({ data: [] })

      const job = new AnomalyDetectorJob()
      const result = await job.run(CLIENT_ID)

      expect(result).toEqual([])
    })
  })

  // ── Rule 3: GEO mention rate drop > 15% ──────────────────────────────────

  describe('Rule 3 — geo.mention_rate.drop_15pct', () => {
    it('fires when mention rate drops > 15%', async () => {
      mockLimitFn
        .mockResolvedValueOnce({ data: [] })  // rule 1
        .mockResolvedValueOnce({ data: [] })  // rule 2
        .mockResolvedValueOnce(metricsRows([0.60, 0.75]))  // rule 3: 20% drop
        .mockResolvedValue({ data: [] })

      const job = new AnomalyDetectorJob()
      const result = await job.run(CLIENT_ID)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        ruleId:   'geo.mention_rate.drop_15pct',
        severity: 'high',
      })
      expect(result[0].pctChange).toBeCloseTo(-20)
    })
  })

  // ── Rule 4: Ads CPA surge > 30% MoM ──────────────────────────────────────

  describe('Rule 4 — ads.cpa.surge_30pct_mom', () => {
    it('fires when CPA surges > 30% month-over-month', async () => {
      // Rules 1,2,3 → no data
      // Rule 4 uses TWO queries (spend + conversions) — each returns 2 rows
      // CPA now = 1000/10 = 100, CPA prior = 500/10 = 50 → +100% surge
      mockLimitFn
        .mockResolvedValueOnce({ data: [] })  // rule 1
        .mockResolvedValueOnce({ data: [] })  // rule 2
        .mockResolvedValueOnce({ data: [] })  // rule 3
        .mockResolvedValueOnce(metricsRows([1000, 500]))  // rule 4: spend
        .mockResolvedValueOnce(metricsRows([10, 10]))     // rule 4: conversions
        .mockResolvedValue({ data: [] })

      const job = new AnomalyDetectorJob()
      const result = await job.run(CLIENT_ID)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        ruleId:        'ads.cpa.surge_30pct_mom',
        severity:      'high',
        currentValue:  100,   // 1000/10
        baselineValue: 50,    // 500/10
      })
      expect(result[0].pctChange).toBeCloseTo(100)
    })

    it('does NOT fire when CPA surge <= 30%', async () => {
      mockLimitFn
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce(metricsRows([600, 500]))  // spend: modest rise
        .mockResolvedValueOnce(metricsRows([10, 10]))    // conversions: stable
        .mockResolvedValue({ data: [] })

      const job = new AnomalyDetectorJob()
      const result = await job.run(CLIENT_ID)

      expect(result).toEqual([])
    })

    it('does NOT fire when conversions is zero (avoids division by zero)', async () => {
      mockLimitFn
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce(metricsRows([1000, 500]))
        .mockResolvedValueOnce(metricsRows([0, 10]))  // current conversions = 0
        .mockResolvedValue({ data: [] })

      const job = new AnomalyDetectorJob()
      const result = await job.run(CLIENT_ID)

      expect(result).toEqual([])
    })
  })

  // ── Rule 5: Social published count drop > 40% MoM ────────────────────────

  describe('Rule 5 — social.published_count.drop_40pct_mom', () => {
    it('fires when published count drops > 40%', async () => {
      mockLimitFn
        .mockResolvedValueOnce({ data: [] })  // rule 1
        .mockResolvedValueOnce({ data: [] })  // rule 2
        .mockResolvedValueOnce({ data: [] })  // rule 3
        .mockResolvedValueOnce({ data: [] })  // rule 4 spend
        .mockResolvedValueOnce({ data: [] })  // rule 4 conversions
        .mockResolvedValueOnce(metricsRows([3, 10]))  // rule 5: 70% drop
        .mockResolvedValue({ data: [] })

      const job = new AnomalyDetectorJob()
      const result = await job.run(CLIENT_ID)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        ruleId:   'social.published_count.drop_40pct_mom',
        severity: 'medium',
      })
      expect(result[0].pctChange).toBeCloseTo(-70)
    })
  })

  // ── Multi-rule firing ─────────────────────────────────────────────────────

  it('fires multiple signals when multiple rules breach simultaneously', async () => {
    mockLimitFn
      .mockResolvedValueOnce(metricsRows([20, 15, 10]))  // rule 1: pos drop fires
      .mockResolvedValueOnce(metricsRows([700, 1000]))   // rule 2: clicks drop fires
      .mockResolvedValueOnce({ data: [] })               // rule 3: no geo data
      .mockResolvedValueOnce({ data: [] })               // rule 4 spend
      .mockResolvedValueOnce({ data: [] })               // rule 4 conversions
      .mockResolvedValue({ data: [] })                   // rule 5: no social data

    const job = new AnomalyDetectorJob()
    const result = await job.run(CLIENT_ID)

    expect(result).toHaveLength(2)
    const ruleIds = result.map(s => s.ruleId)
    expect(ruleIds).toContain('seo.avg_position.drop_5_3days')
    expect(ruleIds).toContain('seo.gsc_clicks.drop_20pct_wow')
    expect(mockInsertFn).toHaveBeenCalledOnce()
  })

  // ── Resilience ────────────────────────────────────────────────────────────

  it('continues processing other rules when one rule throws', async () => {
    mockLimitFn
      .mockRejectedValueOnce(new Error('DB timeout'))  // rule 1 throws
      .mockResolvedValueOnce(metricsRows([700, 1000]))  // rule 2 fires
      .mockResolvedValue({ data: [] })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const job = new AnomalyDetectorJob()
    const result = await job.run(CLIENT_ID)

    expect(result).toHaveLength(1)
    expect(result[0].ruleId).toBe('seo.gsc_clicks.drop_20pct_wow')
    expect(consoleSpy).toHaveBeenCalledWith(
      '[AnomalyDetectorJob] rule error:',
      'DB timeout',
    )

    consoleSpy.mockRestore()
  })

  it('returns fired signals even when DB insert fails', async () => {
    mockInsertFn.mockResolvedValueOnce({ error: { message: 'constraint violation' } })
    mockLimitFn
      .mockResolvedValueOnce(metricsRows([20, 15, 10]))  // rule 1 fires
      .mockResolvedValue({ data: [] })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const job = new AnomalyDetectorJob()
    const result = await job.run(CLIENT_ID)

    expect(result).toHaveLength(1)
    expect(consoleSpy).toHaveBeenCalledWith(
      '[AnomalyDetectorJob] insert error:',
      'constraint violation',
    )

    consoleSpy.mockRestore()
  })
})
