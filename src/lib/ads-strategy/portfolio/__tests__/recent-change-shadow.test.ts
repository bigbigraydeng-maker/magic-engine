import { describe, expect, it } from 'vitest'
import type { GraphAdsetSettings } from '@/lib/meta/entity-settings'
import { normalizeAdset, settingsHash, type EntitySnapshotRow } from '../snapshot'
import { recentChangeShadow, safeRecentChangeShadow, RECENT_CHANGE_COOLDOWN_HOURS } from '../recent-change-shadow'
import type { AccountInput, Diagnosis, DiagnosisInput, SettingChange } from '../diagnostics/types'

const CTX = { clientId: 'c', adAccountId: 'act_1', currency: 'NZD', sharedAccount: false }
const EVALUATED_AT = '2026-11-02T20:00:00Z'

function snap(id: string, campaignId: string): EntitySnapshotRow {
  const g: GraphAdsetSettings = { id, name: id, campaign_id: campaignId, optimization_goal: 'LEAD_GENERATION', status: 'ACTIVE', effective_status: 'ACTIVE', targeting: {} }
  const draft = normalizeAdset(CTX, g)
  return { ...draft, settings_hash: settingsHash(draft), capture_reason: 'daily', captured_at: '2026-11-02T10:00:00Z' }
}

function input(settingChanges: SettingChange[], snapshots = [snap('as_1', 'camp_1'), snap('as_2', 'camp_2')]): DiagnosisInput {
  const account: AccountInput = {
    adAccountId: 'act_1', shared: false, timezone: 'Pacific/Auckland', currency: 'NZD',
    snapshots, daily: [], hourly: {}, hourlyError: null, latestCaptures: [], lastInsightDate: '2026-11-02',
    settingChanges,
  }
  return {
    clientId: 'c', date: '2026-11-02', evaluatedAt: EVALUATED_AT,
    outcome: { leading: null, primary: 'lead', targetCostPerPrimary: 20, minPrimaryPerUnit: 5 },
    outcomeConfigured: true, messagingReferralAvailable: false, digestRecipients: [], accounts: [account],
  }
}

function finding(code: 'O1' | 'D3' | 'D2', adsetId: string, status: Diagnosis['status'] = 'hit'): Diagnosis {
  return {
    code, status, title: `${code} ${adsetId}`,
    units: [{ level: 'adset', id: adsetId, name: adsetId, adAccountId: 'act_1' }],
    evidence: {}, sample: [], reasons: [], clientVisible: false,
  }
}

const changed = (entityId: string, at: string, level: SettingChange['level'] = 'adset'): SettingChange => ({ level, entity_id: entityId, captured_at: at })

describe('放类（O1 加预算）：72 小时内动过 → 本该压住', () => {
  it('广告组 18 小时前改过 → would_suppress=1，样本写明几小时前', () => {
    const s = recentChangeShadow(input([changed('as_1', '2026-11-02T02:00:00Z')]), [finding('O1', 'as_1')])
    expect(s).toMatchObject({ scale_up_hits: 1, would_suppress: 1, stop_loss_hits: 0, would_annotate: 0 })
    expect(s.samples).toEqual([{ code: 'O1', adset_id: 'as_1', changed_at: '2026-11-02T02:00:00Z', hours_ago: 18 }])
  })

  it('广告组没动、它所属的系列 10 小时前改过（CBO 加的是系列预算）→ 也算', () => {
    const s = recentChangeShadow(input([changed('camp_1', '2026-11-02T10:00:00Z', 'campaign')]), [finding('O1', 'as_1')])
    expect(s.would_suppress).toBe(1)
  })

  it(`改动已经超过 ${RECENT_CHANGE_COOLDOWN_HOURS} 小时 → 不压`, () => {
    const s = recentChangeShadow(input([changed('as_1', '2026-10-30T19:00:00Z')]), [finding('O1', 'as_1')])
    expect(s).toMatchObject({ scale_up_hits: 1, would_suppress: 0, samples: [] })
  })

  it('改的是别的广告组 → 不压', () => {
    const s = recentChangeShadow(input([changed('as_2', '2026-11-02T02:00:00Z')]), [finding('O1', 'as_1')])
    expect(s.would_suppress).toBe(0)
  })

  it('改动时间晚于评估时间（时钟或数据异常）→ 不算', () => {
    const s = recentChangeShadow(input([changed('as_1', '2026-11-03T02:00:00Z')]), [finding('O1', 'as_1')])
    expect(s.would_suppress).toBe(0)
  })
})

describe('收类（D3 止损）：永远不压，只标注', () => {
  it('刚改过的组命中 D3 → would_annotate=1，would_suppress 永远是 0', () => {
    const s = recentChangeShadow(input([changed('as_1', '2026-11-02T14:00:00Z')]), [finding('D3', 'as_1')])
    expect(s).toMatchObject({ stop_loss_hits: 1, would_annotate: 1, would_suppress: 0 })
  })
})

describe('范围', () => {
  it('只看 status=hit 的放类和收类；判不了的和别的规则不算', () => {
    const s = recentChangeShadow(
      input([changed('as_1', '2026-11-02T02:00:00Z')]),
      [finding('O1', 'as_1', 'not_comparable'), finding('D2', 'as_1')],
    )
    expect(s).toEqual({ scale_up_hits: 0, would_suppress: 0, stop_loss_hits: 0, would_annotate: 0, samples: [] })
  })

  it('样本最多 3 条，计数照实', () => {
    const snaps = ['a', 'b', 'c', 'd'].map(id => snap(id, `camp_${id}`))
    const s = recentChangeShadow(
      input(['a', 'b', 'c', 'd'].map(id => changed(id, '2026-11-02T02:00:00Z')), snaps),
      ['a', 'b', 'c', 'd'].map(id => finding('O1', id)),
    )
    expect(s.would_suppress).toBe(4)
    expect(s.samples).toHaveLength(3)
  })
})

describe('影子不改正式结果', () => {
  function deepFreeze<T>(o: T): T {
    if (o && typeof o === 'object') {
      for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v)
      Object.freeze(o)
    }
    return o
  }

  it('输入和结论全部冻结后照常算出结果（证明它没有改动任何传进来的东西）', () => {
    const inp = deepFreeze(input([changed('as_1', '2026-11-02T02:00:00Z')]))
    const findings = deepFreeze([finding('O1', 'as_1'), finding('D3', 'as_2')])
    const before = JSON.stringify({ inp, findings })
    const s = recentChangeShadow(inp, findings)
    expect(s.would_suppress).toBe(1)
    expect(JSON.stringify({ inp, findings })).toBe(before)
  })

  it('影子自己出错只返回一句错误，不往外抛', () => {
    const broken = { ...input([]), accounts: null as unknown as DiagnosisInput['accounts'] }
    const out = safeRecentChangeShadow(broken, [finding('O1', 'as_1')])
    expect(out).toHaveProperty('error')
  })
})
