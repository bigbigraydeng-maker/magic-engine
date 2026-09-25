/**
 * O3 独立用例。不编内部类型形状：广告组设置用真实的 `GraphAdsetSettings` 契约构造，
 * 经真实的 `normalizeAdset` + `buildAccountContext` 转换成诊断输入，只是没有走完整的
 * JSON 夹具回放（那套是给整账户回归用的，这里只测这一条新规则）。
 *
 * 角色不靠启发式猜：直接 `ctx.roles.set(...)` 把两个广告组钉成同一角色，
 * 这样 O3 的「同角色预算单位」分组是确定的。
 */
import { describe, expect, it } from 'vitest'
import type { GraphAdsetSettings, GraphCampaignSettings } from '@/lib/meta/entity-settings'
import { normalizeAdset, normalizeCampaign, settingsHash, type EntitySnapshotRow } from '../../snapshot'
import { buildAccountContext } from '../../diagnostics/context'
import { findBudgetMismatch } from '../o3-budget-mismatch'
import type { AccountInput, DailyRow, DiagnosisInput } from '../../diagnostics/types'
import type { OutcomeConfig } from '../../outcome-ladder'
import type { RoleVerdict } from '../../roles'

const CTX = { clientId: 'c', adAccountId: 'act_1', currency: 'NZD', sharedAccount: false }
const DATE = '2026-09-22'
const DAYS = ['2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22']

function snapshotFromGraph(g: GraphAdsetSettings): EntitySnapshotRow {
  const draft = normalizeAdset(CTX, g)
  return { ...draft, settings_hash: settingsHash(draft), capture_reason: 'daily', captured_at: `${DATE}T10:00:00Z` }
}

function campaignSnapshot(g: GraphCampaignSettings): EntitySnapshotRow {
  const draft = normalizeCampaign(CTX, g)
  return { ...draft, settings_hash: settingsHash(draft), capture_reason: 'daily', captured_at: `${DATE}T10:00:00Z` }
}

/** ABO 系列：系列自己不带预算，预算挂在广告组上 → 每个广告组各成一个预算单位。 */
const CAMP: GraphCampaignSettings = {
  id: 'camp_1', name: 'CTS — Lead Form', objective: 'OUTCOME_LEADS',
  status: 'ACTIVE', effective_status: 'ACTIVE',
}

function account(snapshots: EntitySnapshotRow[], daily: DailyRow[]): AccountInput {
  return {
    adAccountId: 'act_1', shared: false, timezone: 'Pacific/Auckland', currency: 'NZD',
    snapshots, daily, hourly: {}, hourlyError: null, latestCaptures: [], lastInsightDate: DATE,
  }
}

function spendRow(adsetId: string, day: string, spend: number, leads: number): DailyRow {
  return {
    level: 'adset', entity_id: adsetId, parent_id: 'camp_1', insight_date: day,
    spend, impressions: 1000, reach: 800, clicks: 20, leads, messaging_conversations: 0,
    video_thruplays: 0,
    // countOutcome 的 lead 级读的是 actions 里的 action_type='lead'，不是 leads 列
    actions: [{ action_type: 'lead', value: String(leads) }],
  }
}

function adset(id: string, name: string, dailyBudgetMinor: string): GraphAdsetSettings {
  return {
    id, name, campaign_id: 'camp_1',
    optimization_goal: 'LINK_CLICKS', status: 'ACTIVE', effective_status: 'ACTIVE',
    daily_budget: dailyBudgetMinor,
    targeting: {},
  }
}

/** 一条广告组在窗口内每天固定花费/留资。 */
function dailyFor(id: string, spend: number, leads: number): DailyRow[] {
  return DAYS.map(day => spendRow(id, day, spend, leads))
}

const OUTCOME: OutcomeConfig = { leading: null, primary: 'lead', targetCostPerPrimary: null, minPrimaryPerUnit: 5 }

function input(outcome: OutcomeConfig = OUTCOME, outcomeConfigured = true): DiagnosisInput {
  return {
    clientId: 'c', date: DATE, evaluatedAt: `${DATE}T10:00:00Z`,
    outcome, outcomeConfigured, messagingReferralAvailable: false,
    digestRecipients: [], accounts: [],
  }
}

/** 直接设定角色，不走分类器（分类器有 roles.test.ts 自己的用例）。
 *  🔴 必须同时改 ctx.budgetUnits —— 那里的 role 是建上下文时拷贝进去的快照，不会跟着 ctx.roles 变。 */
function setRole(ctx: ReturnType<typeof buildAccountContext>, id: string, r: RoleVerdict['role']) {
  const v: RoleVerdict = { role: r, confidence: 'high', reasons: [], specialAdCategories: null, retargetingAudienceIds: [] }
  ctx.roles.set(id, v)
  for (const u of ctx.budgetUnits) if (u.id === id) { u.role = r; u.confidence = 'high' }
  for (const u of ctx.allBudgetUnits) if (u.id === id) { u.role = r; u.confidence = 'high' }
}

describe('O3 预算错配（机会版）', () => {
  it('结果占比明显高于预算占比 → 命中', () => {
    // 预算 A=$20、B=$80 → 花费占比 A=20%；结果 A=60%、B=40% → 差 ≥ 0.15 且二项检验显著
    const daily = [...dailyFor('as_a', 5, 6), ...dailyFor('as_b', 20, 4)]
    const ctx = buildAccountContext(account([campaignSnapshot(CAMP), ...[adset('as_a', 'A', '2000'), adset('as_b', 'B', '8000')].map(snapshotFromGraph)], daily), DATE)
    setRole(ctx, 'as_a', 'acquisition')
    setRole(ctx, 'as_b', 'acquisition')
    const hits = findBudgetMismatch(ctx, input())
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ code: 'O3', status: 'hit', clientVisible: false })
    expect(hits[0].units[0].id).toBe('as_a')
  })

  it('预算占比与结果占比接近 → 不报', () => {
    // 两边花费与留资同比例，占比差为 0
    const daily = [...dailyFor('as_a', 10, 10), ...dailyFor('as_b', 10, 10)]
    const ctx = buildAccountContext(account([campaignSnapshot(CAMP), ...[adset('as_a', 'A', '2000'), adset('as_b', 'B', '2000')].map(snapshotFromGraph)], daily), DATE)
    setRole(ctx, 'as_a', 'acquisition')
    setRole(ctx, 'as_b', 'acquisition')
    expect(findBudgetMismatch(ctx, input())).toEqual([])
  })

  it('主结果归不上 → not_comparable（primary_not_attributable）', () => {
    // primary = deal：countOutcome 一律 UNKNOWN，归不上
    const daily = [...dailyFor('as_a', 5, 6), ...dailyFor('as_b', 20, 4)]
    const ctx = buildAccountContext(account([campaignSnapshot(CAMP), ...[adset('as_a', 'A', '2000'), adset('as_b', 'B', '8000')].map(snapshotFromGraph)], daily), DATE)
    setRole(ctx, 'as_a', 'acquisition')
    setRole(ctx, 'as_b', 'acquisition')
    const hits = findBudgetMismatch(ctx, input({ ...OUTCOME, primary: 'deal' }))
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ code: 'O3', status: 'not_comparable', notComparableReason: 'primary_not_attributable' })
  })

  it('同角色只有一个预算单位 → 静默跳过，返回 []', () => {
    const daily = [...dailyFor('as_a', 5, 6), ...dailyFor('as_b', 20, 4)]
    const ctx = buildAccountContext(account([campaignSnapshot(CAMP), ...[adset('as_a', 'A', '2000'), adset('as_b', 'B', '8000')].map(snapshotFromGraph)], daily), DATE)
    setRole(ctx, 'as_a', 'acquisition')
    setRole(ctx, 'as_b', 'retargeting') // 不同角色 → 各自只有一个单位
    expect(findBudgetMismatch(ctx, input())).toEqual([])
  })
})
