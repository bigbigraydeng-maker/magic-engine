import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildOfferPriceFacts,
  priceFactMessage,
  verifyPostPrices,
  type OfferPriceFacts,
  type PriceFactVerdict,
} from './price-fact-check'

/** True for a plain object (not null, not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read a nested property from an unknown value, or undefined. */
function readPath(value: unknown, key: string): unknown {
  if (!isRecord(value)) return undefined
  return value[key]
}

/**
 * Narrow an unknown offers blob into Record<string, Record<string, string>>.
 * Keeps entries whose value is an object; within each entry keeps only
 * string-valued fields (drops non-string fields but keeps the entry).
 */
function narrowOffers(value: unknown): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  if (!isRecord(value)) return out
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue
    const fields: Record<string, string> = {}
    for (const [fieldKey, fieldValue] of Object.entries(entry)) {
      if (typeof fieldValue === 'string') fields[fieldKey] = fieldValue
    }
    out[key] = fields
  }
  return out
}

/**
 * Load a client's offer price facts from `clients.factory_config`.
 *
 * The data lives under `render.creatomate.offers` for historical reasons; no
 * other creatomate field is required to exist.
 *
 * Fail-closed: a failed read throws, so callers never mistake an error for
 * "no facts to check".
 */
export async function loadOfferPriceFacts(
  supabase: SupabaseClient,
  clientId: string,
): Promise<OfferPriceFacts[]> {
  const { data, error } = await supabase
    .from('clients')
    .select('factory_config')
    .eq('id', clientId)
    .maybeSingle()

  if (error) {
    throw new Error('price-fact-gate: client config read failed: ' + error.message)
  }
  if (data === null || data === undefined) return []

  const factoryConfig = readPath(data, 'factory_config')
  const render = readPath(factoryConfig, 'render')
  const creatomate = readPath(render, 'creatomate')
  const offers = readPath(creatomate, 'offers')

  return buildOfferPriceFacts(narrowOffers(offers))
}

/** Judge a post's price claims against a client's offer facts. */
export function judgePostPriceFacts(input: {
  text: string
  ctaUrl?: string | null
  offers: OfferPriceFacts[]
}): { blocked: boolean; verdict: PriceFactVerdict; message: string } {
  const verdict = verifyPostPrices(input)
  return {
    blocked: verdict.status === 'blocked',
    verdict,
    message: priceFactMessage(verdict),
  }
}

/**
 * The exact text a post is published with (and therefore judged on):
 * hook, body, then "CTA: link". The publish route and the to-do scan both
 * build it here so the two can never judge different text.
 */
export function buildPostPriceText(post: {
  hook: string
  body: string
  cta: string
  cta_url: string | null
}): string {
  const ctaLine = post.cta_url ? `${post.cta}: ${post.cta_url}` : post.cta
  return [post.hook, post.body, ctaLine].map(part => part.trim()).join('\n\n')
}
