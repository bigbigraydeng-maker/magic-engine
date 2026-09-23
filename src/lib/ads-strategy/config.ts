/**
 * P21.K.5 — Ad Strategy Engine per-client configuration.
 *
 * Loads a client's control settings (on/off, digest routing), falling back to
 * safe defaults when no row exists so the engine works for a client the moment
 * they have a Meta account — no config step required to start.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { ME_MAIL_TO_ADDRESS } from '@/lib/email/sender'

export type AutonomyMode = 'observe' | 'bounded_auto'
export type CreativePoolStatus = 'candidate' | 'approved'
export interface CreativePoolEntry {
  kind: 'meta_video' | 'work_order'
  ref: string
  status: CreativePoolStatus
  approved_by?: string
  approved_at?: string
}

export interface AdStrategyConfig {
  client_id: string
  enabled: boolean
  digest_recipients: string[]
  daily_budget_cap_cents: number | null
  autonomy_mode: AutonomyMode
  creative_pool: CreativePoolEntry[]
}

/**
 * Where a loaded config came from:
 *  - 'row'      an actual configured row
 *  - 'default'  no row exists (a fresh client — legitimately on)
 *  - 'fallback' the read FAILED, so `enabled` here is a guess, not the truth
 */
export type ConfigSource = 'row' | 'default' | 'fallback'

/** 缺行默认：引擎开、日报到全局收件箱；autonomy_mode 一律 observe（spec 2026-09-24 §14 M4：缺行按锁定处理，绝不默认放开动钱）。 */
export function defaultConfig(clientId: string): AdStrategyConfig {
  return {
    client_id: clientId,
    enabled: true,
    digest_recipients: [],
    daily_budget_cap_cents: null,
    autonomy_mode: 'observe',
    creative_pool: [],
  }
}

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
): Promise<{ config: AdStrategyConfig; source: ConfigSource }> {
  const { data, error } = await supabaseAdmin
    .from('ad_strategy_configs')
    .select('client_id, enabled, digest_recipients, daily_budget_cap_cents, autonomy_mode, creative_pool')
    .eq('client_id', clientId)
    .maybeSingle()

  if (error) {
    console.warn(`[ad-strategy] config read failed for ${clientId}, falling back to enabled:`, error.message)
    return { config: defaultConfig(clientId), source: 'fallback' }
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
