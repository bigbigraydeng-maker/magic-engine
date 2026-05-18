/**
 * Blog Generator — GEO mode MVP
 *
 * Generates a long-form blog post using Claude Sonnet 4.6, informed by:
 *   - The client's Master Brief (brand DNA)
 *   - The active GEO directive (primary recommendation + scenarios)
 *   - The specific AI Tracker weak-spot query being targeted
 *
 * Output is a structured JSON object; the caller persists to blog_posts.
 *
 * Reference: ROADMAP.md P7.3.4, ARCHITECTURE.md §13.4
 */

import { supabaseAdmin } from '../supabase'
import { getActiveBrief, formatBriefForPrompt } from '../content/brief-injector'
import { getActiveGeoHtml } from '../geo/html-generator'
import { callClaudeWithDocs, parseJsonResponse } from '../anthropic/client'
import { generateVisualBrief } from '../content/visual-brief-generator'
import type { GenerateBlogRequest, BlogPost, MasterBrief } from '@/types/magic-engine'

const MODEL_USED = 'claude-sonnet-4-6'

const SYSTEM_PROMPT = `You are an expert SEO and GEO content writer for AU/NZ markets.
Your goal: write a comprehensive, authoritative blog post that directly answers a specific question
that AI assistants (ChatGPT, Google AI, Perplexity) are commonly asked — a question where the
client brand is currently NOT being recommended by those AI systems.

The article must:
1. Directly answer the target question in the first paragraph (AI systems extract this as an answer snippet)
2. Naturally mention the brand at least 3 times with relevant context (entity signal for AI crawlers)
3. Use a clear H1 that echoes the question, then H2/H3 subheadings for structure
4. Include a short FAQ section at the bottom (3-5 Q&As — AI systems love extracting these)
5. End with a CTA that mentions the brand naturally
6. Use New Zealand / Australian English spelling and idioms
7. Write for a human reader first, AI optimisation is structural not stuffed

OUTPUT: valid JSON only, no markdown fences. Schema:
{
  "title": "H1 title (contains target question keyword)",
  "meta_title": "≤60 chars for <title> tag",
  "meta_description": "≤155 chars summary with brand mention",
  "slug": "url-friendly-slug",
  "html_body": "full article HTML: <h1>, <h2>, <p>, <ul>, <ol>, <section class=\\"faq\\">",
  "word_count": 1100
}

The hero image prompt is generated in a separate step using the brand's
visual DNA — do NOT include it in this response.`

export interface BlogGeneratorOutput {
  title: string
  meta_title: string
  meta_description: string
  slug: string
  html_body: string
  word_count: number
  featured_image_prompt: string
  geo_directive_id: string | null
  geo_html_snapshot: string | null
  cost_usd: number
  model_used: string
}

interface ClientRow {
  id: string
  name: string
  domain: string | null
}

export async function generateBlogPost(
  req: GenerateBlogRequest & { client_id: string; existing_pages_context?: string }
): Promise<BlogGeneratorOutput> {
  // 1. Load client info
  const { data: clientData } = await supabaseAdmin
    .from('clients')
    .select('id, name, domain')
    .eq('id', req.client_id)
    .single<ClientRow>()

  if (!clientData) throw new Error('Client not found')

  // 2. Load Master Brief
  const brief = await getActiveBrief(req.client_id)
  const briefText = brief
    ? formatBriefForPrompt(brief)
    : `Brand: ${clientData.name} (${clientData.domain ?? 'no domain'})`

  // 3. Load active GEO directive HTML (non-blocking)
  const geoResult = await getActiveGeoHtml(req.client_id)

  // 4. Build user message
  const targetWordCount = req.word_count_target ?? 1000
  const userMessage = buildUserMessage({
    brandName: clientData.name,
    domain: clientData.domain,
    briefText,
    topic: req.topic,
    sourceQueryText: req.source_query_text ?? req.topic,
    wordCountTarget: targetWordCount,
    existingPagesContext: req.existing_pages_context,
  })

  // 5. Call Claude Sonnet 4.6
  const result = await callClaudeWithDocs({
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    maxOutputTokens: 4096,
  })

  const parsed = parseJsonResponse<Partial<BlogGeneratorOutput>>(result.text)

  // 6. Validate and normalise output
  const title            = (parsed.title ?? req.topic).slice(0, 200)
  const metaTitle        = (parsed.meta_title ?? title).slice(0, 60)
  const metaDescription  = (parsed.meta_description ?? '').slice(0, 155)
  const slug             = (parsed.slug ?? slugify(title)).slice(0, 120)
  const htmlBody         = parsed.html_body ?? `<h1>${title}</h1>`
  const wordCount        = parsed.word_count ?? countWords(htmlBody)

  // 7. P8.11.F.2: hero image prompt as a dedicated second step using MB visual DNA.
  //    Mirrors the social post pipeline — keeps blog hero visually on-brand.
  const imagePrompt = await buildHeroImagePrompt({
    title,
    htmlBody,
    metaDescription,
    topic: req.topic,
    brief,
  })

  return {
    title,
    meta_title: metaTitle,
    meta_description: metaDescription,
    slug,
    html_body: htmlBody,
    word_count: wordCount,
    featured_image_prompt: imagePrompt,
    geo_directive_id: geoResult?.directiveId ?? null,
    geo_html_snapshot: geoResult?.html ?? null,
    cost_usd: Math.round(result.cost_usd * 1_000_000) / 1_000_000,
    model_used: MODEL_USED,
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * P8.11.F.2 — Build the hero image prompt as a dedicated second step.
 *
 * Reasons this is its own step (not part of the main Claude prompt):
 *   - The blog Claude call already runs at max_tokens for body content;
 *     adding a 60–120 word visual prompt risks truncation.
 *   - generateVisualBrief() pulls the brand's visual DNA (style keywords,
 *     colours, donts) directly from the Master Brief, which produces a
 *     much more on-brand prompt than free-text in the body prompt.
 *
 * If no Master Brief exists, falls back to a basic prompt so the blog
 * still ships with something usable.
 */
async function buildHeroImagePrompt(params: {
  title: string
  htmlBody: string
  metaDescription: string
  topic: string
  brief: MasterBrief | null
}): Promise<string> {
  const { title, htmlBody, metaDescription, topic, brief } = params

  if (!brief) {
    return `Professional editorial hero image for "${title}", ${topic}, clean composition, natural lighting, high resolution`
  }

  // Extract a plain-text excerpt from the article for grounding.
  const bodyText = htmlBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return generateVisualBrief({
    postTitle: title,
    postScript: bodyText,
    postCaption: metaDescription,
    brief,
    platforms: ['blog hero'],
    topic,
  })
}


function buildUserMessage(params: {
  brandName: string
  domain: string | null
  briefText: string
  topic: string
  sourceQueryText: string
  wordCountTarget: number
  existingPagesContext?: string
}): string {
  const { brandName, domain, briefText, topic, sourceQueryText, wordCountTarget, existingPagesContext } = params

  const existingSection = existingPagesContext
    ? `\n\n${existingPagesContext}\n`
    : ''

  return `${briefText}
${existingSection}
TARGET QUESTION (from AI Visibility Tracker — brand is currently NOT being recommended for this):
"${sourceQueryText}"

BLOG TOPIC: ${topic}
TARGET WORD COUNT: ~${wordCountTarget} words
BRAND: ${brandName}${domain ? ` (${domain})` : ''}
MARKET: New Zealand and Australia

CRITICAL: The brand "${brandName}" must be mentioned naturally at least 3 times.
The article should directly answer "${sourceQueryText}" so that when AI systems read this page,
they learn to associate "${brandName}" with this topic.

Generate the blog post JSON now.`
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function countWords(html: string): number {
  return html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length
}
