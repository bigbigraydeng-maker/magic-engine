/**
 * Objective → expected metric.
 *
 * 30 Kiteroa is the case that forced this: a Messenger-objective property
 * lead-gen campaign. It has no purchase, so Meta reports no purchase_roas —
 * the old hard-coded `ads.account.roas` promise could never be redeemed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ADS_METRIC_KEY } from '../vocabulary'
import { isAdsMetricPulled } from '../metric-registry'
import {
  resolveAdsExpectedMetric,
  resolveAndLogAdsExpectedMetric,
  resolveClientAdsExpectedMetric,
  describeResultsColumn,
  resultsAreComparable,
} from '../ads-expected-metric'

describe('resolveAdsExpectedMetric', () => {
  it('grades a sales campaign on ROAS', () => {
    expect(resolveAdsExpectedMetric({ objective: 'OUTCOME_SALES' }).metricKey)
      .toBe(ADS_METRIC_KEY.ROAS)
    expect(resolveAdsExpectedMetric({ objective: 'CONVERSIONS' }).metricKey)
      .toBe(ADS_METRIC_KEY.ROAS)
  })

  it('grades a lead-form campaign on cost per lead, never ROAS', () => {
    const { metricKey } = resolveAdsExpectedMetric({ objective: 'OUTCOME_LEADS' })
    expect(metricKey).toBe(ADS_METRIC_KEY.COST_PER_LEAD)
    expect(metricKey).not.toBe(ADS_METRIC_KEY.ROAS)
  })

  it('grades a messaging campaign on cost per conversation', () => {
    expect(resolveAdsExpectedMetric({ objective: 'MESSAGES' }).metricKey)
      .toBe(ADS_METRIC_KEY.COST_PER_CONVERSATION)
  })

  it('lets a Messenger destination override OUTCOME_LEADS — the 30 Kiteroa case', () => {
    // OUTCOME_LEADS covers Instant Forms AND click-to-Messenger. Only
    // destination_type tells them apart, and getting it wrong means promising
    // a cost-per-lead that a conversation campaign never reports.
    const { metricKey } = resolveAdsExpectedMetric({
      objective: 'OUTCOME_LEADS',
      destinationType: 'MESSENGER',
    })
    expect(metricKey).toBe(ADS_METRIC_KEY.COST_PER_CONVERSATION)
  })

  it('returns null with a reason for awareness / traffic objectives', () => {
    const { metricKey, reason } = resolveAdsExpectedMetric({ objective: 'OUTCOME_AWARENESS' })
    expect(metricKey).toBeNull()
    expect(reason).toMatch(/not attributable/)
  })

  it('returns null when the platform gave no objective — never guesses', () => {
    expect(resolveAdsExpectedMetric({ objective: null }).metricKey).toBeNull()
    expect(resolveAdsExpectedMetric({}).metricKey).toBeNull()
  })

  it('is case- and whitespace-insensitive on the platform value', () => {
    expect(resolveAdsExpectedMetric({ objective: '  outcome_sales ' }).metricKey)
      .toBe(ADS_METRIC_KEY.ROAS)
  })

  it('only ever returns metrics the registry says are pulled', () => {
    const objectives = [
      'OUTCOME_SALES', 'CONVERSIONS', 'PRODUCT_CATALOG_SALES', 'CATALOG_SALES',
      'OUTCOME_LEADS', 'LEAD_GENERATION', 'MESSAGES', 'OUTCOME_ENGAGEMENT',
      'OUTCOME_TRAFFIC', 'REACH', 'UNKNOWN_FUTURE_OBJECTIVE',
    ]
    for (const objective of objectives) {
      for (const destinationType of [null, 'WEBSITE', 'MESSENGER', 'WHATSAPP']) {
        const { metricKey } = resolveAdsExpectedMetric({ objective, destinationType })
        if (metricKey !== null) expect(isAdsMetricPulled(metricKey)).toBe(true)
      }
    }
  })
})

describe('resolveAndLogAdsExpectedMetric', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('warns when it cannot grade the action — silence is what caused the outage', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = resolveAndLogAdsExpectedMetric({ objective: 'REACH' }, 'unit-test')
    expect(result).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unit-test'))
  })

  it('stays quiet when it resolved a metric', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveAndLogAdsExpectedMetric({ objective: 'MESSAGES' }, 'unit-test'))
      .toBe(ADS_METRIC_KEY.COST_PER_CONVERSATION)
    expect(warn).not.toHaveBeenCalled()
  })
})

// ── Client-level fallback ─────────────────────────────────────────────────────

function supabaseReturning(
  rows: Array<{ metric_key: string }> | null,
  error: { message: string } | null = null,
) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    in:     vi.fn().mockReturnThis(),
    gte:    vi.fn().mockResolvedValue({ data: rows, error }),
  }
  return { from: vi.fn().mockReturnValue(chain), chain }
}

describe('resolveClientAdsExpectedMetric', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('picks the metric the client actually has data for', async () => {
    const supabase = supabaseReturning([{ metric_key: ADS_METRIC_KEY.COST_PER_CONVERSATION }])
    const result = await resolveClientAdsExpectedMetric(supabase as never, 'kiteroa')
    expect(result).toBe(ADS_METRIC_KEY.COST_PER_CONVERSATION)
  })

  it('prefers revenue over cost-per-outcome when the client has both', async () => {
    const supabase = supabaseReturning([
      { metric_key: ADS_METRIC_KEY.COST_PER_LEAD },
      { metric_key: ADS_METRIC_KEY.ROAS },
    ])
    expect(await resolveClientAdsExpectedMetric(supabase as never, 'shop'))
      .toBe(ADS_METRIC_KEY.ROAS)
  })

  it('returns null — not ROAS — when the client has no ads outcome data', async () => {
    // This is the whole regression: a Messenger client used to get a ROAS
    // promise here. Now it gets an honest "unmeasured".
    const supabase = supabaseReturning([])
    expect(await resolveClientAdsExpectedMetric(supabase as never, 'kiteroa')).toBeNull()
  })

  it('returns null when the lookup itself fails, rather than guessing', async () => {
    const supabase = supabaseReturning(null, { message: 'connection reset' })
    expect(await resolveClientAdsExpectedMetric(supabase as never, 'any')).toBeNull()
  })

  it('scopes the query to the ads flywheel and this client', async () => {
    const supabase = supabaseReturning([{ metric_key: ADS_METRIC_KEY.CPA }])
    await resolveClientAdsExpectedMetric(supabase as never, 'client-42')
    expect(supabase.from).toHaveBeenCalledWith('flywheel_metrics')
    expect(supabase.chain.eq).toHaveBeenCalledWith('client_id', 'client-42')
    expect(supabase.chain.eq).toHaveBeenCalledWith('flywheel', 'ads')
  })
})

// ── describeResultsColumn / resultsAreComparable（2026-08-04 $834 误判的机器版护栏）──
describe('describeResultsColumn', () => {
  it('触达类目标：results 恒为 0，0 是正常的', () => {
    for (const objective of ['OUTCOME_AWARENESS', 'REACH', 'BRAND_AWARENESS']) {
      const r = describeResultsColumn({ objective })
      expect(r.meaning).toBe('not_applicable')
      expect(r.zeroIsExpected).toBe(true)
    }
  })

  it('视频观看类目标：results 恒为 0，0 是正常的', () => {
    const r = describeResultsColumn({ objective: 'VIDEO_VIEWS' })
    expect(r.meaning).toBe('not_applicable')
    expect(r.zeroIsExpected).toBe(true)
    expect(r.reason).toContain('完播')
  })

  it('留资目标：0 结果是坏消息，不能当正常放过', () => {
    const r = describeResultsColumn({ objective: 'OUTCOME_LEADS' })
    expect(r.meaning).toBe('form_leads')
    expect(r.zeroIsExpected).toBe(false)
  })

  it('目的地优先于目标：OUTCOME_LEADS + MESSENGER 算对话不算留资', () => {
    const r = describeResultsColumn({ objective: 'OUTCOME_LEADS', destinationType: 'MESSENGER' })
    expect(r.meaning).toBe('conversations')
    expect(r.zeroIsExpected).toBe(false)
  })

  it('拿不到目标时不假设 0 正常 —— 宁可多问一句', () => {
    const r = describeResultsColumn({ objective: null })
    expect(r.meaning).toBe('unknown')
    expect(r.zeroIsExpected).toBe(false)
  })

  it('未知目标同样不放过', () => {
    const r = describeResultsColumn({ objective: 'SOME_NEW_META_OBJECTIVE' })
    expect(r.meaning).toBe('unknown')
    expect(r.zeroIsExpected).toBe(false)
  })
})

describe('resultsAreComparable', () => {
  it('同类目标可比', () => {
    expect(resultsAreComparable({ objective: 'OUTCOME_LEADS' }, { objective: 'LEAD_GENERATION' })).toBe(true)
  })

  it('留资 vs 对话 不可比', () => {
    expect(resultsAreComparable({ objective: 'OUTCOME_LEADS' }, { objective: 'OUTCOME_ENGAGEMENT' })).toBe(false)
  })

  it('🔴 回归：留资 vs 触达 绝不可比（$834 误判的根因）', () => {
    expect(resultsAreComparable({ objective: 'OUTCOME_LEADS' }, { objective: 'REACH' })).toBe(false)
    expect(resultsAreComparable({ objective: 'OUTCOME_LEADS' }, { objective: 'VIDEO_VIEWS' })).toBe(false)
  })

  it('任一方目标未知就不可比', () => {
    expect(resultsAreComparable({ objective: 'OUTCOME_LEADS' }, { objective: null })).toBe(false)
  })

  it('🔴 两条都是触达类也不可比 —— 两边恒为 0，比出来的名次没有意义', () => {
    expect(resultsAreComparable({ objective: 'REACH' }, { objective: 'OUTCOME_AWARENESS' })).toBe(false)
    expect(resultsAreComparable({ objective: 'VIDEO_VIEWS' }, { objective: 'VIDEO_VIEWS' })).toBe(false)
  })
})
