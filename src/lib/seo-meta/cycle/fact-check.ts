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

import Anthropic from '@anthropic-ai/sdk'
import { parseJsonResponse } from '@/lib/anthropic/client'

export interface FactCheckResult {
  consistent: boolean
  reason: string
}

/**
 * AI-judge check (PM explicitly allows "规则或 AI 判官都行" — an AI judge is
 * more robust here than a rules engine: the contradictions that matter
 * (visa-free vs application-required, free vs paid, open vs closed) are
 * semantic, not detectable by keyword/regex matching).
 *
 * Fail-closed: any error (network, malformed JSON) returns consistent:false
 * — an unverifiable claim must not ship, the candidate gets skipped and
 * routed to the manual board, same as every other gate failure.
 */
export async function checkFactPreservation(
  oldTitle: string,
  oldDesc: string,
  newTitle: string,
  newDesc: string,
): Promise<FactCheckResult> {
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: `Compare the ORIGINAL page title/description against the NEW proposed one. Does the NEW text contradict any concrete fact stated or implied by the ORIGINAL (e.g. price, whether something is free vs paid, whether an application/visa is required vs not required, dates, availability, location)? Wording changes and added detail are fine — only flag a genuine factual contradiction or reversal.

ORIGINAL title: ${oldTitle}
ORIGINAL description: ${oldDesc}

NEW title: ${newTitle}
NEW description: ${newDesc}

Respond ONLY with valid JSON: {"consistent": true|false, "reason": "one sentence"}`,
        },
      ],
    })
    const text = msg.content[0].type === 'text' ? msg.content[0].text.trim() : '{}'
    const parsed = parseJsonResponse<{ consistent?: boolean; reason?: string }>(text)
    if (typeof parsed.consistent !== 'boolean') {
      return { consistent: false, reason: 'fact-check judge returned an unparseable verdict' }
    }
    return { consistent: parsed.consistent, reason: parsed.reason ?? '' }
  } catch (err) {
    return { consistent: false, reason: `fact-check judge call failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}
