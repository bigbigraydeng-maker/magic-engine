import { describe, expect, it } from 'vitest'
import type { AdsDraftFacts, AudiencePoolItem } from '@/lib/marketing-plan/promo/draft-ads'
import { isRemarketingSubtype } from '../../portfolio/roles'
import {
  audienceIdsToRead,
  audienceOwnedByAccount,
  seedAudience,
  seedCreatives,
  seedExcluded,
  seedSchedule,
  seedStepAudiences,
  type AudienceStatus,
  type AudienceStatusRead,
} from '../audience-creative'
const NOW = Date.parse('2026-10-27T00:00:00Z')
const PERIOD = { start_date: '2026-11-01', end_date: '2026-11-30' }
const OK: AudienceStatus = { operation: 200, delivery: 200 }
function facts(over: Partial<AdsDraftFacts>): AdsDraftFacts {
  return {
    today: '2026-10-27', headroom: { ok: false, reason: 'x' }, account_delivering_minor: null,
    account_cap_minor: null, committed_minor: 0, daily: null, insights_as_of: null, audiences: null,
    audiences_complete: null, approved_creatives: null, budget_share_of_headroom: 0.5,
    min_audience_size: 1000, max_creatives: 3, ...over,
  }
}
function aud(ref: string, subtype: string | null, last_used_on: string, name = ref, size_lower = 100): AudiencePoolItem {
  return { ref, name, size_lower, last_used_on, as_of: null, subtype }
}
function status(ids: Record<string, AudienceStatus>): AudienceStatusRead {
  return { state: 'ok', value: ids }
}
const pool = [aud('111111', 'ENGAGEMENT', '2026-10-20', 'A', 50)]
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
    const r = seedAudience('warm_pool_retarget', facts({ audiences: pool }), status({ '111111': OK }))
    expect(r.state).toBe('read')
    expect(r.ids.ok && r.ids.value).toEqual(['111111'])
  })
  it('unusable: status not 200 leaves it empty', () => {
    const r = seedAudience('warm_pool_retarget', facts({ audiences: pool }), status({ '111111': { operation: 400, delivery: 200 } }))
    expect(r.state).toBe('unusable')
    expect(r.ids.ok).toBe(false)
  })
  it('unreadable: no pool or no status read', () => {
    expect(seedAudience('warm_pool_retarget', facts({}), null).state).toBe('unreadable')
    expect(seedAudience('warm_pool_retarget', facts({ audiences: pool }), null).state).toBe('unreadable')
  })
  it('failed read keeps the reason, including a timeout', () => {
    const r = seedAudience('warm_pool_retarget', facts({ audiences: pool }), { state: 'failed', reason: '读受众状态超时，先留空' })
    expect(r.state).toBe('unreadable')
    if (!r.ids.ok) expect(r.ids.why_empty).toBe('读受众状态超时，先留空')
  })
  it('non-retarget plays get no audience', () => {
    expect(seedAudience('lead_form_harvest', facts({ audiences: pool }), null).ids.ok).toBe(false)
  })
  it('picks the warm subtype, not a more recently used lookalike', () => {
    const audiences = [aud('111111', 'LOOKALIKE', '2026-10-26', 'Similar', 9000), aud('444444', 'ENGAGEMENT', '2026-10-01', 'Engaged', 400)]
    const r = seedAudience('warm_pool_retarget', facts({ audiences }), status({ '111111': OK, '444444': OK }))
    expect(r.state).toBe('read')
    expect(r.ids.ok && r.ids.value).toEqual(['444444'])
    expect(audienceIdsToRead('warm_pool_retarget', facts({ audiences }))).toEqual(['444444'])
  })
  it('still reads a warm audience when lookalikes fill the status slots', () => {
    const audiences = [
      aud('111111', 'LOOKALIKE', '2026-10-26', 'Similar', 9000),
      aud('222222', 'LOOKALIKE', '2026-10-25', 'Similar 2', 8000),
      aud('333333', 'LOOKALIKE', '2026-10-24', 'Similar 3', 7000),
      aud('444444', 'ENGAGEMENT', '2026-10-01', 'Engaged', 400),
    ]
    const r = seedAudience('warm_pool_retarget', facts({ audiences }), status({ '111111': OK, '222222': OK, '333333': OK, '444444': OK }))
    expect(r.ids.ok && r.ids.value).toEqual(['444444'])
    expect(audienceIdsToRead('warm_pool_retarget', facts({ audiences, excluded_in_use: [{ ref: '111111', adsets: 1 }] }))).toEqual(['444444', '111111'])
  })
  it('leaves warm retarget empty when nothing is a remarketing subtype', () => {
    const audiences = [aud('111111', 'LOOKALIKE', '2026-10-26', 'Similar', 9000), aud('555555', null, '2026-10-20', 'Unknown')]
    const r = seedAudience('warm_pool_retarget', facts({ audiences }), status({ '111111': OK, '555555': OK }))
    expect(r.state).toBe('unusable')
    if (!r.ids.ok) expect(r.ids.why_empty).toContain('再营销')
    expect(audienceIdsToRead('warm_pool_retarget', facts({ audiences }))).toEqual([])
  })
  it('drops a warm audience from the exclusion list when no other warm candidate is usable', () => {
    const audiences = [aud('111111', 'ENGAGEMENT', '2026-10-20', 'Warm', 800), aud('222222', 'CUSTOM', '2026-10-01', 'List', 400)]
    const paired = seedStepAudiences('warm_pool_retarget', facts({
      audiences,
      excluded_in_use: [{ ref: '111111', adsets: 2 }, { ref: '333333', adsets: 1 }],
    }), status({ '111111': OK, '222222': { operation: 400, delivery: 200 }, '333333': OK }))
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
    const r = seedExcluded(facts({ excluded_in_use: inUse }), status({ '222222': OK }))
    expect(r.ok && r.value).toEqual(['222222'])
  })
  it('fails closed when status unreadable or unusable', () => {
    expect(seedExcluded(facts({ excluded_in_use: inUse }), null).ok).toBe(false)
    expect(seedExcluded(facts({ excluded_in_use: inUse }), status({ '222222': { operation: 400, delivery: null } })).ok).toBe(false)
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
    expect(seedCreatives(facts({ creative_pool: [{ ref: 'v1', status: 'approved', promo_window: ever }] }), PERIOD, NOW).state).toBe('ready')
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
