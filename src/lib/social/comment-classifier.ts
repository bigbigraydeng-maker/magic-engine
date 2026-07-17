/**
 * Comment classifier + reply decision engine.
 *
 * The LLM is trusted for exactly ONE free-form job: writing a warm reply to
 * genuine praise. Everything else (questions, complaints, spam) is handled by
 * deterministic safe templates in comment-guardrails.ts — the LLM is NEVER
 * allowed to author an answer to a factual question, because that would risk
 * fabricating itinerary / price / date details (CLAUDE.md red line).
 *
 * Even the praise reply passes detectUnverifiableClaims() before it can be
 * returned; a tripped filter falls back to safePraiseReply(). So no matter what
 * an adversarial commenter injects, the worst case is a claim-free thank-you.
 */

import { getAnthropicClient, MODEL_HAIKU } from '@/lib/anthropic/client'
import {
  ReplyContext,
  detectUnverifiableClaims,
  safePraiseReply,
  safeQuestionPublicReply,
  safeQuestionPrivateReply,
  safeComplaintPublicReply,
  safeComplaintPrivateReply,
} from './comment-guardrails'

export type CommentCategory = 'praise' | 'question' | 'complaint' | 'spam' | 'other'

export interface CommentDecision {
  category: CommentCategory
  confidence: number
  /** Public reply to post under the comment, or null to stay silent. */
  publicReply: string | null
  /** Private (DM) reply, or null. Only sent when the comment surface allows it. */
  privateReply: string | null
  /** True → hide the comment (spam). */
  shouldHide: boolean
  /** True → surface in FDE audit view for offline follow-up (questions/complaints/other). */
  needsHuman: boolean
  /** Claim-filter flags that were tripped on the LLM draft (empty = clean). */
  guardrailFlags: string[]
  /** Where publicReply came from — 'llm' (praise draft) or 'fallback' (safe template). */
  replySource: 'llm' | 'fallback' | 'none'
}

interface LlmClassification {
  category: CommentCategory
  confidence: number
  purchase_intent: boolean
  praise_reply: string | null
}

const SYSTEM_PROMPT = `You are a social media community manager for a travel/tourism brand in Australia/New Zealand.
Classify a single Facebook comment and, ONLY if it is genuine praise, draft a short warm reply.

Categories:
- "praise": positive feedback, compliments, sharing a good memory ("amazing experience", "loved it")
- "question": asks anything that needs a factual answer (price, dates, what's included, how to book, availability)
- "complaint": negative feedback, dissatisfaction, a problem
- "spam": promotion, links, gibberish, unrelated
- "other": anything that fits none of the above

Rules for the praise reply (praise_reply) — CRITICAL:
- ONLY fill praise_reply when category is "praise". Otherwise set it to null.
- NEVER state any price, discount, date, duration, itinerary detail, or "we arrange/include X" claim. You do not have that information and must not invent it.
- Keep it to 1-2 warm sentences, thanking them. You may gently invite them to reach out. No specific facts.
- Match warm AU/NZ English. One or two emoji max.

Also set purchase_intent=true if the commenter signals they want to travel/book/go (so we can DM them).

Respond with ONLY a JSON object:
{"category":"...","confidence":0.0-1.0,"purchase_intent":true|false,"praise_reply":"..."|null}`

function buildUserPrompt(commentText: string): string {
  return `Comment: """${commentText.slice(0, 800)}"""\n\nReturn the JSON object.`
}

function parseClassification(raw: string): LlmClassification | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as Partial<LlmClassification>
    const category = obj.category
    if (!category || !['praise', 'question', 'complaint', 'spam', 'other'].includes(category)) {
      return null
    }
    return {
      category,
      confidence: typeof obj.confidence === 'number' ? obj.confidence : 0.5,
      purchase_intent: obj.purchase_intent === true,
      praise_reply: typeof obj.praise_reply === 'string' ? obj.praise_reply : null,
    }
  } catch {
    return null
  }
}

/**
 * Classify a comment and decide the full auto-reply action.
 * On any LLM/parse failure, returns a safe 'other' decision that routes to a
 * human — it never guesses or auto-sends when uncertain.
 */
export async function classifyComment(
  commentText: string,
  ctx: ReplyContext,
): Promise<CommentDecision> {
  let llm: LlmClassification | null = null
  try {
    const anthropic = getAnthropicClient()
    const message = await anthropic.messages.create({
      model: MODEL_HAIKU,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(commentText) }],
    })
    const rawText = message.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('')
    llm = parseClassification(rawText)
  } catch (err) {
    console.error('[comment-classifier] LLM error:', err)
  }

  if (!llm) {
    // Uncertain → never auto-send. Route to human.
    return {
      category: 'other', confidence: 0, publicReply: null, privateReply: null,
      shouldHide: false, needsHuman: true, guardrailFlags: [], replySource: 'none',
    }
  }

  return decideByCategory(llm, ctx)
}

/** Map an LLM classification to a guardrailed reply decision. Pure + testable. */
export function decideByCategory(llm: LlmClassification, ctx: ReplyContext): CommentDecision {
  switch (llm.category) {
    case 'praise': {
      const draft = llm.praise_reply?.trim()
      const flags = draft ? detectUnverifiableClaims(draft) : []
      const clean = draft && flags.length === 0
      return {
        category: 'praise',
        confidence: llm.confidence,
        publicReply: clean ? draft! : safePraiseReply(ctx),
        // DM only when they signal intent — avoids spamming every "nice pic".
        privateReply: llm.purchase_intent ? safeQuestionPrivateReply(ctx) : null,
        shouldHide: false,
        needsHuman: false,
        guardrailFlags: flags,
        replySource: clean ? 'llm' : 'fallback',
      }
    }
    case 'question':
      return {
        category: 'question', confidence: llm.confidence,
        publicReply: safeQuestionPublicReply(ctx),
        privateReply: safeQuestionPrivateReply(ctx),
        shouldHide: false, needsHuman: true, guardrailFlags: [], replySource: 'fallback',
      }
    case 'complaint':
      return {
        category: 'complaint', confidence: llm.confidence,
        publicReply: safeComplaintPublicReply(ctx),
        privateReply: safeComplaintPrivateReply(ctx),
        shouldHide: false, needsHuman: true, guardrailFlags: [], replySource: 'fallback',
      }
    case 'spam':
      return {
        category: 'spam', confidence: llm.confidence, publicReply: null, privateReply: null,
        shouldHide: true, needsHuman: false, guardrailFlags: [], replySource: 'none',
      }
    default:
      return {
        category: 'other', confidence: llm.confidence, publicReply: null, privateReply: null,
        shouldHide: false, needsHuman: true, guardrailFlags: [], replySource: 'none',
      }
  }
}
