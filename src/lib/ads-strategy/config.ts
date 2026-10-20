/**
 * P21.K.5 — Ad Strategy Engine per-client configuration.
 *
 * Loads a client's control settings (on/off, digest routing), falling back to
 * safe defaults when no row exists so the engine works for a client the moment
 * they have a Meta account — no config step required to start.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { ME_MAIL_TO_ADDRESS } from '@/lib/email/sender'
import { parsePromoWindow, type PromoWindow } from './promo-window'

export type AutonomyMode = 'observe' | 'bounded_auto'
export type CreativePoolStatus = 'candidate' | 'approved'
export interface CreativePoolEntry {
  kind: 'meta_video' | 'work_order'
  ref: string
  status: CreativePoolStatus
  approved_by?: string
  approved_at?: string
  /** 推广期。缺失 = 未声明（不是长期有效）；未声明的素材不得批准入池、不得启用。 */
  promo_window?: PromoWindow
  /** 该素材在 Meta 上被广告实际引用的衍生视频 id / 帖子 id；匹配只认精确相等，不按名字或时长猜。 */
  alias_refs?: string[]
  /** 推广期是谁在什么时候设的 / 最后一次改动时间（ISO）。断路器用它区分「计划内到期」和「刚被改过」。 */
  promo_window_set_by?: string
  promo_window_set_at?: string
  promo_window_changed_at?: string
}

export interface AdStrategyConfig {
  client_id: string
  enabled: boolean
  digest_recipients: string[]
  daily_budget_cap_cents: number | null
  autonomy_mode: AutonomyMode
  creative_pool: CreativePoolEntry[]
  autopilot_enabled: boolean
  autopilot_dry_run: boolean
}

/**
 * Where a loaded config came from:
 *  - 'row'      an actual configured row
 *  - 'default'  no row exists (a fresh client — legitimately on)
 *  - 'fallback' the read FAILED, so `enabled` here is a guess, not the truth
 */
export type ConfigSource = 'row' | 'default' | 'fallback'

/** A config plus where it came from; `error` is set only when source is 'fallback'. */
export interface LoadedAdStrategyConfig {
  config: AdStrategyConfig
  source: ConfigSource
  error?: string
}

/** 缺行默认：引擎开、日报到全局收件箱；autonomy_mode 一律 observe（spec 2026-09-24 §14 M4：缺行按锁定处理，绝不默认放开动钱）。 */
export function defaultConfig(clientId: string): AdStrategyConfig {
  return {
    client_id: clientId,
    enabled: true,
    digest_recipients: [],
    daily_budget_cap_cents: null,
    autonomy_mode: 'observe',
    creative_pool: [],
    autopilot_enabled: false,
    autopilot_dry_run: true,
  }
}

const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

/** 素材池解析：只保留形状合法的条目，其余静默丢弃（坏数据不能让引擎投出没批准的素材）。 */
export function parseCreativePool(raw: unknown): CreativePoolEntry[] {
  if (!Array.isArray(raw)) return []

  const entries: CreativePoolEntry[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue

    const kind = 'kind' in item ? item.kind : undefined
    if (kind !== 'meta_video' && kind !== 'work_order') continue

    const ref = 'ref' in item ? item.ref : undefined
    if (typeof ref !== 'string' || ref.length === 0) continue

    const status = 'status' in item ? item.status : undefined
    if (status !== 'candidate' && status !== 'approved') continue

    const entry: CreativePoolEntry = { kind, ref, status }

    const approvedBy = 'approved_by' in item ? item.approved_by : undefined
    if (typeof approvedBy === 'string') entry.approved_by = approvedBy

    const approvedAt = 'approved_at' in item ? item.approved_at : undefined
    if (typeof approvedAt === 'string') entry.approved_at = approvedAt

    const promoWindow = 'promo_window' in item ? parsePromoWindow(item.promo_window) : null
    if (promoWindow !== null) entry.promo_window = promoWindow
    else if ('promo_window' in item && item.promo_window !== undefined && item.promo_window !== null) {
      // 库里有值但读不懂：按「未声明」处理（安全方向），但要留痕，不能静默丢。
      console.warn(`[ad-strategy] creative_pool entry ${ref}: promo_window is present but invalid, treated as undeclared`)
    }

    if ('promo_window_set_by' in item && typeof item.promo_window_set_by === 'string' && item.promo_window_set_by.length > 0) {
      entry.promo_window_set_by = item.promo_window_set_by
    }
    for (const key of ['promo_window_set_at', 'promo_window_changed_at'] as const) {
      const v = key in item ? item[key] : undefined
      // 时间戳必须是合法 ISO，别的值一律不要（防止乱写的字符串被当成「很久以前设的」）
      if (typeof v === 'string' && ISO_TIMESTAMP_RE.test(v) && !Number.isNaN(Date.parse(v))) entry[key] = v
    }

    const aliasRefs = 'alias_refs' in item ? item.alias_refs : undefined
    if (Array.isArray(aliasRefs)) {
      const cleaned = [...new Set(aliasRefs.filter((a): a is string => typeof a === 'string' && a.length > 0))]
      if (cleaned.length > 0) entry.alias_refs = cleaned
    }

    entries.push(entry)
  }

  return entries
}

/**
 * Load one client's config with provenance. Never throws.
 *
 * Fail-open is asymmetric on purpose (魏征): a config-table hiccup must not lose
 * data collection, so on error we still return enabled=true — but we mark it
 * `fallback` so the caller can be conservative about the IRREVERSIBLE side
 * (sending email). A client an FDE deliberately paused must not be silently
 * re-opened and emailed because of a transient read error.
 */
export async function loadAdStrategyConfigWithSource(
  clientId: string,
): Promise<LoadedAdStrategyConfig> {
  const { data, error } = await supabaseAdmin
    .from('ad_strategy_configs')
    .select('client_id, enabled, digest_recipients, daily_budget_cap_cents, autonomy_mode, creative_pool, autopilot_enabled, autopilot_dry_run')
    .eq('client_id', clientId)
    .maybeSingle()

  if (error) {
    console.warn(`[ad-strategy] config read failed for ${clientId}, falling back to enabled:`, error.message)
    // 2026-09-25 事故：代码先上线、加列的 migration 晚一天才 apply，这里每次读都 400，
    // 调用方据 'fallback' 静默跳过了所有客户的诊断。把原始报错带出去，让调用方能喊出来。
    return { config: defaultConfig(clientId), source: 'fallback', error: error.message }
  }
  if (!data) return { config: defaultConfig(clientId), source: 'default' }

  return {
    config: {
      client_id: clientId,
      enabled: data.enabled ?? true,
      digest_recipients: Array.isArray(data.digest_recipients) ? data.digest_recipients : [],
      daily_budget_cap_cents:
        typeof data.daily_budget_cap_cents === 'number' &&
        Number.isFinite(data.daily_budget_cap_cents) &&
        data.daily_budget_cap_cents > 0
          ? data.daily_budget_cap_cents
          : null,
      autonomy_mode: data.autonomy_mode === 'bounded_auto' ? 'bounded_auto' : 'observe',
      creative_pool: parseCreativePool(data.creative_pool),
      autopilot_enabled: data.autopilot_enabled === true,
      autopilot_dry_run: data.autopilot_dry_run !== false,
    },
    source: 'row',
  }
}

/** Convenience wrapper for readers that don't care about provenance (e.g. the API). */
export async function loadAdStrategyConfig(clientId: string): Promise<AdStrategyConfig> {
  return (await loadAdStrategyConfigWithSource(clientId)).config
}

/**
 * Resolve the recipients for a client's digest: their configured list, or the
 * global ME inbox when none is set.
 */
export function resolveDigestRecipients(config: AdStrategyConfig): string[] {
  if (config.digest_recipients.length > 0) return config.digest_recipients
  return [process.env.AD_HEALTH_DIGEST_TO || ME_MAIL_TO_ADDRESS]
}

/**
 * 设置行的「版本」：用 updated_at 当乐观锁（所有写设置的入口都会刷新它）。
 * 素材池是整数组读改写，没有版本比较时并发的两次保存会互相覆盖。
 * 🔴 先读版本、再读内容：中间有人写，版本就对不上 → 冲突（安全方向）。
 */
export interface ConfigVersion {
  exists: boolean
  updatedAt: string | null
}

export async function loadConfigVersion(
  clientId: string,
): Promise<{ ok: true; version: ConfigVersion } | { ok: false; error: string }> {
  const { data, error } = await supabaseAdmin
    .from('ad_strategy_configs')
    .select('updated_at')
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: true, version: { exists: false, updatedAt: null } }
  const updatedAt = (data as { updated_at?: unknown }).updated_at
  return { ok: true, version: { exists: true, updatedAt: typeof updatedAt === 'string' ? updatedAt : null } }
}

/**
 * 一次读出「内容 + 版本」，顺序必须是先版本、后内容。
 * 反过来（先内容、后版本）会拿到「旧内容 + 新版本号」：别人在这两步之间写入，
 * 我们却以为版本没变，后续保存会静默覆盖别人的改动。
 *
 * 🔴 内容读失败必须报错，不能悄悄回落默认配置：默认配置的素材池是空数组，
 * 配上合法的版本号，界面会显示「还没有视频」；用户随手加一个编号保存，
 * 就会按整数组替换把已批准的素材全删光——不可逆。所以这里用
 * loadAdStrategyConfigWithSource 区分「读成功」和「读失败回落」。
 */
export async function loadConfigWithVersion(
  clientId: string,
): Promise<{ ok: true; config: AdStrategyConfig; version: string | null } | { ok: false; error: string }> {
  const loadedVersion = await loadConfigVersion(clientId)
  if (!loadedVersion.ok) return { ok: false, error: loadedVersion.error }
  const loaded = await loadAdStrategyConfigWithSource(clientId)
  if (loaded.source === 'fallback') {
    return { ok: false, error: loaded.error ?? '读设置失败' }
  }
  const version = loadedVersion.version.exists ? loadedVersion.version.updatedAt : null
  return { ok: true, config: loaded.config, version }
}

export type ConfigWriteResult =
  | { ok: true; updatedAt: string }
  | { ok: false; kind: 'conflict' | 'error'; message: string }

/** 只在版本没变时写；没有行就插入（并发插入撞唯一键 = 冲突）。 */
export async function writeConfigCas(
  clientId: string,
  fields: Record<string, unknown>,
  version: ConfigVersion,
): Promise<ConfigWriteResult> {
  // updated_at 一律在写入这一刻取，调用方传的一律忽略（防止调用方传旧时间让版本倒退）。
  // 且必须严格大于读到的版本：时钟回拨时把 stamp 顶到 version.updatedAt + 1ms，保证单调递增。
  let stamp = new Date().toISOString()
  if (version.updatedAt !== null) {
    const prev = Date.parse(version.updatedAt)
    if (!Number.isNaN(prev) && Date.parse(stamp) <= prev) {
      stamp = new Date(prev + 1).toISOString()
    }
  }
  const row = { ...fields, updated_at: stamp }
  if (!version.exists) {
    const { error } = await supabaseAdmin.from('ad_strategy_configs').insert({ client_id: clientId, ...row })
    if (!error) return { ok: true, updatedAt: stamp }
    if ((error as { code?: string }).code === '23505') return { ok: false, kind: 'conflict', message: error.message }
    return { ok: false, kind: 'error', message: error.message }
  }
  const base = supabaseAdmin.from('ad_strategy_configs').update(row).eq('client_id', clientId)
  const guarded = version.updatedAt === null ? base.is('updated_at', null) : base.eq('updated_at', version.updatedAt)
  const { data, error } = await guarded.select('client_id')
  if (error) return { ok: false, kind: 'error', message: error.message }
  if (!data || data.length !== 1) return { ok: false, kind: 'conflict', message: 'creative_pool changed concurrently' }
  return { ok: true, updatedAt: stamp }
}
