/**
 * 广告设置快照规范化 —— 全部用 2026-09-14 对真实账户只读实拉的 Meta 返回形状
 * （fixtures/*-settings.json，Graph v21.0），不自编形状。
 */
import { describe, expect, it } from 'vitest'
import nal from './fixtures/nal-settings.json'
import cts from './fixtures/cts-settings.json'
import ctsStudies from './fixtures/cts-adset-studies.json'
import {
  normalizeAd,
  normalizeAdset,
  normalizeAudience,
  normalizeCampaign,
  parseAudienceRule,
  selectRowsToWrite,
  settingsHash,
  type SnapshotContext,
} from '../snapshot'
import type { GraphAdSettings, GraphAdsetSettings, GraphCampaignSettings, GraphCustomAudience } from '@/lib/meta/entity-settings'

const NAL_CTX: SnapshotContext = { clientId: 'client-nal', adAccountId: nal.ad_account_id, currency: 'NZD', sharedAccount: false }
const CTS_CTX: SnapshotContext = { clientId: 'client-cts', adAccountId: cts.ad_account_id, currency: 'NZD', sharedAccount: false }

const nalCampaigns = nal.campaigns as GraphCampaignSettings[]
const nalAdsets = nal.adsets as GraphAdsetSettings[]
const ctsAdsets = cts.adsets as GraphAdsetSettings[]
const byId = <T extends { id: string }>(list: T[], id: string): T => {
  const hit = list.find(x => x.id === id)
  if (!hit) throw new Error(`fixture missing ${id}`)
  return hit
}

describe('normalizeCampaign — 预算层级读系列自己的预算字段', () => {
  it('NAL 五个系列都把日预算挂在系列上 → 全部判 CBO（2026-09-14 实拉）', () => {
    const rows = nalCampaigns.map(c => normalizeCampaign(NAL_CTX, c))
    expect(rows.map(r => r.budget_level)).toEqual(['cbo', 'cbo', 'cbo', 'cbo', 'cbo'])
    const logistics = rows.find(r => r.entity_id === '52589907084125')
    expect(logistics?.daily_budget_minor).toBe(6200)
    expect(logistics?.objective).toBe('OUTCOME_LEADS')
    expect(logistics?.special_ad_categories).toEqual([])
  })

  it('CTS 官方账户系列不带预算 → 判 ABO（预算在广告组上）', () => {
    const rows = (cts.campaigns as GraphCampaignSettings[]).map(c => normalizeCampaign(CTS_CTX, c))
    expect(rows.every(r => r.budget_level === 'abo')).toBe(true)
  })
})

describe('normalizeAdset — 受众包含/排除、Advantage+、名单外扩展', () => {
  it('NAL 再营销组：包含视频观众名单，advantage_audience=0，custom_audience 扩展=0', () => {
    const row = normalizeAdset(NAL_CTX, byId(nalAdsets, '52597304727125'))
    expect(row.included_audience_ids).toEqual(['52597304640525'])
    expect(row.excluded_audience_ids).toEqual([])
    expect(row.advantage_audience).toBe(0)
    expect(row.targeting_relaxation).toEqual({ lookalike: 0, custom_audience: 0 })
    expect(row.optimization_goal).toBe('LEAD_GENERATION')
    // 系列是 CBO，广告组自己不持有预算
    expect(row.budget_level).toBeNull()
  })

  it('CTS 顶层 ThruPlay 组：只有排除名单、没有包含名单（冷流量），预算在组上', () => {
    const row = normalizeAdset(CTS_CTX, byId(ctsAdsets, '52549857906273'))
    expect(row.included_audience_ids).toEqual([])
    expect(row.excluded_audience_ids).toEqual(['52549822861673'])
    expect(row.advantage_audience).toBe(1)
    expect(row.budget_level).toBe('abo')
    expect(row.daily_budget_minor).toBe(1000)
  })

  it('CTS A/B 实验两组带上 ad_studies（实验 1489853439620194，SPLIT_TEST）', () => {
    const studiesById = new Map((ctsStudies.data as Array<{ id: string; ad_studies?: { data?: [] } }>).map(s => [s.id, s.ad_studies]))
    for (const id of ['52551117304473', '52551118124873']) {
      const withStudies = { ...byId(ctsAdsets, id), ad_studies: studiesById.get(id) } as GraphAdsetSettings
      const row = normalizeAdset(CTS_CTX, withStudies)
      expect(row.ad_studies).toEqual([
        { id: '1489853439620194', type: 'SPLIT_TEST', start_time: '2026-09-13T12:31:23+0000', end_time: '2026-09-23T12:31:23+0000' },
      ])
    }
    const control = normalizeAdset(CTS_CTX, { ...byId(ctsAdsets, '52549857906273'), ad_studies: studiesById.get('52549857906273') } as GraphAdsetSettings)
    expect(control.ad_studies).toEqual([])
  })
})

describe('normalizeAd — 创意视频 id（D4 用）', () => {
  it('NAL ThruPlay 广告的 creative.video_id 正是视频观众池规则里的 object_id（不是上传稿 video_data.video_id）', () => {
    const ads = nal.ads as GraphAdSettings[]
    const thruplay = normalizeAd(NAL_CTX, ads.find(a => a.adset_id === '52596939123725')!)
    expect(thruplay.creative_video_ids).toEqual(['961317390332083'])
    expect(thruplay.creative_page_id).toBe('1177479655430100')
    const pool = parseAudienceRule((nal.audiences as GraphCustomAudience[])[0].rule)
    expect(pool.objectIds).toContain(thruplay.creative_video_ids[0])
  })

  it('复用帖子、没有 video_id 的广告 → 空数组，不猜', () => {
    const ads = nal.ads as GraphAdSettings[]
    const noVideo = ads.find(a => !a.creative?.video_id)!
    expect(normalizeAd(NAL_CTX, noVideo).creative_video_ids).toEqual([])
  })
})

describe('parseAudienceRule — 按 object_id 判，不按名字', () => {
  it('视频受众（NAL 25% 观众池）：两个视频 object_id + 事件名', () => {
    const aud = (nal.audiences as GraphCustomAudience[])[0]
    expect(parseAudienceRule(aud.rule)).toEqual({
      objectIds: ['1117182540888214', '961317390332083'],
      events: ['video_view_25_percent'],
    })
    const row = normalizeAudience(NAL_CTX, aud)
    expect(row.audience_count_lower).toBe(1000)
    // time_created=1789293579 → NZ 21:59，比引用它的再营销组（NZ 22:02 建）早 3 分钟
    expect(row.audience_created_at).toBe('2026-09-13T09:59:39.000Z')
  })

  it('CTS 看完 95% 名单：Meta 事件名是 video_completed（不是 video_view_95_percent）', () => {
    const aud = byId(cts.audiences as GraphCustomAudience[], '52551117275273')
    expect(parseAudienceRule(aud.rule).events).toEqual(['video_completed'])
  })

  it('主页互动受众（inclusions 形状）：取 event_sources 的主页 id', () => {
    const aud = byId(cts.audiences as GraphCustomAudience[], '6971567517469')
    expect(parseAudienceRule(aud.rule).objectIds).toEqual(['1146745731851959'])
  })

  it('规则缺失或读不懂 → 空（D4 据此判「无法按 object_id 匹配」，不按名字猜）', () => {
    expect(parseAudienceRule(undefined)).toEqual({ objectIds: [], events: [] })
    expect(parseAudienceRule('{not json')).toEqual({ objectIds: [], events: [] })
  })
})

describe('selectRowsToWrite — 只在设置变化时记一行，另每天一次', () => {
  const dayKey = (iso: string) => iso.slice(0, 10)
  const drafts = nalAdsets.map(s => normalizeAdset(NAL_CTX, s))

  it('第一次抓：全部记为 first_seen（不算设置变化，K12 72 小时计数要排除）', () => {
    const rows = selectRowsToWrite(drafts, [], { capturedAt: '2026-09-14T00:30:00Z', dayKey })
    expect(rows).toHaveLength(nalAdsets.length)
    expect(new Set(rows.map(r => r.capture_reason))).toEqual(new Set(['first_seen']))
  })

  it('哈希对嵌套对象 key 顺序不敏感（Meta 返回顺序变化不算设置变化）', () => {
    const d = drafts.find(x => x.targeting_relaxation !== null)!
    const flipped = { ...d, targeting_relaxation: Object.fromEntries(Object.entries(d.targeting_relaxation!).reverse()) }
    expect(settingsHash(flipped)).toBe(settingsHash(d))
  })

  it('受众人数只在跨过 1000 下限时算变化（类似受众人数天天浮动不记噪音）', () => {
    const aud = normalizeAudience(NAL_CTX, (nal.audiences as GraphCustomAudience[])[0])
    expect(settingsHash({ ...aud, audience_count_lower: 32600 })).toBe(settingsHash({ ...aud, audience_count_lower: 41000 }))
    expect(settingsHash({ ...aud, audience_count_lower: 1000 })).not.toBe(settingsHash({ ...aud, audience_count_lower: 1200 }))
  })

  it('预算 "0" 或缺失 = 这一层没挂预算（null），不当成有预算', () => {
    const c = normalizeCampaign(CTS_CTX, { id: 'x', daily_budget: '0' })
    expect(c.daily_budget_minor).toBeNull()
    expect(c.budget_level).toBe('abo')
  })

  it('受众 id 排序后再存（Meta 返回顺序不同不算变化）', () => {
    const s = byId(ctsAdsets, '52551118124873')
    const t = s.targeting as { custom_audiences: Array<{ id: string }> }
    const twoAud = { ...s, targeting: { ...t, custom_audiences: [{ id: '9' }, { id: '1' }] } } as GraphAdsetSettings
    expect(normalizeAdset(CTS_CTX, twoAud).included_audience_ids).toEqual(['1', '9'])
  })

  it('同一天再抓、设置没变：一行都不写', () => {
    const first = selectRowsToWrite(drafts, [], { capturedAt: '2026-09-14T00:30:00Z', dayKey })
    const again = selectRowsToWrite(drafts, first, { capturedAt: '2026-09-14T03:30:00Z', dayKey })
    expect(again).toEqual([])
  })

  it('第二天设置没变：每个实体记一行 daily', () => {
    const first = selectRowsToWrite(drafts, [], { capturedAt: '2026-09-14T21:30:00Z', dayKey })
    const nextDay = selectRowsToWrite(drafts, first, { capturedAt: '2026-09-15T00:30:00Z', dayKey })
    expect(nextDay).toHaveLength(nalAdsets.length)
    expect(new Set(nextDay.map(r => r.capture_reason))).toEqual(new Set(['daily']))
  })

  it('改预算（CTS 2026-09-13 12:11 UTC 顶层 ThruPlay 组 6000→1000，Meta activities 实查）→ 只记这一行 changed', () => {
    const ctsDrafts = ctsAdsets.map(s => normalizeAdset(CTS_CTX, s))
    const before = ctsDrafts.map(d => (d.entity_id === '52549857906273' ? { ...d, daily_budget_minor: 6000 } : d))
    const earlier = selectRowsToWrite(before, [], { capturedAt: '2026-09-13T09:30:00Z', dayKey })
    const after = selectRowsToWrite(ctsDrafts, earlier, { capturedAt: '2026-09-13T12:30:00Z', dayKey })
    expect(after.map(r => [r.entity_id, r.capture_reason, r.daily_budget_minor])).toEqual([['52549857906273', 'changed', 1000]])
  })

  it('改名不是设置变化（名字不进哈希）', () => {
    const d = drafts[0]
    expect(settingsHash({ ...d, entity_name: 'renamed' })).toBe(settingsHash(d))
    expect(settingsHash({ ...d, advantage_audience: d.advantage_audience === 0 ? 1 : 0 })).not.toBe(settingsHash(d))
  })

  it('内核运行前后（kernel_pre / kernel_post）一律写，不论哈希', () => {
    const first = selectRowsToWrite(drafts, [], { capturedAt: '2026-09-14T00:30:00Z', dayKey })
    const pre = selectRowsToWrite(drafts, first, { capturedAt: '2026-09-14T00:31:00Z', dayKey, reason: 'kernel_pre' })
    expect(pre).toHaveLength(drafts.length)
    expect(new Set(pre.map(r => r.capture_reason))).toEqual(new Set(['kernel_pre']))
  })
})
