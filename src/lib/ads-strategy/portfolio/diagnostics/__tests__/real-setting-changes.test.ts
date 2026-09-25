import { describe, expect, it } from 'vitest'
import type { EntitySnapshotRow } from '../../snapshot'
import { realSettingChanges } from '../loader'

function snap(p: Partial<EntitySnapshotRow> & Pick<EntitySnapshotRow, 'captured_at' | 'capture_reason'>): EntitySnapshotRow {
  return {
    client_id: 'c', platform: 'meta', ad_account_id: 'act_1', level: 'adset', entity_id: 'as1', entity_name: 'as1', campaign_id: 'c1', adset_id: null,
    status: 'ACTIVE', effective_status: 'ACTIVE', objective: null, optimization_goal: 'LEAD_GENERATION', destination_type: 'ON_AD',
    budget_level: 'abo', daily_budget_minor: 2000, lifetime_budget_minor: null, currency: 'NZD', bid_strategy: null,
    special_ad_categories: [], smart_promotion_type: null, included_audience_ids: [], excluded_audience_ids: [],
    advantage_audience: null, targeting_relaxation: null, targeting_summary: { geo: 'NZ' }, learning_stage: null, ad_studies: [],
    creative_video_ids: [], creative_page_id: null, account_status: null, disable_reason: null, timezone_name: null,
    audience_subtype: null, audience_count_lower: null, audience_rule_object_ids: [], audience_rule_events: [],
    audience_retention_days: null, audience_created_at: null, shared_account: false, settings_hash: 'h',
    source_updated_time: '2026-09-01T00:00:00Z',
    ...p,
  }
}

describe('realSettingChanges', () => {
  it('ignores a changed row whose source_updated_time is unchanged (serialisation artefact)', () => {
    const rows = [
      snap({ captured_at: '2026-09-10T00:00:00Z', capture_reason: 'daily' }),
      snap({
        captured_at: '2026-09-11T00:00:00Z',
        capture_reason: 'changed',
        source_updated_time: '2026-09-01T00:00:00Z',
        targeting_summary: { geo: 'NZ', placements: 'auto' },
      }),
    ]
    expect(realSettingChanges(rows)).toEqual([])
  })

  it('counts a changed row when Meta source_updated_time moved, using Meta time', () => {
    const rows = [
      snap({ captured_at: '2026-09-10T00:00:00Z', capture_reason: 'daily' }),
      snap({
        captured_at: '2026-09-11T00:00:00Z',
        capture_reason: 'changed',
        source_updated_time: '2026-09-11T03:00:00Z',
        targeting_summary: { geo: 'NZ', placements: 'auto' },
      }),
    ]
    expect(realSettingChanges(rows)).toEqual([
      { level: 'adset', entity_id: 'as1', captured_at: '2026-09-11T03:00:00Z' },
    ])
  })

  it('falls back to key fields when prev source_updated_time is null', () => {
    const prev = snap({ captured_at: '2026-09-10T00:00:00Z', capture_reason: 'daily', source_updated_time: null })

    const onlyTargeting = [
      prev,
      snap({
        captured_at: '2026-09-11T00:00:00Z',
        capture_reason: 'changed',
        source_updated_time: null,
        targeting_summary: { geo: 'NZ', placements: 'auto' },
      }),
    ]
    expect(realSettingChanges(onlyTargeting)).toEqual([])

    const budgetChanged = [
      prev,
      snap({
        captured_at: '2026-09-11T00:00:00Z',
        capture_reason: 'changed',
        source_updated_time: '2026-09-11T05:00:00Z',
        daily_budget_minor: 3000,
      }),
    ]
    expect(realSettingChanges(budgetChanged)).toEqual([
      { level: 'adset', entity_id: 'as1', captured_at: '2026-09-11T05:00:00Z' },
    ])
  })

  it('uses captured_at when both source_updated_time are null and a key field differs', () => {
    const rows = [
      snap({ captured_at: '2026-09-10T00:00:00Z', capture_reason: 'daily', source_updated_time: null }),
      snap({
        captured_at: '2026-09-11T00:00:00Z',
        capture_reason: 'changed',
        source_updated_time: null,
        daily_budget_minor: 3000,
      }),
    ]
    expect(realSettingChanges(rows)).toEqual([
      { level: 'adset', entity_id: 'as1', captured_at: '2026-09-11T00:00:00Z' },
    ])
  })

  it('counts a changed row with no previous row only when Meta time is within 2 days of capture', () => {
    const recent = [
      snap({
        captured_at: '2026-09-11T10:00:00Z',
        capture_reason: 'changed',
        source_updated_time: '2026-09-10T20:00:00Z',
      }),
    ]
    expect(realSettingChanges(recent)).toEqual([
      { level: 'adset', entity_id: 'as1', captured_at: '2026-09-10T20:00:00Z' },
    ])

    const stale = [
      snap({
        captured_at: '2026-09-11T10:00:00Z',
        capture_reason: 'changed',
        source_updated_time: '2026-08-30T00:00:00Z',
      }),
    ]
    expect(realSettingChanges(stale)).toEqual([])
  })

  it('treats kernel_post like changed and never emits daily or first_seen rows', () => {
    const rows = [
      snap({ captured_at: '2026-09-10T00:00:00Z', capture_reason: 'daily' }),
      snap({
        captured_at: '2026-09-11T00:00:00Z',
        capture_reason: 'kernel_post',
        source_updated_time: '2026-09-11T03:00:00Z',
      }),
      snap({
        captured_at: '2026-09-12T00:00:00Z',
        capture_reason: 'daily',
        source_updated_time: '2026-09-12T03:00:00Z',
      }),
      snap({
        captured_at: '2026-09-13T00:00:00Z',
        capture_reason: 'first_seen',
        source_updated_time: '2026-09-13T03:00:00Z',
      }),
    ]
    expect(realSettingChanges(rows)).toEqual([
      { level: 'adset', entity_id: 'as1', captured_at: '2026-09-11T03:00:00Z' },
    ])
  })

  it('compares rows only within their own entity, regardless of input order', () => {
    const rows = [
      snap({
        captured_at: '2026-09-11T00:00:00Z',
        capture_reason: 'changed',
        entity_id: 'as2',
        source_updated_time: '2026-09-11T03:00:00Z',
      }),
      snap({ captured_at: '2026-09-10T00:00:00Z', capture_reason: 'daily', entity_id: 'as2' }),
      snap({
        captured_at: '2026-09-11T00:00:00Z',
        capture_reason: 'changed',
        entity_id: 'as1',
        source_updated_time: '2026-09-11T04:00:00Z',
      }),
      snap({ captured_at: '2026-09-10T00:00:00Z', capture_reason: 'daily', entity_id: 'as1' }),
    ]
    expect(realSettingChanges(rows)).toEqual([
      { level: 'adset', entity_id: 'as2', captured_at: '2026-09-11T03:00:00Z' },
      { level: 'adset', entity_id: 'as1', captured_at: '2026-09-11T04:00:00Z' },
    ])
  })

  it('skips a disappeared row when looking for the previous row', () => {
    const rows = [
      snap({ captured_at: '2026-09-09T00:00:00Z', capture_reason: 'daily' }),
      snap({ captured_at: '2026-09-10T00:00:00Z', capture_reason: 'disappeared' }),
      snap({
        captured_at: '2026-09-11T00:00:00Z',
        capture_reason: 'changed',
        source_updated_time: '2026-09-11T03:00:00Z',
      }),
    ]
    expect(realSettingChanges(rows)).toEqual([
      { level: 'adset', entity_id: 'as1', captured_at: '2026-09-11T03:00:00Z' },
    ])
  })
})
