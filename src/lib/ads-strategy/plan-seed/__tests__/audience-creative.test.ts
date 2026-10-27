import { describe, expect, it } from 'vitest'
import type { AdsDraftFacts } from '@/lib/marketing-plan/promo/draft-ads'
import { isRemarketingSubtype } from '../../portfolio/roles'
import {
  audienceIdsToRead,
  audienceOwnedByAccount,
  seedAudience,
  seedCreatives,
  seedExcluded,
  seedSchedule,
  seedStepAudiences,
} from '../audience-creative'

const NOW = Date.parse('2026-10-27T00:00:00Z')
const PERIOD = { start_date: '2026-11-01', end_date: '2026-11-30' }

function facts(over: Partial<AdsDraftFacts>): AdsDraftFacts {
  return {
    today: '2026-10-27',
    headroom: { ok: false, reason: 'x' },
    account_delivering_minor: null,
    account_cap_minor: null,
    committed_minor: 0,
    daily: null,
    insights_as_of: null,
    audiences: null,
    audiences_complete: null,
    approved_creatives: null,
    budget_share_of_headroom: 0.5,
    min_audience_size: 1000,
    max_creatives: 3,
    ...over,
  }
}

const pool = [{ ref: '111111', name: 'A', size_lower: 50, last_used_on: '2026-10-20', as_of: null, subtype: 'ENGAGEMENT' }]

describe('remarketing subtypes', () => {
  it('matches the funnel-role split: lookalikes and unknown subtypes are not warm', () => {
    for (const subtype of ['ENGAGEMENT', 'WEBSITE', 'CUSTOM', 'OFFLINE_CONVERSION', 'APP', 'VIDEO']) {
      expect(isRemarketingSubtype(subtype)).toBe(true)
    }
    expect(isRemarketingSubtype('LOOKALIKE')).toBe(false)
    expect(isRemarketingSubtype(null)).toBe(false)
    expect(isRemarketingSubtype(undefined)).toBe(false)
  })
})

describe('seedAudience', () => {
  it('read: usable candidate is picked even when small (size is not a filter)', () => {
    const r = seedAudience('warm_pool_retarget', facts({ audiences: pool }), {
      state: 'ok',
      value: { '111111': { operation: 200, delivery: 200 } },
    })
    expect(r.state).toBe('read')
    expect(r.ids.ok && r.ids.value).toEqual(['111111'])
  })
  it('unusable: status not 200 leaves it empty', () => {
    const r = seedAudience('warm_pool_retarget', facts({ audiences: pool }), {
      state: 'ok',
      value: { '111111': { operation: 400, delivery: 200 } },
    })
    expect(r.state).toBe('unusable')
    expect(r.ids.ok).toBe(false)
  })
  it('unreadable: no pool or no status read', () => {
    expect(seedAudience('warm_pool_retarget', facts({}), null).state).toBe('unreadable')
    expect(seedAudience('warm_pool_retarget', facts({ audiences: pool }), null).state).toBe('unreadable')
  })
  it('failed read keeps the reason, including a timeout', () => {
    const r = seedAudience('warm_pool_retarget', facts({ audiences: pool }), {
      state: 'failed',
      reason: '读受众状态超时，先留空',
    })
    expect(r.state).toBe('unreadable')
    expect(r.ids.ok).toBe(false)
    if (!r.ids.ok) expect(r.ids.why_empty).toBe('读受众状态超时，先留空')
  })
  it('non-retarget plays get no audience', () => {
    expect(seedAudience('lead_form_harvest', facts({ audiences: pool }), null).ids.ok).toBe(false)
  })

  it('picks the warm subtype, not a more recently used lookalike', () => {
    const audiences = [
      { ref: '111111', name: 'Similar', size_lower: 9000, last_used_on: '2026-10-26', as_of: null, subtype: 'LOOKALIKE' },
      { ref: '444444', name: 'Engaged', size_lower: 400, last_used_on: '2026-10-01', as_of: null, subtype: 'ENGAGEMENT' },
    ]
    const status = {
      state: 'ok' as const,
      value: {
        '111111': { operation: 200, delivery: 200 },
        '444444': { operation: 200, delivery: 200 },
      },
    }
    const r = seedAudience('warm_pool_retarget', facts({ audiences }), status)
    expect(r.state).toBe('read')
    expect(r.ids.ok && r.ids.value).toEqual(['444444'])
    expect(audienceIdsToRead('warm_pool_retarget', facts({ audiences }))).toEqual(['444444'])
  })

  it('still reads a warm audience when lookalikes fill the status slots', () => {
    const audiences = [
      { ref: '111111', name: 'Similar', size_lower: 9000, last_used_on: '2026-10-26', as_of: null, subtype: 'LOOKALIKE' },
      { ref: '222222', name: 'Similar 2', size_lower: 8000, last_used_on: '2026-10-25', as_of: null, subtype: 'LOOKALIKE' },
      { ref: '333333', name: 'Similar 3', size_lower: 7000, last_used_on: '2026-10-24', as_of: null, subtype: 'LOOKALIKE' },
      { ref: '444444', name: 'Engaged', size_lower: 400, last_used_on: '2026-10-01', as_of: null, subtype: 'ENGAGEMENT' },
    ]
    const r = seedAudience('warm_pool_retarget', facts({ audiences }), {
      state: 'ok',
      value: {
        '111111': { operation: 200, delivery: 200 },
        '222222': { operation: 200, delivery: 200 },
        '333333': { operation: 200, delivery: 200 },
        '444444': { operation: 200, delivery: 200 },
      },
    })
    expect(r.ids.ok && r.ids.value).toEqual(['444444'])
    expect(audienceIdsToRead('warm_pool_retarget', facts({ audiences, excluded_in_use: [{ ref: '111111', adsets: 1 }] }))).toEqual([
      '444444',
      '111111',
    ])
  })

  it('leaves warm retarget empty when nothing is a remarketing subtype', () => {
    const audiences = [
      { ref: '111111', name: 'Similar', size_lower: 9000, last_used_on: '2026-10-26', as_of: null, subtype: 'LOOKALIKE' },
      { ref: '555555', name: 'Unknown', size_lower: 100, last_used_on: '2026-10-20', as_of: null, subtype: null },
    ]
    const r = seedAudience('warm_pool_retarget', facts({ audiences }), {
      state: 'ok',
      value: {
        '111111': { operation: 200, delivery: 200 },
        '555555': { operation: 200, delivery: 200 },
      },
    })
    expect(r.state).toBe('unusable')
    expect(r.ids.ok).toBe(false)
    if (!r.ids.ok) expect(r.ids.why_empty).toContain('再营销')
    expect(audienceIdsToRead('warm_pool_retarget', facts({ audiences }))).toEqual([])
  })

  it('drops a warm audience from the exclusion list when no other warm candidate is usable', () => {
    const audiences = [
      { ref: '111111', name: 'Warm', size_lower: 800, last_used_on: '2026-10-20', as_of: null, subtype: 'ENGAGEMENT' },
      { ref: '222222', name: 'List', size_lower: 400, last_used_on: '2026-10-01', as_of: null, subtype: 'CUSTOM' },
    ]
    const paired = seedStepAudiences('warm_pool_retarget', facts({
      audiences,
      excluded_in_use: [{ ref: '111111', adsets: 2 }, { ref: '333333', adsets: 1 }],
    }), {
      state: 'ok',
      value: {
        '111111': { operation: 200, delivery: 200 },
        '222222': { operation: 400, delivery: 200 },
        '333333': { operation: 200, delivery: 200 },
      },
    })
    expect(paired.audience.ids.ok && paired.audience.ids.value).toEqual(['111111'])
    expect(paired.excluded.ok).toBe(true)
    if (paired.excluded.ok) {
      expect(paired.excluded.value).toEqual(['333333'])
      expect(paired.excluded.basis[0].value).not.toContain('111111')
      expect(paired.excluded.notes.some((n) => n.includes('自相矛盾'))).toBe(true)
    }
  })
})

describe('seedExcluded', () => {
  const inUse = [{ ref: '222222', adsets: 2 }]
  it('references existing exclusions only', () => {
    const r = seedExcluded(facts({ excluded_in_use: inUse }), {
      state: 'ok',
      value: { '222222': { operation: 200, delivery: 200 } },
    })
    expect(r.ok && r.value).toEqual(['222222'])
  })
  it('fails closed when status unreadable or unusable', () => {
    expect(seedExcluded(facts({ excluded_in_use: inUse }), null).ok).toBe(false)
    expect(
      seedExcluded(facts({ excluded_in_use: inUse }), { state: 'ok', value: { '222222': { operation: 400, delivery: null } } }).ok,
    ).toBe(false)
  })
  it('empty when none in use', () => {
    expect(seedExcluded(facts({ excluded_in_use: [] }), null).ok).toBe(false)
  })
  it('failed read keeps the reason', () => {
    const r = seedExcluded(facts({ excluded_in_use: inUse }), { state: 'failed', reason: '读受众状态超时，先留空' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.why_empty).toBe('读受众状态超时，先留空')
  })
})

describe('audienceOwnedByAccount', () => {
  it('matches act_ and bare digits, rejects a different account or a missing owner', () => {
    expect(audienceOwnedByAccount('123', 'act_123')).toBe(true)
    expect(audienceOwnedByAccount('act_123', '123')).toBe(true)
    expect(audienceOwnedByAccount('999', 'act_123')).toBe(false)
    expect(audienceOwnedByAccount(undefined, 'act_123')).toBe(false)
    expect(audienceOwnedByAccount('', 'act_123')).toBe(false)
    expect(audienceOwnedByAccount('123', '')).toBe(false)
  })
})

describe('seedCreatives', () => {
  const ever = { kind: 'evergreen' } as const
  it('ready only for approved with covering window', () => {
    const r = seedCreatives(facts({ creative_pool: [{ ref: 'v1', status: 'approved', promo_window: ever }] }), PERIOD, NOW)
    expect(r.state).toBe('ready')
  })
  it('pending approval is never a pass', () => {
    const r = seedCreatives(facts({ creative_pool: [{ ref: 'v1', status: 'candidate', promo_window: ever }] }), PERIOD, NOW)
    expect(r.state).toBe('pending_approval')
    expect(r.refs.ok).toBe(false)
  })
  it('window mismatch, none, unreadable', () => {
    const expired = { kind: 'dated', start: '2026-01-01', end: '2026-02-01' } as const
    expect(seedCreatives(facts({ creative_pool: [{ ref: 'v1', status: 'approved', promo_window: expired }] }), PERIOD, NOW).state).toBe('window_mismatch')
    expect(seedCreatives(facts({ creative_pool: [] }), PERIOD, NOW).state).toBe('none')
    expect(seedCreatives(facts({}), PERIOD, NOW).state).toBe('unreadable')
  })
})

describe('seedSchedule', () => {
  it('uses the goal period; empty when missing or already ended', () => {
    expect(seedSchedule(PERIOD, NOW).ok).toBe(true)
    expect(seedSchedule(null, NOW).ok).toBe(false)
    expect(seedSchedule({ start_date: '2026-01-01', end_date: '2026-02-01' }, NOW).ok).toBe(false)
  })
  it('NaN facts time does not throw and leaves the schedule empty', () => {
    const r = seedSchedule(PERIOD, Number.NaN)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.why_empty).toBe('取数时间读不到，不猜起止日')
  })
})
