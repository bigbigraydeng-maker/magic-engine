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
 *
 * A Jev hit is advisory-only: it lands in `semantic_flags`, never in `ok` /
 * `blocked_reasons` (Codex review 2026-09-20 on PR #1838, P1 — an earlier version
 * of this code flipped `ok` to `false` on a semantic hit, which routed the draft to
 * `verifier_status='blocked'`; `drafts/route.ts` only queries `pending` and
 * `messenger-draft-items.ts`'s `TRACKED_STATUSES` excludes `blocked`, so that
 * "needs human review" flag was reaching no human review surface at all). Every
 * assertion below checks `semantic_flags`, not `blocked_reasons`, for a Jev hit.
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

/** Deliberately bypasses `reply_text: string` to hand in a runtime value the type system
 *  would reject — used only to test the fail-open safety net against a caller bug, not a
 *  claim about what a well-typed caller would ever produce. */
function withRawReplyText(rawReplyText: unknown, overrides: Partial<CtsVerifierContext> = {}): CtsVerifierContext {
  return baseContext({
    agentOutput: { reply_text: rawReplyText as string, confidence: 0.9, offerings: [] },
    ...overrides,
  })
}

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

  it('the semantic layer flags it (advisory, not a block) when Jev scores the paraphrase high', async () => {
    callJev.mockResolvedValueOnce({ answers: { brand_redline_semantic: { noul: 0.87 } } })
    callJev.mockResolvedValueOnce({ answers: { number_claim_semantic: { noul: 0.02 } } })
    const result = await verifyCtsReplyWithSemanticChecks(
      baseContext({ agentOutput: { reply_text: PARAPHRASED_REDLINE, confidence: 0.9, offerings: [] } }),
    )
    // Advisory only: still ok:true, still reaches 'pending' so a human actually sees it.
    expect(result.ok).toBe(true)
    expect(result.blocked_reasons).toEqual([])
    expect(result.semantic_flags.some((r) => r.startsWith('brand_redline_semantic:'))).toBe(true)
    expect(result.require_human_confirm).toBe(true)
    // The call actually carried the real redline list and reply text, not a stub.
    expect(callJev).toHaveBeenCalledWith(
      expect.objectContaining({ reply_text: PARAPHRASED_REDLINE, forbidden_claims: BRAND_REDLINES }),
      expect.any(Object),
    )
  })

  it('does not flag a clean reply that Jev scores low', async () => {
    callJev.mockResolvedValueOnce({ answers: { brand_redline_semantic: { noul: 0.05 } } })
    callJev.mockResolvedValueOnce({ answers: { number_claim_semantic: { noul: 0.02 } } })
    const result = await verifyCtsReplyWithSemanticChecks(baseContext())
    expect(result.semantic_flags.some((r) => r.startsWith('brand_redline_semantic:'))).toBe(false)
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

  it('the semantic layer flags it (advisory, not a block) when Jev scores the spelled-out mismatch high', async () => {
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
    // Advisory only: still ok:true, still reaches 'pending' so a human actually sees it.
    expect(result.ok).toBe(true)
    expect(result.blocked_reasons).toEqual([])
    expect(result.semantic_flags.some((r) => r.startsWith('number_claim_semantic:'))).toBe(true)
    expect(callJev).toHaveBeenCalledWith(
      expect.objectContaining({ valid_prices_nzd: [4999], valid_departure_dates: ['2026-11-16'] }),
      expect.any(Object),
    )
  })

  it('does not flag a spelled-out price/date that Jev scores low (e.g. it actually matches)', async () => {
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
    expect(result.semantic_flags.some((r) => r.startsWith('number_claim_semantic:'))).toBe(false)
    // The semantic layer stays silent, but the deterministic content_claims gate now blocks a
    // spelled-out price that matches no confirmed fact (this used to be the gap Jev only flagged).
    expect(result.ok).toBe(false)
    expect(result.blocked_reasons.some((r) => r.startsWith('content_claims:'))).toBe(true)
  })
})

// ─── Fail-open: Jev must never become a new point of failure ────────────────

describe('fail-open — Jev outage never blocks a reply that the regex gates already passed', () => {
  it('Jev throwing on both checks falls back to the regex-only result, unchanged', async () => {
    callJev.mockRejectedValue(new Error('jev call timed out after 6000ms'))
    const withoutSemantic = verifyCtsReply(baseContext())
    const withSemantic = await verifyCtsReplyWithSemanticChecks(baseContext())
    expect(withSemantic.ok).toBe(withoutSemantic.ok)
    expect(withSemantic.blocked_reasons).toEqual(withoutSemantic.blocked_reasons)
    expect(withSemantic.require_human_confirm).toBe(withoutSemantic.require_human_confirm)
    expect(withSemantic.ok).toBe(true)
    // Neither semantic id is claimed — a Jev outage must not be reported as "checked" to
    // the human reviewer, only the seven regex gates that actually ran (子牙/魏征复审).
    expect(withSemantic.checked_gate_ids).toEqual([
      'brand_redline',
      'retired_tour_mention',
      'number_claim',
      'reply_forbidden_topic',
      'provenance',
      'length',
      'url_allowlist',
      'content_claims',
    ])
    expect(withSemantic.semantic_flags).toEqual([])
  })

  it('one check throwing and the other scoring low both fail open — no crash, no false block, only the working check is claimed', async () => {
    callJev.mockRejectedValueOnce(new Error('network error')) // brand_redline_semantic
    callJev.mockResolvedValueOnce({ answers: { number_claim_semantic: { noul: 0.1 } } })
    const result = await verifyCtsReplyWithSemanticChecks(baseContext())
    expect(result.ok).toBe(true)
    expect(result.blocked_reasons).toEqual([])
    expect(result.semantic_flags).toEqual([])
    expect(result.checked_gate_ids).not.toContain('brand_redline_semantic')
    expect(result.checked_gate_ids).toContain('number_claim_semantic')
  })

  it('an unexpected error before either check reaches its own Jev try/catch still fails open via an outer safety net', async () => {
    // withRawReplyText(null) hands in a reply_text the type system would reject — simulating
    // a caller bug, not a wrong fixture. `.trim()` on it throws synchronously before either
    // check's own internal try/catch (which only wraps the Jev call itself), so this
    // exercises verifyCtsReplyWithSemanticChecks's own outer try/catch. Ran this suite with
    // that outer try/catch temporarily removed: the same input then produced an unhandled
    // promise rejection instead of the fail-open result asserted below, confirming this test
    // exercises that safety net for real (魏征复审 2026-09-20 blocker: a bug in the semantic
    // layer must never propagate into step.run('verify', ...) and become an Inngest-retried
    // pipeline failure).
    //
    // Note this malformed reply_text also makes several of the seven REGEX gates crash on
    // their own `.length`/`.matchAll` calls — framework.ts's `runVerifierGates` already
    // fail-closes those internally (treats a gate throwing as that gate blocking, by design),
    // so `result.ok` here is expected to be false for that reason, same as calling
    // `verifyCtsReply` directly on this input. What this test actually proves is narrower and
    // still real: the semantic layer's own crash didn't ADD to that, escape as an unhandled
    // rejection, or stop `checked_gate_ids` from correctly reporting "regex ran, semantic did
    // not" — not that this specific input is a clean draft.
    const baseOnMalformed = verifyCtsReply(withRawReplyText(null))
    const result = await verifyCtsReplyWithSemanticChecks(withRawReplyText(null))
    expect(callJev).not.toHaveBeenCalled()
    expect(result.ok).toBe(baseOnMalformed.ok)
    expect(result.blocked_reasons).toEqual(baseOnMalformed.blocked_reasons)
    expect(result.semantic_flags).toEqual([])
    expect(result.checked_gate_ids).toEqual([
      'brand_redline',
      'retired_tour_mention',
      'number_claim',
      'reply_forbidden_topic',
      'provenance',
      'length',
      'url_allowlist',
      'content_claims',
    ])
  })

  it('the kill switch MESSENGER_VERIFIER_SEMANTIC_DISABLED=true skips Jev entirely and only claims the seven regex gates', async () => {
    process.env.MESSENGER_VERIFIER_SEMANTIC_DISABLED = 'true'
    const result = await verifyCtsReplyWithSemanticChecks(baseContext())
    expect(callJev).not.toHaveBeenCalled()
    const base = verifyCtsReply(baseContext())
    expect(result.ok).toBe(base.ok)
    expect(result.blocked_reasons).toEqual(base.blocked_reasons)
    expect(result.semantic_flags).toEqual([])
    expect(result.checked_gate_ids).not.toContain('brand_redline_semantic')
    expect(result.checked_gate_ids).not.toContain('number_claim_semantic')
  })

  it('a client-id mismatch never calls Jev and claims zero checked gates — the identity guard short-circuits everything', async () => {
    const result = await verifyCtsReplyWithSemanticChecks(
      baseContext({ clientId: 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84' }),
    )
    expect(callJev).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    expect(result.blocked_reasons[0]).toContain('client_id_mismatch')
    expect(result.semantic_flags).toEqual([])
    expect(result.checked_gate_ids).toEqual([])
  })
})

// ─── checked_gate_ids — the honest per-draft record drafts/route.ts reads ────

describe('checked_gate_ids — what the human-review portal trusts', () => {
  it('a fully successful run claims all ten gate ids, not a static constant', async () => {
    callJev.mockResolvedValueOnce({ answers: { brand_redline_semantic: { noul: 0.01 } } })
    callJev.mockResolvedValueOnce({ answers: { number_claim_semantic: { noul: 0.01 } } })
    const result = await verifyCtsReplyWithSemanticChecks(baseContext())
    expect(result.checked_gate_ids).toEqual([
      'brand_redline',
      'retired_tour_mention',
      'number_claim',
      'reply_forbidden_topic',
      'provenance',
      'length',
      'url_allowlist',
      'content_claims',
      'brand_redline_semantic',
      'number_claim_semantic',
    ])
  })

  it('brand_redline_semantic is still claimed as evaluated when there are no redline phrases to check (nothing to catch, not a failure)', async () => {
    callJev.mockResolvedValueOnce({ answers: { number_claim_semantic: { noul: 0.01 } } })
    const result = await verifyCtsReplyWithSemanticChecks(baseContext({ brandRedlinePhrases: [] }))
    expect(result.checked_gate_ids).toContain('brand_redline_semantic')
    // Only one Jev call happened — for number_claim_semantic — confirming brand_redline_semantic
    // was a structural skip (nothing to check), not a real Jev evaluation.
    expect(callJev).toHaveBeenCalledTimes(1)
  })
})

// ─── A hard regex block and an advisory semantic flag are independent ───────

describe('a regex block and a semantic flag never get conflated', () => {
  it(
    'a reply that fails a regex gate AND scores high on a semantic check reports the regex ' +
      "failure in blocked_reasons (ok:false, this IS a hard block) and the semantic hit " +
      "separately in semantic_flags (advisory) — never merged into one list",
    async () => {
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
      // number_claim (regex) is a real hard block — $999999 matches no confirmed product.
      expect(result.ok).toBe(false)
      expect(result.blocked_reasons.some((r) => r.startsWith('number_claim:'))).toBe(true)
      expect(result.blocked_reasons.some((r) => r.startsWith('brand_redline_semantic:'))).toBe(false)
      // brand_redline_semantic (Jev) is advisory only — lives in semantic_flags, not blocked_reasons.
      expect(result.semantic_flags.some((r) => r.startsWith('brand_redline_semantic:'))).toBe(true)
    },
  )
})
