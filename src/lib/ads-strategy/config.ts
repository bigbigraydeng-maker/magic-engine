/**
 * P21.K.5 — Ad Strategy Engine per-client configuration.
 *
 * Loads a client's control settings (on/off, digest routing), falling back to
 * safe defaults when no row exists so the engine works for a client the moment
 * they have a Meta account — no config step required to start.
 */

import { supabaseAdmin } from '@/lib/supabase'

export interface AdStrategyConfig {
  client_id: string
  enabled: boolean
  digest_recipients: string[]
}

/**
 * Where a loaded config came from:
 *  - 'row'      an actual configured row
 *  - 'default'  no row exists (a fresh client — legitimately on)
 *  - 'fallback' the read FAILED, so `enabled` here is a guess, not the truth
 */
export type ConfigSource = 'row' | 'default' | 'fallback'

/** Default when a client has no config row: on, digest to the global inbox. */
export function defaultConfig(clientId: string): AdStrategyConfig {
  return { client_id: clientId, enabled: true, digest_recipients: [] }
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
    .select('client_id, enabled, digest_recipients')
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
  return [process.env.AD_HEALTH_DIGEST_TO || 'raydeng@magicengine.com.au']
}
