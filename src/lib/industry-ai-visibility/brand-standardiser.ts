/**
 * Phase 30 — Brand standardiser.
 *
 * Pipeline for SERP brand extraction:
 *   1. domain-normalise → coarse "ctstours" candidates
 *   2. brand-standardiser (this module) → canonical "CTS Tours"
 *
 * Cache key is (industry_code, raw_lower). Same raw token may resolve to
 * different canonicals in different industries — "CTS" in tourism vs
 * finance — so the cache is industry-scoped.
 *
 * Fallback strategy on LLM failure:
 *   - Zod parse fails  → retry once
 *   - Retry fails      → fall back to a Title-Cased version of the raw input
 *                         (so we always return SOMETHING, never null)
 *   - All cache writes are best-effort; a write failure logs but does not
 *     propagate (the standardised value is still returned to the caller).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getAnthropicClient, MODEL_HAIKU } from '@/lib/anthropic/client'

const HAIKU_PRICE_INPUT_PER_M  = 0.80
const HAIKU_PRICE_OUTPUT_PER_M = 4.0

const SYSTEM_PROMPT = `You normalise raw text tokens into the canonical brand name of a real-world business.

Input examples:
  "ctstours"                                → "CTS Tours"
  "intrepidtravel"                          → "Intrepid Travel"
  "china travel service (nz) ltd"           → "China Travel Service"
  "Best Small Group Tours | Intrepid Travel AU" → "Intrepid Travel"

Rules:
  - Return the SHORTEST recognisable brand name (drop suffixes like Ltd, Pty, NZ, AU, " | ...").
  - Use Title Case unless the brand officially uses other casing.
  - If the input is an SEO article title (e.g. "10 Best Tours of 2026"), return "UNKNOWN".
  - If the input is a generic phrase that is NOT a brand, return "UNKNOWN".
  - NEVER invent a brand. When unsure, return "UNKNOWN".`

// Pure TS validator (project convention: no zod dep — see src/lib/zhangqian/validators.ts)
function validateCanonicalResponse(input: unknown): { canonical: string } {
  if (!input || typeof input !== 'object') {
    throw new Error('LLM response is not an object')
  }
  const raw = (input as Record<string, unknown>).canonical
  if (typeof raw !== 'string') {
    throw new Error('LLM response missing "canonical" string field')
  }
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    throw new Error('LLM "canonical" is empty')
  }
  if (trimmed.length > 80) {
    throw new Error(`LLM "canonical" exceeds 80 chars: ${trimmed.slice(0, 80)}`)
  }
  return { canonical: trimmed }
}

interface StandardiseDeps {
  supabase: SupabaseClient
  industryCode: string
}

interface StandardiseOutcome {
  canonical: string
  source: 'cache' | 'llm' | 'llm_retry' | 'fallback'
  cost_usd: number
}

/**
 * Standardise ONE raw token. Hits the canonical cache first; on cache miss
 * calls Haiku, persists the result, and returns the canonical.
 */
export async function standardiseBrand(
  raw: string,
  deps: StandardiseDeps,
): Promise<StandardiseOutcome> {
  const cleaned = raw.trim()
  if (!cleaned) return { canonical: 'UNKNOWN', source: 'fallback', cost_usd: 0 }

  const rawLower = cleaned.toLowerCase()

  // 1) Cache lookup
  const { data: cached } = await deps.supabase
    .from('industry_brand_canonical')
    .select('canonical_brand')
    .eq('industry_code', deps.industryCode)
    .eq('raw_lower', rawLower)
    .maybeSingle()

  if (cached?.canonical_brand) {
    return { canonical: cached.canonical_brand as string, source: 'cache', cost_usd: 0 }
  }

  // 2) LLM call (up to 1 retry on Zod parse failure)
  let attempt = 0
  let lastError: unknown = null
  while (attempt < 2) {
    attempt++
    try {
      const result = await callHaikuStandardiser(cleaned)
      const { canonical, cost_usd } = result

      // Persist (best-effort — log on failure but keep returning the canonical)
      await persistCanonical(deps, {
        rawLower,
        canonical,
        source: attempt === 1 ? 'llm' : 'llm_retry',
        llmCost: cost_usd,
      })

      return {
        canonical,
        source: attempt === 1 ? 'llm' : 'llm_retry',
        cost_usd,
      }
    } catch (err) {
      lastError = err
      // continue to retry; second iteration falls through to fallback below
    }
  }

  // 3) Fallback — title-case the cleaned raw, never crash.
  // 魏征 Hotfix-4: do NOT persist the fallback to cache. If we did, every
  // subsequent collection during a Haiku outage would cache-hit the bad
  // title-cased value and never retry the LLM, even after Haiku recovers.
  // Cost of re-trying LLM on the same raw next cycle is ~$0.0002 — acceptable
  // insurance against permanent cache poisoning.
  console.error('[brand-standardiser] LLM failed twice, using fallback (not cached)', { raw: cleaned, error: lastError })
  const fallback = titleCase(cleaned)
  return { canonical: fallback, source: 'fallback', cost_usd: 0 }
}

/**
 * Batch helper — standardise an ordered list of raw tokens, deduplicating
 * the canonical output (preserving order of first appearance). Same input
 * raw seen multiple times within the call shares one cache lookup.
 */
export async function standardiseBrandList(
  rawList: string[],
  deps: StandardiseDeps,
): Promise<{ brands: string[]; total_cost_usd: number }> {
  const localCache = new Map<string, string>()  // rawLower → canonical (within this batch)
  const seenCanonical = new Set<string>()
  const out: string[] = []
  let totalCost = 0

  for (const raw of rawList) {
    const key = raw.trim().toLowerCase()
    if (!key) continue

    let canonical: string
    if (localCache.has(key)) {
      canonical = localCache.get(key)!
    } else {
      const outcome = await standardiseBrand(raw, deps)
      canonical = outcome.canonical
      totalCost += outcome.cost_usd
      localCache.set(key, canonical)
    }

    if (canonical === 'UNKNOWN') continue
    if (seenCanonical.has(canonical)) continue
    seenCanonical.add(canonical)
    out.push(canonical)
  }

  return { brands: out, total_cost_usd: totalCost }
}

// ─── Internals ───────────────────────────────────────────────────────────────

async function callHaikuStandardiser(raw: string): Promise<{ canonical: string; cost_usd: number }> {
  const client = getAnthropicClient()
  const response = await client.messages.create({
    model: MODEL_HAIKU,
    max_tokens: 100,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Input: ${JSON.stringify(raw)}\n\nReturn JSON only, no prose:\n{"canonical": "..."}`,
      },
    ],
  })

  const text = response.content
    .filter(block => block.type === 'text')
    .map(block => (block as { text: string }).text)
    .join('')
    .trim()

  // Strip any markdown fence Haiku may add
  const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch (err) {
    throw new Error(`Haiku returned non-JSON: ${jsonText.slice(0, 80)}`)
  }

  const validated = validateCanonicalResponse(parsed)
  const canonical = validated.canonical

  const inputTok = response.usage?.input_tokens ?? 0
  const outputTok = response.usage?.output_tokens ?? 0
  const cost =
    (inputTok / 1_000_000) * HAIKU_PRICE_INPUT_PER_M +
    (outputTok / 1_000_000) * HAIKU_PRICE_OUTPUT_PER_M

  return { canonical, cost_usd: cost }
}

interface PersistArgs {
  rawLower: string
  canonical: string
  source: 'llm' | 'llm_retry' | 'domain_fallback' | 'manual_override'
  llmCost: number
}

async function persistCanonical(deps: StandardiseDeps, args: PersistArgs): Promise<void> {
  const { error } = await deps.supabase
    .from('industry_brand_canonical')
    .upsert(
      {
        industry_code: deps.industryCode,
        raw_lower: args.rawLower,
        canonical_brand: args.canonical,
        source: args.source,
        llm_model: args.source.startsWith('llm') ? MODEL_HAIKU : null,
        llm_cost_usd: args.llmCost,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'industry_code,raw_lower' },
    )
  if (error) {
    console.error('[brand-standardiser] cache write failed', { industry: deps.industryCode, raw: args.rawLower, error })
  }
}

function titleCase(s: string): string {
  return s
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}
