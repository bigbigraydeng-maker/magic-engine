/**
 * 漏斗角色判定 —— 输入全部来自 2026-09-14 真实账户只读快照（fixtures/*-settings.json），
 * 经 snapshot.ts 规范化后判。设计 §10 要求的三个专门用例：
 *   ① ThruPlay 投视频观众名单 → 再营销优先（中）
 *   ② 获客组排除已转化名单 → 仍是冷流量（获客）
 *   ③ Advantage+ 开着的再营销 → mixed
 */
import { describe, expect, it } from 'vitest'
import nal from './fixtures/nal-settings.json'
import cts from './fixtures/cts-settings.json'
import oztop from './fixtures/oztop-settings.json'
import {
  normalizeAdset,
  normalizeAudience,
  normalizeCampaign,
  selectRowsToWrite,
  type SnapshotContext,
  type SnapshotRowDraft,
} from '../snapshot'
import { classifyAdsetRole, rollupCampaignRole, type RoleInput } from '../roles'
import type { EntitySnapshotRow } from '../snapshot'
import type { GraphAdsetSettings, GraphCampaignSettings, GraphCustomAudience } from '@/lib/meta/entity-settings'

interface Fixture {
  ad_account_id: string
  campaigns: unknown[]
  adsets: unknown[]
  audiences: unknown[]
}

function materialise(f: Fixture) {
  const ctx: SnapshotContext = { clientId: 'c', adAccountId: f.ad_account_id, currency: null, sharedAccount: false }
  const drafts: SnapshotRowDraft[] = [
    ...(f.campaigns as GraphCampaignSettings[]).map(c => normalizeCampaign(ctx, c)),
    ...(f.adsets as GraphAdsetSettings[]).map(s => normalizeAdset(ctx, s)),
    ...(f.audiences as GraphCustomAudience[]).map(a => normalizeAudience(ctx, a)),
  ]
  const rows = selectRowsToWrite(drafts, [], { capturedAt: '2026-09-14T00:00:00Z', dayKey: s => s.slice(0, 10) })
  const get = (level: string, id: string): EntitySnapshotRow => {
    const r = rows.find(x => x.level === level && x.entity_id === id)
    if (!r) throw new Error(`missing ${level} ${id}`)
    return r
  }
  const audiences = new Map(rows.filter(r => r.level === 'audience').map(r => [r.entity_id, r]))
  const input = (adsetId: string): RoleInput => {
    const adset = get('adset', adsetId)
    return { adset, campaign: adset.campaign_id ? get('campaign', adset.campaign_id) : null, audiences }
  }
  return { get, audiences, input }
}

const NAL = materialise(nal)
const CTS = materialise(cts)
const OZ = materialise(oztop)

describe('classifyAdsetRole — 真实账户', () => {
  it('NAL ThruPlay 两组（冷流量、优化 THRUPLAY）→ 破冰 · 高', () => {
    for (const id of ['52596939123725', '52596931528525']) {
      expect(classifyAdsetRole(NAL.input(id))).toMatchObject({ role: 'awareness', confidence: 'high' })
    }
  })

  it('NAL 9/13 手工再营销组（包含视频观众池、Advantage+=0、扩展=0）→ 再营销 · 高，并带出受众 id', () => {
    const v = classifyAdsetRole(NAL.input('52597304727125'))
    expect(v).toMatchObject({ role: 'retargeting', confidence: 'high', retargetingAudienceIds: ['52597304640525'] })
  })

  it('NAL 私信留资组 / WhatsApp 组 / 3PL 表单组 → 获客', () => {
    for (const id of ['52589967398925', '52594661606125', '52593506023925']) {
      expect(classifyAdsetRole(NAL.input(id)).role).toBe('acquisition')
    }
  })

  it('CTS 顶层 ThruPlay 组（只排除名单）→ 破冰 · 高', () => {
    expect(classifyAdsetRole(CTS.input('52549857906273'))).toMatchObject({ role: 'awareness', confidence: 'high' })
  })

  it('CTS A/B 实验两组（包含「看完 95%」、扩展全关）→ 再营销', () => {
    expect(classifyAdsetRole(CTS.input('52551117304473')).role).toBe('retargeting')
    expect(classifyAdsetRole(CTS.input('52551118124873')).role).toBe('retargeting')
  })

  it('特殊广告类别读系列自己的字段（CTS 系列为空数组）', () => {
    expect(classifyAdsetRole(CTS.input('52549857906273')).specialAdCategories).toEqual([])
  })

  it('CTS LAL 实验组（OUTCOME_LEADS 系列里优化 LINK_CLICKS）→ 目标错位判 mixed · 低', () => {
    expect(classifyAdsetRole(CTS.input('52549843017273'))).toMatchObject({ role: 'mixed', confidence: 'low' })
  })
})

describe('设计 §10 三个专门用例', () => {
  it('① ThruPlay 投视频观众名单 → 以包含受众优先判再营销，可信度「中」', () => {
    // 形状取 NAL 真实再营销组，只把优化目标换成 THRUPLAY、挂到真实的 ThruPlay（OUTCOME_ENGAGEMENT）系列下
    const base = NAL.input('52597304727125')
    const input: RoleInput = {
      ...base,
      adset: { ...base.adset, optimization_goal: 'THRUPLAY', campaign_id: '52596939123525' },
      campaign: NAL.get('campaign', '52596939123525'),
    }
    expect(classifyAdsetRole(input)).toMatchObject({ role: 'retargeting', confidence: 'medium' })
  })

  it('② 获客组只有排除名单（Oztop「Broad Pack 1」排除网站访客）→ 冷流量 = 获客，不当再营销', () => {
    const v = classifyAdsetRole(OZ.input('120238854619520790'))
    expect(v.role).toBe('acquisition')
    expect(v.retargetingAudienceIds).toEqual([])
  })

  it('③ Advantage+ 受众开着的再营销（Oztop WhatsApp 暖池组，advantage_audience=1）→ mixed · 低', () => {
    const v = classifyAdsetRole(OZ.input('120252643974920790'))
    expect(v).toMatchObject({ role: 'mixed', confidence: 'low' })
    expect(v.reasons.join('')).toContain('实际在投冷流量')
  })

  it('③b 名单外扩展开着（custom_audience=1）也降为 mixed', () => {
    const base = NAL.input('52597304727125')
    const input = { ...base, adset: { ...base.adset, targeting_relaxation: { lookalike: 0, custom_audience: 1 } } }
    expect(classifyAdsetRole(input).role).toBe('mixed')
  })

  it('③c 扩展字段读不到（Meta 没返回）→ 不能确认已关闭，按 mixed 处理', () => {
    const base = NAL.input('52597304727125')
    const input = { ...base, adset: { ...base.adset, targeting_relaxation: null } }
    expect(classifyAdsetRole(input).role).toBe('mixed')
  })
})

describe('复审补测：每道闸单独变红（2026-09-14 子牙/魏征）', () => {
  const retarget = () => NAL.input('52597304727125')

  it('Advantage+=1 但名单外扩展=0（只开 Advantage+）→ mixed', () => {
    const b = retarget()
    expect(classifyAdsetRole({ ...b, adset: { ...b.adset, advantage_audience: 1 } }).role).toBe('mixed')
  })

  it('Meta 没返回 targeting_automation（advantage_audience 读不到）→ 不当作已关闭 → mixed', () => {
    const b = retarget()
    expect(classifyAdsetRole({ ...b, adset: { ...b.adset, advantage_audience: null } }).role).toBe('mixed')
  })

  it('包含了本账户快照里查不到子类型的受众 → mixed · 低，且不计入再营销受众', () => {
    const b = retarget()
    const v = classifyAdsetRole({ ...b, adset: { ...b.adset, included_audience_ids: ['not-in-snapshot'] } })
    expect(v).toMatchObject({ role: 'mixed', confidence: 'low', retargetingAudienceIds: [] })
  })

  it('Advantage+ 购物系列（smart_promotion_type=AUTOMATED_SHOPPING_ADS）→ mixed', () => {
    const b = NAL.input('52589967398925')
    const campaign = { ...b.campaign!, smart_promotion_type: 'AUTOMATED_SHOPPING_ADS' }
    expect(classifyAdsetRole({ ...b, campaign }).role).toBe('mixed')
  })

  it('特殊广告类别原样读系列自己的字段；系列快照缺失 → null（未知，不是确认没有）', () => {
    const b = NAL.input('52589967398925')
    const housing = { ...b.campaign!, special_ad_categories: ['HOUSING'] }
    expect(classifyAdsetRole({ ...b, campaign: housing }).specialAdCategories).toEqual(['HOUSING'])
    expect(classifyAdsetRole({ ...b, campaign: null }).specialAdCategories).toBeNull()
  })

  it('名字像再营销但设置是冷流量 → 可信度降为「中」', () => {
    const b = NAL.input('52596939123725')
    const v = classifyAdsetRole({ ...b, adset: { ...b.adset, entity_name: '再营销 · ThruPlay' } })
    expect(v).toMatchObject({ role: 'awareness', confidence: 'medium' })
  })

  it('同时包含再营销类受众和类似人群 → mixed · 低（§3.1 双命中，只有破冰+再营销例外）', () => {
    const b = CTS.input('52551117304473')
    const lookalike = '52549838527273' // CTS 真实类似人群受众
    const v = classifyAdsetRole({ ...b, adset: { ...b.adset, included_audience_ids: [...b.adset.included_audience_ids, lookalike] } })
    expect(v).toMatchObject({ role: 'mixed', confidence: 'low' })
  })
})

describe('rollupCampaignRole — CBO 系列作为预算单位', () => {
  it('组内角色一致 → 该角色；不一致 → mixed', () => {
    const a = classifyAdsetRole(NAL.input('52589967398925'))
    const r = classifyAdsetRole(NAL.input('52597304727125'))
    expect(rollupCampaignRole([a, a]).role).toBe('acquisition')
    expect(rollupCampaignRole([a, r]).role).toBe('mixed')
    expect(rollupCampaignRole([]).role).toBe('unknown')
  })
})
