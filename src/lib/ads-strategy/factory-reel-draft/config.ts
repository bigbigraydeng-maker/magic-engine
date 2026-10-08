/**
 * 工厂 Reel 自动起草广告 · 每客户开关 + 参数（读写）。
 *
 * ── 为什么单独一个 loader，不并进 outcome-config ──────────────────────────
 * 这一列（`ad_strategy_configs.factory_reel_ad_draft`）是后加的。如果把它塞进
 * 任何「一次 select 好几列」的共享 loader，那么代码先上线、migration 后 apply 的
 * 窗口里，**所有**读那张表的调用都会因为「列不存在」而挂 —— 不只是这个功能。
 * 所以这里只 select 这一列，读失败也只影响这一个功能。
 *
 * ── 失败一律当「关」────────────────────────────────────────────────────
 * 读不到 / 列还没建 / 值被手改坏 → `effectiveMode` 一律 `'off'`。
 * 自动花钱的事，读不清就是不做，绝不猜、绝不回落默认参数。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { MAX_AUTO_DAILY_BUDGET, MAX_DURATION_DAYS } from '../ad-draft'

export const FACTORY_REEL_DRAFT_MODES = ['off', 'dry_run', 'on'] as const
export type FactoryReelDraftMode = (typeof FACTORY_REEL_DRAFT_MODES)[number]

export interface FactoryReelDraftConfig {
  mode: FactoryReelDraftMode
  geoCountries: string[]
  geoCityKeys: string[]
  ageMin: number
  ageMax: number
  dailyBudget: number
  durationDays: number
  maxAgeHours: number
  updatedBy: string | null
  updatedAt: string | null
}

export type ParseResult =
  | { ok: true; config: FactoryReelDraftConfig }
  | { ok: false; error: string }

const MAX_GEO_COUNTRIES = 5
const MAX_GEO_CITY_KEYS = 20
const MIN_AGE = 18
const MAX_AGE = 65
const MIN_MAX_AGE_HOURS = 1
const MAX_MAX_AGE_HOURS = 72

const COUNTRY_CODE = /^[A-Z]{2}$/

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isMode(v: unknown): v is FactoryReelDraftMode {
  return typeof v === 'string' && (FACTORY_REEL_DRAFT_MODES as readonly string[]).includes(v)
}

/**
 * 解析存库 / 请求体里的对象（snake_case 键）。
 *
 * 除了 `geo_city_keys`（缺省 `[]`），**没有任何默认值** —— 少一个字段就是配置不完整，
 * 报错让人去补，而不是替人决定每天花多少钱。
 */
export function parseFactoryReelDraftConfig(raw: unknown): ParseResult {
  if (!isPlainObject(raw)) {
    return { ok: false, error: '配置必须是一个对象' }
  }

  if (!isMode(raw.mode)) {
    return { ok: false, error: `mode 必须是 ${FACTORY_REEL_DRAFT_MODES.join(' / ')} 之一` }
  }

  const geoCountries = raw.geo_countries
  if (!Array.isArray(geoCountries) || geoCountries.length === 0) {
    return { ok: false, error: 'geo_countries 必须是非空数组' }
  }
  if (geoCountries.length > MAX_GEO_COUNTRIES) {
    return { ok: false, error: `geo_countries 最多 ${MAX_GEO_COUNTRIES} 个` }
  }
  for (const c of geoCountries) {
    if (typeof c !== 'string' || !COUNTRY_CODE.test(c)) {
      return { ok: false, error: 'geo_countries 里每一项都要是两位大写国家代码（如 NZ）' }
    }
  }

  const rawCityKeys = raw.geo_city_keys
  let geoCityKeys: string[] = []
  if (rawCityKeys !== undefined) {
    if (!Array.isArray(rawCityKeys)) {
      return { ok: false, error: 'geo_city_keys 必须是数组' }
    }
    if (rawCityKeys.length > MAX_GEO_CITY_KEYS) {
      return { ok: false, error: `geo_city_keys 最多 ${MAX_GEO_CITY_KEYS} 个` }
    }
    for (const k of rawCityKeys) {
      if (typeof k !== 'string' || k.trim() === '') {
        return { ok: false, error: 'geo_city_keys 里每一项都要是非空字符串' }
      }
    }
    geoCityKeys = rawCityKeys as string[]
  }

  const ageMin = raw.age_min
  if (typeof ageMin !== 'number' || !Number.isInteger(ageMin) || ageMin < MIN_AGE || ageMin > MAX_AGE) {
    return { ok: false, error: `age_min 必须是 ${MIN_AGE}..${MAX_AGE} 的整数` }
  }

  const ageMax = raw.age_max
  if (typeof ageMax !== 'number' || !Number.isInteger(ageMax) || ageMax < ageMin || ageMax > MAX_AGE) {
    return { ok: false, error: `age_max 必须是 ${ageMin}..${MAX_AGE} 的整数，且不小于 age_min` }
  }

  const dailyBudget = raw.daily_budget
  if (typeof dailyBudget !== 'number' || !Number.isInteger(dailyBudget) || dailyBudget < 1 || dailyBudget > MAX_AUTO_DAILY_BUDGET) {
    return { ok: false, error: `daily_budget 必须是 1 到 ${MAX_AUTO_DAILY_BUDGET} 之间的整数` }
  }

  const durationDays = raw.duration_days
  if (typeof durationDays !== 'number' || !Number.isInteger(durationDays) || durationDays < 1 || durationDays > MAX_DURATION_DAYS) {
    return { ok: false, error: `duration_days 必须是 1..${MAX_DURATION_DAYS} 的整数` }
  }

  const maxAgeHours = raw.max_age_hours
  if (typeof maxAgeHours !== 'number' || !Number.isInteger(maxAgeHours) || maxAgeHours < MIN_MAX_AGE_HOURS || maxAgeHours > MAX_MAX_AGE_HOURS) {
    return { ok: false, error: `max_age_hours 必须是 ${MIN_MAX_AGE_HOURS}..${MAX_MAX_AGE_HOURS} 的整数` }
  }

  const updatedBy = raw.updated_by === undefined || raw.updated_by === null
    ? null
    : typeof raw.updated_by === 'string' ? raw.updated_by : null
  const updatedAt = raw.updated_at === undefined || raw.updated_at === null
    ? null
    : typeof raw.updated_at === 'string' ? raw.updated_at : null

  return {
    ok: true,
    config: {
      mode: raw.mode,
      geoCountries: geoCountries as string[],
      geoCityKeys,
      ageMin,
      ageMax,
      dailyBudget,
      durationDays,
      maxAgeHours,
      updatedBy,
      updatedAt,
    },
  }
}

export type ConfigSource = 'row' | 'no_row' | 'column_missing' | 'read_error' | 'invalid_value'

export interface LoadedFactoryReelDraftConfig {
  config: FactoryReelDraftConfig | null
  effectiveMode: FactoryReelDraftMode
  source: ConfigSource
  error?: string
}

/** 列还没建（migration 未 apply）时的报错特征。路由也复用这个判断。 */
export function isMissingColumnError(err: { code?: string; message?: string }): boolean {
  if (err.code === 'PGRST204' || err.code === '42703') return true
  const msg = err.message ?? ''
  return /could not find the .* column|column .* does not exist/i.test(msg)
}

/**
 * 读一个客户的工厂 Reel 起草配置。
 *
 * 客户端是**注入**的（不 import supabaseAdmin）：测试能塞假对象，路由能塞自己的客户端。
 * 除了 `source === 'row'`，`effectiveMode` 一律 `'off'` —— 这是整个模块的重点。
 */
export async function loadFactoryReelDraftConfig(
  supabase: SupabaseClient,
  clientId: string,
): Promise<LoadedFactoryReelDraftConfig> {
  try {
    const { data, error } = await supabase
      .from('ad_strategy_configs')
      .select('factory_reel_ad_draft')
      .eq('client_id', clientId)
      .maybeSingle()

    if (error) {
      if (isMissingColumnError(error)) {
        return { config: null, effectiveMode: 'off', source: 'column_missing', error: error.message }
      }
      return { config: null, effectiveMode: 'off', source: 'read_error', error: error.message }
    }

    if (!data) {
      return { config: null, effectiveMode: 'off', source: 'no_row' }
    }

    const raw = (data as Record<string, unknown>).factory_reel_ad_draft
    if (raw === null || raw === undefined) {
      return { config: null, effectiveMode: 'off', source: 'no_row' }
    }

    const parsed = parseFactoryReelDraftConfig(raw)
    if (!parsed.ok) {
      return { config: null, effectiveMode: 'off', source: 'invalid_value', error: parsed.error }
    }

    return { config: parsed.config, effectiveMode: parsed.config.mode, source: 'row' }
  } catch (err) {
    return {
      config: null,
      effectiveMode: 'off',
      source: 'read_error',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
