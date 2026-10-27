import { describe, expect, it } from 'vitest'
import type { AdsDraftFacts } from '@/lib/marketing-plan/promo/draft-ads'
import { seedAudience, seedCreatives, seedExcluded, seedSchedule } from '../audience-creative'

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

const pool = [{ ref: '111111', name: 'A', size_lower: 50, last_used_on: '2026-10-20', as_of: null }]

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
  it('non-retarget plays get no audience', () => {
    expect(seedAudience('lead_form_harvest', facts({ audiences: pool }), null).ids.ok).toBe(false)
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
})
