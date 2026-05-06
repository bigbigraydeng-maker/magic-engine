/**
 * Page Upgrader — Phase 8.D.2.2
 *
 * Generates an upgrade recommendation for an existing client page:
 *   1. Loads the SitePage record from client_site_pages
 *   2. Re-fetches the live page via Jina for fresh content (with fallback)
 *   3. Loads the active GEO directive HTML
 *   4. Calls GPT-4o (JSON mode) for a structured upgrade plan
 *
 * Returns an UpgradeRecommendation. The caller / UI shows it as a
 * diff-style preview; the team applies changes manually to the
 * client CMS — we do NOT auto-publish.
 *
 * Reference: ROADMAP.md P8.D.2.2
 */

import OpenAI from 'openai'
import { fetchUrlAsMarkdown } from '@/lib/brief/jina'
import { getActiveGeoHtml } from '@/lib/geo/html-generator'
import { supabaseAdmin } from '@/lib/supabase'
import type { SitePage } from '@/types/magic-engine'

const PRICE_INPUT_PER_M = 2.5
const PRICE_OUTPUT_PER_M = 10.0
const MARKDOWN_LIMIT = 8000   // keep prompt size sane

export interface UpgradeRecommendation {
  page_id: string
  page_url: string
  current_word_count: number | null
  current_has_geo_block: boolean
  what_to_add: string[]
  what_to_strengthen: string[]
  meta_title_suggestion: string | null
  meta_description_suggestion: string | null
  upgraded_html_preview: string
  rationale: string
  geo_directive_id: string | null
  cost_usd: number
  model_used: string
}

const SYSTEM_PROMPT = `You are an expert SEO + GEO content editor for AU/NZ markets.
You will receive a client's existing web page (markdown) plus the active GEO directive
the client wants to embed. Produce a JSON upgrade plan that:
  - identifies sections to add (FAQs, tables, examples, comparison notes)
  - identifies thin paragraphs to strengthen with concrete depth
  - drafts an upgraded HTML body that already incorporates the additions
  - improves meta title and description while staying under length limits
  - explicitly mentions the brand 3+ times for AI entity signal
  - uses NZ/AU English spelling

OUTPUT: valid JSON only. Schema:
{
  "what_to_add": ["string", ...],
  "what_to_strengthen": ["string", ...],
  "meta_title_suggestion": "≤60 chars or null",
  "meta_description_suggestion": "≤155 chars or null",
  "upgraded_html_preview": "full <h1>…</h1>… HTML for the upgraded page",
  "rationale": "one paragraph explaining the changes"
}`

export async function upgradePage(
  clientId: string,
  pageId: string
): Promise<UpgradeRecommendation> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set')

  // 1. Load the page record
  const { data: page } = await supabaseAdmin
    .from('client_site_pages')
    .select('*')
    .eq('id', pageId)
    .single<SitePage>()

  if (!page) throw new Error(`Site page ${pageId} not found`)
  if (page.client_id !== clientId)
    throw new Error(`Page ${pageId} does not belong to client ${clientId}`)

  // 2. Re-fetch live content (best effort)
  let liveMarkdown: string | null = null
  try {
    const fetched = await fetchUrlAsMarkdown(page.url)
    liveMarkdown = fetched.markdown
  } catch {
    liveMarkdown = null
  }
  const sourceMd = (liveMarkdown ?? page.content_summary ?? '').slice(0, MARKDOWN_LIMIT)

  // 3. Active GEO directive
  const geo = await getActiveGeoHtml(clientId).catch(() => null)

  // 4. GPT call
  const openai = new OpenAI({ apiKey })
  const userMsg = buildUserMessage({
    page,
    sourceMd,
    geoDirectiveId: geo?.directiveId ?? null,
    geoHtml: geo?.html ?? null,
  })

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    response_format: { type: 'json_object' },
    max_tokens: 4096,
    temperature: 0.4,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMsg },
    ],
  })

  const raw = completion.choices[0]?.message?.content ?? '{}'
  let parsed: any = {}
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = {}
  }

  const usage = completion.usage
  const costUsd = usage
    ? (usage.prompt_tokens / 1_000_000) * PRICE_INPUT_PER_M +
      (usage.completion_tokens / 1_000_000) * PRICE_OUTPUT_PER_M
    : 0

  return {
    page_id: page.id,
    page_url: page.url,
    current_word_count: page.word_count,
    current_has_geo_block: !!page.has_geo_block,
    what_to_add: Array.isArray(parsed.what_to_add) ? parsed.what_to_add.slice(0, 12) : [],
    what_to_strengthen: Array.isArray(parsed.what_to_strengthen)
      ? parsed.what_to_strengthen.slice(0, 12)
      : [],
    meta_title_suggestion:
      typeof parsed.meta_title_suggestion === 'string'
        ? parsed.meta_title_suggestion.slice(0, 60)
        : null,
    meta_description_suggestion:
      typeof parsed.meta_description_suggestion === 'string'
        ? parsed.meta_description_suggestion.slice(0, 155)
        : null,
    upgraded_html_preview:
      typeof parsed.upgraded_html_preview === 'string'
        ? parsed.upgraded_html_preview
        : `<h1>${page.title ?? page.url}</h1>`,
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
    geo_directive_id: geo?.directiveId ?? null,
    cost_usd: Math.round(costUsd * 1_000_000) / 1_000_000,
    model_used: 'gpt-4o',
  }
}

function buildUserMessage(p: {
  page: SitePage
  sourceMd: string
  geoDirectiveId: string | null
  geoHtml: string | null
}): string {
  return `EXISTING PAGE:
URL: ${p.page.url}
Title: ${p.page.title ?? '(none)'}
Page type: ${p.page.page_type}
Topics: ${(p.page.topics ?? []).join(', ') || '(none)'}
Primary keyword: ${p.page.primary_keyword ?? '(unset)'}
Word count: ${p.page.word_count ?? 'unknown'}
Has GEO block already: ${p.page.has_geo_block ? 'yes' : 'NO — must be added'}

CURRENT CONTENT (markdown / cached summary):
${p.sourceMd}

ACTIVE GEO DIRECTIVE: ${p.geoDirectiveId ?? '(none)'}
${p.geoHtml ? `GEO HTML to embed:\n${p.geoHtml.slice(0, 2000)}` : ''}

Produce the JSON upgrade plan now.`
}
