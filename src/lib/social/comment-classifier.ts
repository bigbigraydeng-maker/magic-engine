/**
 * Comment classifier + reply decision engine.
 *
 * The LLM is trusted for exactly ONE free-form job: writing a warm reply to
 * genuine praise. Everything else (questions, complaints, spam) is handled by
 * deterministic safe templates in comment-guardrails.ts — the LLM is NEVER
 * allowed to author an answer to a factual question.
 *
 * A praise draft is only used if it clears isPraiseReplySafe() (no digit, link,
 * handle, or claim shape) AND the classifier is confident (>= threshold).
 * Otherwise it falls back to a rotating safe template. So the worst case from
 * an adversarial commenter is a claim-free thank-you.
 *
 * DM-first: for questions/complaints the engine sends the DM first, then picks
 * the public reply — publicReplyAfterDm when the DM landed (so it can say
 * "we've messaged you"), publicReply otherwise (no false "we messaged you").
 */

import { getAnthropicClient, MODEL_HAIKU } from '@/lib/anthropic/client'
import {
  ReplyContext,
  isPraiseReplySafe,
  detectUnverifiableClaims,
  safePraiseReply,
  safeQuestionPublicReplyNoDm,
  safeQuestionPublicReplyWithDm,
  safeQuestionPrivateReply,
  safeComplaintPublicReplyNoDm,
  safeComplaintPublicReplyWithDm,
  safeComplaintPrivateReply,
} from './comment-guardrails'

export type CommentCategory = 'praise' | 'question' | 'complaint' | 'spam' | 'other'

/** Praise below this classifier confidence falls back to a safe template. */
export const PRAISE_CONFIDENCE_THRESHOLD = 0.85

export interface CommentDecision {
  category: CommentCategory
  confidence: number
  /** Public reply to post when no DM is sent (praise reply, or question/complaint no-DM variant). */
  publicReply: string | null
  /** Public reply to post INSTEAD when a DM was successfully sent (question/complaint only). */
  publicReplyAfterDm: string | null
  /** Private (DM) reply, or null. */
  privateReply: string | null
  shouldHide: boolean
  needsHuman: boolean
  guardrailFlags: string[]
  replySource: 'llm' | 'fallback' | 'none'
}

interface LlmClassification {
  category: CommentCategory
  confidence: number
  purchase_intent: boolean
  praise_reply: string | null
}

const SYSTEM_PROMPT = `You are a social media community manager for a travel/tourism brand in Australia/New Zealand with an older, sincere audience.
Classify a single Facebook comment and, ONLY if it is genuine praise, draft a short warm reply.

Categories:
- "praise": positive feedback, compliments, sharing a good memory ("amazing experience", "loved it")
- "question": asks anything that needs a factual answer (price, dates, what's included, how to book, availability)
- "complaint": negative feedback, dissatisfaction, a problem
- "spam": promotion, links, gibberish, unrelated
- "other": anything that fits none of the above

Rules for the praise reply (praise_reply) — CRITICAL:
- ONLY fill praise_reply when category is "praise". Otherwise set it to null.
- NEVER state any price, discount, date, duration, itinerary detail, phone, link, or "we arrange/include X" claim, and NEVER include any digit. You do not have that information and must not invent it.
- Do NOT add a sales invitation or "plan your next trip / next adventure" line — especially if the comment is a memory or a general compliment. Just warmly acknowledge what they actually said.
- Reference the specific thing they mentioned (a place, a memory, their experience) in a natural, grounded tone — avoid peppy marketing language.
- 1-2 warm sentences. At most one emoji, and only if it feels natural (prefer 🙏 for thanks). AU/NZ English.

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
 * On any LLM/parse failure returns a safe 'other' decision that routes to a
 * human — it never guesses or auto-sends when uncertain.
 *
 * @param seed rotates praise fallback templates to avoid a botted-looking feed.
 */
export async function classifyComment(
  commentText: string,
  ctx: ReplyContext,
  seed = 0,
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
    return {
      category: 'other', confidence: 0, publicReply: null, publicReplyAfterDm: null,
      privateReply: null, shouldHide: false, needsHuman: true, guardrailFlags: [], replySource: 'none',
    }
  }

  return decideByCategory(llm, ctx, seed)
}

/** Map an LLM classification to a guardrailed reply decision. Pure + testable. */
export function decideByCategory(llm: LlmClassification, ctx: ReplyContext, seed = 0): CommentDecision {
  switch (llm.category) {
    case 'praise': {
      const draft = llm.praise_reply?.trim()
      const flags = draft ? detectUnverifiableClaims(draft) : []
      // Use the LLM draft only if it's confident AND clears the strict praise gate.
      const clean = !!draft
        && llm.confidence >= PRAISE_CONFIDENCE_THRESHOLD
        && isPraiseReplySafe(draft)
      return {
        category: 'praise',
        confidence: llm.confidence,
        publicReply: clean ? draft! : safePraiseReply(ctx, seed),
        publicReplyAfterDm: null,
        // DM only on genuine purchase intent — avoids spamming every "nice pic".
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
        publicReply: safeQuestionPublicReplyNoDm(ctx),
        publicReplyAfterDm: safeQuestionPublicReplyWithDm(ctx),
        privateReply: safeQuestionPrivateReply(ctx),
        shouldHide: false, needsHuman: true, guardrailFlags: [], replySource: 'fallback',
      }
    case 'complaint':
      return {
        category: 'complaint', confidence: llm.confidence,
        publicReply: safeComplaintPublicReplyNoDm(ctx),
        publicReplyAfterDm: safeComplaintPublicReplyWithDm(ctx),
        privateReply: safeComplaintPrivateReply(ctx),
        shouldHide: false, needsHuman: true, guardrailFlags: [], replySource: 'fallback',
      }
    case 'spam':
      return {
        category: 'spam', confidence: llm.confidence, publicReply: null, publicReplyAfterDm: null,
        privateReply: null, shouldHide: true, needsHuman: false, guardrailFlags: [], replySource: 'none',
      }
    default:
      return {
        category: 'other', confidence: llm.confidence, publicReply: null, publicReplyAfterDm: null,
        privateReply: null, shouldHide: false, needsHuman: true, guardrailFlags: [], replySource: 'none',
      }
  }
}
