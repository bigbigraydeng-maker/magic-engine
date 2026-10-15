/**
 * `buildAdsDraftFacts` 纯函数测试。
 *
 * 只测纯函数，不碰数据库。夹具用 `mkRow()` 造，必填字段给默认值，
 * 每个用例只覆盖它关心的那几个字段。
 */

import { describe, it, expect } from 'vitest'
import { buildAdsDraftFacts } from '../promo-draft-facts'
import type { RawDraftInput } from '../promo-draft-facts'
import type { EntitySnapshotRow } from '../portfolio/snapshot'

/** 造一行快照；必填字段给默认值，用例只覆盖关心的字段。 */
function mkRow(over: Partial<EntitySnapshotRow>): EntitySnapshotRow {
  const base: EntitySnapshotRow = {
    client_id: 'c1', platform: 'meta', ad_account_id: 'act_1', level: 'campaign', entity_id: 'e1', entity_name: null,
    campaign_id: null, adset_id: null, status: null, effective_status: null, objective: null, optimization_goal: null,
    destination_type: null, budget_level: null, daily_budget_minor: null, lifetime_budget_minor: null, currency: 'USD',
    bid_strategy: null, special_ad_categories: [], smart_promotion_type: null, included_audience_ids: [], excluded_audience_ids: [],
    advantage_audience: null, targeting_relaxation: null, targeting_summary: null, learning_stage: null, ad_studies: [],
    creative_video_ids: [], creative_page_id: null, account_status: null, disable_reason: null, timezone_name: null,
    audience_subtype: null, audience_count_lower: null, audience_rule_object_ids: [], audience_rule_events: [],
    audience_retention_days: null, audience_created_at: null, shared_account: false, settings_hash: 'h',
    capture_reason: 'daily', source_updated_time: null, captured_at: '2026-01-01T00:00:00.000Z',
  }
  return { ...base, ...over }
}

/** 造一份最小可用的 RawDraftInput；用例只覆盖关心的字段。 */
function mkRaw(over: Partial<RawDraftInput>): RawDraftInput {
  const base: RawDraftInput = {
    now: new Date('2026-01-10T12:00:00.000Z'),
    config: { daily_budget_cap_cents: 100_000, approved_creatives: ['cr_1'] },
    account_cap_minor: 100_000,
    account_cap_read_failed: false,
    snapshots: [],
    insights: [],
    audience_capture: null,
    captures_read_failed: false,
    ad_account_id: 'act_1',
    committed_minor: 0,
    budget_share_of_headroom: 0.5,
    min_audience_size: 1000,
    max_creatives: 3,
  }
  return { ...base, ...over }
}

describe('buildAdsDraftFacts — headroom 读不全', () => {
  it('config=null → headroom ok:false', () => {
    const f = buildAdsDraftFacts(mkRaw({ config: null }))
    expect(f.headroom.ok).toBe(false)
    if (f.headroom.ok === false) expect(f.headroom.reason).toBe('广告设置读不出来')
    expect(f.approved_creatives).toBeNull()
  })

  it('客户日预算总上限没设 → headroom ok:false', () => {
    const f = buildAdsDraftFacts(
      mkRaw({ config: { daily_budget_cap_cents: null, approved_creatives: [] } }),
    )
    expect(f.headroom.ok).toBe(false)
    if (f.headroom.ok === false) expect(f.headroom.reason).toBe('客户日预算总上限没设置')
  })

  it('account_cap_read_failed → headroom ok:false', () => {
    const f = buildAdsDraftFacts(mkRaw({ account_cap_read_failed: true }))
    expect(f.headroom.ok).toBe(false)
    if (f.headroom.ok === false) expect(f.headroom.reason).toBe('账户日上限读不出来')
    expect(f.account_cap_minor).toBeNull()
  })

  it('snapshots=null → headroom ok:false 且 audiences=null', () => {
    const f = buildAdsDraftFacts(mkRaw({ snapshots: null }))
    expect(f.headroom.ok).toBe(false)
    if (f.headroom.ok === false) expect(f.headroom.reason).toBe('广告快照读不出来')
    expect(f.audiences).toBeNull()
  })
})

describe('buildAdsDraftFacts — 正常路径', () => {
  it('headroom_minor = cap − 在投合计', () => {
    const rows: EntitySnapshotRow[] = [
      mkRow({
        level: 'account',
        entity_id: 'act_1',
        captured_at: '2026-01-09T00:00:00.000Z',
        timezone_name: 'UTC',
      }),
      mkRow({
        level: 'campaign',
        entity_id: 'cmp_1',
        budget_level: 'cbo',
        daily_budget_minor: 30_000,
        effective_status: 'ACTIVE',
        captured_at: '2026-01-09T00:00:00.000Z',
      }),
      mkRow({
        level: 'campaign',
        entity_id: 'cmp_2',
        budget_level: 'cbo',
        daily_budget_minor: 20_000,
        effective_status: 'ACTIVE',
        captured_at: '2026-01-09T00:00:00.000Z',
      }),
    ]
    const f = buildAdsDraftFacts(mkRaw({ snapshots: rows }))
    expect(f.headroom.ok).toBe(true)
    if (f.headroom.ok === true) {
      expect(f.headroom.cap_minor).toBe(100_000)
      expect(f.headroom.delivering_minor).toBe(50_000)
      expect(f.headroom.headroom_minor).toBe(50_000)
      expect(f.headroom.currency).toBe('USD')
    }
    expect(f.account_delivering_minor).toBe(50_000)
  })

  it('audiences 排除 capture_reason==="disappeared" 的受众', () => {
    const rows: EntitySnapshotRow[] = [
      mkRow({
        level: 'account',
        entity_id: 'act_1',
        captured_at: '2026-01-09T00:00:00.000Z',
        timezone_name: 'UTC',
      }),
      mkRow({
        level: 'audience',
        entity_id: 'aud_keep',
        captured_at: '2026-01-09T00:00:00.000Z',
      }),
      mkRow({
        level: 'audience',
        entity_id: 'aud_gone',
        capture_reason: 'disappeared',
        captured_at: '2026-01-09T00:00:00.000Z',
      }),
    ]
    const f = buildAdsDraftFacts(mkRaw({ snapshots: rows }))
    expect(f.audiences).not.toBeNull()
    if (f.audiences !== null) {
      const refs = f.audiences.map((a) => a.ref)
      expect(refs).toContain('aud_keep')
      expect(refs).not.toContain('aud_gone')
    }
  })

  it('last_used_on 只认现在在投的广告组', () => {
    const rows: EntitySnapshotRow[] = [
      mkRow({
        level: 'account',
        entity_id: 'act_1',
        captured_at: '2026-01-09T00:00:00.000Z',
        timezone_name: 'UTC',
      }),
      mkRow({
        level: 'audience',
        entity_id: 'aud_1',
        captured_at: '2026-01-09T00:00:00.000Z',
      }),
      mkRow({
        level: 'adset',
        entity_id: 'as_1',
        included_audience_ids: ['aud_1'],
        effective_status: 'ACTIVE',
        captured_at: '2026-01-05T00:00:00.000Z',
      }),
      mkRow({
        level: 'adset',
        entity_id: 'as_2',
        included_audience_ids: ['aud_1'],
        effective_status: 'ACTIVE',
        captured_at: '2026-01-08T00:00:00.000Z',
      }),
      // 暂停的广告组不算「还在用」，即使它的抓取日期更新
      mkRow({
        level: 'adset',
        entity_id: 'as_3',
        included_audience_ids: ['aud_1'],
        effective_status: 'PAUSED',
        captured_at: '2026-01-09T00:00:00.000Z',
      }),
    ]
    const f = buildAdsDraftFacts(mkRaw({ snapshots: rows }))
    expect(f.audiences).not.toBeNull()
    if (f.audiences !== null) {
      const aud = f.audiences.find((a) => a.ref === 'aud_1')
      expect(aud).toBeDefined()
      if (aud !== undefined) expect(aud.last_used_on).toBe('2026-01-08')
    }
  })

  it('受众 size_lower 为 null 的保留', () => {
    const rows: EntitySnapshotRow[] = [
      mkRow({
        level: 'account',
        entity_id: 'act_1',
        captured_at: '2026-01-09T00:00:00.000Z',
        timezone_name: 'UTC',
      }),
      mkRow({
        level: 'audience',
        entity_id: 'aud_unknown',
        audience_count_lower: null,
        captured_at: '2026-01-09T00:00:00.000Z',
      }),
    ]
    const f = buildAdsDraftFacts(mkRaw({ snapshots: rows }))
    expect(f.audiences).not.toBeNull()
    if (f.audiences !== null) {
      const aud = f.audiences.find((a) => a.ref === 'aud_unknown')
      expect(aud).toBeDefined()
      if (aud !== undefined) expect(aud.size_lower).toBeNull()
    }
  })
})

describe('buildAdsDraftFacts — 逐日', () => {
  it('insights=null → daily=null', () => {
    const f = buildAdsDraftFacts(mkRaw({ insights: null }))
    expect(f.daily).toBeNull()
  })

  it('零行 → daily=[]（与 null 区分）', () => {
    const f = buildAdsDraftFacts(mkRaw({ insights: [] }))
    expect(f.daily).not.toBeNull()
    expect(f.daily).toEqual([])
  })

  it('同一天多行被汇总', () => {
    const f = buildAdsDraftFacts(
      mkRaw({
        insights: [
          { insight_date: '2026-01-05', spend: 10, results: 2, fetched_at: '2026-01-06T00:00:00.000Z' },
          { insight_date: '2026-01-05', spend: '5.5', results: 1, fetched_at: '2026-01-06T00:00:00.000Z' },
          { insight_date: '2026-01-06', spend: 3, results: 1, fetched_at: '2026-01-07T00:00:00.000Z' },
        ],
      }),
    )
    expect(f.daily).not.toBeNull()
    if (f.daily !== null) {
      expect(f.daily.length).toBe(2)
      expect(f.daily[0].date).toBe('2026-01-05')
      expect(f.daily[0].spend_cents).toBe(1550)
      expect(f.daily[0].results).toBe(3)
      expect(f.daily[1].date).toBe('2026-01-06')
      expect(f.daily[1].spend_cents).toBe(300)
    }
    expect(f.insights_as_of).toBe('2026-01-07T00:00:00.000Z')
  })

  it('account_status 取自账户历史快照', () => {
    const rows: EntitySnapshotRow[] = [
      mkRow({
        level: 'account',
        entity_id: 'act_1',
        captured_at: '2026-01-04T00:00:00.000Z',
        account_status: 1,
        timezone_name: 'UTC',
      }),
      mkRow({
        level: 'account',
        entity_id: 'act_1',
        captured_at: '2026-01-06T00:00:00.000Z',
        account_status: 2,
        timezone_name: 'UTC',
      }),
    ]
    const f = buildAdsDraftFacts(
      mkRaw({
        snapshots: rows,
        insights: [
          { insight_date: '2026-01-05', spend: 1, results: 1, fetched_at: null },
          { insight_date: '2026-01-07', spend: 1, results: 1, fetched_at: null },
        ],
      }),
    )
    expect(f.daily).not.toBeNull()
    if (f.daily !== null) {
      const d05 = f.daily.find((d) => d.date === '2026-01-05')
      const d07 = f.daily.find((d) => d.date === '2026-01-07')
      expect(d05?.account_status).toBe(1)
      expect(d07?.account_status).toBe(2)
    }
  })
})

describe('buildAdsDraftFacts — audiences_complete', () => {
  it('audience_capture=null → null', () => {
    const f = buildAdsDraftFacts(mkRaw({ audience_capture: null }))
    expect(f.audiences_complete).toBeNull()
  })

  it('captures_read_failed → null', () => {
    const f = buildAdsDraftFacts(
      mkRaw({ captures_read_failed: true, audience_capture: { complete: true, skipped_shared: false } }),
    )
    expect(f.audiences_complete).toBeNull()
  })

  it('skipped_shared → false', () => {
    const f = buildAdsDraftFacts(
      mkRaw({ audience_capture: { complete: true, skipped_shared: true } }),
    )
    expect(f.audiences_complete).toBe(false)
  })

  it('complete → true', () => {
    const f = buildAdsDraftFacts(
      mkRaw({ audience_capture: { complete: true, skipped_shared: false } }),
    )
    expect(f.audiences_complete).toBe(true)
  })
})

describe('多账户快照：余量按客户全部账户合计，受众只认选中账户', () => {
  it('另一个账户的在投预算也计入客户余量；另一个账户的受众不出现', () => {
    const mine = mkRow({ ad_account_id: 'act_1', level: 'campaign', entity_id: 'c-mine', budget_level: 'cbo', daily_budget_minor: 3000, effective_status: 'ACTIVE' })
    const other = mkRow({ ad_account_id: 'act_2', level: 'campaign', entity_id: 'c-other', budget_level: 'cbo', daily_budget_minor: 4000, effective_status: 'ACTIVE' })
    const otherAud = mkRow({ ad_account_id: 'act_2', level: 'audience', entity_id: 'aud-other', audience_count_lower: 99999 })
    const myAud = mkRow({ ad_account_id: 'act_1', level: 'audience', entity_id: 'aud-mine', audience_count_lower: 5000 })
    const raw = mkRaw({ snapshots: [mine, other, otherAud, myAud] })
    raw.config = { daily_budget_cap_cents: 10000, approved_creatives: [] }
    const f = buildAdsDraftFacts(raw)
    expect(f.headroom.ok).toBe(true)
    if (f.headroom.ok) {
      expect(f.headroom.delivering_minor).toBe(7000)
      expect(f.headroom.headroom_minor).toBe(3000)
    }
    expect(f.account_delivering_minor).toBe(3000)
    expect(f.audiences?.map(a => a.ref)).toEqual(['aud-mine'])
  })
})

describe('buildAdsDraftFacts — 余量覆盖与新鲜度（客户全部账户）', () => {
  const NOW = new Date('2026-01-10T00:00:00.000Z')
  const campaign = (acct: string, at: string) => mkRow({
    ad_account_id: acct, level: 'campaign', entity_id: `c-${acct}`, budget_level: 'cbo', daily_budget_minor: 1000,
    effective_status: 'ACTIVE', captured_at: at, currency: 'USD',
  })
  const withOwned = (rows: EntitySnapshotRow[], owned: string[]) =>
    mkRaw({ now: NOW, snapshots: rows, owned_account_ids: owned, config: { daily_budget_cap_cents: 10000, approved_creatives: [] } })

  it('客户名下某个账户没有系列层快照（共用账户只写账户层）→ headroom ok:false，不把它当成在投 0', () => {
    const f = buildAdsDraftFacts(withOwned([
      campaign('act_1', '2026-01-09T12:00:00.000Z'),
      mkRow({ ad_account_id: 'act_2', level: 'account', entity_id: 'act_2', captured_at: '2026-01-09T12:00:00.000Z' }),
    ], ['act_1', 'act_2']))
    expect(f.headroom.ok).toBe(false)
    if (f.headroom.ok === false) expect(f.headroom.reason).toContain('act_2')
  })
  it('某个账户的快照超过 2 天没更新 → headroom ok:false（一个新鲜不能盖住另一个过期）', () => {
    const f = buildAdsDraftFacts(withOwned([
      campaign('act_1', '2026-01-09T12:00:00.000Z'),
      campaign('act_2', '2025-12-01T12:00:00.000Z'),
    ], ['act_1', 'act_2']))
    expect(f.headroom.ok).toBe(false)
    if (f.headroom.ok === false) expect(f.headroom.reason).toContain('没更新')
  })
  it('各账户都有系列层快照且够新 → 照常算，取数时间取最旧的那个账户', () => {
    const f = buildAdsDraftFacts(withOwned([
      campaign('act_1', '2026-01-09T12:00:00.000Z'),
      campaign('act_2', '2026-01-08T12:00:00.000Z'),
    ], ['act_1', 'act_2']))
    expect(f.headroom.ok).toBe(true)
    if (f.headroom.ok) {
      expect(f.headroom.delivering_minor).toBe(2000)
      expect(f.headroom.as_of).toBe('2026-01-08T12:00:00.000Z')
    }
  })
})
