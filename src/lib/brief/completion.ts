import { supabaseAdmin } from '@/lib/supabase'

interface CacheEntry {
  result: boolean
  expiresAt: number
}

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const cache = new Map<string, CacheEntry>()

/**
 * Returns true if the client has completed their onboarding brief.
 * Result is cached in-process for 5 minutes per clientId.
 */
export async function isBriefComplete(clientId: string): Promise<boolean> {
  const now = Date.now()
  const hit = cache.get(clientId)
  if (hit && hit.expiresAt > now) {
    return hit.result
  }

  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('brief_completed_at')
    .eq('id', clientId)
    .maybeSingle()

  if (error || !data) {
    return false
  }

  const result = data.brief_completed_at !== null
  cache.set(clientId, { result, expiresAt: now + CACHE_TTL_MS })

  return result
}

/** Clears the in-process cache for a specific client (e.g. after brief submission). */
export function invalidateBriefCache(clientId: string): void {
  cache.delete(clientId)
}
