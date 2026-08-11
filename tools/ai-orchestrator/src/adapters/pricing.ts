/**
 * Worst-case cost estimation.
 *
 * A reservation is only a ceiling if it is computed from the actual price of the
 * actual model. A flat $0.50 is a guess, and a guess that is too low turns the
 * cap back into a tripwire — which is exactly the defect this replaces.
 *
 * Two of the three inputs err upward, and one does not:
 *
 * - output is always priced at the full `max_output_tokens`, never at an expected
 *   value;
 * - cache-write and tool surcharges are added when the table declares them;
 * - **the input-token estimate is NOT a safe upper bound.** See
 *   `estimateInputTokens`. This is Enable blocker E2 in the spec, and until it is
 *   fixed the reservation is a reasonable figure rather than a proven ceiling.
 *
 * A price table that is missing, stale, or does not cover the model produces a
 * refusal, not a fallback number. There is no safe default price.
 */

import type {
  CostEstimate,
  CostEstimateResult,
  CostQuery,
} from './provider-types'

export interface ModelPricing {
  model: string
  /** Bumped whenever a rate changes. Recorded with every reservation. */
  pricing_version: string
  input_usd_per_mtok: number
  output_usd_per_mtok: number
  /** Charged on the whole input when the adapter writes a prompt cache entry. */
  cache_write_usd_per_mtok?: number
  /** Flat worst-case allowance for tool calls the model may make. */
  tool_surcharge_usd?: number
  /** Refuse to quote after this instant. Prices go out of date silently otherwise. */
  valid_until: string
  /** Refuse inputs larger than this; also bounds the estimate. */
  max_input_tokens: number
}

/**
 * ⚠️ Not a safe upper bound. Enable blocker E2.
 *
 * Three characters per token over-counts for English prose, which is where the
 * figure came from. It **under**-counts for CJK, and Magic Engine's context is
 * full of Chinese: a UTF-8 three-byte character costs roughly one token in most
 * tokenizers but is counted here as one third of one. Code, JSON and emoji drift
 * the same way.
 *
 * An under-estimate is the dangerous direction — it under-reserves, so the cap
 * stops being a ceiling. Enable requires either the model's own tokenizer or
 * UTF-8 byte length (bytes >= tokens, so it errs upward for every script).
 *
 * It is left in place, wrong and labelled, because the scaffold calls no real
 * model: nothing here can spend. Replacing it with a guess that merely *looks*
 * safer would hide the blocker instead of holding it open.
 */
export const CHARS_PER_TOKEN_OPTIMISTIC = 3

/** @deprecated Misleading name for {@link CHARS_PER_TOKEN_OPTIMISTIC}. */
export const CHARS_PER_TOKEN_CONSERVATIVE = CHARS_PER_TOKEN_OPTIMISTIC

export function estimateInputTokens(system: string, user: string): number {
  return Math.ceil((system.length + user.length) / CHARS_PER_TOKEN_OPTIMISTIC)
}

function round(value: number): number {
  return Math.ceil(value * 1e6) / 1e6
}

export function quoteWorstCase(pricing: ModelPricing | undefined, query: CostQuery): CostEstimateResult {
  if (!pricing) {
    return {
      ok: false,
      reason: 'pricing_missing',
      message: 'no price table entry for this model; refusing to quote',
    }
  }

  if (Date.parse(pricing.valid_until) <= query.now.getTime()) {
    return {
      ok: false,
      reason: 'pricing_stale',
      message: `price table ${pricing.pricing_version} expired at ${pricing.valid_until}`,
    }
  }

  const inputTokens = estimateInputTokens(query.system, query.user)
  if (inputTokens > pricing.max_input_tokens) {
    return {
      ok: false,
      reason: 'input_too_large',
      message: `estimated ${inputTokens} input tokens exceeds the ${pricing.max_input_tokens} ceiling`,
    }
  }

  const perMillion = (tokens: number, rate: number): number => round((tokens / 1_000_000) * rate)

  const breakdown: Record<string, number> = {
    input: perMillion(inputTokens, pricing.input_usd_per_mtok),
    output: perMillion(query.max_output_tokens, pricing.output_usd_per_mtok),
  }
  if (pricing.cache_write_usd_per_mtok) {
    breakdown.cache_write = perMillion(inputTokens, pricing.cache_write_usd_per_mtok)
  }
  if (pricing.tool_surcharge_usd) {
    breakdown.tools = pricing.tool_surcharge_usd
  }

  const estimate: CostEstimate = {
    max_cost_usd: round(Object.values(breakdown).reduce((sum, value) => sum + value, 0)),
    model: pricing.model,
    pricing_version: pricing.pricing_version,
    input_tokens_estimate: inputTokens,
    max_output_tokens: query.max_output_tokens,
    breakdown,
  }

  return { ok: true, estimate }
}

/**
 * Prices used by the mock providers so the tests exercise the real arithmetic.
 * These are NOT the rates the Enable phase should ship with — the real table is a
 * separate, reviewed change, listed in the Enable checklist.
 */
export const MOCK_PRICING: Readonly<Record<string, ModelPricing>> = {
  'mock-gpt': {
    model: 'mock-gpt',
    pricing_version: 'mock-2026-08',
    input_usd_per_mtok: 2,
    output_usd_per_mtok: 8,
    valid_until: '2027-01-01T00:00:00.000Z',
    max_input_tokens: 200_000,
  },
  'mock-claude': {
    model: 'mock-claude',
    pricing_version: 'mock-2026-08',
    input_usd_per_mtok: 3,
    output_usd_per_mtok: 15,
    cache_write_usd_per_mtok: 3.75,
    tool_surcharge_usd: 0.01,
    valid_until: '2027-01-01T00:00:00.000Z',
    max_input_tokens: 200_000,
  },
}
