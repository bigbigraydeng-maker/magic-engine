/**
 * D3 候选范围：获客 / 再营销照旧（可进自动暂停建议）；类似人群与流量组纳入但只提醒（autoPauseEligible=false）。
 * 广告组设置用真实 `GraphAdsetSettings` 经 `normalizeAdset` + `buildAccountContext` 构造。
 */
import { describe, expect, it } from 'vitest'
import type { GraphAdsetSettings } from '@/lib/meta/entity-settings'
import { normalizeAdset, normalizeCampaign, settingsHash, type EntitySnapshotRow } from '../../snapshot'
import type { RoleVerdict } from '../../roles'
import { buildAccountContext } from '../context'
import { diagnoseSpendNoResult } from '../d3-spend-no-result'
import type { AccountInput, DailyRow, DiagnosisInput } from '../types'

const CTX = { clientId: 'c', adAccountId: 'act_1', currency: 'NZD', sharedAccount: false }
const DATE = '2026-10-24'

function snap(g: GraphAdsetSettings): EntitySnapshotRow {
  const draft = normalizeAdset(CTX, g)
  return { ...draft, settings_hash: settingsHash(draft), capture_reason: 'daily', captured_at: `${DATE}T10:00:00Z` }
}

function adset(id: string, goal: string): GraphAdsetSettings {
  return {
    id, name: id, campaign_id: 'camp_1', optimization_goal: goal,
    status: 'ACTIVE', effective_status: 'ACTIVE', targeting: {},
  }
}

function dayRow(adsetId: string, spend: number, leads = 0): DailyRow {
  return {
    level: 'adset', entity_id: adsetId, parent_id: 'camp_1', insight_date: DATE,
    spend, impressions: 1000, reach: 800, clicks: 40, leads, messaging_conversations: 0,
    video_thruplays: null,
    actions: leads > 0 ? [{ action_type: 'lead', value: String(leads) }] : [],
  }
}

function run(
  goal: string,
  spend: number,
  target: number | null = 11,
  role?: RoleVerdict['role'],
) {
  const account: AccountInput = {
    adAccountId: 'act_1', shared: false, timezone: 'Pacific/Auckland', currency: 'NZD',
    snapshots: [snap(adset('as_1', goal))], daily: [dayRow('as_1', spend)],
    hourly: {}, hourlyError: null, latestCaptures: [], lastInsightDate: DATE,
  }
  const ctx = buildAccountContext(account, DATE)
  if (role) {
    const prev = ctx.roles.get('as_1')
    ctx.roles.set('as_1', { ...prev, role, confidence: 'high', reasons: [], retargetingAudienceIds: [] } as RoleVerdict)
  }
  const input: DiagnosisInput = {
    clientId: 'c', date: DATE, evaluatedAt: `${DATE}T20:00:00Z`,
    outcome: { leading: null, primary: 'lead', targetCostPerPrimary: target, minPrimaryPerUnit: 5 },
    outcomeConfigured: true, messagingReferralAvailable: false, digestRecipients: [], accounts: [account],
  }
  return diagnoseSpendNoResult(ctx, input)
}

describe('D3 候选范围', () => {
  it('流量组（LINK_CLICKS）花 $152、0 线索、目标 $11 → 命中，只提醒', () => {
    const [d] = run('LINK_CLICKS', 152)
    expect(d).toMatchObject({ code: 'D3', status: 'hit', autoPauseEligible: false })
    expect(d.title).toContain('只提醒')
    expect(d.units[0].id).toBe('as_1')
  })

  it('落地页浏览目标的流量组同样命中且只提醒', () => {
    expect(run('LANDING_PAGE_VIEWS', 30)[0]).toMatchObject({ status: 'hit', autoPauseEligible: false })
  })

  it('类似人群（expansion）花 $194、0 线索 → 命中，只提醒', () => {
    expect(run('LEAD_GENERATION', 194, 11, 'expansion')[0]).toMatchObject({ status: 'hit', autoPauseEligible: false })
  })

  it('流量组被判成再营销（retargeting）→ 仍只提醒，不进自动暂停', () => {
    expect(run('LINK_CLICKS', 152, 11, 'retargeting')[0]).toMatchObject({ status: 'hit', autoPauseEligible: false })
  })

  it('获客组行为不变：命中且不带 autoPauseEligible=false', () => {
    const [d] = run('LEAD_GENERATION', 100)
    expect(d.status).toBe('hit')
    expect(d.autoPauseEligible).toBeUndefined()
    expect(d.title).not.toContain('只提醒')
  })

  it('花费没到 2× 目标（$22）→ 不报', () => {
    expect(run('LINK_CLICKS', 21)).toEqual([])
  })

  it('没配目标 → 判不了（不回落默认），且不会是命中', () => {
    const out = run('LINK_CLICKS', 152, null)
    expect(out.every(d => d.status === 'not_comparable')).toBe(true)
  })

  it('破冰类（THRUPLAY）不纳入', () => {
    expect(run('THRUPLAY', 500)).toEqual([])
  })

  it('花钱结果太少：标题写明广告组，同系列还有别的花费时补系列合计，判定仍只看这个组', () => {
    const campaign = {
      ...normalizeCampaign(CTX, { id: 'camp_1', name: '系列甲', status: 'ACTIVE', effective_status: 'ACTIVE' }),
      settings_hash: 'h', capture_reason: 'daily' as const, captured_at: `${DATE}T10:00:00Z`,
    }
    const named = (id: string, name: string): GraphAdsetSettings => ({ ...adset(id, 'LEAD_GENERATION'), name })
    const account: AccountInput = {
      adAccountId: 'act_1', shared: false, timezone: 'Pacific/Auckland', currency: 'NZD',
      snapshots: [campaign, snap(named('as_a', '组A')), snap(named('as_b', '组B'))],
      daily: [dayRow('as_a', 48.55, 2), dayRow('as_b', 16.37, 0)],
      hourly: {}, hourlyError: null, latestCaptures: [], lastInsightDate: DATE,
    }
    const ctx = buildAccountContext(account, DATE)
    for (const id of ['as_a', 'as_b']) {
      const prev = ctx.roles.get(id)
      ctx.roles.set(id, { ...prev, role: 'acquisition', confidence: 'high', reasons: [], retargetingAudienceIds: [] } as RoleVerdict)
    }
    const input: DiagnosisInput = {
      clientId: 'c', date: DATE, evaluatedAt: `${DATE}T20:00:00Z`,
      outcome: { leading: null, primary: 'lead', targetCostPerPrimary: 11, minPrimaryPerUnit: 5 },
      outcomeConfigured: true, messagingReferralAvailable: false, digestRecipients: [], accounts: [account],
    }
    const hits = diagnoseSpendNoResult(ctx, input).filter(d => d.status === 'hit')
    expect(hits.map(d => d.units[0]?.id)).toEqual(['as_a'])
    expect(hits[0]?.title).toContain('广告组「组A」')
    expect(hits[0]?.title).toContain('系列合计 NZD 64.92 / 2 = NZD 32.46')
    expect(hits[0]?.evidence).toMatchObject({ spend: 48.55, results: 2, cost_per_result: 24.28 })
  })

  it('系列里只有一个有花费的广告组：标题写明组名，不另写合计', () => {
    const [d] = run('LEAD_GENERATION', 100)
    expect(d.title).toContain('广告组「as_1」')
    expect(d.title).not.toContain('系列合计')
  })
})
