/**
 * 卫青巡察的两个纯函数。
 *
 * `resolveCompleteness` 是这一层最容易被改坏的地方：现有 cron 里那个
 * `if (result.ad_daily?.success)` 只看广告系列级，而 D3–D9 / O1–O3 大多是广告组粒度。
 * 下面「广告系列级成功但广告组级没跑 → partial」那条用例就是钉这件事的——
 * 把实现改回只查 campaign 一层，它必须变红。
 */

import { describe, expect, it } from 'vitest'
import { resolveCompleteness, buildHeadline, capturesComplete, dropProblemsSupersededByOpportunities } from '../patrol'
import type { AccountInput, CaptureCoverage, Diagnosis } from '../../portfolio/diagnostics/types'
import type { DigestGoalContext } from '../../portfolio/internal-digest'
import type { GoalPace } from '../../goal-pace'

const ok = { success: true }
const bad = { success: false }
const fullAccount = { campaign: ok, adset: ok, ad: ok }

describe('resolveCompleteness — 三层都要查', () => {
  it('主账户三层都成功 + 快照抓全 → complete，无原因', () => {
    const v = resolveCompleteness({ accounts: [fullAccount], capturesComplete: true })
    expect(v.completeness).toBe('complete')
    expect(v.reasons).toEqual([])
  })

  it('广告系列级成功、广告组级没跑 → partial（只查 campaign 一层的实现会漏掉）', () => {
    const v = resolveCompleteness({ accounts: [{ campaign: ok, ad: ok }], capturesComplete: true })
    expect(v.completeness).toBe('partial')
    expect(v.reasons.some(r => r.includes('广告组级'))).toBe(true)
  })

  it('广告级拉取失败 → partial', () => {
    const v = resolveCompleteness({ accounts: [{ campaign: ok, adset: ok, ad: bad }], capturesComplete: true })
    expect(v.completeness).toBe('partial')
    expect(v.reasons.some(r => r.includes('广告级'))).toBe(true)
  })

  it('次账户缺一层也算不完整（不能只看主账户）', () => {
    const v = resolveCompleteness({ accounts: [fullAccount, { campaign: ok, adset: ok }], capturesComplete: true })
    expect(v.completeness).toBe('partial')
    expect(v.reasons.some(r => r.includes('第 2 个广告账户'))).toBe(true)
  })

  it('日数据齐但设置快照没抓全 → partial', () => {
    const v = resolveCompleteness({ accounts: [fullAccount], capturesComplete: false })
    expect(v.completeness).toBe('partial')
    expect(v.reasons.some(r => r.includes('快照'))).toBe(true)
  })

  it('一个账户都没同步 → partial（空数组不能当"没问题"）', () => {
    const v = resolveCompleteness({ accounts: [], capturesComplete: true })
    expect(v.completeness).toBe('partial')
  })
})

function capture(level: string, complete: boolean, skipped_shared = false): CaptureCoverage {
  return { level, complete, skipped_shared, error: complete ? null : 'boom', captured_at: '2026-09-24T02:00:00Z' }
}
function acct(latestCaptures: CaptureCoverage[]): AccountInput {
  return {
    adAccountId: 'act_1', shared: false, timezone: 'Pacific/Auckland', currency: 'NZD',
    snapshots: [], daily: [], hourly: {}, hourlyError: null, latestCaptures, lastInsightDate: '2026-09-24',
  }
}

describe('capturesComplete — 共用账户的合法跳过不算缺数据', () => {
  it('每层都 complete → true', () => {
    expect(capturesComplete([acct([capture('account', true), capture('adset', true)])])).toBe(true)
  })

  it('某层没抓全 → false', () => {
    expect(capturesComplete([acct([capture('account', true), capture('adset', false)])])).toBe(false)
  })

  it('共用账户按 §14 M9 跳过的层不算缺（skipped_shared）', () => {
    expect(capturesComplete([acct([capture('account', true), capture('adset', false, true)])])).toBe(true)
  })

  it('任一账户没抓全，整体就不算全', () => {
    expect(capturesComplete([acct([capture('account', true)]), acct([capture('account', false)])])).toBe(false)
  })
})

function hit(code: Diagnosis['code']): Diagnosis {
  return {
    code, status: 'hit', title: 't', units: [], evidence: {}, sample: [], reasons: [], clientVisible: false,
  }
}
function notComparable(code: Diagnosis['code']): Diagnosis {
  return { ...hit(code), status: 'not_comparable' }
}
function goalWith(verdict: GoalPace['verdict']): DigestGoalContext {
  return {
    title: 'CTS 圣诞团', label: '留资', target: 100, dayIndex: 10, totalDays: 30,
    pace: { expectedToDate: 33, actualToDate: 20, gapPct: -39, projectedEnd: 60, verdict, reason: 'r' },
  }
}

function withUnit(d: Diagnosis, id: string): Diagnosis {
  return { ...d, units: [{ level: 'adset', id, name: id, adAccountId: 'act_1' }] }
}

describe('dropProblemsSupersededByOpportunities — D5 ⊇ O3 不要两栏各说一遍', () => {
  it('同一个广告组同时被 D5 和 O3 命中 → 只留 O3，D5 那张不重复显示', () => {
    const r = dropProblemsSupersededByOpportunities(
      [withUnit(hit('D5'), 'as_a'), withUnit(hit('D3'), 'as_a')],
      [withUnit(hit('O3'), 'as_a')],
    )
    expect(r.supersededCount).toBe(1)
    expect(r.problems.map(p => p.code)).toEqual(['D3'])
  })

  it('D5 命中的是别的广告组 → 照常保留（不能一见 O3 就全砍）', () => {
    const r = dropProblemsSupersededByOpportunities(
      [withUnit(hit('D5'), 'as_b')],
      [withUnit(hit('O3'), 'as_a')],
    )
    expect(r.supersededCount).toBe(0)
    expect(r.problems.map(p => p.code)).toEqual(['D5'])
  })

  it('只丢 D5，不丢别的诊断码（O3 只跟 D5 同源）', () => {
    const r = dropProblemsSupersededByOpportunities(
      [withUnit(hit('D1'), 'as_a'), withUnit(hit('D4'), 'as_a')],
      [withUnit(hit('O3'), 'as_a')],
    )
    expect(r.supersededCount).toBe(0)
    expect(r.problems).toHaveLength(2)
  })

  it('O3 是 not_comparable 时不去重（没真命中就没重复一说）', () => {
    const r = dropProblemsSupersededByOpportunities(
      [withUnit(hit('D5'), 'as_a')],
      [withUnit(notComparable('O3'), 'as_a')],
    )
    expect(r.supersededCount).toBe(0)
    expect(r.problems).toHaveLength(1)
  })

  it('没有任何机会时原样返回', () => {
    const problems = [withUnit(hit('D5'), 'as_a')]
    const r = dropProblemsSupersededByOpportunities(problems, [])
    expect(r.problems).toEqual(problems)
    expect(r.supersededCount).toBe(0)
  })
})

describe('buildHeadline — 一句人话', () => {
  it('有问题也有机会 → 两样都报', () => {
    const h = buildHeadline([hit('D3'), hit('D1')], [hit('O1')], 'complete', null)
    expect(h).toContain('2 件要看的事')
    expect(h).toContain('1 个可以加力的地方')
  })

  it('判不了的不算进「要看的事」', () => {
    const h = buildHeadline([notComparable('D3')], [notComparable('O1')], 'complete', null)
    expect(h).toContain('今天没发现要紧的事')
  })

  it('目标到不了 → 排在最前面', () => {
    const h = buildHeadline([], [], 'complete', goalWith('unreachable_within_caps'))
    expect(h.startsWith('目标按现在的预算上限到不了')).toBe(true)
  })

  it('目标未判时不提目标', () => {
    const h = buildHeadline([hit('D3')], [], 'complete', goalWith('unknown'))
    expect(h).not.toContain('目标')
  })

  it('数据不全 → 明说没判机会，不假装一切正常', () => {
    const h = buildHeadline([hit('D3')], [], 'partial', null)
    expect(h).toContain('数据没拉全')
  })

  it('数据不全且什么都没发现 → 说「只看不动」，不说「没问题」', () => {
    const h = buildHeadline([], [], 'partial', null)
    expect(h).toContain('只看不动')
  })
})
