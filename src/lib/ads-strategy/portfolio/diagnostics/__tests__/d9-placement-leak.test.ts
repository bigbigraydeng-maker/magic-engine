/**
 * D9 独立用例。不编内部类型形状：广告组设置用真实的 `GraphAdsetSettings` 契约构造，
 * 经真实的 `normalizeAdset` + `buildAccountContext` 转换成诊断输入，只是没有走完整的
 * JSON 夹具回放（那套是给整账户回归用的，这里只测这一条新规则）。
 */
import { describe, expect, it } from 'vitest'
import type { GraphAdsetSettings } from '@/lib/meta/entity-settings'
import { normalizeAdset, settingsHash, type EntitySnapshotRow } from '../../snapshot'
import { buildAccountContext } from '../context'
import { diagnosePlacementLeak } from '../d9-placement-leak'
import type { AccountInput, DailyRow } from '../types'

const CTX = { clientId: 'c', adAccountId: 'act_1', currency: 'NZD', sharedAccount: false }
const DATE = '2026-09-22'

function snapshotFromGraph(g: GraphAdsetSettings): EntitySnapshotRow {
  const draft = normalizeAdset(CTX, g)
  return { ...draft, settings_hash: settingsHash(draft), capture_reason: 'daily', captured_at: `${DATE}T10:00:00Z` }
}

function account(snapshots: EntitySnapshotRow[], daily: DailyRow[]): AccountInput {
  return {
    adAccountId: 'act_1', shared: false, timezone: 'Pacific/Auckland', currency: 'NZD',
    snapshots, daily, hourly: {}, hourlyError: null, latestCaptures: [], lastInsightDate: DATE,
  }
}

function spendRow(adsetId: string, spend: number): DailyRow {
  return {
    level: 'adset', entity_id: adsetId, parent_id: 'camp_1', insight_date: DATE,
    spend, impressions: 100, reach: 80, clicks: 5, leads: 0, messaging_conversations: 0,
    video_thruplays: 90, actions: null,
  }
}

describe('D9 纯播放广告没排除 Audience Network', () => {
  it('THRUPLAY + 没设 publisher_platforms + 有花费 → 命中', () => {
    const s: GraphAdsetSettings = {
      id: 'as_1', name: 'Christmas-ThruPlay-NZ-50-65', campaign_id: 'camp_1',
      optimization_goal: 'THRUPLAY', status: 'ACTIVE', effective_status: 'ACTIVE',
      targeting: { age_min: 50, age_max: 65 },
    }
    const ctx = buildAccountContext(account([snapshotFromGraph(s)], [spendRow('as_1', 2.44)]), DATE)
    const hits = diagnosePlacementLeak(ctx)
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      code: 'D9', status: 'hit', clientVisible: false,
      evidence: expect.objectContaining({ optimization_goal: 'THRUPLAY', publisher_platforms: null }),
    })
  })

  it('THRUPLAY + publisher_platforms 已排除 Audience Network → 不报', () => {
    const s: GraphAdsetSettings = {
      id: 'as_2', name: 'Clean ThruPlay', campaign_id: 'camp_1',
      optimization_goal: 'THRUPLAY', status: 'ACTIVE', effective_status: 'ACTIVE',
      targeting: { publisher_platforms: ['facebook', 'instagram'] },
    }
    const ctx = buildAccountContext(account([snapshotFromGraph(s)], [spendRow('as_2', 30)]), DATE)
    expect(diagnosePlacementLeak(ctx)).toHaveLength(0)
  })

  it('THRUPLAY + publisher_platforms 里明确写了 audience_network → 命中', () => {
    const s: GraphAdsetSettings = {
      id: 'as_3', name: 'Leaky on purpose', campaign_id: 'camp_1',
      optimization_goal: 'THRUPLAY', status: 'ACTIVE', effective_status: 'ACTIVE',
      targeting: { publisher_platforms: ['facebook', 'audience_network'] },
    }
    const ctx = buildAccountContext(account([snapshotFromGraph(s)], [spendRow('as_3', 10)]), DATE)
    const hits = diagnosePlacementLeak(ctx)
    expect(hits).toHaveLength(1)
    expect(hits[0].title).toContain('明确包含了 Audience Network')
  })

  it('非纯播放目标（比如留资）→ 不管版位设置都不判', () => {
    const s: GraphAdsetSettings = {
      id: 'as_4', name: 'Lead form adset', campaign_id: 'camp_1',
      optimization_goal: 'LEAD_GENERATION', status: 'ACTIVE', effective_status: 'ACTIVE',
      targeting: {},
    }
    const ctx = buildAccountContext(account([snapshotFromGraph(s)], [spendRow('as_4', 60)]), DATE)
    expect(diagnosePlacementLeak(ctx)).toHaveLength(0)
  })

  it('THRUPLAY 但窗口内花费为 0（规则只看花费，不看投放状态）→ 不报，避免噪音', () => {
    const s: GraphAdsetSettings = {
      id: 'as_5', name: 'Just created', campaign_id: 'camp_1',
      optimization_goal: 'THRUPLAY', status: 'PAUSED', effective_status: 'PAUSED',
      targeting: {},
    }
    const ctx = buildAccountContext(account([snapshotFromGraph(s)], []), DATE)
    expect(diagnosePlacementLeak(ctx)).toHaveLength(0)
  })

  it('publisher_platforms 显式设成空数组（不是没设过）→ 按"已排除"处理，不报', () => {
    // 空数组≠null：null是"从没设置过、留自动版位"，[]是"手动选了投放位置但一个都没勾"——
    // 后一种 Meta 后台操作上很少见，但既然显式给了列表且里面没有 audience_network，就不算"留自动版位"。
    const s: GraphAdsetSettings = {
      id: 'as_6', name: 'Empty platforms list', campaign_id: 'camp_1',
      optimization_goal: 'THRUPLAY', status: 'ACTIVE', effective_status: 'ACTIVE',
      targeting: { publisher_platforms: [] },
    }
    const ctx = buildAccountContext(account([snapshotFromGraph(s)], [spendRow('as_6', 20)]), DATE)
    expect(diagnosePlacementLeak(ctx)).toHaveLength(0)
  })

  it('同一账户里多个广告组：只该命中的那个命中，干净的和不相关的都不进来', () => {
    const leaky: GraphAdsetSettings = {
      id: 'as_7', name: 'Leaky ThruPlay', campaign_id: 'camp_1',
      optimization_goal: 'THRUPLAY', status: 'ACTIVE', effective_status: 'ACTIVE',
      targeting: {},
    }
    const clean: GraphAdsetSettings = {
      id: 'as_8', name: 'Clean ThruPlay', campaign_id: 'camp_1',
      optimization_goal: 'THRUPLAY', status: 'ACTIVE', effective_status: 'ACTIVE',
      targeting: { publisher_platforms: ['facebook', 'instagram'] },
    }
    const leadForm: GraphAdsetSettings = {
      id: 'as_9', name: 'Lead form', campaign_id: 'camp_1',
      optimization_goal: 'LEAD_GENERATION', status: 'ACTIVE', effective_status: 'ACTIVE',
      targeting: {},
    }
    const ctx = buildAccountContext(
      account(
        [leaky, clean, leadForm].map(snapshotFromGraph),
        [spendRow('as_7', 15), spendRow('as_8', 40), spendRow('as_9', 60)],
      ),
      DATE,
    )
    const hits = diagnosePlacementLeak(ctx)
    expect(hits.map(h => h.units[0].id)).toEqual(['as_7'])
  })
})
