import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  FACTORY_REEL_DRAFT_MODES,
  parseFactoryReelDraftConfig,
  loadFactoryReelDraftConfig,
  isMissingColumnError,
} from '../config'
import { MAX_AUTO_DAILY_BUDGET, MAX_DURATION_DAYS } from '../../ad-draft'

const VALID_RAW = {
  mode: 'on',
  geo_countries: ['NZ'],
  geo_city_keys: ['2700001'],
  age_min: 25,
  age_max: 55,
  daily_budget: 20,
  duration_days: 7,
  max_age_hours: 24,
  updated_by: 'pm@example.com',
  updated_at: '2026-10-09T00:00:00Z',
}

describe('parseFactoryReelDraftConfig', () => {
  it('happy path: maps snake_case to camelCase and keeps all fields', () => {
    const res = parseFactoryReelDraftConfig(VALID_RAW)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.config).toEqual({
      mode: 'on',
      geoCountries: ['NZ'],
      geoCityKeys: ['2700001'],
      ageMin: 25,
      ageMax: 55,
      dailyBudget: 20,
      durationDays: 7,
      maxAgeHours: 24,
      updatedBy: 'pm@example.com',
      updatedAt: '2026-10-09T00:00:00Z',
    })
  })

  it('defaults geo_city_keys to [] when absent', () => {
    const { geo_city_keys: _omit, ...rest } = VALID_RAW
    const res = parseFactoryReelDraftConfig(rest)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.config.geoCityKeys).toEqual([])
  })

  it('defaults updated_by / updated_at to null when absent', () => {
    const { updated_by: _b, updated_at: _a, ...rest } = VALID_RAW
    const res = parseFactoryReelDraftConfig(rest)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.config.updatedBy).toBeNull()
    expect(res.config.updatedAt).toBeNull()
  })

  it('rejects mode "maybe"', () => {
    const res = parseFactoryReelDraftConfig({ ...VALID_RAW, mode: 'maybe' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('mode')
  })

  it('rejects empty geo_countries', () => {
    const res = parseFactoryReelDraftConfig({ ...VALID_RAW, geo_countries: [] })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('geo_countries')
  })

  it('rejects lowercase country code', () => {
    const res = parseFactoryReelDraftConfig({ ...VALID_RAW, geo_countries: ['nz'] })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('geo_countries')
  })

  it('rejects more than 5 countries', () => {
    const res = parseFactoryReelDraftConfig({
      ...VALID_RAW,
      geo_countries: ['NZ', 'AU', 'US', 'GB', 'CA', 'IE'],
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('geo_countries')
  })

  it('rejects age_min 17', () => {
    const res = parseFactoryReelDraftConfig({ ...VALID_RAW, age_min: 17 })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('age_min')
  })

  it('rejects age_max below age_min', () => {
    const res = parseFactoryReelDraftConfig({ ...VALID_RAW, age_min: 40, age_max: 30 })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('age_max')
  })

  it('rejects age_max 66', () => {
    const res = parseFactoryReelDraftConfig({ ...VALID_RAW, age_max: 66 })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('age_max')
  })

  it('rejects daily_budget 0', () => {
    const res = parseFactoryReelDraftConfig({ ...VALID_RAW, daily_budget: 0 })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('daily_budget')
  })

  it('rejects daily_budget 0.004', () => {
    const res = parseFactoryReelDraftConfig({ ...VALID_RAW, daily_budget: 0.004 })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('daily_budget')
  })

  it('rejects daily_budget 0.5', () => {
    const res = parseFactoryReelDraftConfig({ ...VALID_RAW, daily_budget: 0.5 })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('daily_budget')
  })

  it('rejects daily_budget 1.5', () => {
    const res = parseFactoryReelDraftConfig({ ...VALID_RAW, daily_budget: 1.5 })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('daily_budget')
  })

  it('accepts daily_budget 1', () => {
    const res = parseFactoryReelDraftConfig({ ...VALID_RAW, daily_budget: 1 })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.config.dailyBudget).toBe(1)
  })

  it('accepts daily_budget MAX_AUTO_DAILY_BUDGET', () => {
    const res = parseFactoryReelDraftConfig({ ...VALID_RAW, daily_budget: MAX_AUTO_DAILY_BUDGET })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.config.dailyBudget).toBe(MAX_AUTO_DAILY_BUDGET)
  })

  it('rejects daily_budget above MAX_AUTO_DAILY_BUDGET', () => {
    const res = parseFactoryReelDraftConfig({ ...VALID_RAW, daily_budget: MAX_AUTO_DAILY_BUDGET + 1 })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('daily_budget')
  })

  it('rejects daily_budget NaN', () => {
    const res = parseFactoryReelDraftConfig({ ...VALID_RAW, daily_budget: Number.NaN })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('daily_budget')
  })

  it('rejects daily_budget as string "10"', () => {
    const res = parseFactoryReelDraftConfig({ ...VALID_RAW, daily_budget: '10' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('daily_budget')
  })

  it('rejects duration_days 0', () => {
    const res = parseFactoryReelDraftConfig({ ...VALID_RAW, duration_days: 0 })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('duration_days')
  })

  it('rejects duration_days above MAX_DURATION_DAYS', () => {
    const res = parseFactoryReelDraftConfig({ ...VALID_RAW, duration_days: MAX_DURATION_DAYS + 1 })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('duration_days')
  })

  it('rejects duration_days 2.5', () => {
    const res = parseFactoryReelDraftConfig({ ...VALID_RAW, duration_days: 2.5 })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('duration_days')
  })

  it('rejects max_age_hours 0', () => {
    const res = parseFactoryReelDraftConfig({ ...VALID_RAW, max_age_hours: 0 })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('max_age_hours')
  })

  it('rejects max_age_hours 73', () => {
    const res = parseFactoryReelDraftConfig({ ...VALID_RAW, max_age_hours: 73 })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('max_age_hours')
  })

  it('rejects raw null', () => {
    const res = parseFactoryReelDraftConfig(null)
    expect(res.ok).toBe(false)
  })

  it('rejects raw array', () => {
    const res = parseFactoryReelDraftConfig([])
    expect(res.ok).toBe(false)
  })

  it('rejects raw string', () => {
    const res = parseFactoryReelDraftConfig('nope')
    expect(res.ok).toBe(false)
  })

  it('exposes the three modes', () => {
    expect(FACTORY_REEL_DRAFT_MODES).toEqual(['off', 'dry_run', 'on'])
  })
})

interface Canned {
  data: unknown
  error: { code?: string; message?: string } | null
}

/** 最小假 supabase：链式 from().select().eq().maybeSingle() 返回罐头结果。 */
function fakeSupabase(canned: Canned | (() => never)): SupabaseClient {
  const maybeSingle = typeof canned === 'function'
    ? canned
    : () => Promise.resolve(canned)
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle,
  }
  const client = {
    from: () => chain,
  }
  return client as unknown as SupabaseClient
}

describe('loadFactoryReelDraftConfig', () => {
  it('row ok => source row, effectiveMode equals config.mode', async () => {
    const res = await loadFactoryReelDraftConfig(
      fakeSupabase({ data: { factory_reel_ad_draft: VALID_RAW }, error: null }),
      'client-1',
    )
    expect(res.source).toBe('row')
    expect(res.effectiveMode).toBe('on')
    expect(res.config?.mode).toBe('on')
  })

  it('stored mode dry_run => effectiveMode dry_run', async () => {
    const res = await loadFactoryReelDraftConfig(
      fakeSupabase({ data: { factory_reel_ad_draft: { ...VALID_RAW, mode: 'dry_run' } }, error: null }),
      'client-1',
    )
    expect(res.source).toBe('row')
    expect(res.effectiveMode).toBe('dry_run')
  })

  it('mode on but invalid field => invalid_value and effectiveMode off', async () => {
    const res = await loadFactoryReelDraftConfig(
      fakeSupabase({ data: { factory_reel_ad_draft: { ...VALID_RAW, age_min: 17 } }, error: null }),
      'client-1',
    )
    expect(res.source).toBe('invalid_value')
    expect(res.effectiveMode).toBe('off')
    expect(res.config).toBeNull()
    expect(res.error).toContain('age_min')
  })

  it('data null => no_row off', async () => {
    const res = await loadFactoryReelDraftConfig(
      fakeSupabase({ data: null, error: null }),
      'client-1',
    )
    expect(res.source).toBe('no_row')
    expect(res.effectiveMode).toBe('off')
    expect(res.config).toBeNull()
  })

  it('column value null => no_row off', async () => {
    const res = await loadFactoryReelDraftConfig(
      fakeSupabase({ data: { factory_reel_ad_draft: null }, error: null }),
      'client-1',
    )
    expect(res.source).toBe('no_row')
    expect(res.effectiveMode).toBe('off')
  })

  it('error code 42703 => column_missing off', async () => {
    const res = await loadFactoryReelDraftConfig(
      fakeSupabase({ data: null, error: { code: '42703', message: 'column does not exist' } }),
      'client-1',
    )
    expect(res.source).toBe('column_missing')
    expect(res.effectiveMode).toBe('off')
  })

  it('error code XX000 => read_error off', async () => {
    const res = await loadFactoryReelDraftConfig(
      fakeSupabase({ data: null, error: { code: 'XX000', message: 'boom' } }),
      'client-1',
    )
    expect(res.source).toBe('read_error')
    expect(res.effectiveMode).toBe('off')
    expect(res.error).toBe('boom')
  })

  it('maybeSingle throws => read_error off', async () => {
    const res = await loadFactoryReelDraftConfig(
      fakeSupabase(() => { throw new Error('network down') }),
      'client-1',
    )
    expect(res.source).toBe('read_error')
    expect(res.effectiveMode).toBe('off')
    expect(res.error).toBe('network down')
  })
})

describe('isMissingColumnError', () => {
  it('true for PGRST204', () => {
    expect(isMissingColumnError({ code: 'PGRST204' })).toBe(true)
  })

  it('true for 42703', () => {
    expect(isMissingColumnError({ code: '42703' })).toBe(true)
  })

  it('true for a matching message', () => {
    expect(isMissingColumnError({ message: 'Could not find the factory_reel_ad_draft column' })).toBe(true)
  })

  it('false for an unrelated error', () => {
    expect(isMissingColumnError({ code: 'XX000', message: 'boom' })).toBe(false)
  })
})
