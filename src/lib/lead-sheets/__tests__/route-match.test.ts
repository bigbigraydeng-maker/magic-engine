import { describe, it, expect } from 'vitest'
import { isWithinBackfillWindow, pickRoute } from '../route-match'
import type { LeadRecord, LeadSheetRoute } from '../types'

function route(over: Partial<LeadSheetRoute>): LeadSheetRoute {
  return {
    routeKey: 'r',
    label: null,
    spreadsheetId: 's',
    tabName: 't',
    matchAnyAnswerFields: [],
    priority: 100,
    columns: [{ field: 'lead_id' }],
    valueLabels: {},
    dedupColumns: [0],
  dedupIdColumn: null,
    timezone: 'Pacific/Auckland',
    backfillSince: null,
    enabled: true,
    ...over,
  }
}

function lead(answers: Record<string, string>, occurredAt = '2026-09-23T21:00:00Z'): LeadRecord {
  return {
    leadId: 'x', occurredAt, name: null, email: null, phone: null,
    adId: null, adName: null, adsetId: null, adsetName: null,
    campaignId: null, campaignName: null, formId: null, formName: null,
    platform: null, isOrganic: null, answers,
  }
}

const NEW = route({
  routeKey: 'v4',
  priority: 10,
  matchAnyAnswerFields: ['whats_your_budget_per_person_nzd?', 'when_are_you_hoping_to_travel?'],
})
const OLD = route({ routeKey: 'default', priority: 900 })

describe('pickRoute', () => {
  it('问了预算就走新表', () => {
    expect(pickRoute(lead({ 'whats_your_budget_per_person_nzd?': '3000_5000' }), [NEW, OLD])?.routeKey).toBe('v4')
  })

  it('只问了出发时间也走新表（判据是「任一」）', () => {
    expect(pickRoute(lead({ 'when_are_you_hoping_to_travel?': 'around_christmas' }), [NEW, OLD])?.routeKey).toBe('v4')
  })

  it('两个都没问就走兜底的旧表', () => {
    expect(pickRoute(lead({ 'which_tour_interests_you_most?': 'x' }), [NEW, OLD])?.routeKey).toBe('default')
  })

  it('答案留空但问题在 → 还是走新表（判据是「问过」不是「答了」）', () => {
    expect(pickRoute(lead({ 'whats_your_budget_per_person_nzd?': '' }), [NEW, OLD])?.routeKey).toBe('v4')
  })

  it('**不认 form_id**：换了个 form id 但问题没变，照样归新表', () => {
    // 这条就是「以后出 v5/v6 不用改代码」的全部依据，别删。
    const v5 = lead({
      'whats_your_budget_per_person_nzd?': 'around_3000',
      'brand_new_question_only_v5_has?': 'yes',
    })
    expect(pickRoute(v5, [NEW, OLD])?.routeKey).toBe('v4')
  })

  it('没有兜底路线时返回 null，不硬塞进某张表', () => {
    expect(pickRoute(lead({ a: 'b' }), [NEW])).toBeNull()
  })

  it('停用的路线不参与', () => {
    const off = { ...NEW, enabled: false }
    expect(pickRoute(lead({ 'whats_your_budget_per_person_nzd?': 'x' }), [off, OLD])?.routeKey).toBe('default')
  })

  it('优先级小的先匹配', () => {
    const a = route({ routeKey: 'a', priority: 1, matchAnyAnswerFields: ['q'] })
    const b = route({ routeKey: 'b', priority: 2, matchAnyAnswerFields: ['q'] })
    expect(pickRoute(lead({ q: '1' }), [b, a])?.routeKey).toBe('a')
  })
})

describe('isWithinBackfillWindow', () => {
  const r = route({ backfillSince: '2026-09-20T00:00:00Z' })

  it('窗口内的要', () => {
    expect(isWithinBackfillWindow(lead({}, '2026-09-23T00:00:00Z'), r)).toBe(true)
  })

  it('窗口之前的不碰 —— 首跑不能把几百条历史倒进人在用的表', () => {
    expect(isWithinBackfillWindow(lead({}, '2026-07-01T00:00:00Z'), r)).toBe(false)
  })

  it('没设窗口就全要', () => {
    expect(isWithinBackfillWindow(lead({}, '2020-01-01T00:00:00Z'), route({}))).toBe(true)
  })

  it('时间读不懂就当窗口外 —— 宁可不写，不写错', () => {
    expect(isWithinBackfillWindow(lead({}, '不是时间'), r)).toBe(false)
  })
})
