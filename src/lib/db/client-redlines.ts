import { supabaseAdmin } from '@/lib/supabase'
import type { RedlineCheckInput } from '@/lib/page-optimization'

export interface TrustedClientRedlines {
  readonly redline: RedlineCheckInput
  readonly source: string
}

function strings(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return null
  return value.map((item) => item.trim()).filter(Boolean)
}

/** Tenant-filtered, fail-closed redline loader for governed page changes. */
export async function loadTrustedClientRedlines(clientId: string): Promise<TrustedClientRedlines> {
  const source = `clients:${clientId}:brand_redline_phrases+master_briefs:${clientId}:avoid_words`
  if (!clientId.trim()) {
    return { redline: { available: false, reason: 'client id missing' }, source }
  }
  try {
    const [clientResult, briefResult] = await Promise.all([
      supabaseAdmin
        .from('clients')
        .select('brand_redline_phrases')
        .eq('id', clientId)
        .maybeSingle(),
      supabaseAdmin
        .from('master_briefs')
        .select('avoid_words')
        .eq('client_id', clientId)
        .eq('is_active', true)
        .maybeSingle(),
    ])
    if (clientResult.error || briefResult.error || !clientResult.data) {
      return { redline: { available: false, reason: 'tenant redline lookup failed' }, source }
    }
    const clientPhrases = strings(
      (clientResult.data as { brand_redline_phrases?: unknown }).brand_redline_phrases,
    )
    const avoidWords = briefResult.data === null
      ? []
      : strings((briefResult.data as { avoid_words?: unknown }).avoid_words)
    if (!clientPhrases || !avoidWords) {
      return { redline: { available: false, reason: 'tenant redline shape invalid' }, source }
    }
    return {
      redline: { available: true, phrases: Array.from(new Set([...clientPhrases, ...avoidWords])) },
      source,
    }
  } catch {
    return { redline: { available: false, reason: 'tenant redline lookup failed' }, source }
  }
}
