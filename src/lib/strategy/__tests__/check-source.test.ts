import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { GEO_QUALIFIED_MENTION_GOAL_METRIC_KEY, PRIMARY_METRIC_CATALOG } from '@/types/strategy'

import {
  CHECK_OUTCOME_LEVEL_CLOSED_DEAL,
  CHECK_OUTCOME_LEVEL_CONTACT_SUCCESS,
  CHECK_OUTCOME_LEVEL_QUALIFIED_LEAD,
  CHECK_PLATFORM_STAGE,
  describeCheckSource,
  type CheckSourceEvidence,
  type CheckSourceGoal,
} from '../check-source'

const GOAL: CheckSourceGoal = {
  id: 'goal-1',
  client_id: 'client-1',
  intent: 'sales',
  primary_metric_key: 'signups_count',
  period_start: '2026-03-01',
  period_end: '2026-03-31',
}

const SEAT_RULE = {
  rule_id: 'rule-seats',
  paid_milestone_kind: 'deposit' as const,
  period_date_field: 'booked_on' as const,
}

function numbersIn(value: unknown, found: number[] = []): number[] {
  if (typeof value === 'number') found.push(value)
  else if (Array.isArray(value)) value.forEach((item) => numbersIn(item, found))
  else if (value !== null && typeof value === 'object') {
    Object.values(value).forEach((item) => numbersIn(item, found))
  }
  return found
}

function assertNoProgressNumber(evidence: CheckSourceEvidence): void {
  expect(evidence.writes_current_value).toBe(false)
  expect(evidence.empty_read).toBe('unknown')
  expect(evidence).not.toHaveProperty('value')
  expect(evidence).not.toHaveProperty('current_value')
  expect(evidence).not.toHaveProperty('progress_value')
  expect(numbersIn(evidence)).toEqual([])
  expect(JSON.stringify(evidence)).not.toMatch(/:0[,}\]]/)
}

function autoFetchCases(source: string): string[] {
  const start = source.indexOf('switch (metricKey)')
  const end = source.indexOf('default:', start)
  return [...source.slice(start, end).matchAll(/case '([^']+)'/g)].map((match) => match[1])
}

describe('describeCheckSource', () => {
  it('exports three separate outcome-level names and maps the file to Check', () => {
    expect(CHECK_OUTCOME_LEVEL_CONTACT_SUCCESS).toBe('contact_success')
    expect(CHECK_OUTCOME_LEVEL_QUALIFIED_LEAD).toBe('qualified_lead')
    expect(CHECK_OUTCOME_LEVEL_CLOSED_DEAL).toBe('closed_deal')
    expect(new Set([
      CHECK_OUTCOME_LEVEL_CONTACT_SUCCESS,
      CHECK_OUTCOME_LEVEL_QUALIFIED_LEAD,
      CHECK_OUTCOME_LEVEL_CLOSED_DEAL,
    ]).size).toBe(3)
    expect(CHECK_PLATFORM_STAGE).toBe('app/impact.Check')
  })

  it('defaults signups to booking rows in me_sale_outcomes and emits no number', () => {
    const evidence = describeCheckSource(GOAL)

    expect(evidence).toMatchObject({
      stage: 'check',
      platform_stage: 'app/impact.Check',
      status: 'declared',
      count_kind: 'bookings',
      count_kind_label_zh: '笔数',
      count_unit_source: 'metric_default',
      outcome_level: 'closed_deal',
      table: 'me_sale_outcomes',
      seat_rule_id: null,
      unknown_reason: null,
      period: { start: '2026-03-01', end: '2026-03-31' },
    })
    expect(evidence.filters).toEqual([
      { table: 'me_sale_outcomes', column: 'client_id', op: 'eq', value: 'client-1' },
      { table: 'me_sale_outcomes', column: 'outcome_kind', op: 'eq', value: 'purchase' },
      { table: 'me_sale_outcomes', column: 'redacted_at', op: 'is_null', value: null },
      { table: 'me_sale_outcomes', column: 'review_status', op: 'neq', value: 'rejected' },
      { table: 'me_sale_outcomes', column: 'occurred_at', op: 'gte', value: '2026-03-01T00:00:00Z' },
      { table: 'me_sale_outcomes', column: 'occurred_at', op: 'lte', value: '2026-03-31T23:59:59Z' },
    ])
    expect(evidence.caveats.join(' ')).toContain('一条成交行都没有时是未知，不是 0')
    expect(evidence.unknown_when_missing.map((item) => item.field)).toContain('me_sale_outcomes.outcome_kind')
    assertNoProgressNumber(evidence)
    expect(evidence).not.toBeInstanceOf(Promise)
  })

  it('does not switch to seats when a departure list or an unused seat rule is present', () => {
    const withDates = describeCheckSource(GOAL, { departure_dates: ['2026-11-02', '2026-12-01'] })
    expect(withDates).toEqual(describeCheckSource(GOAL))
    expect(JSON.stringify(withDates)).not.toContain('2026-11-02')

    const withRule = describeCheckSource(GOAL, { seat_rule: SEAT_RULE })
    expect(withRule.count_kind).toBe('bookings')
    expect(withRule.table).toBe('me_sale_outcomes')
    expect(withRule.seat_rule_id).toBeNull()
    expect(withRule.status).toBe('declared')
    expect(withRule.caveats.join(' ')).toContain('没有把单位设为座位，所以仍按笔数')
  })

  it('counts seats only when the goal config opens that unit and names the rule', () => {
    const evidence = describeCheckSource(GOAL, { count_unit: 'seats', seat_rule: SEAT_RULE })

    expect(evidence).toMatchObject({
      status: 'declared',
      count_kind: 'seats',
      count_kind_label_zh: '座位',
      count_unit_source: 'goal_config',
      outcome_level: 'closed_deal',
      table: 'crm_bookings',
      also_reads: ['crm_booking_milestones'],
      seat_rule_id: 'rule-seats',
    })
    expect(evidence.filters).toContainEqual({
      table: 'crm_booking_milestones', column: 'kind', op: 'eq', value: 'deposit',
    })
    expect(evidence.filters).toContainEqual({
      table: 'crm_bookings', column: 'booked_on', op: 'gte', value: '2026-03-01',
    })
    const party = evidence.unknown_when_missing.find((item) => item.field === 'crm_bookings.party_size')
    expect(party?.reason).toContain('不记 0')
    expect(evidence.caveats.join(' ')).not.toContain('定金')
    assertNoProgressNumber(evidence)
  })

  it('uses the configured milestone and date column, with no default milestone', () => {
    const evidence = describeCheckSource(GOAL, {
      count_unit: 'seats',
      seat_rule: {
        rule_id: 'rule-balance',
        paid_milestone_kind: 'balance',
        period_date_field: 'departure_depart_on',
      },
    })

    expect(evidence.status).toBe('declared')
    expect(evidence.filters).toContainEqual({
      table: 'crm_booking_milestones', column: 'kind', op: 'eq', value: 'balance',
    })
    expect(evidence.filters.map((item) => item.value)).not.toContain('deposit')
    expect(evidence.filters).toContainEqual({
      table: 'crm_bookings', column: 'departure_depart_on', op: 'gte', value: '2026-03-01',
    })
  })

  it('stays unknown and emits no number when the seat rule is missing', () => {
    const evidence = describeCheckSource(GOAL, { count_unit: 'seats' })

    expect(evidence.status).toBe('unknown')
    expect(evidence.count_kind).toBe('seats')
    expect(evidence.table).toBe('crm_bookings')
    expect(evidence.seat_rule_id).toBeNull()
    expect(evidence.missing_fields).toContain('config.seat_rule')
    expect(evidence.unknown_reason).toContain('没有全行业默认')
    expect(evidence.filters.map((item) => item.column)).not.toContain('kind')
    assertNoProgressNumber(evidence)
  })

  it('treats a missing or inverted check window as unknown and does not invent 0', () => {
    const missing = describeCheckSource({ ...GOAL, period_start: null, period_end: '' })
    expect(missing.status).toBe('unknown')
    expect(missing.count_kind).toBe('bookings')
    expect(missing.missing_fields).toEqual(['goals.period_start', 'goals.period_end'])
    expect(missing.filters.map((item) => item.column)).not.toContain('occurred_at')
    assertNoProgressNumber(missing)

    const inverted = describeCheckSource({ ...GOAL, period_start: '2026-04-01', period_end: '2026-03-01' })
    expect(inverted.status).toBe('unknown')
    expect(inverted.missing_fields).toContain('goals.period_end')
    expect(inverted.unknown_reason).toContain('结束日早于开始日')
    assertNoProgressNumber(inverted)

    const blankClient = describeCheckSource({ ...GOAL, client_id: '  ' })
    expect(blankClient.status).toBe('unknown')
    expect(blankClient.missing_fields).toContain('goals.client_id')
    assertNoProgressNumber(blankClient)
  })

  it('rejects an unusable archive stamp without turning the declaration into a number', () => {
    const bad = describeCheckSource(GOAL, { as_of: 'yesterday' })
    expect(bad.status).toBe('unknown')
    expect(bad.as_of).toBeNull()
    expect(bad.missing_fields).toContain('config.as_of')
    assertNoProgressNumber(bad)

    const stamped = describeCheckSource(GOAL, { as_of: '2026-10-24T00:00:00Z' })
    expect(stamped.status).toBe('declared')
    expect(stamped.as_of).toBe('2026-10-24T00:00:00Z')
  })

  it('describes leads as other, from two tables, and not as a closed deal', () => {
    const evidence = describeCheckSource({ ...GOAL, primary_metric_key: 'leads_count' })

    expect(evidence).toMatchObject({
      status: 'declared',
      count_kind: 'other',
      count_kind_label_zh: '其他',
      outcome_level: null,
      table: null,
      source_order: ['ga4_traffic_snapshots', 'ad_daily_insights'],
    })
    expect(evidence.outcome_level).not.toBe(CHECK_OUTCOME_LEVEL_CONTACT_SUCCESS)
    expect(evidence.outcome_level).not.toBe(CHECK_OUTCOME_LEVEL_QUALIFIED_LEAD)
    expect(evidence.caveats.join(' ')).toContain('不区分联系成功和合格线索')
    expect(evidence.caveats.join(' ')).toContain('销售目标的进度不能用这个数代替成交')
    assertNoProgressNumber(evidence)
  })

  it('describes search clicks as other clicks, including on a sales goal', () => {
    const evidence = describeCheckSource({
      ...GOAL,
      intent: 'sales',
      primary_metric_key: 'seo_gsc_clicks_28d',
    })

    expect(evidence).toMatchObject({
      status: 'declared',
      count_kind: 'other',
      table: 'gsc_page_daily',
      outcome_level: null,
    })
    expect(evidence.caveats.join(' ')).toContain('不是报名笔数')
    expect(evidence.caveats.join(' ')).toContain('不能用这个数代替成交')
    assertNoProgressNumber(evidence)
  })

  it('does not invent a table or a zero for self-reported, verification, or unwired metrics', () => {
    const orders = describeCheckSource({ ...GOAL, primary_metric_key: 'orders_count' })
    expect(orders.status).toBe('unknown')
    expect(orders.count_kind).toBe('other')
    expect(orders.table).toBeNull()
    expect(orders.missing_fields).toContain('manual_reading')
    expect(orders.unknown_reason).toContain('不是 0')
    assertNoProgressNumber(orders)

    const verification = describeCheckSource({
      ...GOAL,
      intent: 'awareness',
      primary_metric_key: GEO_QUALIFIED_MENTION_GOAL_METRIC_KEY,
    })
    expect(verification.status).toBe('unknown')
    expect(verification.missing_fields).toContain('verification_evidence')
    assertNoProgressNumber(verification)

    const rate = describeCheckSource({ ...GOAL, primary_metric_key: 'conversion_rate' })
    expect(rate.status).toBe('unknown')
    expect(rate.table).toBeNull()
    expect(rate.missing_fields).toContain('auto_fetch_source')
    assertNoProgressNumber(rate)
  })

  it('refuses to relabel another metric as bookings or seats', () => {
    const seatsOnClicks = describeCheckSource(
      { ...GOAL, primary_metric_key: 'seo_gsc_clicks_28d' },
      { count_unit: 'seats', seat_rule: SEAT_RULE },
    )
    expect(seatsOnClicks.status).toBe('unknown')
    expect(seatsOnClicks.count_kind).toBeNull()
    expect(seatsOnClicks.missing_fields).toContain('config.count_unit')
    assertNoProgressNumber(seatsOnClicks)

    const otherOnSignups = describeCheckSource(GOAL, { count_unit: 'other' })
    expect(otherOnSignups.status).toBe('unknown')
    expect(otherOnSignups.count_kind).toBeNull()
    assertNoProgressNumber(otherOnSignups)
  })

  it('covers every current auto-fetch metric without assigning the collapsed levels', () => {
    const cases = autoFetchCases(readFileSync('src/lib/strategy/auto-fetch.ts', 'utf8'))
    expect(cases).toContain('signups_count')
    expect(cases.length).toBeGreaterThan(0)

    for (const key of cases) {
      const evidence = describeCheckSource({ ...GOAL, intent: 'awareness', primary_metric_key: key })
      expect(evidence.status, key).toBe('declared')
      assertNoProgressNumber(evidence)
      if (key === 'signups_count') {
        expect(evidence.count_kind).toBe('bookings')
        expect(evidence.table).toBe('me_sale_outcomes')
        expect(evidence.outcome_level).toBe(CHECK_OUTCOME_LEVEL_CLOSED_DEAL)
      } else {
        expect(evidence.count_kind).toBe('other')
        expect(evidence.outcome_level).toBeNull()
      }
    }
  })

  it('never marks a catalog metric as contact success or a qualified lead', () => {
    for (const metric of PRIMARY_METRIC_CATALOG) {
      const evidence = describeCheckSource({ ...GOAL, primary_metric_key: metric.key })
      expect(evidence.outcome_level).not.toBe(CHECK_OUTCOME_LEVEL_CONTACT_SUCCESS)
      expect(evidence.outcome_level).not.toBe(CHECK_OUTCOME_LEVEL_QUALIFIED_LEAD)
      expect(evidence.outcome_level === CHECK_OUTCOME_LEVEL_CLOSED_DEAL).toBe(metric.key === 'signups_count')
      assertNoProgressNumber(evidence)
    }
  })

  it('keeps client names and deposit-as-sale wording out of the shared module', () => {
    const source = readFileSync('src/lib/strategy/check-source.ts', 'utf8')
    expect(source).not.toContain('CTS')
    expect(source).not.toContain('定金')
    expect(source).not.toContain('27fc80bd')
    expect(source).not.toContain('supabase')
    expect(source).toContain('app/impact Check')
  })
})
