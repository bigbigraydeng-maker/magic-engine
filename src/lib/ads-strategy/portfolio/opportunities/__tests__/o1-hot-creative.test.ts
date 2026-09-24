/**
 * O1 独立用例。不编内部类型形状：广告组设置用真实的 `GraphAdsetSettings` 契约构造，
 * 经真实的 `normalizeAdset` + `buildAccountContext` 转换成诊断输入，只是没有走完整的
 * JSON 夹具回放（那套是给整账户回归用的，这里只测这一条新规则）。
 */
import { describe, expect, it } from 'vitest'
import type { GraphAdsetSettings } from '@/lib/meta/entity-settings'
import { normalizeAdset, settingsHash, type EntitySnapshotRow } from '../../snapshot'
import { buildAccountContext } from '../../diagnostics/context'
import { findHotCreatives, O1_MIN_DAYS } from '../o1-hot-creative'
import type { AccountInput, DailyRow } from '../../diagnostics/types'

const CTX = { clientId: 'c', adAccountId: 'act_1', currency: 'NZD', sharedAccount: false }
const DATE = '2026-09-22'
// buildAccountContext 的窗口是截至 DATE 的 7 天，日行日期都落在这里面
const DAYS = ['2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22']
const LAST_DAYS = DAYS.slice(-O1_MIN_DAYS)

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

function spendRow(adsetId: string, day: string, spend: number, impressions: number, clicks: number): DailyRow {
  return {
    level: 'adset', entity_id: adsetId, parent_id: 'camp_1', insight_date: day,
    spend, impressions, reach: Math.round(impressions * 0.8), clicks, leads: 0, messaging_conversations: 0,
    video_thruplays: 0, actions: null,
  }
}

function adset(id: string, name: string): GraphAdsetSettings {
  return {
    id, name, campaign_id: 'camp_1',
    optimization_goal: 'LINK_CLICKS', status: 'ACTIVE', effective_status: 'ACTIVE',
    targeting: {},
  }
}

/** 一条广告组在最后 3 天每天固定曝光/点击。 */
function dailyFor(id: string, impressions: number, clicks: number, spend: number): DailyRow[] {
  return LAST_DAYS.map(day => spendRow(id, day, spend, impressions, clicks))
}

describe('O1 潜在爆款', () => {
  it('连续 3 天 CTR 是中位数 2 倍且花费低于均值 → 命中', () => {
    // 对照组：CTR 低、花费高，把账户均值抬上去
    const daily = [
      ...dailyFor('as_hot', 1000, 40, 5),   // CTR 4%
      ...dailyFor('as_a', 1000, 10, 50),    // CTR 1%
      ...dailyFor('as_b', 1000, 10, 50),    // CTR 1%
    ]
    const ctx = buildAccountContext(account([adset('as_hot', 'Hot'), adset('as_a', 'A'), adset('as_b', 'B')].map(snapshotFromGraph), daily), DATE)
    const hits = findHotCreatives(ctx)
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ code: 'O1', status: 'hit', clientVisible: false })
    expect(hits[0].units[0].id).toBe('as_hot')
  })

  it('CTR 高但花费也高于账户均值 → 不报（不是"预算不够"）', () => {
    const daily = [
      ...dailyFor('as_hot', 1000, 40, 100), // CTR 4%，但花费最高
      ...dailyFor('as_a', 1000, 10, 5),
      ...dailyFor('as_b', 1000, 10, 5),
    ]
    const ctx = buildAccountContext(account([adset('as_hot', 'Hot'), adset('as_a', 'A'), adset('as_b', 'B')].map(snapshotFromGraph), daily), DATE)
    expect(findHotCreatives(ctx)).toHaveLength(0)
  })

  it('只有 2 天达标 → 不出 hit', () => {
    const daily = [
      ...dailyFor('as_hot', 1000, 40, 5).slice(0, 2),
      spendRow('as_hot', LAST_DAYS[2], 5, 1000, 10), // 第 3 天 CTR 掉回中位数（曝光仍 ≥ 500，算数）
      ...dailyFor('as_a', 1000, 10, 50),
      ...dailyFor('as_b', 1000, 10, 50),
    ]
    const ctx = buildAccountContext(account([adset('as_hot', 'Hot'), adset('as_a', 'A'), adset('as_b', 'B')].map(snapshotFromGraph), daily), DATE)
    expect(findHotCreatives(ctx)).toEqual([])
  })

  it('CTR 高但某天曝光 < 500 → not_comparable（below_min_sample）', () => {
    const daily = [
      ...dailyFor('as_hot', 1000, 40, 5).slice(0, 2),
      spendRow('as_hot', LAST_DAYS[2], 5, 100, 4), // 曝光太薄
      ...dailyFor('as_a', 1000, 10, 50),
      ...dailyFor('as_b', 1000, 10, 50),
    ]
    const ctx = buildAccountContext(account([adset('as_hot', 'Hot'), adset('as_a', 'A'), adset('as_b', 'B')].map(snapshotFromGraph), daily), DATE)
    const hits = findHotCreatives(ctx)
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ code: 'O1', status: 'not_comparable', notComparableReason: 'below_min_sample' })
  })

  it('实验中的广告组即使命中也被排除', () => {
    const daily = [
      ...dailyFor('as_hot', 1000, 40, 5),
      ...dailyFor('as_a', 1000, 10, 50),
      ...dailyFor('as_b', 1000, 10, 50),
    ]
    const snapshots = [adset('as_hot', 'Hot'), adset('as_a', 'A'), adset('as_b', 'B')].map(snapshotFromGraph)
    const ctx = buildAccountContext(account(snapshots, daily), DATE)
    ctx.experimentIds.add('as_hot') // 实验中的实体，规则必须跳过
    expect(ctx.experimentIds.has('as_hot')).toBe(true)
    expect(findHotCreatives(ctx)).toHaveLength(0)
  })
})
