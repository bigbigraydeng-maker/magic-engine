/**
 * 司马迁 · 口碑周巡的「起草」层。
 *
 * 每周四读 review_items 里本轮新出现的客户自己的 Google 评价（is_new=true，
 * 由 reputation-snapshots-weekly 每周一写入），给每条起草一段回复，
 * 另起草一条「客户好评」帖子草稿。
 *
 * **一律不发**：口碑维度 FDE-only、GBP 发帖审批制（CLAUDE.md），
 * 产出只进今日待办三件套。读不到 = 不判，不给默认值。
 *
 * spec: docs/specs/2026-09-24-agent-autonomy-operating-plan-v1.md §4.1（司马迁）· B2
 * 数据来源：review_items 由 src/lib/reputation/snapshots.ts 每周一写入（DataForSEO 计划 阶段 2）
 */

import { callClaudeChat, MODEL_HAIKU, type ClaudeCallResult } from '@/lib/anthropic/client'

export interface NewReviewRow {
  review_uid: string
  author: string | null
  rating: number | null
  text: string | null
  review_date: string | null
}

export interface ReviewReplyDraft {
  review_uid: string
  author: string | null
  rating: number | null
  /** 评价原文前 160 字，给待办看 */
  text_excerpt: string
  /** null = 没起草（原因见 reason） */
  reply_draft: string | null
  reason: string | null
  cost_usd: number
}

export type ClientPatrolStatus = 'drafted' | 'no_new_reviews' | 'read_failed' | 'draft_failed'

export interface ClientPatrolReceipt {
  client_id: string
  client_name: string
  status: ClientPatrolStatus
  new_reviews: number
  negative_reviews: number
  replies: ReviewReplyDraft[]
  post_draft: string | null
  cost_usd: number
  error: string | null
}

export type DraftLlm = typeof callClaudeChat

export const NEGATIVE_RATING_CEILING = 2
export const PRAISE_RATING_FLOOR = 4
export const MAX_REPLY_WORDS = 80

// ── Pure helpers ────────────────────────────────────────────────────────────────

/** 评价原文截断：去首尾空白、折叠内部空白、超长加省略号。 */
export function excerpt(text: string | null, max = 160): string {
  if (!text) return ''
  const collapsed = text.trim().replace(/\s+/g, ' ')
  if (collapsed.length <= max) return collapsed
  return `${collapsed.slice(0, max)}…`
}

/** 差评计数：rating 非空且 ≤ NEGATIVE_RATING_CEILING。 */
export function countNegative(reviews: readonly NewReviewRow[]): number {
  return reviews.filter(r => r.rating !== null && r.rating <= NEGATIVE_RATING_CEILING).length
}

/** 起草回复的 system prompt —— 硬规则逐行列出，绝不编造。 */
export function buildReplySystemPrompt(brandName: string): string {
  return [
    `You draft the business owner's public reply to ONE Google review for ${brandName} (an AU/NZ business — use AU/NZ English spelling).`,
    'Hard rules:',
    `- The reply must be ${MAX_REPLY_WORDS} words or fewer.`,
    '- Thank the reviewer by first name if one is given.',
    '- NEVER invent prices, dates, discounts, phone numbers, emails, staff names, or promises of refunds/compensation.',
    '- For ratings of 2 or below, apologise sincerely, do not argue, and invite them to reach out to us directly (no contact details).',
    '- Do not mention competitors.',
    '- Output the reply text only — no quotes, no preamble, no markdown.',
  ].join('\n')
}

/** 起草回复的 user message —— 星级、作者、日期、原文。 */
export function buildReplyUserMessage(review: NewReviewRow): string {
  return [
    `Rating: ${review.rating ?? 'unknown'}`,
    `Author: ${review.author ?? 'anonymous'}`,
    `Date: ${review.review_date ?? 'unknown'}`,
    `Review: ${review.text ?? ''}`,
  ].join('\n')
}

/** 好评帖子草稿的 system + user prompt。 */
export function buildPraisePostPrompt(
  brandName: string,
  reviews: readonly NewReviewRow[],
): { system: string; user: string } {
  const system = [
    `You draft ONE Google Business Profile post for ${brandName} (an AU/NZ business — use AU/NZ English spelling).`,
    'Hard rules:',
    '- The post must be 120 words or fewer.',
    '- Thank customers and quote at most two of the supplied reviews verbatim or lightly trimmed.',
    '- NEVER invent prices, dates, discounts, phone numbers, emails, staff names, or promises of refunds/compensation.',
    '- No hashtags.',
    '- No call-to-action containing prices or dates.',
    '- Output the post text only — no quotes, no preamble, no markdown.',
  ].join('\n')
  const user = reviews
    .map(r => `Rating: ${r.rating ?? 'unknown'} | Author: ${r.author ?? 'anonymous'}\n${r.text ?? ''}`)
    .join('\n\n')
  return { system, user }
}

/** 可引用进帖子的好评：rating ≥ 4 且文字 ≥ 40 字，最多 2 条，保持原顺序。 */
export function praiseCandidates(reviews: readonly NewReviewRow[]): NewReviewRow[] {
  return reviews
    .filter(r => r.rating !== null && r.rating >= PRAISE_RATING_FLOOR)
    .filter(r => (r.text ?? '').trim().length >= 40)
    .slice(0, 2)
}

// ── Orchestration ───────────────────────────────────────────────────────────────

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 单条评价起草回复。任何失败都不抛，落进 reason。 */
export async function draftReplyFor(
  brandName: string,
  review: NewReviewRow,
  llm: DraftLlm = callClaudeChat,
): Promise<ReviewReplyDraft> {
  const base: ReviewReplyDraft = {
    review_uid: review.review_uid,
    author: review.author,
    rating: review.rating,
    text_excerpt: excerpt(review.text),
    reply_draft: null,
    reason: null,
    cost_usd: 0,
  }

  if (!review.text?.trim()) {
    return { ...base, reason: '评价只有星级没有文字，不起草' }
  }

  try {
    const result: ClaudeCallResult = await llm({
      systemPrompt: buildReplySystemPrompt(brandName),
      messages: [{ role: 'user', content: buildReplyUserMessage(review) }],
      model: MODEL_HAIKU,
      singleAttempt: true,
      maxOutputTokens: 400,
    })
    const text = result.text.trim()
    if (!text) {
      return { ...base, reason: 'AI 返回空文本', cost_usd: result.cost_usd }
    }
    return { ...base, reply_draft: text, cost_usd: result.cost_usd }
  } catch (err) {
    return { ...base, reason: `起草失败：${errorMessage(err)}` }
  }
}

/** 好评帖子草稿。任何失败都不抛，落进 reason。 */
export async function draftPraisePost(
  brandName: string,
  reviews: readonly NewReviewRow[],
  llm: DraftLlm = callClaudeChat,
): Promise<{ post_draft: string | null; cost_usd: number; reason: string | null }> {
  const candidates = praiseCandidates(reviews)
  if (candidates.length === 0) {
    return { post_draft: null, cost_usd: 0, reason: '本周没有带文字的好评，不写帖子' }
  }

  const { system, user } = buildPraisePostPrompt(brandName, candidates)
  try {
    const result: ClaudeCallResult = await llm({
      systemPrompt: system,
      messages: [{ role: 'user', content: user }],
      model: MODEL_HAIKU,
      singleAttempt: true,
      maxOutputTokens: 500,
    })
    const text = result.text.trim()
    if (!text) {
      return { post_draft: null, cost_usd: result.cost_usd, reason: 'AI 返回空文本' }
    }
    return { post_draft: text, cost_usd: result.cost_usd, reason: null }
  } catch (err) {
    return { post_draft: null, cost_usd: 0, reason: `起草失败：${errorMessage(err)}` }
  }
}

/** 一个客户的整轮起草：逐条回复（串行，避 provider 限流）再写帖子。 */
export async function draftForClient(
  input: { clientId: string; clientName: string; reviews: readonly NewReviewRow[] },
  llm: DraftLlm = callClaudeChat,
): Promise<ClientPatrolReceipt> {
  const { clientId, clientName, reviews } = input

  if (reviews.length === 0) {
    return {
      client_id: clientId,
      client_name: clientName,
      status: 'no_new_reviews',
      new_reviews: 0,
      negative_reviews: 0,
      replies: [],
      post_draft: null,
      cost_usd: 0,
      error: null,
    }
  }

  const replies: ReviewReplyDraft[] = []
  for (const review of reviews) {
    replies.push(await draftReplyFor(clientName, review, llm))
  }

  const post = await draftPraisePost(clientName, reviews, llm)
  const cost = replies.reduce((sum, r) => sum + r.cost_usd, 0) + post.cost_usd
  const anyDraft = replies.some(r => r.reply_draft !== null) || post.post_draft !== null
  const firstReason = replies.find(r => r.reason !== null)?.reason ?? post.reason

  return {
    client_id: clientId,
    client_name: clientName,
    status: anyDraft ? 'drafted' : 'draft_failed',
    new_reviews: reviews.length,
    negative_reviews: countNegative(reviews),
    replies,
    post_draft: post.post_draft,
    cost_usd: cost,
    error: anyDraft ? null : firstReason,
  }
}
