/**
 * VoiceStore factory. Picks memory vs supabase by config (魏征 #3/#5).
 * - memory:   process-singleton, used for tests + mock closed-loop
 * - supabase: over supabaseAdmin (lazy-imported so a missing service key in mock
 *             mode never throws at import time)
 */
import { getVoiceConfig } from '../config'
import { InMemoryVoiceStore } from './memory'
import type { VoiceStore } from './types'

let injected: VoiceStore | null = null
let memorySingleton: InMemoryVoiceStore | null = null
let supabaseSingleton: VoiceStore | null = null

/** Tests / scripts can inject a specific store (e.g. a fresh InMemoryVoiceStore). */
export function setVoiceStore(store: VoiceStore | null): void {
  injected = store
}

export function getInMemoryStore(): InMemoryVoiceStore {
  if (!memorySingleton) memorySingleton = new InMemoryVoiceStore()
  return memorySingleton
}

export async function getVoiceStore(): Promise<VoiceStore> {
  if (injected) return injected
  const cfg = getVoiceConfig()
  if (cfg.storeKind === 'supabase') {
    if (!supabaseSingleton) {
      const { supabaseAdmin } = await import('@/lib/supabase')
      const { SupabaseVoiceStore } = await import('./supabase')
      supabaseSingleton = new SupabaseVoiceStore(supabaseAdmin)
    }
    return supabaseSingleton
  }
  return getInMemoryStore()
}

export type { VoiceStore } from './types'
