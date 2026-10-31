import { describe, expect, it } from 'vitest'
import { detectOutsideChanges, formatNzWhen, idsInRecord, type ActionFact, type SnapshotFact } from '../detect'

const T0 = '2026-10-29T22:00:00.000Z'
const T1 = '2026-10-30T10:00:00.000Z'
const T2 = '2026-10-30T22:00:00.000Z'

function snap(partial: Partial<SnapshotFact> & Pick<SnapshotFact, 'level' | 'entityId' | 'capturedAt' | 'settingsHash'>): SnapshotFact {
  return {
    entityName: 'Name',
    campaignId: null,
    adsetId: null,
    dailyBudgetMinor: null,
    lifetimeBudgetMinor: null,
    currency: 'NZD',
    ...partial,
  }
}

function action(partial: Partial<ActionFact> & Pick<ActionFact, 'key' | 'occurredAt' | 'ids'>): ActionFact {
  return { status: 'succeeded', ...partial }
}

const campaign = snap({
  level: 'campaign', entityId: 'camp-1', entityName: 'Spring', capturedAt: T0, settingsHash: 'camp',
})

describe('detectOutsideChanges', () => {
  it('detects a budget change when the settings hash and stored budget both differ', () => {
    const before = snap({
      level: 'adset', entityId: 'set-1', entityName: 'North', campaignId: 'camp-1',
      capturedAt: T0, settingsHash: 'h1', dailyBudgetMinor: 5000,
    })
    const after = snap({ ...before, capturedAt: T1, settingsHash: 'h2', dailyBudgetMinor: 6000 })
    const found = detectOutsideChanges([campaign, before, after], [])
    expect(found).toEqual([expect.objectContaining({
      kind: 'budget',
      entityId: 'set-1',
      where: '广告组 · North（系列 Spring）',
      what: '每天预算 NZD 50 → NZD 60',
      capturedAt: T1,
    })])
  })

  it('does not treat a same hash, or a hash change with the same budget, as a budget change', () => {
    const before = snap({
      level: 'adset', entityId: 'set-1', entityName: 'North', capturedAt: T0, settingsHash: 'h1', dailyBudgetMinor: 5000,
    })
    const sameHash = snap({ ...before, capturedAt: T1, dailyBudgetMinor: 6000 })
    const otherSetting = snap({ ...before, capturedAt: T1, settingsHash: 'h2', dailyBudgetMinor: 5000, lifetimeBudgetMinor: null })
    expect(detectOutsideChanges([before, sameHash], [])).toEqual([])
    expect(detectOutsideChanges([before, otherSetting], [])).toEqual([])
  })

  it('detects a new ad set and a new ad that appear after an earlier snapshot', () => {
    const adset = snap({
      level: 'adset', entityId: 'set-new', entityName: 'South', campaignId: 'camp-1',
      capturedAt: T1, settingsHash: 'new-set', dailyBudgetMinor: 3000,
    })
    const ad = snap({
      level: 'ad', entityId: 'ad-new', entityName: 'Clip', adsetId: 'set-new',
      capturedAt: T2, settingsHash: 'new-ad',
    })
    const found = detectOutsideChanges([campaign, adset, ad], [])
    expect(found.map((row) => row.kind)).toEqual(['new_ad', 'new_adset'])
    expect(found[0]).toMatchObject({ where: '广告 · Clip（广告组 South）', what: '新广告' })
    expect(found[1]).toMatchObject({ what: '新广告组，每天预算 NZD 30', where: '广告组 · South（系列 Spring）' })
  })

  it('does not call the first snapshot batch new', () => {
    const adset = snap({
      level: 'adset', entityId: 'set-1', entityName: 'North', capturedAt: T0, settingsHash: 'h1', dailyBudgetMinor: 5000,
    })
    expect(detectOutsideChanges([campaign, adset], [])).toEqual([])
  })

  it('keeps a change when no action record matches the entity (no-match)', () => {
    const before = snap({
      level: 'adset', entityId: 'set-1', entityName: 'North', capturedAt: T0, settingsHash: 'h1', dailyBudgetMinor: 5000,
    })
    const after = snap({ ...before, capturedAt: T1, settingsHash: 'h2', dailyBudgetMinor: 7200 })
    const pause = action({ key: 'ads.pause_campaign', occurredAt: '2026-10-30T09:00:00.000Z', ids: ['set-1'] })
    const otherEntity = action({ key: 'ads.cut_unit_budget', occurredAt: '2026-10-30T09:00:00.000Z', ids: ['set-other'] })
    const tooEarly = action({ key: 'ads.scale_unit_budget', occurredAt: T0, ids: ['set-1'] })
    const failed = action({
      key: 'ads.scale_unit_budget', occurredAt: '2026-10-30T09:00:00.000Z', ids: ['set-1'], status: 'failed',
    })
    expect(detectOutsideChanges([before, after], [pause, otherEntity, tooEarly, failed])).toHaveLength(1)
  })

  it('drops a change when a finished action record matches the entity in the gap (match)', () => {
    const before = snap({
      level: 'campaign', entityId: 'camp-1', entityName: 'Spring', capturedAt: T0, settingsHash: 'c1', dailyBudgetMinor: 5000,
    })
    const after = snap({ ...before, capturedAt: T1, settingsHash: 'c2', dailyBudgetMinor: 4000 })
    const adset = snap({
      level: 'adset', entityId: 'set-new', entityName: 'South', campaignId: 'camp-1',
      capturedAt: T1, settingsHash: 'new-set', dailyBudgetMinor: 1500,
    })
    const ad = snap({
      level: 'ad', entityId: 'ad-1', entityName: 'Clip', adsetId: 'set-new', capturedAt: T1, settingsHash: 'new-ad',
    })
    const budget = action({
      key: 'ads.cut_campaign_budget',
      occurredAt: '2026-10-30T09:30:00.000Z',
      ids: idsInRecord({ campaign_id: 'camp-1', before: { daily_budget: '50' }, after: { daily_budget: '40' } }),
      status: null,
    })
    const created = action({
      key: 'ads.create_ad',
      occurredAt: '2026-10-30T09:40:00.000Z',
      ids: idsInRecord({ status: 'active', campaignId: 'camp-1', adSetId: 'set-new', adIds: ['ad-1'], draft: { pageId: 'page-9' } }),
      status: 'active',
    })
    expect(idsInRecord({ draft: { pageId: 'page-9' } })).not.toContain('page-9')
    expect(detectOutsideChanges([before, after, adset, ad], [budget, created])).toEqual([])
  })

  it('formats the snapshot time in New Zealand daylight time', () => {
    expect(formatNzWhen('2026-10-30T00:28:00.000Z')).toContain('13:28')
    expect(formatNzWhen('2026-10-30T00:28:00.000Z')).toContain('NZDT')
  })
})
