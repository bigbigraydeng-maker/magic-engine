import { describe, it, expect } from 'vitest'
import { breakdownSig } from '../sig'
import { specFor } from '../specs'
import { mapBreakdownRow, mapBreakdownRows, type MapContext } from '../map'
import { reconcileSpend } from '../reconcile'
import type { BreakdownStatRow, GraphBreakdownRow } from '../types'

const ctx: MapContext = {
  clientId: 'c1',
  adAccountId: 'act_1',
  fetchedAt: '2026-10-29T00:00:00.000Z',
}

function baseRow(overrides: Partial<GraphBreakdownRow> = {}): GraphBreakdownRow {
  return {
    ad_id: 'ad_1',
    date_start: '2026-10-28',
    spend: '10.00',
    impressions: '100',
    clicks: '5',
    account_currency: 'USD',
    ...overrides,
  }
}

function statRow(overrides: Partial<BreakdownStatRow> = {}): BreakdownStatRow {
  return {
    client_id: 'c1',
    ad_account_id: 'act_1',
    level: 'ad',
    entity_id: 'ad_1',
    campaign_id: null,
    adset_id: null,
    stat_date: '2026-10-28',
    breakdown_key: 'hour_account_tz',
    breakdown_value: { hour: 21 },
    breakdown_sig: 'hour=21',
    spend: 10,
    currency: 'USD',
    impressions: 100,
    clicks: 5,
    link_clicks: null,
    meta_leads: null,
    meta_messaging: null,
    fetched_at: '2026-10-29T00:00:00.000Z',
    ...overrides,
  }
}

describe('breakdownSig', () => {
  it('is order-independent', () => {
    const a = breakdownSig({ platform: 'facebook', position: 'feed' })
    const b = breakdownSig({ position: 'feed', platform: 'facebook' })
    expect(a).toBe(b)
  })

  it('returns empty string for empty object', () => {
    expect(breakdownSig({})).toBe('')
  })
})

describe('spec valueOf', () => {
  it('parses hourly range to hour', () => {
    const spec = specFor('hour_account_tz')
    const value = spec.valueOf(
      baseRow({ hourly_stats_aggregated_by_advertiser_time_zone: '21:00:00 - 21:59:59' }),
    )
    expect(value).toEqual({ hour: 21 })
  })

  it('rejects out-of-range hour', () => {
    const spec = specFor('hour_account_tz')
    const value = spec.valueOf(
      baseRow({ hourly_stats_aggregated_by_advertiser_time_zone: '24:00:00 - 24:59:59' }),
    )
    expect(value).toBeNull()
  })

  it('placement requires device', () => {
    const spec = specFor('placement_device')
    const value = spec.valueOf(
      baseRow({ publisher_platform: 'facebook', platform_position: 'feed' }),
    )
    expect(value).toBeNull()
  })

  it('age_gender extracts both fields', () => {
    const spec = specFor('age_gender')
    const value = spec.valueOf(baseRow({ age: '25-34', gender: 'female' }))
    expect(value).toEqual({ age: '25-34', gender: 'female' })
  })

  it('region extracts region', () => {
    const spec = specFor('region')
    const value = spec.valueOf(baseRow({ region: 'CA' }))
    expect(value).toEqual({ region: 'CA' })
  })
})

describe('mapBreakdownRow', () => {
  it('hourly spec nulls meta actions even when actions contain lead', () => {
    const spec = specFor('hour_account_tz')
    const row = mapBreakdownRow(
      baseRow({
        hourly_stats_aggregated_by_advertiser_time_zone: '21:00:00 - 21:59:59',
        actions: [{ action_type: 'lead', value: '5' }],
      }),
      spec,
      ctx,
    )
    expect(row).not.toBeNull()
    expect(row?.meta_leads).toBeNull()
    expect(row?.meta_messaging).toBeNull()
  })

  it('placement spec picks one lead action, not the sum', () => {
    const spec = specFor('placement_device')
    const row = mapBreakdownRow(
      baseRow({
        publisher_platform: 'facebook',
        platform_position: 'feed',
        impression_device: 'iphone',
        actions: [
          { action_type: 'lead', value: '5' },
          { action_type: 'onsite_conversion.lead_grouped', value: '5' },
        ],
      }),
      spec,
      ctx,
    )
    expect(row?.meta_leads).toBe(5)
  })

  it('returns null when ad_id missing', () => {
    const spec = specFor('region')
    const row = mapBreakdownRow(
      baseRow({ ad_id: undefined, region: 'CA' }),
      spec,
      ctx,
    )
    expect(row).toBeNull()
  })

  it('link_clicks is null when inline_link_clicks absent', () => {
    const spec = specFor('region')
    const row = mapBreakdownRow(baseRow({ region: 'CA' }), spec, ctx)
    expect(row?.link_clicks).toBeNull()
  })
})

describe('mapBreakdownRows', () => {
  it('merges duplicate conflict keys and sums spend', () => {
    const spec = specFor('region')
    const raw = [
      baseRow({ region: 'CA', spend: '3.00' }),
      baseRow({ region: 'CA', spend: '4.00' }),
    ]
    const result = mapBreakdownRows(raw, spec, ctx)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].spend).toBe(7)
    expect(result.merged).toBe(1)
  })
})

describe('reconcileSpend', () => {
  it('exact match is ok', () => {
    const rows = [statRow({ spend: 10 })]
    const daily = [{ date: '2026-10-28', spend: 10 }]
    const [result] = reconcileSpend(rows, daily, ['hour_account_tz'])
    expect(result.ok).toBe(true)
    expect(result.relative_gap).toBe(0)
  })

  it('2% gap is not ok', () => {
    const rows = [statRow({ spend: 10.2 })]
    const daily = [{ date: '2026-10-28', spend: 10 }]
    const [result] = reconcileSpend(rows, daily, ['hour_account_tz'])
    expect(result.ok).toBe(false)
  })

  it('small absolute gap within tolerance is ok', () => {
    const rows = [statRow({ spend: 0.53 })]
    const daily = [{ date: '2026-10-28', spend: 0.5 }]
    const [result] = reconcileSpend(rows, daily, ['hour_account_tz'])
    expect(result.ok).toBe(true)
  })

  it('account 0 with breakdown > 0 yields null gap and not ok', () => {
    const rows = [statRow({ spend: 5 })]
    const daily = [{ date: '2026-10-28', spend: 0 }]
    const [result] = reconcileSpend(rows, daily, ['hour_account_tz'])
    expect(result.relative_gap).toBeNull()
    expect(result.ok).toBe(false)
  })

  it('missing rows for expected key yields zero spend and not ok', () => {
    const rows: BreakdownStatRow[] = []
    const daily = [{ date: '2026-10-28', spend: 10 }]
    const [result] = reconcileSpend(rows, daily, ['hour_account_tz'])
    expect(result.breakdown_spend).toBe(0)
    expect(result.ok).toBe(false)
  })
})
