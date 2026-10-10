/**
 * 结果阶梯计数与归属（§3.2 / §14 M2 / M3）。actions 形状取 NAL 2026-09-13 广告组级真实返回。
 */
import { describe, expect, it } from 'vitest'
import nalAdsetDaily from './fixtures/nal-daily-adset-2026-08-17_2026-09-13.json'
import { countOutcome, isAttributableForBudget, type InsightForOutcome } from '../outcome-ladder'
import { parseOutcomeConfigRow } from '../outcome-config'

type Raw = { adset_id: string; date_start: string; reach: string; actions?: Array<{ action_type: string; value: string }>; video_thruplay_watched_actions?: Array<{ value: string }> }

function row(adsetId: string, date: string): InsightForOutcome {
  const r = (nalAdsetDaily as Raw[]).find(x => x.adset_id === adsetId && x.date_start === date)
  if (!r) throw new Error('fixture row missing')
  return {
    reach: Number(r.reach),
    video_thruplays: r.video_thruplay_watched_actions ? Number(r.video_thruplay_watched_actions[0].value) : null,
    actions: r.actions ?? null,
  }
}

describe('countOutcome', () => {
  it('NAL 物流私信留资组某天：留资、私信开聊都是平台直报', () => {
    const day = (nalAdsetDaily as Raw[]).find(x => x.adset_id === '52589967398925' && (x.actions ?? []).some(a => a.action_type === 'lead'))
    expect(day).toBeDefined()
    const r = row('52589967398925', day!.date_start)
    const lead = countOutcome('lead', r)
    expect(lead.attribution).toBe('platform_reported')
    expect(lead.value).toBeGreaterThan(0)
    expect(isAttributableForBudget(lead)).toBe(true)
  })

  it('ThruPlay 组：完播取视频字段；没有留资动作 → 0（平台直报的 0，不是 UNKNOWN）', () => {
    const r = row('52596939123725', '2026-09-13')
    expect(countOutcome('video_complete', r)).toEqual({ step: 'video_complete', value: 723, attribution: 'platform_reported' })
    expect(countOutcome('lead', r)).toEqual({ step: 'lead', value: 0, attribution: 'platform_reported' })
  })

  it('🔴 M2 合格询盘 / 成交：归不到广告单位 → UNKNOWN（null），不算 0、不算自然流量', () => {
    const r = row('52589967398925', '2026-09-13')
    for (const step of ['qualified_enquiry', 'deal'] as const) {
      const c = countOutcome(step, r)
      expect(c.value).toBeNull()
      expect(c.attribution).toBe('none')
      expect(isAttributableForBudget(c)).toBe(false)
    }
  })

  it('没有原始 actions 的行（视频列/actions 列还没回填）→ UNKNOWN', () => {
    expect(countOutcome('lead', { reach: 10, video_thruplays: null, actions: null }).value).toBeNull()
  })

  it('🔴 网站转化优化的组，当天只有自定义像素事件、没有标准留资 → 留资是 UNKNOWN，不是 0（NAL 3PL 组真实一天）', () => {
    const day = (nalAdsetDaily as Raw[]).find(x =>
      (x.actions ?? []).some(a => a.action_type === 'offsite_conversion.fb_pixel_custom') &&
      !(x.actions ?? []).some(a => a.action_type === 'lead'))
    expect(day).toBeDefined()
    const r = row(day!.adset_id, day!.date_start)
    const c = countOutcome('lead', r, { messagingReferralAvailable: false, optimizationGoal: 'OFFSITE_CONVERSIONS' })
    expect(c.value).toBeNull()
    expect(isAttributableForBudget(c)).toBe(false)
    // 同一行如果是表单留资优化，没有 lead 就是真实的 0
    expect(countOutcome('lead', r, { messagingReferralAvailable: false, optimizationGoal: 'LEAD_GENERATION' }).value).toBe(0)
  })

  it('🔴 M3 启发式归属不能进 D5 / 预算处方', () => {
    expect(isAttributableForBudget({ step: 'qualified_enquiry', value: 4, attribution: 'heuristic' })).toBe(false)
    expect(isAttributableForBudget({ step: 'qualified_enquiry', value: 4, attribution: 'webhook_referral' })).toBe(true)
  })
})

describe('parseOutcomeConfigRow — 库里的脏值按未配置处理', () => {
  it('合法值原样取', () => {
    expect(parseOutcomeConfigRow({ leading_result: 'messaging_started', primary_result: 'qualified_enquiry', target_cost_per_primary: '25', min_primary_per_unit: 5 }))
      .toEqual({ leading: 'messaging_started', primary: 'qualified_enquiry', targetCostPerPrimary: 25, minPrimaryPerUnit: 5 })
  })

  it('非法阶梯值 / 非正目标成本 / 非法最低数 → 未配置或默认', () => {
    expect(parseOutcomeConfigRow({ leading_result: '询盘', primary_result: null, target_cost_per_primary: 0, min_primary_per_unit: 0 }))
      .toEqual({ leading: null, primary: null, targetCostPerPrimary: null, minPrimaryPerUnit: 5 })
  })
})
