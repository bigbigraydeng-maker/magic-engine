import { describe, expect, it } from 'vitest'
import { adsetCoreMetric, coreResultsByCampaign, normaliseInsight, summariseCoreResults, toActionStats, type AdsetMeta } from '../metrics'

describe('normaliseInsight 透传版位/设备/地区维度字段', () => {
  it('保留 publisher_platform/platform_position/device_platform/country——2026-09-23 生产事故：这几个字段被漏掉，导致版位/设备/地区三张图表全部显示占位符（“?”“其他”）', () => {
    const row = {
      spend: '10', impressions: '100', clicks: '5',
      publisher_platform: 'facebook', platform_position: 'feed',
      device_platform: 'mobile_app', country: 'NZ',
    }
    const result = normaliseInsight(row, 'lead')
    expect(result).toHaveProperty('publisher_platform', 'facebook')
    expect(result).toHaveProperty('platform_position', 'feed')
    expect(result).toHaveProperty('device_platform', 'mobile_app')
    expect(result).toHaveProperty('country', 'NZ')
  })

  it('仍然保留原有的 age/gender 透传', () => {
    const row = { spend: '10', impressions: '100', clicks: '5', age: '25-34', gender: 'female' }
    const result = normaliseInsight(row, 'lead')
    expect(result).toHaveProperty('age', '25-34')
    expect(result).toHaveProperty('gender', 'female')
  })

  it('维度字段缺失时不产生该键，而不是写入 undefined', () => {
    const result = normaliseInsight({ spend: '10', impressions: '100', clicks: '5' }, 'lead')
    expect(result).not.toHaveProperty('publisher_platform')
    expect(result).not.toHaveProperty('device_platform')
    expect(result).not.toHaveProperty('country')
  })
})

const LEAD_META: AdsetMeta = { destination_type: 'ON_AD', optimization_goal: 'LEAD_GENERATION' }
const MSG_META: AdsetMeta = { destination_type: 'MESSENGER', optimization_goal: 'CONVERSATIONS' }
const VIDEO_META: AdsetMeta = { destination_type: 'ON_VIDEO', optimization_goal: 'THRUPLAY' }

function metaMap(entries: Record<string, AdsetMeta>): Map<string, AdsetMeta> {
  return new Map(Object.entries(entries))
}

describe('summariseCoreResults 按广告组去向算结果口径', () => {
  it('只有留资组时 core_metric 为 lead，留资按优先级取一次，不把同行的 lead_grouped 再加一遍', () => {
    const rows = [
      { adset_id: 'as1', spend: '30', actions: [
        { action_type: 'lead', value: '3' },
        { action_type: 'onsite_conversion.lead_grouped', value: '3' },
      ] },
      { adset_id: 'as2', spend: '20', actions: [{ action_type: 'lead', value: '2' }] },
    ]
    const summary = summariseCoreResults(rows, metaMap({ as1: LEAD_META, as2: LEAD_META }), 'lead')
    expect(summary.core_metric).toBe('lead')
    expect(summary.leads).toBe(5)
    expect(summary.results).toBe(5)
    expect(summary.cost_per_result).toBe(10)
    expect(summary.conversations).toBeNull()
    expect(summary.cost_per_conversation).toBeNull()
  })

  it('只有开聊组时 core_metric 为 messaging_started，优先取 messaging_conversation_started_7d', () => {
    const rows = [
      { adset_id: 'as1', spend: '60', actions: [
        { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '6' },
        { action_type: 'onsite_conversion.total_messaging_connection', value: '9' },
      ] },
    ]
    const summary = summariseCoreResults(rows, metaMap({ as1: MSG_META }), 'lead')
    expect(summary.core_metric).toBe('messaging_started')
    expect(summary.conversations).toBe(6)
    expect(summary.results).toBe(6)
    expect(summary.cost_per_result).toBe(10)
    expect(summary.leads).toBeNull()
  })

  it('两种都有时 core_metric 为 mixed，结果不相加，留资只算留资组', () => {
    const rows = [
      { adset_id: 'as-msg', spend: '60', actions: [
        { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '6' },
        { action_type: 'lead', value: '5' },
      ] },
      { adset_id: 'as-lead', spend: '40', actions: [
        { action_type: 'lead', value: '4' },
        { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '3' },
      ] },
    ]
    const summary = summariseCoreResults(rows, metaMap({ 'as-msg': MSG_META, 'as-lead': LEAD_META }), 'lead')
    expect(summary.core_metric).toBe('mixed')
    expect(summary.results).toBeNull()
    expect(summary.cost_per_result).toBeNull()
    expect(summary.leads).toBe(4)
    expect(summary.conversations).toBe(6)
    expect(summary.cost_per_lead).toBe(10)
    expect(summary.cost_per_conversation).toBe(10)
  })

  it('去向读不到的组进 unknown_goal_spend，播放/互动类进 other_goal_spend，都不进结果', () => {
    const rows = [
      { adset_id: 'as-lead', spend: '40', actions: [{ action_type: 'lead', value: '4' }] },
      { adset_id: 'as-missing', spend: '15', actions: [{ action_type: 'lead', value: '9' }] },
      { adset_id: 'as-video', spend: '10', actions: [] },
    ]
    const summary = summariseCoreResults(rows, metaMap({ 'as-lead': LEAD_META, 'as-video': VIDEO_META }), 'lead')
    expect(summary.core_metric).toBe('lead')
    expect(summary.leads).toBe(4)
    expect(summary.unknown_goal_spend).toBe(15)
    expect(summary.other_goal_spend).toBe(10)
  })

  it('MESSENGER + LEAD_GENERATION 有歧义：客户主目标是留资时算留资，没有主目标时算开聊', () => {
    const rows = [{ adset_id: 'as1', spend: '20', actions: [
      { action_type: 'lead', value: '2' },
      { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '4' },
    ] }]
    const meta = metaMap({ as1: { destination_type: 'MESSENGER', optimization_goal: 'LEAD_GENERATION' } })

    const asLead = summariseCoreResults(rows, meta, 'lead')
    expect(asLead.core_metric).toBe('lead')
    expect(asLead.leads).toBe(2)

    const asMessaging = summariseCoreResults(rows, meta, null)
    expect(asMessaging.core_metric).toBe('messaging_started')
    expect(asMessaging.conversations).toBe(4)
  })

  it('零花费的留资组不算数，core_metric 仍为 null', () => {
    const rows = [{ adset_id: 'as1', spend: '0', actions: [{ action_type: 'lead', value: '0' }] }]
    const summary = summariseCoreResults(rows, metaMap({ as1: LEAD_META }), 'lead')
    expect(summary.core_metric).toBeNull()
    expect(summary.leads).toBeNull()
    expect(summary.results).toBeNull()
  })
})

describe('toActionStats 清洗 Graph 原始 actions', () => {
  it('非数组返回 undefined', () => {
    expect(toActionStats(null)).toBeUndefined()
    expect(toActionStats('lead')).toBeUndefined()
    expect(toActionStats({ action_type: 'lead' })).toBeUndefined()
  })

  it('丢掉没有字符串 action_type 的项，数字 value 转成字符串', () => {
    const stats = toActionStats([
      { action_type: 'lead', value: 3 },
      { action_type: 'lead', value: '4' },
      { value: '5' },
      { action_type: 7, value: '6' },
      null,
      'nope',
    ])
    expect(stats).toEqual([
      { action_type: 'lead', value: '3' },
      { action_type: 'lead', value: '4' },
    ])
  })
})

describe('adsetCoreMetric 读广告组去向', () => {
  it('meta 缺失时为 unknown', () => {
    expect(adsetCoreMetric(undefined, 'lead')).toBe('unknown')
  })

  it('按去向与优化目标解析出留资或开聊', () => {
    expect(adsetCoreMetric(LEAD_META, 'lead')).toBe('lead')
    expect(adsetCoreMetric(MSG_META, 'lead')).toBe('messaging_started')
    expect(adsetCoreMetric(VIDEO_META, 'lead')).toBeNull()
  })
})

describe('coreResultsByCampaign 按广告系列分组', () => {
  it('按 campaign_id 分组，跳过没有 campaign_id 的行', () => {
    const rows = [
      { campaign_id: 'c1', adset_id: 'as1', spend: '30', actions: [{ action_type: 'lead', value: '3' }] },
      { campaign_id: 'c1', adset_id: 'as2', spend: '20', actions: [{ action_type: 'lead', value: '2' }] },
      { campaign_id: 'c2', adset_id: 'as3', spend: '10', actions: [{ action_type: 'lead', value: '1' }] },
      { adset_id: 'as4', spend: '5', actions: [{ action_type: 'lead', value: '1' }] },
    ]
    const byCampaign = coreResultsByCampaign(rows, metaMap({ as1: LEAD_META, as2: LEAD_META, as3: LEAD_META, as4: LEAD_META }), 'lead')
    expect([...byCampaign.keys()].sort()).toEqual(['c1', 'c2'])
    expect(byCampaign.get('c1')?.leads).toBe(5)
    expect(byCampaign.get('c2')?.leads).toBe(1)
  })
})
