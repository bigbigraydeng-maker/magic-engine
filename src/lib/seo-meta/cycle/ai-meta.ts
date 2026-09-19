/**
 * SEO Meta-Cycle v1 — AI title/description generation for the auto
 * `title_rewrite` action.
 *
 * Generalised version of cts-meta-pr.ts's `generateCtsMeta`: same
 * model/shape/JSON-parsing approach, but the brand-voice sentence comes from
 * `clients.seo_config.meta_cycle_brand_voice` (L4) instead of being
 * hardcoded "NZ China-travel voice" text — spec §6 explicitly calls this out
 * as one of the things that must move out of shared code.
 */

import Anthropic from '@anthropic-ai/sdk'
import { parseJsonResponse } from '@/lib/anthropic/client'

const MAX_TITLE_CHARS = 60
const MAX_DESC_CHARS = 155

export async function generateMetaCycleTitle(
  keyword: string,
  pageUrl: string,
  brandVoice: string,
  /** Top-3 competitor page titles from step 2's SERP enrichment — gives the
   *  model real competitive context instead of guessing in a vacuum. */
  competitorTitles: string[] = [],
): Promise<{ title: string; desc: string }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const competitorBlock = competitorTitles.length > 0
    ? `\nTop-ranking competitor pages for this keyword (for context, do not copy):\n${competitorTitles.map((t) => `- ${t}`).join('\n')}`
    : ''

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: `You are an SEO specialist. Voice/tone: ${brandVoice}

Target keyword: "${keyword}"
Page URL: ${pageUrl}${competitorBlock}

Rules:
- Title: max ${MAX_TITLE_CHARS} chars, keyword near the start
- Description: max ${MAX_DESC_CHARS} chars, include the keyword + a clear call to action
- Factual tone — do NOT invent prices, dates or itinerary/product details
- No quotes inside the text

Respond ONLY with valid JSON: {"title":"...","desc":"..."}`,
      },
    ],
  })
  const text = msg.content[0].type === 'text' ? msg.content[0].text.trim() : '{}'
  try {
    const p = parseJsonResponse<{ title?: string; desc?: string }>(text)
    return {
      title: (p.title ?? keyword).slice(0, MAX_TITLE_CHARS),
      desc: (p.desc ?? '').slice(0, MAX_DESC_CHARS),
    }
  } catch {
    return { title: keyword.slice(0, MAX_TITLE_CHARS), desc: '' }
  }
}
