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

/** Default when a client has no config row: on, digest to the global inbox. */
export function defaultConfig(clientId: string): AdStrategyConfig {
  return { client_id: clientId, enabled: true, digest_recipients: [] }
}

/**
 * Load one client's config, or defaults. Never throws — on a read error it
 * returns defaults (fail-open: a config-table hiccup must not silently disable
 * a client's monitoring).
 */
export async function loadAdStrategyConfig(clientId: string): Promise<AdStrategyConfig> {
  const { data, error } = await supabaseAdmin
    .from('ad_strategy_configs')
    .select('client_id, enabled, digest_recipients')
    .eq('client_id', clientId)
    .maybeSingle()

  if (error || !data) return defaultConfig(clientId)
  return {
    client_id: clientId,
    enabled: data.enabled ?? true,
    digest_recipients: Array.isArray(data.digest_recipients) ? data.digest_recipients : [],
  }
}

/**
 * Resolve the recipients for a client's digest: their configured list, or the
 * global ME inbox when none is set.
 */
export function resolveDigestRecipients(config: AdStrategyConfig): string[] {
  if (config.digest_recipients.length > 0) return config.digest_recipients
  return [process.env.AD_HEALTH_DIGEST_TO || 'raydeng@magicengine.com.au']
}
