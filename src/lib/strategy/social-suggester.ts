/**
 * Social Content Suggester — Phase 8.D.2.4
 *
 * After a blog post is approved, generate three platform-specific
 * social content angles (Facebook / Instagram / LinkedIn) and
 * persist them as content_strategy_items so the team sees the
 * amplification work in the same panel.
 *
 * Reference: ROADMAP.md P8.D.2.4
 */

import OpenAI from 'openai'
import { insertStrategyItems } from '@/lib/db/strategy-items'
import type { ContentStrategyInsert } from '@/types/magic-engine'

const PRICE_INPUT_PER_M = 0.15
const PRICE_OUTPUT_PER_M = 0.6
const PLATFORMS = ['facebook', 'instagram', 'linkedin'] as const
export type SocialPlatform = (typeof PLATFORMS)[number]

export interface SocialSuggestion {
  platform: SocialPlatform
  headline: string
  body: string
}

export interface SocialSuggesterInput {
  client_id: string
  blog_post_id: string
  title: string
  html_body: string
  primary_keyword?: string | null
  strategy_run_id?: string
}

export interface SocialSuggesterOutput {
  suggestions: SocialSuggestion[]
  inserted: number
  cost_usd: number
}

const SYSTEM_PROMPT = `You are a paid + organic social strategist for AU/NZ markets.
You'll be given a blog post that the brand just published. Produce three platform-specific
post angles that amplify the article — one each for Facebook, Instagram, LinkedIn.

Tone:
- Facebook: friendly, community feel, ask a question
- Instagram: punchy hook, visual-first, 1 hashtag-friendly line
- LinkedIn: B2B, insight-led, opens with a stat or POV

OUTPUT: JSON only.
{
  "suggestions": [
    { "platform": "facebook" | "instagram" | "linkedin",
      "headline": "1-line hook",
      "body": "2-3 sentence post body" },
    ...
  ]
}`

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1500)
}

export function parseSuggestions(raw: unknown): SocialSuggestion[] {
  if (!raw || typeof raw !== 'object') return []
  const arr = (raw as { suggestions?: unknown[] }).suggestions
  if (!Array.isArray(arr)) return []

  const seen = new Set<SocialPlatform>()
  const out: SocialSuggestion[] = []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    const platform = obj.platform as string
    const headline = obj.headline as string
    const body = obj.body as string
    if (!PLATFORMS.includes(platform as SocialPlatform)) continue
    if (seen.has(platform as SocialPlatform)) continue
    if (typeof headline !== 'string' || headline.trim().length === 0) continue
    if (typeof body !== 'string' || body.trim().length === 0) continue
    seen.add(platform as SocialPlatform)
    out.push({
      platform: platform as SocialPlatform,
      headline: headline.trim(),
      body: body.trim(),
    })
    if (out.length >= 3) break
  }
  return out
}

export async function generateSocialSuggestions(
  input: SocialSuggesterInput
): Promise<SocialSuggesterOutput> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set')

  const openai = new OpenAI({ apiKey })

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    max_tokens: 800,
    temperature: 0.8,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `BLOG POST TITLE: ${input.title}
PRIMARY KEYWORD: ${input.primary_keyword ?? '(unset)'}
EXCERPT: ${stripHtml(input.html_body)}

Produce 3 platform-specific social angles now.`,
      },
    ],
  })

  const raw = completion.choices[0]?.message?.content ?? '{}'
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = null
  }

  const suggestions = parseSuggestions(parsed)

  const usage = completion.usage
  const costUsd = usage
    ? (usage.prompt_tokens / 1_000_000) * PRICE_INPUT_PER_M +
      (usage.completion_tokens / 1_000_000) * PRICE_OUTPUT_PER_M
    : 0

  if (suggestions.length === 0) {
    return { suggestions: [], inserted: 0, cost_usd: costUsd }
  }

  const rows: ContentStrategyInsert[] = suggestions.map((s) => ({
    client_id: input.client_id,
    strategy_run_id:
      input.strategy_run_id ?? `social-${input.blog_post_id}-${Date.now()}`,
    action_type: 'social_content',
    content_mode: 'seo_only',
    priority_score: 30,
    proposed_title: `[${s.platform}] ${s.headline}`,
    rationale: s.body,
    linked_blog_post_id: input.blog_post_id,
  })) as any

  const inserted = await insertStrategyItems(rows)

  return {
    suggestions,
    inserted: inserted.length,
    cost_usd: Math.round(costUsd * 1_000_000) / 1_000_000,
  }
}
