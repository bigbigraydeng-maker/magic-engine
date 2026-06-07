/**
 * MCP rate limiting (Phase 34 / P34.5, extended for admin in P34-P3.5).
 *
 * Counts mcp_access_log rows for a key in the last RATE_WINDOW_SEC. Using the
 * access log as the counter (子牙 B3) keeps it correct across multiple Render
 * instances — no single-instance in-memory LRU.
 *
 * Counts the per-kind FK column (client_key_id / admin_key_id), NOT the legacy
 * key_id — P34-P3 logMcpAccess writes the kind-specific column.
 *
 * Fire-and-forget log writes mean the window is approximate; acceptable for a
 * read-only abuse/scan throttle. Fails OPEN on a counting error.
 */
import { supabaseAdmin } from '@/lib/supabase'

export const RATE_LIMIT = 60 // client default, per 60s
export const RATE_WINDOW_SEC = 60

export interface RateCheck {
  ok: boolean
  used: number
  limit: number
}

export interface RateOpts {
  limit?: number
  kind?: 'client' | 'admin'
}

export async function checkRateLimit(keyId: string, opts: RateOpts = {}): Promise<RateCheck> {
  const limit = opts.limit ?? RATE_LIMIT
  const column = opts.kind === 'admin' ? 'admin_key_id' : 'client_key_id'
  const since = new Date(Date.now() - RATE_WINDOW_SEC * 1000).toISOString()

  const { count, error } = await supabaseAdmin
    .from('mcp_access_log')
    .select('id', { count: 'exact', head: true })
    .eq(column, keyId)
    .gte('created_at', since)

  if (error) {
    console.error('[mcp rate-limit] count failed, failing open:', error)
    return { ok: true, used: 0, limit }
  }

  const used = count ?? 0
  return { ok: used < limit, used, limit }
}
