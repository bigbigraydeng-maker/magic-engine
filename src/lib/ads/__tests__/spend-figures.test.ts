import { describe, expect, it } from 'vitest'
import {
  accountSpendReading,
  alignSpendTile,
  currencyFromCountry,
  formatAdMoney,
  publicAdAccountName,
  spendOutcome,
  unreadWeeklySpendReason,
} from '../spend-figures'
import { clickThroughRate, formatCtr } from '@/lib/meta/ctr'

describe('clickThroughRate', () => {
  it('is clicks divided by impressions, the same ratio for the account and a campaign', () => {
    const impressions = 67_857
    const clicks = 1_900
    const rate = clickThroughRate(clicks, impressions)
    expect(rate).toBeCloseTo(clicks / impressions, 8)
    expect(formatCtr(rate)).toBe('2.8%')
    expect(formatCtr(clickThroughRate(28, 1_000))).toBe('2.8%')
  })

  it('does not turn a served day with zero clicks into a gap, and a day with no impressions stays empty', () => {
    expect(clickThroughRate(0, 2_000)).toBe(0)
    expect(formatCtr(0)).toBe('0.0%')
    expect(clickThroughRate(0, 0)).toBeNull()
    expect(clickThroughRate(null, 100)).toBeNull()
  })
})

describe('formatAdMoney', () => {
  it('uses the ad-account currency and does not compact or use a bare dollar sign', () => {
    expect(formatAdMoney(2012, 'NZD')).toBe('NZ$2,012.00')
    expect(formatAdMoney(484, 'AUD')).toBe('A$484.00')
    expect(formatAdMoney(12.5, 'USD')).toBe('US$12.50')
    expect(formatAdMoney(2012, null)).toBe('2,012.00（币种未标明）')
    expect(formatAdMoney(2012, 'nzd')).toBe('NZ$2,012.00')
  })

  it('maps a client country only when the account currency is missing', () => {
    expect(currencyFromCountry('NZ')).toBe('NZD')
    expect(currencyFromCountry('AU')).toBe('AUD')
    expect(currencyFromCountry('nz')).toBe('NZD')
    expect(currencyFromCountry(null)).toBeNull()
    expect(currencyFromCountry('US')).toBeNull()
  })
})

describe('spendOutcome', () => {
  it('shows purchase ROAS when Meta reported one', () => {
    expect(spendOutcome({ roas: 3.2, costPerConversation: 8, costPerLead: 4, currency: 'NZD' }))
      .toEqual({ label: 'ROAS', value: '3.20×' })
  })

  it('does not show a dash when spend exists but there is no purchase ROAS', () => {
    expect(spendOutcome({ roas: null, costPerConversation: 8.5, costPerLead: null, currency: 'NZD' }))
      .toEqual({ label: '每次对话成本', value: 'NZ$8.50' })
    expect(spendOutcome({ roas: null, costPerConversation: null, costPerLead: 12, currency: 'AUD' }))
      .toEqual({ label: '每次线索成本', value: 'A$12.00' })
    expect(spendOutcome({ roas: null, costPerConversation: null, costPerLead: null, currency: 'NZD' }).value)
      .toBe('不适用（没有成交金额）')
  })
})

describe('unreadWeeklySpendReason', () => {
  it('cites the data-tab total and its window, and says that total is not this week', () => {
    const reason = unreadWeeklySpendReason({
      spend: 2012, currency: 'NZD', period_start: '2026-09-25', period_end: '2026-10-25',
    })
    expect(reason).toContain('NZ$2,012.00')
    expect(reason).toContain('2026-09-25 至 2026-10-25')
    expect(reason).toContain('不是这一周')
  })

  it('stays honest when the account total is missing too', () => {
    expect(unreadWeeklySpendReason(null)).toContain('广告花费读不出来')
  })
})

describe('account spend tile', () => {
  const flywheelTile = {
    currentValue: 4024,
    value7dAgo: 1900,
    value28dAgo: 1000,
    deltaPct7d: 111.8,
    deltaPct28d: 302.4,
    sparkline: [1000, 4024],
    currency: null as string | null,
    periodLabel: null as string | null,
  }

  it('uses the snapshot spend and its own dates, not a summed daily bucket', () => {
    const reading = accountSpendReading(
      { spend: '2012.00', period_start: '2026-09-25', period_end: '2026-10-25' },
      'NZD',
    )
    const tile = alignSpendTile(flywheelTile, reading)
    expect(tile.currentValue).toBe(2012)
    expect(tile.periodLabel).toBe('2026-09-25 至 2026-10-25')
    expect(tile.currency).toBe('NZD')
    expect(tile.deltaPct7d).toBeNull()
    expect(tile.value7dAgo).toBeNull()
    expect(tile.sparkline).toEqual([null, 2012])
  })

  it('blanks the amount and the dates together when the snapshot is missing', () => {
    const tile = alignSpendTile(flywheelTile, accountSpendReading(null, 'NZD'))
    expect(tile.currentValue).toBeNull()
    expect(tile.periodLabel).toBeNull()
    expect(tile.sparkline).toEqual([null, null])
  })
})

describe('publicAdAccountName', () => {
  it('never shows a raw act_ id', () => {
    expect(publicAdAccountName(null, 'act_42')).toBe('已绑定的广告账户')
    expect(publicAdAccountName('act_42', 'act_42')).toBe('已绑定的广告账户')
    expect(publicAdAccountName('主账户', 'act_42')).toBe('主账户')
    expect(publicAdAccountName(null, 'sample-account')).toBe('sample-account')
  })
})
