/**
 * Tests for the Jev semantic supplement layer added on top of the seven
 * deterministic CTS verifier gates (2026-09-20, PM-approved to send customer
 * conversation text to Jev — see MEMORY reference-jev-typesafe-evaluation-2026-09-20).
 *
 * The whole point of this layer is to catch what `containsPhrase` (plain
 * substring match) and the price/date regexes structurally cannot: a
 * paraphrased brand-redline claim, or a price/date spelled out in words. Every
 * "regex misses it" assertion below first proves the regex-only gate
 * (`verifyCtsReply`) actually passes the same input — otherwise the test would
 * not be demonstrating any real value added by the semantic layer.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

const callJev = vi.fn()
vi.mock('@/lib/jev/client', () => ({
  callJev: (...a: unknown[]) => callJev(...a),
}))

import type { KnowledgeEntry, KnowledgeReadResult } from '@/lib/knowledge'
import {
  CTS_CLIENT_ID,
  verifyCtsReply,
  verifyCtsReplyWithSemanticChecks,
  type CtsVerifierContext,
} from '../policies/cts'

function activeProductFact(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: `fact-${overrides.factKey ?? 'active'}`,
    clientId: CTS_CLIENT_ID,
    factKey: 'tour.active.golden-china',
    scope: {},
    statement: 'China Discovery — Golden China',
    structuredValue: {
      code: 'golden-china',
      name: 'China Discovery — Golden China',
      aliases: ['Golden China'],
      price_nzd: 4999,
      departure_dates: ['2026-11-16'],
      itinerary_url: 'https://www.ctstours.co.nz/tours/china/discovery/golden-china',
    },
    conflictGroupId: null,
    status: 'approved',
    visibility: 'customer_ok',
    sensitivity: 'price',
    validFrom: '2026-09-01T00:00:00Z',
    validUntil: null,
    lastVerifiedAt: null,
    approvedByEmail: 'ray@magicengine.cloud',
    approvedAt: '2026-09-01T00:00:00Z',
    clientConfirmedByEmail: 'client@ctstours.co.nz',
    clientConfirmedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

const KNOWLEDGE: KnowledgeReadResult = { entries: [activeProductFact()], forbiddenFactKeys: [] }

// Real seeded CTS redline (supabase/migrations/20260711000002_p21j_content_factory_m1.sql
// §4.6c): CTS must never claim to have operated "since 1928" — that is a real founding-year
// overstatement the brand-redline list exists to catch.
const BRAND_REDLINES = ['Auckland since 1928']

function baseContext(overrides: Partial<CtsVerifierContext> = {}): CtsVerifierContext {
  return {
    clientId: CTS_CLIENT_ID,
    agentOutput: {
      reply_text: 'Kia ora! The Golden China tour departs 2026-11-16 and costs $4999.',
      confidence: 0.9,
      offerings: [],
    },
    brandRedlinePhrases: BRAND_REDLINES,
    knowledge: KNOWLEDGE,
    ...overrides,
  }
}

beforeEach(() => {
  callJev.mockReset()
  delete process.env.MESSENGER_VERIFIER_SEMANTIC_DISABLED
})

// ─── brand_redline_semantic ──────────────────────────────────────────────────

describe('brand_redline_semantic — catches a paraphrase the literal-phrase regex cannot', () => {
  const PARAPHRASED_REDLINE =
    "We've been proudly running tours out of Auckland for nearly a century now, going all the " +
    'way back to the late 1920s!'

  it('regression guard: the regex-only gate does NOT catch this paraphrase (proves the gap is real)', () => {
    const result = verifyCtsReply(
      baseContext({ agentOutput: { reply_text: PARAPHRASED_REDLINE, confidence: 0.9, offerings: [] } }),
    )
    expect(result.blocked_reasons.some((r) => r.startsWith('brand_redline:'))).toBe(false)
  })

  it('the semantic layer catches it when Jev scores the paraphrase high', async () => {
    callJev.mockResolvedValueOnce({ answers: { brand_redline_semantic: { noul: 0.87 } } })
    callJev.mockResolvedValueOnce({ answers: { number_claim_semantic: { noul: 0.02 } } })
    const result = await verifyCtsReplyWithSemanticChecks(
      baseContext({ agentOutput: { reply_text: PARAPHRASED_REDLINE, confidence: 0.9, offerings: [] } }),
    )
    expect(result.ok).toBe(false)
    expect(result.blocked_reasons.some((r) => r.startsWith('brand_redline_semantic:'))).toBe(true)
    expect(result.require_human_confirm).toBe(true)
    // The call actually carried the real redline list and reply text, not a stub.
    expect(callJev).toHaveBeenCalledWith(
      expect.objectContaining({ reply_text: PARAPHRASED_REDLINE, forbidden_claims: BRAND_REDLINES }),
      expect.any(Object),
    )
  })

  it('does not block a clean reply that Jev scores low', async () => {
    callJev.mockResolvedValueOnce({ answers: { brand_redline_semantic: { noul: 0.05 } } })
    callJev.mockResolvedValueOnce({ answers: { number_claim_semantic: { noul: 0.02 } } })
    const result = await verifyCtsReplyWithSemanticChecks(baseContext())
    expect(result.blocked_reasons.some((r) => r.startsWith('brand_redline_semantic:'))).toBe(false)
    expect(result.ok).toBe(true)
  })

  it('skips the Jev call entirely when the client has no brand-redline phrases at all', async () => {
    callJev.mockResolvedValueOnce({ answers: { number_claim_semantic: { noul: 0 } } })
    await verifyCtsReplyWithSemanticChecks(baseContext({ brandRedlinePhrases: [] }))
    expect(callJev).not.toHaveBeenCalledWith(
      expect.objectContaining({ forbidden_claims: expect.anything() }),
      expect.any(Object),
    )
  })
})

// ─── number_claim_semantic ───────────────────────────────────────────────────

describe('number_claim_semantic — catches a spelled-out price/date the digit regex cannot', () => {
  const SPELLED_OUT_WRONG_PRICE_AND_DATE =
    'The Golden China tour departs the sixteenth of December twenty twenty six and costs around ' +
    'six thousand New Zealand dollars.'

  it('regression guard: the regex-only gate does NOT catch this (no "$1234" or "YYYY-MM-DD" token to match)', () => {
    const result = verifyCtsReply(
      baseContext({
        agentOutput: { reply_text: SPELLED_OUT_WRONG_PRICE_AND_DATE, confidence: 0.9, offerings: [] },
      }),
    )
    expect(result.blocked_reasons.some((r) => r.startsWith('number_claim:'))).toBe(false)
  })

  it('the semantic layer catches it when Jev scores the spelled-out mismatch high', async () => {
    // Both checks fire in parallel (brandRedlinePhrases is non-empty in baseContext) —
    // queue a low brand score first (call order matches Promise.all's array order: each
    // async check runs synchronously up to its own `await callJev(...)`, so brand's call
    // is always registered before number's) so only the number-claim check is exercised.
    callJev.mockResolvedValueOnce({ answers: { brand_redline_semantic: { noul: 0.02 } } })
    callJev.mockResolvedValueOnce({ answers: { number_claim_semantic: { noul: 0.81 } } })
    const result = await verifyCtsReplyWithSemanticChecks(
      baseContext({
        agentOutput: { reply_text: SPELLED_OUT_WRONG_PRICE_AND_DATE, confidence: 0.9, offerings: [] },
      }),
    )
    expect(result.ok).toBe(false)
    expect(result.blocked_reasons.some((r) => r.startsWith('number_claim_semantic:'))).toBe(true)
    expect(callJev).toHaveBeenCalledWith(
      expect.objectContaining({ valid_prices_nzd: [4999], valid_departure_dates: ['2026-11-16'] }),
      expect.any(Object),
    )
  })

  it('does not block a spelled-out price/date that Jev scores low (e.g. it actually matches)', async () => {
    callJev.mockResolvedValueOnce({ answers: { brand_redline_semantic: { noul: 0.03 } } })
    callJev.mockResolvedValueOnce({ answers: { number_claim_semantic: { noul: 0.1 } } })
    const result = await verifyCtsReplyWithSemanticChecks(
      baseContext({
        agentOutput: {
          reply_text: 'It costs about five thousand dollars, give or take.',
          confidence: 0.9,
          offerings: [],
        },
      }),
    )
    expect(result.blocked_reasons.some((r) => r.startsWith('number_claim_semantic:'))).toBe(false)
    expect(result.ok).toBe(true)
  })
})

// ─── Fail-open: Jev must never become a new point of failure ────────────────

describe('fail-open — Jev outage never blocks a reply that the regex gates already passed', () => {
  it('Jev throwing on both checks falls back to the regex-only result, unchanged', async () => {
    callJev.mockRejectedValue(new Error('jev call timed out after 6000ms'))
    const withoutSemantic = verifyCtsReply(baseContext())
    const withSemantic = await verifyCtsReplyWithSemanticChecks(baseContext())
    expect(withSemantic).toEqual(withoutSemantic)
    expect(withSemantic.ok).toBe(true)
  })

  it('one check throwing and the other scoring low both fail open — no crash, no false block', async () => {
    callJev.mockRejectedValueOnce(new Error('network error')) // brand_redline_semantic
    callJev.mockResolvedValueOnce({ answers: { number_claim_semantic: { noul: 0.1 } } })
    const result = await verifyCtsReplyWithSemanticChecks(baseContext())
    expect(result.ok).toBe(true)
    expect(result.blocked_reasons).toEqual([])
  })

  it('the kill switch MESSENGER_VERIFIER_SEMANTIC_DISABLED=true skips Jev entirely', async () => {
    process.env.MESSENGER_VERIFIER_SEMANTIC_DISABLED = 'true'
    const result = await verifyCtsReplyWithSemanticChecks(baseContext())
    expect(callJev).not.toHaveBeenCalled()
    expect(result).toEqual(verifyCtsReply(baseContext()))
  })

  it('a client-id mismatch never calls Jev — the identity guard still short-circuits everything', async () => {
    const result = await verifyCtsReplyWithSemanticChecks(
      baseContext({ clientId: 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84' }),
    )
    expect(callJev).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    expect(result.blocked_reasons[0]).toContain('client_id_mismatch')
  })
})

// ─── Combined with regex blocks ──────────────────────────────────────────────

describe('semantic reasons combine with regex reasons rather than replacing them', () => {
  it('a reply that fails both a regex gate and a semantic check reports both', async () => {
    callJev.mockResolvedValueOnce({ answers: { brand_redline_semantic: { noul: 0.9 } } })
    callJev.mockResolvedValueOnce({ answers: { number_claim_semantic: { noul: 0.05 } } })
    const result = await verifyCtsReplyWithSemanticChecks(
      baseContext({
        agentOutput: {
          reply_text: "We've served Auckland since the late 1920s! Also: $999999 total scam price.",
          confidence: 0.9,
          offerings: [],
        },
      }),
    )
    expect(result.ok).toBe(false)
    const firedGates = result.blocked_reasons.map((r) => r.split(':')[0])
    expect(firedGates).toEqual(expect.arrayContaining(['number_claim', 'brand_redline_semantic']))
  })
})
