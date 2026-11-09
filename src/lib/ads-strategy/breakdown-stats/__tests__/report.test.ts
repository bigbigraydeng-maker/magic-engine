import { describe, expect, it } from 'vitest'
import {
  buildBreakdownReport,
  flagRows,
  isoWeekday,
  type LeadInput,
  type StatInput,
} from '../report'
import type { ReportAccount } from '../report-types'

const ACCOUNT: ReportAccount = {
  adAccountId: 'act_1',
  currency: 'USD',
  timezone: 'UTC',
  latestStatDate: '2026-11-01',
  lastFetchedAt: '2026-11-02T00:00:00Z',
}

const OBJECTIVES = new Map<string, string | null>([
  ['c_lead', 'OUTCOME_LEADS'],
  ['c_aware', 'OUTCOME_AWARENESS'],
])

function stat(over: Partial<StatInput>): StatInput {
  return {
    ad_account_id: 'act_1',
    campaign_id: 'c_lead',
    stat_date: '2026-10-26',
    breakdown_key: 'placement_device',
    breakdown_value: {},
    spend: 0,
    impressions: 0,
    clicks: 0,
    meta_leads: 0,
    ...over,
  }
}

function lead(local_date: string, local_hour: number): LeadInput {
  return { ad_account_id: 'act_1', local_date, local_hour }
}

describe('isoWeekday', () => {
  it('maps Monday to 1 and Sunday to 7', () => {
    expect(isoWeekday('2026-10-26')).toBe(1)
    expect(isoWeekday('2026-11-01')).toBe(7)
  })
})

describe('flagRows', () => {
  it('keeps null leads as null flag and null cost per lead', () => {
    const rows = flagRows([
      { key: 'a', spend: 10, impressions: 1, clicks: 1, leads: null },
      { key: 'b', spend: 10, impressions: 1, clicks: 1, leads: 5 },
    ])
    const a = rows.find((r) => r.key === 'a')
    expect(a?.leads).toBeNull()
    expect(a?.flag).toBeNull()
    expect(a?.costPerLead).toBeNull()
  })

  it('marks rows with too few expected leads as too_few', () => {
    const rows = flagRows([
      { key: 'big', spend: 1000, impressions: 1, clicks: 1, leads: 100 },
      { key: 'tiny', spend: 1, impressions: 1, clicks: 1, leads: 0 },
    ])
    const tiny = rows.find((r) => r.key === 'tiny')
    expect(tiny?.flag).toBe('too_few')
  })

  it('marks a clearly cheap row as cheap', () => {
    const rows = flagRows([
      { key: 'cheap', spend: 100, impressions: 1, clicks: 1, leads: 100 },
      { key: 'rest', spend: 1000, impressions: 1, clicks: 1, leads: 100 },
    ])
    expect(rows.find((r) => r.key === 'cheap')?.flag).toBe('cheap')
  })

  it('marks a clearly costly row as costly', () => {
    const rows = flagRows([
      { key: 'costly', spend: 1000, impressions: 1, clicks: 1, leads: 0 },
      { key: 'rest', spend: 10, impressions: 1, clicks: 1, leads: 100 },
    ])
    expect(rows.find((r) => r.key === 'costly')?.flag).toBe('costly')
  })

  it('spendShare sums to 1', () => {
    const rows = flagRows([
      { key: 'a', spend: 30, impressions: 1, clicks: 1, leads: 3 },
      { key: 'b', spend: 70, impressions: 1, clicks: 1, leads: 7 },
    ])
    const sum = rows.reduce((acc, r) => acc + r.spendShare, 0)
    expect(sum).toBeCloseTo(1, 10)
  })
})

describe('buildBreakdownReport', () => {
  it('excludes non-lead-objective spend from lead rows and totals', () => {
    const stats: StatInput[] = [
      stat({
        campaign_id: 'c_lead',
        breakdown_key: 'placement_device',
        breakdown_value: { platform: 'facebook', position: 'feed' },
        spend: 100,
        meta_leads: 10,
      }),
      stat({
        campaign_id: 'c_aware',
        breakdown_key: 'placement_device',
        breakdown_value: { platform: 'instagram', position: 'story' },
        spend: 50,
        meta_leads: 0,
      }),
    ]
    const report = buildBreakdownReport({
      since: '2026-10-01',
      until: '2026-11-01',
      days: 30,
      accounts: [ACCOUNT],
      stats,
      leads: [],
      objectives: OBJECTIVES,
    })
    expect(report.placement).toHaveLength(1)
    expect(report.placement[0].key).toBe('facebook · feed')
    expect(report.totals.spendLeadObjective).toBe(100)
    expect(report.totals.spendAll).toBe(150)
    expect(report.nonLeadSpend).toEqual([{ objective: 'OUTCOME_AWARENESS', spend: 50 }])
  })

  it('spendAll uses placement_device only and does not double count', () => {
    const stats: StatInput[] = [
      stat({
        breakdown_key: 'placement_device',
        breakdown_value: { platform: 'facebook', position: 'feed' },
        spend: 100,
        meta_leads: 5,
      }),
      stat({
        breakdown_key: 'hour_account_tz',
        breakdown_value: { hour: 9 },
        spend: 100,
        meta_leads: 5,
      }),
    ]
    const report = buildBreakdownReport({
      since: '2026-10-01',
      until: '2026-11-01',
      days: 30,
      accounts: [ACCOUNT],
      stats,
      leads: [],
      objectives: OBJECTIVES,
    })
    expect(report.totals.spendAll).toBe(100)
  })

  it('emits 24 hour rows and counts CRM leads by local_hour', () => {
    const stats: StatInput[] = [
      stat({
        breakdown_key: 'hour_account_tz',
        breakdown_value: { hour: 9 },
        spend: 10,
        meta_leads: 0,
      }),
    ]
    const leads: LeadInput[] = [lead('2026-10-26', 9), lead('2026-10-26', 9), lead('2026-10-26', 14)]
    const report = buildBreakdownReport({
      since: '2026-10-01',
      until: '2026-11-01',
      days: 30,
      accounts: [ACCOUNT],
      stats,
      leads,
      objectives: OBJECTIVES,
    })
    expect(report.hour).toHaveLength(24)
    expect(report.hour[9].leads).toBe(2)
    expect(report.hour[14].leads).toBe(1)
    expect(report.hour[0].leads).toBe(0)
  })

  it('region rows have null leads and flag, at most 15 rows', () => {
    const stats: StatInput[] = []
    for (let i = 0; i < 20; i++) {
      stats.push(
        stat({
          breakdown_key: 'region',
          breakdown_value: { region: `r${i}` },
          spend: 100 - i,
          meta_leads: 0,
        }),
      )
    }
    const report = buildBreakdownReport({
      since: '2026-10-01',
      until: '2026-11-01',
      days: 30,
      accounts: [ACCOUNT],
      stats,
      leads: [],
      objectives: OBJECTIVES,
    })
    expect(report.region.length).toBeLessThanOrEqual(15)
    for (const row of report.region) {
      expect(row.leads).toBeNull()
      expect(row.flag).toBeNull()
    }
  })

  it('weekday rows add up the hourly rows by date (regression: weekday spend was always 0)', () => {
    const report = buildBreakdownReport({
      since: '2026-10-26', until: '2026-11-01', days: 7, accounts: [ACCOUNT], objectives: OBJECTIVES,
      stats: [
        stat({ breakdown_key: 'hour_account_tz', breakdown_value: { hour: 9 }, stat_date: '2026-10-26', spend: 30, clicks: 3 }),
        stat({ breakdown_key: 'hour_account_tz', breakdown_value: { hour: 20 }, stat_date: '2026-10-26', spend: 20, clicks: 2 }),
        stat({ breakdown_key: 'hour_account_tz', breakdown_value: { hour: 9 }, stat_date: '2026-11-01', spend: 50, clicks: 5 }),
      ],
      leads: [lead('2026-10-26', 9), lead('2026-11-01', 9), lead('2026-11-01', 21)],
    })
    const mon = report.weekday.find((r) => r.key === '1')
    const sun = report.weekday.find((r) => r.key === '7')
    expect(mon?.spend).toBe(50)
    expect(mon?.clicks).toBe(5)
    expect(mon?.leads).toBe(1)
    expect(sun?.spend).toBe(50)
    expect(sun?.leads).toBe(2)
    expect(report.weekday.reduce((n, r) => n + r.spend, 0)).toBe(100)
  })

  it('day rows: one per date, newest first, spend from hourly rows and leads from CRM by local date, no verdict', () => {
    const report = buildBreakdownReport({
      since: '2026-10-26', until: '2026-10-28', days: 3, accounts: [ACCOUNT], objectives: OBJECTIVES,
      stats: [
        stat({ breakdown_key: 'hour_account_tz', breakdown_value: { hour: 9 }, stat_date: '2026-10-26', spend: 30, clicks: 3, impressions: 300 }),
        stat({ breakdown_key: 'hour_account_tz', breakdown_value: { hour: 20 }, stat_date: '2026-10-26', spend: 20, clicks: 2, impressions: 200 }),
        stat({ breakdown_key: 'hour_account_tz', breakdown_value: { hour: 9 }, stat_date: '2026-10-28', spend: 50, clicks: 5, impressions: 500 }),
      ],
      leads: [lead('2026-10-26', 9), lead('2026-10-27', 10), lead('2026-10-28', 9), lead('2026-10-28', 21)],
    })
    expect(report.day.map((r) => r.key)).toEqual(['2026-10-28', '2026-10-27', '2026-10-26'])
    const d26 = report.day.find((r) => r.key === '2026-10-26')
    expect(d26?.spend).toBe(50)
    expect(d26?.impressions).toBe(500)
    expect(d26?.leads).toBe(1)
    expect(d26?.costPerLead).toBe(50)
    const d27 = report.day.find((r) => r.key === '2026-10-27')
    expect(d27?.spend).toBe(0)
    expect(d27?.leads).toBe(1)
    expect(report.day.every((r) => r.flag === null && r.expectedLeads === null)).toBe(true)
    expect(report.day.reduce((n, r) => n + r.spend, 0)).toBe(100)
  })

  it('matchRate is null when metaLeads is 0', () => {
    const stats: StatInput[] = [
      stat({
        breakdown_key: 'placement_device',
        breakdown_value: { platform: 'facebook', position: 'feed' },
        spend: 10,
        meta_leads: 0,
      }),
    ]
    const report = buildBreakdownReport({
      since: '2026-10-01',
      until: '2026-11-01',
      days: 30,
      accounts: [ACCOUNT],
      stats,
      leads: [lead('2026-10-26', 9)],
      objectives: OBJECTIVES,
    })
    expect(report.totals.metaLeads).toBe(0)
    expect(report.totals.matchRate).toBeNull()
  })

  it('placement leads equal the sum of meta_leads', () => {
    const stats: StatInput[] = [
      stat({
        breakdown_key: 'placement_device',
        breakdown_value: { platform: 'facebook', position: 'feed' },
        spend: 100,
        meta_leads: 7,
      }),
      stat({
        breakdown_key: 'placement_device',
        breakdown_value: { platform: 'facebook', position: 'feed' },
        spend: 50,
        meta_leads: 3,
      }),
    ]
    const report = buildBreakdownReport({
      since: '2026-10-01',
      until: '2026-11-01',
      days: 30,
      accounts: [ACCOUNT],
      stats,
      leads: [],
      objectives: OBJECTIVES,
    })
    expect(report.placement).toHaveLength(1)
    expect(report.placement[0].leads).toBe(10)
  })

  it('builds the device table from placement_device rows', () => {
    const report = buildBreakdownReport({
      since: '2026-10-01',
      until: '2026-11-01',
      days: 30,
      accounts: [ACCOUNT],
      stats: [
        stat({ breakdown_value: { platform: 'facebook', position: 'feed', device: 'mobile_app' }, spend: 80, meta_leads: 8 }),
        stat({ breakdown_value: { platform: 'instagram', position: 'feed', device: 'mobile_app' }, spend: 20, meta_leads: 2 }),
        stat({ breakdown_value: { platform: 'facebook', position: 'feed', device: 'desktop' }, spend: 10, meta_leads: 1 }),
      ],
      leads: [],
      objectives: OBJECTIVES,
    })
    expect(report.device.map((r) => [r.key, r.spend, r.leads])).toEqual([
      ['mobile_app', 100, 10],
      ['desktop', 10, 1],
    ])
  })

  it('reports unmatched CRM leads apart from crmLeads', () => {
    const report = buildBreakdownReport({
      since: '2026-10-01',
      until: '2026-11-01',
      days: 30,
      accounts: [ACCOUNT],
      stats: [],
      leads: [lead('2026-10-26', 9)],
      objectives: OBJECTIVES,
      unmatchedLeads: 3,
    })
    expect(report.totals.crmLeads).toBe(1)
    expect(report.totals.crmLeadsUnmatched).toBe(3)
  })
})
