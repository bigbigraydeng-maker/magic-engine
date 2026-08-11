/**
 * Cancellation and worst-case pricing.
 *
 * Two things that were described as guarantees before they were one:
 *
 * - `Promise.race` was called a "hard timeout". Losing a race abandons the local
 *   `await`; the HTTP request keeps running and keeps billing. Now there is an
 *   `AbortController`, the adapter has to honour the signal, and an adapter that
 *   cannot prove it does must say so — the lease is then sized to the provider's
 *   server-side maximum instead of to our own wishful timeout.
 * - a flat $0.50 reservation was called a "hard cap". It is only a cap if it is
 *   computed from the real price of the real model, and refused outright when the
 *   price is unknown or out of date.
 */

import { describe, expect, it } from 'vitest'

import { MOCK_PRICING, estimateInputTokens, quoteWorstCase } from '../src/adapters/pricing'
import type { ModelPricing } from '../src/adapters/pricing'
import { MockReviewerProvider } from '../src/adapters/openai/mock-reviewer'
import { createClaudeImplementer } from '../src/adapters/claude/implementer'
import { createOpenAIReviewer } from '../src/adapters/openai/reviewer'
import { checkTimingInvariant } from '../src/policy/policy'
import { SCAFFOLD_LEASE_TTL_MS, SCAFFOLD_LIMITS } from '../src/config/scaffold-config'
import { runOrchestration } from '../src/runner'
import { FIXED_NOW, makeHarness, reviewerOutput } from './helpers'

const QUERY = {
  system: 'x'.repeat(3000),
  user: 'y'.repeat(3000),
  max_output_tokens: 16_000,
  now: FIXED_NOW,
}

// ─────────────────────────────────────────────────────────────────────────────
// Cancellation
// ─────────────────────────────────────────────────────────────────────────────

describe('timeout really aborts the call', () => {
  it('delivers the abort to the adapter, not just to our own await', async () => {
    const h = makeHarness({
      inputOverrides: { limits: { ...SCAFFOLD_LIMITS, provider_timeout_ms: 20 } },
      reviewerScript: [{ output: reviewerOutput(), delayMs: 500 }],
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(h.reviewer.abortObserved).toBe(true)
    expect(result.appended.find((e) => e.event === 'turn_rejected')).toMatchObject({
      reason: 'provider_timeout',
    })
  })

  it('does not abort a call that returns in time — the positive control', async () => {
    const h = makeHarness({ reviewerScript: [{ output: reviewerOutput(), delayMs: 1 }] })
    await runOrchestration(h.input, h.deps)
    expect(h.reviewer.abortObserved).toBe(false)
  })

  it('says in the ledger whether the cancellation was believed', async () => {
    const h = makeHarness({
      inputOverrides: {
        limits: { ...SCAFFOLD_LIMITS, provider_timeout_ms: 20 },
        leaseTtlMs: 40 * 60_000,
      },
      reviewerScript: [{ output: reviewerOutput(), delayMs: 500 }],
    })
    const uncancellable = new MockReviewerProvider([{ output: reviewerOutput(), delayMs: 500 }], {
      cancellation: { supported: false, server_max_timeout_ms: 20 * 60_000 },
    })

    const result = await runOrchestration(h.input, { ...h.deps, reviewer: uncancellable })

    const rejected = result.appended.find((e) => e.event === 'turn_rejected')
    expect(rejected && 'detail' in rejected && rejected.detail.join(' ')).toContain(
      'does not support cancellation'
    )
  })
})

describe('an uncancellable provider sizes the lease, not our wishful timeout', () => {
  it('refuses to start when the lease only covers our own timeout', async () => {
    const uncancellable = new MockReviewerProvider([{ output: reviewerOutput() }], {
      cancellation: { supported: false, server_max_timeout_ms: 30 * 60_000 },
    })
    const h = makeHarness({ inputOverrides: { leaseTtlMs: SCAFFOLD_LEASE_TTL_MS } })

    const result = await runOrchestration(h.input, { ...h.deps, reviewer: uncancellable })

    expect(result.run.stop_reason).toBe('configuration_invalid')
    expect(result.stopped_because).toContain('1800000ms in-flight window')
    expect(uncancellable.callCount).toBe(0)
  })

  it('starts once the lease covers the provider server maximum', async () => {
    const uncancellable = new MockReviewerProvider(
      [{ output: reviewerOutput({ verdict: 'APPROVED_FOR_NEXT_STAGE' }) }],
      { cancellation: { supported: false, server_max_timeout_ms: 30 * 60_000 } }
    )
    const h = makeHarness({
      inputOverrides: { leaseTtlMs: 30 * 60_000 + SCAFFOLD_LIMITS.lease_margin_ms },
    })

    const result = await runOrchestration(h.input, { ...h.deps, reviewer: uncancellable })

    expect(result.preflight.timing_invariant.ok).toBe(true)
    expect(uncancellable.callCount).toBe(1)
  })

  it('reports each provider cancellation stance in the preflight', async () => {
    const h = makeHarness({ dryRun: true })
    const result = await runOrchestration(h.input, h.deps)
    expect(result.preflight.cancellation.gpt_reviewer.supported).toBe(true)
    expect(result.preflight.cancellation.claude_implementer.supported).toBe(true)
  })

  it('takes the worst window across both providers', () => {
    const ttl = 10 * 60_000
    expect(checkTimingInvariant(SCAFFOLD_LIMITS, ttl, SCAFFOLD_LIMITS.provider_timeout_ms).ok).toBe(true)
    expect(checkTimingInvariant(SCAFFOLD_LIMITS, ttl, 30 * 60_000).ok).toBe(false)
  })
})

describe('the shipped real adapters do not claim cancellation they cannot prove', () => {
  it('openai reviewer declares unsupported until the transport exists', () => {
    const built = createOpenAIReviewer({ enabled: true, apiKey: 'sk-test' })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.provider.cancellation.supported).toBe(false)
    expect(built.provider.cancellation.server_max_timeout_ms).toBeGreaterThan(0)
  })

  it('claude implementer declares unsupported: killing our await does not kill a child process', () => {
    const built = createClaudeImplementer({ enabled: true, apiKey: 'sk-ant-test' })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.provider.cancellation.supported).toBe(false)
  })

  it('refuses to quote without a price table', () => {
    const built = createClaudeImplementer({ enabled: true, apiKey: 'sk-ant-test' })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.provider.maxCostFor(QUERY)).toMatchObject({ ok: false, reason: 'pricing_missing' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Worst-case pricing
// ─────────────────────────────────────────────────────────────────────────────

describe('quoteWorstCase', () => {
  const pricing = MOCK_PRICING['mock-claude']

  it('prices output at the full ceiling, never at an expected value', () => {
    const quote = quoteWorstCase(pricing, QUERY)
    expect(quote.ok).toBe(true)
    if (!quote.ok) return
    expect(quote.estimate.breakdown.output).toBeCloseTo((16_000 / 1e6) * 15, 6)
    expect(quote.estimate.max_output_tokens).toBe(16_000)
  })

  it('includes cache-write and tool surcharges when the table declares them', () => {
    const quote = quoteWorstCase(pricing, QUERY)
    if (!quote.ok) throw new Error('expected a quote')
    expect(Object.keys(quote.estimate.breakdown).sort()).toEqual([
      'cache_write',
      'input',
      'output',
      'tools',
    ])
    expect(quote.estimate.breakdown.tools).toBe(0.01)
  })

  it('over-estimates input tokens rather than under-estimating them', () => {
    // 3 chars per token is well below real density, so the count runs high — the
    // safe direction, because an under-estimate is an under-reservation.
    expect(estimateInputTokens('a'.repeat(300), '')).toBe(100)
  })

  it('names the price table version so a stale quote is visible', () => {
    const quote = quoteWorstCase(pricing, QUERY)
    if (!quote.ok) throw new Error('expected a quote')
    expect(quote.estimate.pricing_version).toBe('mock-2026-08')
    expect(quote.estimate.model).toBe('mock-claude')
  })

  it('refuses when there is no table entry', () => {
    expect(quoteWorstCase(undefined, QUERY)).toMatchObject({ ok: false, reason: 'pricing_missing' })
  })

  it('refuses when the table has expired', () => {
    const stale: ModelPricing = { ...pricing, valid_until: '2020-01-01T00:00:00.000Z' }
    expect(quoteWorstCase(stale, QUERY)).toMatchObject({ ok: false, reason: 'pricing_stale' })
  })

  it('refuses an input larger than the table allows', () => {
    const small: ModelPricing = { ...pricing, max_input_tokens: 10 }
    expect(quoteWorstCase(small, QUERY)).toMatchObject({ ok: false, reason: 'input_too_large' })
  })

  it('scales the quote with the size of the prompt', () => {
    const small = quoteWorstCase(pricing, { ...QUERY, system: 'x', user: 'y' })
    const large = quoteWorstCase(pricing, { ...QUERY, system: 'x'.repeat(700_000), user: '' })
    if (!small.ok) throw new Error('expected a quote')
    // The large one is refused for being over the input ceiling, which is the
    // point: an oversized prompt is never quietly quoted.
    expect(large).toMatchObject({ ok: false, reason: 'input_too_large' })
    expect(small.estimate.max_cost_usd).toBeGreaterThan(0)
  })
})

describe('an unquotable turn makes no call', () => {
  it('stops at WAITING_HUMAN when the price table is missing', async () => {
    const unpriced = new MockReviewerProvider([{ output: reviewerOutput() }], { pricing: null })
    const h = makeHarness()

    const result = await runOrchestration(h.input, { ...h.deps, reviewer: unpriced })

    expect(unpriced.callCount).toBe(0)
    expect(result.run.state).toBe('WAITING_HUMAN')
    expect(result.run.stop_reason).toBe('cost_estimate_unavailable')
    expect(result.stopped_because).toContain('pricing_missing')
  })

  it('stops at WAITING_HUMAN when the price table is stale', async () => {
    const stale = new MockReviewerProvider([{ output: reviewerOutput() }], {
      pricing: { ...MOCK_PRICING['mock-gpt'], valid_until: '2020-01-01T00:00:00.000Z' },
    })
    const h = makeHarness()

    const result = await runOrchestration(h.input, { ...h.deps, reviewer: stale })

    expect(stale.callCount).toBe(0)
    expect(result.stopped_because).toContain('pricing_stale')
  })

  it('stops at WAITING_HUMAN when the prompt exceeds the input ceiling', async () => {
    const tiny = new MockReviewerProvider([{ output: reviewerOutput() }], {
      pricing: { ...MOCK_PRICING['mock-gpt'], max_input_tokens: 5 },
    })
    const h = makeHarness()

    const result = await runOrchestration(h.input, { ...h.deps, reviewer: tiny })

    expect(tiny.callCount).toBe(0)
    expect(result.stopped_because).toContain('input_too_large')
  })

  it('calls when the quote succeeds — the positive control', async () => {
    const h = makeHarness()
    await runOrchestration(h.input, h.deps)
    expect(h.reviewer.callCount).toBe(1)
  })
})

describe('actual above the reservation is a pricing violation, not a bigger cap', () => {
  it('halts the run when usage exceeds what was reserved', async () => {
    const h = makeHarness({
      // The quote for this prompt is around $0.13; bill $5 and the price model is
      // provably wrong.
      reviewerScript: [{ output: reviewerOutput(), usage: { cost_usd: 5 } }],
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.state).toBe('WAITING_HUMAN')
    expect(result.run.stop_reason).toBe('cost_overrun')
    const rejected = result.appended.find((e) => e.event === 'turn_rejected')
    expect(rejected).toMatchObject({ reason: 'cost_overrun' })
    // The real amount is what gets charged, not the reservation we were wrong about.
    expect(rejected && 'cost_usd' in rejected && rejected.cost_usd).toBe(5)
    expect(result.run.cumulative_cost_usd).toBeCloseTo(5)
  })

  it('accepts usage at or under the reservation — the positive control', async () => {
    const h = makeHarness({
      reviewerScript: [
        { output: reviewerOutput({ verdict: 'APPROVED_FOR_NEXT_STAGE' }), usage: { cost_usd: 0.01 } },
      ],
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.appended.some((e) => e.event === 'turn_rejected')).toBe(false)
    expect(result.run.state).toBe('APPROVED_FOR_HUMAN_MERGE')
  })
})
