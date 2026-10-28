/**
 * SEO Meta-Cycle v1 — AI title/description generation for the `title_rewrite`
 * action.
 *
 * Generalised version of cts-meta-pr.ts's `generateCtsMeta`: same
 * model/shape/JSON-parsing approach, but the brand-voice sentence comes from
 * `clients.seo_config.meta_cycle_brand_voice` (L4) instead of being
 * hardcoded "NZ China-travel voice" text.
 *
 * PM 2026-09-20 拍板 item 4: the prompt carries the full context the
 * candidate pipeline already gathered — keyword, search volume, difficulty,
 * current ranking position/CTR, and the top-3 competitor page titles —
 * instead of just the bare keyword.
 */

import Anthropic from '@anthropic-ai/sdk'
import { parseJsonResponse } from '@/lib/anthropic/client'

const MAX_TITLE_CHARS = 60
const MAX_DESC_CHARS = 155

export interface MetaGenerationInput {
  keyword: string
  pageUrl: string
  searchVolume: number | null
  keywordDifficulty: number | null
  position: number | null
  /** 0-1 decimal fraction. */
  ctr: number | null
  brandVoice: string
  competitorTitles: string[]
  /** The page's current title/description — the generator rewrites these rather than inventing copy (2026-10-28). */
  currentTitle?: string
  currentDesc?: string
  /** Facts from the current text that must survive the rewrite (see listHardFacts). */
  factsToKeep?: string[]
  /** Reason the previous attempt was rejected, for the single fact-aware retry. */
  retryFeedback?: string
}

/** Prompt assembly kept out of generateMetaCycleTitle to stay under the 50-line budget. */
function buildPrompt(input: MetaGenerationInput): string {
  const contextLines = [
    `Target keyword: "${input.keyword}"`,
    `Page URL: ${input.pageUrl}`,
    input.searchVolume !== null ? `Monthly search volume: ${input.searchVolume}` : null,
    input.keywordDifficulty !== null ? `Keyword difficulty (0-100): ${input.keywordDifficulty}` : null,
    input.position !== null ? `Current Google ranking position: #${input.position}` : null,
    input.ctr !== null ? `Current click-through rate: ${(input.ctr * 100).toFixed(2)}%` : null,
  ].filter((l): l is string => l !== null).join('\n')

  const competitorBlock = input.competitorTitles.length > 0
    ? `\nTop-ranking competitor pages for this keyword (for context, do not copy):\n${input.competitorTitles.map((t) => `- ${t}`).join('\n')}`
    : ''

  // 2026-10-28: the generator must see the current text and the facts the hard
  // check will require — without them it wrote generic copy that dropped every
  // concrete detail and was blocked on every run.
  const currentBlock = [
    input.currentTitle !== undefined ? `Current title: ${input.currentTitle}` : null,
    input.currentDesc !== undefined ? `Current description: ${input.currentDesc}` : null,
    input.factsToKeep && input.factsToKeep.length > 0
      ? `These facts from the current text MUST appear unchanged in your new title or description (keep the exact numbers/names): ${input.factsToKeep.join('; ')}`
      : null,
    input.retryFeedback ? `Your previous attempt was rejected: ${input.retryFeedback}. Fix exactly that.` : null,
  ].filter((l): l is string => l !== null).join('\n')

  return `You are an SEO specialist. Voice/tone: ${input.brandVoice}

${contextLines}${competitorBlock}${currentBlock ? `\n${currentBlock}` : ''}

Rules:
- Title: max ${MAX_TITLE_CHARS} chars, keyword near the start
- Description: max ${MAX_DESC_CHARS} chars, include the keyword + a clear call to action
- Rewrite the CURRENT text to improve it for the target keyword; keep it specific to this page — do not replace concrete details with generic marketing phrases
- Do NOT add any number, price, date, place name or acronym that is not in the current text
- Factual tone — do NOT invent prices, dates or itinerary/product details
- No quotes inside the text

Respond ONLY with valid JSON: {"title":"...","desc":"..."}`
}

export async function generateMetaCycleTitle(input: MetaGenerationInput): Promise<{ title: string; desc: string }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{ role: 'user', content: buildPrompt(input) }],
  })
  const text = msg.content[0].type === 'text' ? msg.content[0].text.trim() : '{}'
  try {
    const p = parseJsonResponse<{ title?: string; desc?: string }>(text)
    return {
      title: (p.title ?? input.keyword).slice(0, MAX_TITLE_CHARS),
      desc: (p.desc ?? '').slice(0, MAX_DESC_CHARS),
    }
  } catch {
    return { title: input.keyword.slice(0, MAX_TITLE_CHARS), desc: '' }
  }
}
