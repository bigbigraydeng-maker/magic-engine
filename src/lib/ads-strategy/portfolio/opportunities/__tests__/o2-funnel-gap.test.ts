/**
 * O2 独立用例。不编内部类型形状：广告组设置用真实的 `GraphAdsetSettings` 契约构造，
 * 经真实的 `normalizeAdset` + `buildAccountContext` 转换成诊断输入。
 *
 * 例外：第 4 条（not_comparable）走不通 Graph 契约——`classifyAdsetRole` 里 awareness 角色
 * 只会返回 medium/high 可信度，永远到不了 low。那条只能直接构造 AccountContext 打桩 roles。
 */
import { describe, expect, it } from 'vitest'
import type { GraphAdsetSettings } from '@/lib/meta/entity-settings'
import { normalizeAdset, settingsHash, type EntitySnapshotRow } from '../../snapshot'
import { buildAccountContext } from '../../diagnostics/context'
import type { RoleVerdict } from '../../roles'
import { findFunnelGap } from '../o2-funnel-gap'
import type { AccountInput, DailyRow } from '../../diagnostics/types'

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

/** 广告组快照：O2 不测角色判定（roles.test.ts 已覆盖），角色由测试显式打桩。 */
function adset(id: string, name: string, status: 'ACTIVE' | 'PAUSED' = 'ACTIVE'): GraphAdsetSettings {
  return {
    id, name, campaign_id: 'camp_1',
    optimization_goal: 'THRUPLAY', status, effective_status: status,
    targeting: {},
  }
}

function role(r: RoleVerdict['role'], confidence: RoleVerdict['confidence'] = 'high'): RoleVerdict {
  return { role: r, confidence, reasons: [], specialAdCategories: null, retargetingAudienceIds: [] }
}

describe('O2 漏斗缺位', () => {
  it('有破冰花费 ≥ 阈值、零再营销组 → 一条 O2 hit', () => {
    const ctx = buildAccountContext(account([snapshotFromGraph(adset('as_aware', 'ThruPlay NZ'))], [spendRow('as_aware', 50)]), DATE)
    ctx.roles.set('as_aware', role('awareness'))
    const hit = findFunnelGap(ctx)
    expect(hit).toMatchObject({
      code: 'O2', status: 'hit', clientVisible: false,
      evidence: expect.objectContaining({ awareness_spend: 50, awareness_adsets: 1, retargeting_adsets: 0 }),
    })
    expect(hit?.units.map(u => u.id)).toEqual(['as_aware'])
  })

  it('有破冰花费但也有再营销组（哪怕是暂停的）→ null', () => {
    const ctx = buildAccountContext(
      account(
        [snapshotFromGraph(adset('as_aware', 'ThruPlay NZ')), snapshotFromGraph(adset('as_retarget', 'Retarget viewers', 'PAUSED'))],
        [spendRow('as_aware', 50)],
      ),
      DATE,
    )
    ctx.roles.set('as_aware', role('awareness'))
    ctx.roles.set('as_retarget', role('retargeting'))
    expect(findFunnelGap(ctx)).toBeNull()
  })

  it('破冰花费低于阈值 → null', () => {
    const ctx = buildAccountContext(account([snapshotFromGraph(adset('as_aware', 'ThruPlay NZ'))], [spendRow('as_aware', 5)]), DATE)
    ctx.roles.set('as_aware', role('awareness'))
    expect(findFunnelGap(ctx)).toBeNull()
  })

  it('破冰组角色可信度全是 low → not_comparable', () => {
    const ctx = buildAccountContext(account([snapshotFromGraph(adset('as_aware', 'ThruPlay NZ'))], [spendRow('as_aware', 50)]), DATE)
    ctx.roles.set('as_aware', role('awareness', 'low'))
    const hit = findFunnelGap(ctx)
    expect(hit).toMatchObject({ code: 'O2', status: 'not_comparable', notComparableReason: 'below_min_sample' })
  })
})
