import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

import { toClientGrowthView, type GrowthRowForClient } from '../growth-client-view'

const NOW = new Date('2026-09-27T20:00:00Z')

const INTERNAL_D11_TITLE = '再营销受众池断供，建议给供血广告加预算'
const INTERNAL_GOAL_REASON = '按当前日预算上限和近 7 天每结果成本，到期最多约 40，不到目标的 80%'

const d10 = (over: Record<string, unknown> = {}) => ({
  code: 'D10',
  status: 'hit',
  title: '内部：点进去之后差了，按手册查表单',
  reasons: ['内部原因：口径 2.5'],
  clientVisible: true,
  units: [{ level: 'ad', id: 'ad1', name: 'Spring Lead Ad', adAccountId: 'act_1' }],
  evidence: {
    core_metric: 'lead',
    baseline_source: 'own_history',
    base_rate: 0.16,
    recent_rate: 0.04,
    base_cost_per_result: 7,
    recent_cost_per_result: 30,
    recent_spend: 100,
  },
  manualTask: { what: 'FDE 内部任务', how: '内部操作', href: null },
  checkBack: { after: '7 天后', condition: '内部条件', fallback: '内部退回' },
  ...over,
})

const d11 = {
  code: 'D11',
  status: 'hit',
  title: INTERNAL_D11_TITLE,
  reasons: ['受众 7 天缩水'],
  clientVisible: false,
  units: [{ level: 'adset', id: 'as9', name: 'Retargeting pool', adAccountId: 'act_1' }],
  evidence: { audience_id: 'aud_1', suggested_extra_spend: 50 },
}

const o1 = { code: 'O1', status: 'hit', title: '内部机会：潜在爆款，建议加钱', clientVisible: false, units: [] }

function row(date: string, problems: unknown[], over: Record<string, unknown> = {}): GrowthRowForClient {
  return {
    client_id: 'c1',
    date,
    data_completeness: 'complete',
    goal_pace: {
      expectedToDate: 50,
      actualToDate: 30,
      gapPct: -40,
      projectedEnd: 40,
      verdict: 'unreachable_within_caps',
      reason: INTERNAL_GOAL_REASON,
    },
    payload: {
      headline: '目标按现在的预算上限到不了，3 件要看的事',
      dataCompleteness: 'complete',
      completenessReasons: ['adset 层日数据同步失败：内部报错'],
      problems,
      opportunities: [o1],
      excluded: [{ adAccountId: 'act_2', level: 'campaign', id: 'x', name: '别的客户的系列', reason: 'shared_account', detail: '' }],
      adLevelCoverage: [{ adAccountId: 'act_1', ran: true, reason: 'ok', adsChecked: 5 }],
      goal: { title: '九月留资', label: '留资', target: 100, dayIndex: 15, totalDays: 30, pace: { reason: INTERNAL_GOAL_REASON } },
      evaluatedAt: '2026-09-27T01:00:00Z',
      ...over,
    },
  }
}

describe('toClientGrowthView', () => {
  it('no rows → null (page says the patrol has not run yet)', () => {
    expect(toClientGrowthView([], NOW)).toBeNull()
  })

  it('keeps a client-visible D10 that hit two days running, as client copy; drops D11, opportunities and internal fields', () => {
    const rows = [row('2026-09-26', [d10(), d11]), row('2026-09-27', [d10(), d11])]
    const view = toClientGrowthView(rows, NOW)!
    expect(view.viewer).toBe('client')
    expect(view.date).toBe('2026-09-27')
    expect(view.adCards?.cards).toHaveLength(1)
    expect(view.adCards?.cards[0].adLabel).toBe('Spring Lead Ad')

    const json = JSON.stringify(view)
    for (const leaked of [
      INTERNAL_D11_TITLE, 'D11', 'aud_1', 'suggested_extra_spend', 'Retargeting pool',
      '内部', 'FDE', '手册', 'O1', '别的客户的系列', 'adLevelCoverage', 'evidence',
      INTERNAL_GOAL_REASON, '日预算上限', '3 件要看的事',
    ]) {
      expect(json, `leaked: ${leaked}`).not.toContain(leaked)
    }
  })

  it('goal and pace are whitelisted; internal pace reason replaced with neutral words', () => {
    const view = toClientGrowthView([row('2026-09-27', [])], NOW)!
    expect(view.goal).toEqual({
      title: '九月留资',
      label: '留资',
      target: 100,
      dayIndex: 15,
      totalDays: 30,
      progressPending: false,
    })
    expect(view.goal_pace?.verdict).toBe('unreachable_within_caps')
    expect(view.goal_pace?.reason).not.toContain('预算')
    expect(view.goal_pace?.actualToDate).toBe(30)
  })

  it('signups metric → progressPending without leaking primaryMetricKey', () => {
    const view = toClientGrowthView([
      row('2026-09-27', [], {
        goal: {
          title: '定金座位',
          label: '报名',
          target: 30,
          dayIndex: 3,
          totalDays: 60,
          primaryMetricKey: 'signups_count',
        },
      }),
    ], NOW)!
    expect(view.goal?.progressPending).toBe(true)
    expect(JSON.stringify(view)).not.toContain('signups_count')
    expect(JSON.stringify(view)).not.toContain('primaryMetricKey')
  })

  it('clientVisible missing or the string "true" counts as internal', () => {
    const missing = d10({ clientVisible: undefined })
    const stringy = d10({ clientVisible: 'true' })
    for (const f of [missing, stringy]) {
      const view = toClientGrowthView([row('2026-09-26', [f]), row('2026-09-27', [f])], NOW)!
      expect(view.adCards).toBeNull()
    }
  })

  it('a single-day hit is not shown; the note says it checked and found nothing', () => {
    const view = toClientGrowthView([row('2026-09-26', []), row('2026-09-27', [d10()])], NOW)!
    expect(view.adCards).toBeNull()
    expect(view.adNote).toContain('检查了 5 条')
  })

  it('account not checked → says so, never "found nothing"', () => {
    const view = toClientGrowthView(
      [row('2026-09-27', [d10()], { adLevelCoverage: [{ adAccountId: 'act_1', ran: false, reason: 'shared_account', adsChecked: 0 }] })],
      NOW,
    )!
    expect(view.adCards).toBeNull()
    expect(view.adNote).toBe('你的广告账户这次没有逐条检查：这个账户目前只看整体表现，暂时不逐条检查。')
    expect(view.adNote).not.toContain('没有发现')
  })

  it('partial data → says data was not complete', () => {
    const view = toClientGrowthView([row('2026-09-27', [d10()], { dataCompleteness: 'partial' })], NOW)!
    expect(view.adCards).toBeNull()
    expect(view.adNote).toContain('数据还没有到齐')
  })

  it('old patrol payload without coverage → preparing, not "found nothing"', () => {
    const view = toClientGrowthView([row('2026-09-27', [d10()], { adLevelCoverage: undefined })], NOW)!
    expect(view.adCards).toBeNull()
    expect(view.adNote).toContain('准备中')
  })

  it('stale patrol with the old payload shape → "not updated", not "preparing"', () => {
    const view = toClientGrowthView([row('2026-09-20', [d10()], { adLevelCoverage: undefined })], NOW)!
    expect(view.adNote).toContain('还没有更新')
    expect(view.adNote).not.toContain('准备中')
  })

  it('a client-visible finding that could not be judged (not_comparable) is never shown', () => {
    const nc = d10({ status: 'not_comparable', notComparableReason: 'recently_changed', reasons: ['§14 M8 内部'] })
    const view = toClientGrowthView([row('2026-09-26', [nc]), row('2026-09-27', [nc])], NOW)!
    expect(view.adCards).toBeNull()
    expect(JSON.stringify(view)).not.toContain('M8')
  })

  it('every account unchecked → says how many and each reason, not just the first one', () => {
    const coverage = [
      { adAccountId: 'act_1', ran: false, reason: 'shared_account', adsChecked: 0 },
      { adAccountId: 'act_2', ran: false, reason: 'client_page_unknown', adsChecked: 0 },
    ]
    const view = toClientGrowthView([row('2026-09-27', [d10()], { adLevelCoverage: coverage })], NOW)!
    expect(view.adCards).toBeNull()
    expect(view.adNote).toContain('你的 2 个广告账户这次都没有逐条检查')
    expect(view.adNote).toContain('只看整体表现')
    expect(view.adNote).toContain('Facebook 主页')
  })

  it('one of two accounts not checked → cards plus a note about the skipped account', () => {
    const coverage = [
      { adAccountId: 'act_1', ran: true, reason: 'ok', adsChecked: 5 },
      { adAccountId: 'act_2', ran: false, reason: 'not_loaded', adsChecked: 0 },
    ]
    const view = toClientGrowthView(
      [row('2026-09-26', [d10()], { adLevelCoverage: coverage }), row('2026-09-27', [d10()], { adLevelCoverage: coverage })],
      NOW,
    )!
    expect(view.adCards?.cards).toHaveLength(1)
    expect(view.adNote).toContain('1 个广告账户这次没有逐条检查')
  })
})
