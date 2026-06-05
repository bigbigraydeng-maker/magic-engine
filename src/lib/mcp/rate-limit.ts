/**
 * MCP rate limiting (Phase 34 / P34.5).
 *
 * Counts rows in mcp_access_log for this key in the last RATE_WINDOW_SEC and
 * rejects once over RATE_LIMIT. Using the access log as the counter (子牙 B3)
 * keeps it correct across multiple Render instances — no single-instance
 * in-memory LRU that breaks on scale-out.
 *
 * Note: mcp_access_log is written fire-and-forget by logMcpAccess AFTER a tool
 * runs, so the window is approximate (a burst within the same tick can slip a
 * few through before rows land). That's an acceptable tradeoff for a read-only
 * surface — the goal is abuse/scan throttling, not exact accounting.
 */
import { supabaseAdmin } from '@/lib/supabase'

export const RATE_LIMIT = 60        // requests
export const RATE_WINDOW_SEC = 60   // per 60s sliding window

export interface RateCheck {
  ok: boolean
  used: number
  limit: number
}

/**
 * Returns ok:false if this key has made >= RATE_LIMIT calls in the window.
 * Fails OPEN (ok:true) on a counting error — a read-only surface shouldn't go
 * dark because the log table hiccuped; the error is logged for visibility.
 */
export async function checkRateLimit(keyId: string): Promise<RateCheck> {
  const since = new Date(Date.now() - RATE_WINDOW_SEC * 1000).toISOString()
  const { count, error } = await supabaseAdmin
    .from('mcp_access_log')
    .select('id', { count: 'exact', head: true })
    .eq('key_id', keyId)
    .gte('created_at', since)

  if (error) {
    console.error('[mcp rate-limit] count failed, failing open:', error)
    return { ok: true, used: 0, limit: RATE_LIMIT }
  }

  const used = count ?? 0
  return { ok: used < RATE_LIMIT, used, limit: RATE_LIMIT }
}
