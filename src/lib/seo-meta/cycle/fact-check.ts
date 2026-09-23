/**
 * SEO Meta-Cycle v1 — fact-preservation check (PM 2026-09-20, incident
 * follow-up requirement 5).
 *
 * chinatravel #200 is the concrete failure this exists to catch: the
 * original description said the destination is visa-free / no application
 * needed; the AI-generated replacement, chasing an "application steps &
 * timelines" keyword the topic-match gate (gate.ts) would now have already
 * rejected, said the opposite. Requirement 3's fix (real per-page keywords)
 * removes the keyword-mismatch ROOT CAUSE, but this is a second, independent
 * check — the AI can still misremember or invert a fact even given a
 * correctly-matched keyword, so PM wants a dedicated verification pass
 * AFTER generation, not just a better prompt.
 */

import { callJev } from '@/lib/jev/client'

export interface FactCheckResult {
  consistent: boolean
  reason: string
}

// A noul answer is a continuous 0..1 confidence score, not a sentence — 0.5 is
// the symmetric "more likely than not a real contradiction" midpoint. The
// 2026-09-20 evaluation of this exact judgment type (20 real fact-preservation
// questions from ME data, 19/20 correct — see repo memory
// reference-jev-typesafe-evaluation-2026-09-20.md) didn't publish per-question
// scores, so there's no calibration data to justify skewing the cutoff either
// way; and this check is already fail-closed on top of it (any callJev
// failure below also returns consistent:false), so there's no need to bias
// the threshold further toward over-flagging good rewrites.
const CONTRADICTION_THRESHOLD = 0.5

/**
 * AI-judge check (PM explicitly allows "规则或 AI 判官都行" — an AI judge is
 * more robust here than a rules engine: the contradictions that matter
 * (visa-free vs application-required, free vs paid, open vs closed) are
 * semantic, not detectable by keyword/regex matching).
 *
 * Uses the Jev judgment model (src/lib/jev/client.ts) instead of an LLM
 * prompt — this exact judgment type (fact reversal in an SEO rewrite) was
 * already validated against real ME data (see repo memory
 * reference-jev-typesafe-evaluation-2026-09-20.md).
 *
 * Fail-closed: any error (missing API key, network, timeout, malformed
 * response) returns consistent:false — an unverifiable claim must not ship,
 * the candidate gets skipped and routed to the manual board, same as every
 * other gate failure.
 */
export async function checkFactPreservation(
  oldTitle: string,
  oldDesc: string,
  newTitle: string,
  newDesc: string,
): Promise<FactCheckResult> {
  try {
    const result = await callJev(
      { oldTitle, oldDesc, newTitle, newDesc },
      {
        contradiction: {
          type: 'noul',
          instructions:
            'Compare oldTitle/oldDesc (the ORIGINAL page text) against newTitle/newDesc (the NEW proposed text) in the given state. Does the NEW text contradict any concrete fact stated or implied by the ORIGINAL (e.g. price, whether something is free vs paid, whether an application/visa is required vs not required, dates, availability, location)? This includes the service area / geographic coverage / departure cities being NARROWED OR MADE VAGUER — e.g. the ORIGINAL states departures from multiple named cities/regions and the NEW only names one, or the ORIGINAL names a specific city/region and the NEW generalizes it away to a broader or different one. Treat that narrowing as a contradiction even though nothing is literally negated — it changes who the page is telling can use the service. Wording changes and added detail are fine — only a genuine factual contradiction, reversal, or narrowing of scope counts. Answer with a high score if a contradiction (including a scope-narrowing one) exists, a low score if the texts are factually consistent.',
        },
      },
    )
    const score = result.answers.contradiction?.noul
    if (typeof score !== 'number') {
      return { consistent: false, reason: 'fact-check judge returned an unparseable verdict' }
    }
    const contradictionFound = score >= CONTRADICTION_THRESHOLD
    return {
      consistent: !contradictionFound,
      reason: contradictionFound
        ? `contradiction score ${score.toFixed(2)} ≥ ${CONTRADICTION_THRESHOLD} threshold`
        : `no contradiction detected (score ${score.toFixed(2)})`,
    }
  } catch (err) {
    return { consistent: false, reason: `fact-check judge call failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}
