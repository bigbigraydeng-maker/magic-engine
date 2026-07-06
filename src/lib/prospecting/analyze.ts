/**
 * Zhangqian prospect short-mode — Step 4 of the outbound pipeline.
 *
 * Reference: ROADMAP.md Phase 35 P35.5.
 *
 * A slim, deterministic version of the Zhangqian discovery scan for cold
 * prospects that already passed the rule-based qualification. Target cost
 * <$0.15 per prospect vs ~$0.57 for the full scan:
 *
 *   1. Homepage markdown via Site Analyzer (Jina)          ~free
 *   2. GEO probe: one AI-search question, brand mentioned?  ~$0.01
 *   3. Social activity via Apify (only if FB/IG known)      ~$0.03
 *   4. One Claude synthesis call → four-pillar scorecard,
 *      owner name, top problems, email hook                 ~$0.05
 *
 * Every stage degrades gracefully (missing env key / scrape failure →
 * null with a skip note) — a prospect analysis never throws.
 */

import { fetchUrlAsMarkdown } from '@/lib/brief/jina'
import { runOpenAI } from '@/lib/ai-tracker/runners/openai'
import { scrapeFacebookPage, scrapeInstagramProfile } from '@/lib/apify/social-scraper'
import { callClaudeChat, parseJsonResponse } from '@/lib/anthropic/client'
import { deriveSegment, type ProspectSegment } from './segment'
import type { ScoreSignal } from './score'

// ─── Result types (persisted verbatim into outbound_prospects.ai_report) ─────

export interface PillarScore {
  /** 0–100, higher = healthier (NOT opportunity — this is the customer-facing framing). */
  score:   number
  /** One plain-language sentence an owner instantly understands. */
  summary: string
}

export interface SocialActivity {
  platform:       'facebook' | 'instagram'
  followers:      number
  posts_last_30d: number
}

export interface GeoProbeResult {
  question:  string
  mentioned: boolean
  /** Competitor business names the AI answer surfaced instead. */
  competitors_mentioned: string[]
}

export interface ProspectAnalysis {
  analyzed_at:  string
  segment:      ProspectSegment
  owner_name:   string | null
  /** Three concrete, verifiable problems for the outreach email. */
  top_problems: string[]
  /** One personalised opening line referencing something real about the business. */
  email_hook:   string
  pillars: { seo: PillarScore; geo: PillarScore; social: PillarScore; gbp: PillarScore }
  geo_probe:       GeoProbeResult | null
  social_activity: SocialActivity | null
  skips:           string[]
  error?:          string
}

export interface ProspectAnalysisInput {
  business_name: string
  industry:      string
  city:          string
  country:       string          // 'AU' | 'NZ'
  website_url:   string | null
  domain:        string | null
  facebook_url:  string | null
  instagram_url: string | null
  rating:        number | null
  review_count:  number | null
  score_breakdown: ScoreSignal[] | null
}

// ─── Seed labels for the GEO probe question ───────────────────────────────────

/** Human phrasing per industry seed key, for "best X in <city>" questions. */
const INDUSTRY_LABELS: Record<string, string> = {
  flooring:            'flooring store',
  builders:            'home builder',
  roofing:             'roofing company',
  kitchen_renovation:  'kitchen renovation company',
  bathroom_renovation: 'bathroom renovation company',
  electricians:        'electrician',
  plumbers:            'plumber',
  hvac:                'air conditioning company',
  solar:               'solar installer',
  dentists:            'dentist',
  cosmetic_clinics:    'cosmetic clinic',
  lawyers:             'law firm',
  mortgage_brokers:    'mortgage broker',
  accountants:         'accountant',
  education_consultants: 'education consultant',
  travel_agencies:     'travel agency',
  landscaping:         'landscaping company',
  commercial_cleaning: 'commercial cleaning company',
}

const HOMEPAGE_CHAR_CAP = 6_000
const GEO_ANSWER_CHAR_CAP = 2_500

// ─── Collectors (each optional, never throws) ────────────────────────────────

async function collectHomepage(url: string | null): Promise<string | null> {
  if (!url) return null
  try {
    const page = await fetchUrlAsMarkdown(url)
    return page.markdown.slice(0, HOMEPAGE_CHAR_CAP)
  } catch {
    return null
  }
}

/** Exported for tests. Checks whether the brand shows up in an AI answer. */
export function brandMentioned(answer: string, businessName: string): boolean {
  const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  const name = normalise(businessName)
  if (!name) return false
  const haystack = normalise(answer)
  if (haystack.includes(name)) return true
  // Tolerate suffix trimming: "Oz Flooring Co Pty Ltd" → "oz flooring"
  const words = name.split(' ').filter(w => !['pty', 'ltd', 'limited', 'co', 'the'].includes(w))
  return words.length >= 2 && haystack.includes(words.slice(0, 2).join(' '))
}

async function collectGeoProbe(input: ProspectAnalysisInput): Promise<{ raw: string; probe: GeoProbeResult } | null> {
  if (!process.env.OPENAI_API_KEY) return null
  const label = INDUSTRY_LABELS[input.industry] ?? input.industry.replace(/_/g, ' ')
  const question = `What is the best ${label} in ${input.city.replace(/_/g, ' ')}?`
  const market = input.country === 'NZ' ? 'nz' : 'au'
  const out = await runOpenAI({ question, market })
  if (out.error_message || !out.raw_response) return null
  return {
    raw: out.raw_response.slice(0, GEO_ANSWER_CHAR_CAP),
    probe: {
      question,
      mentioned: brandMentioned(out.raw_response, input.business_name),
      competitors_mentioned: [],   // filled by the synthesis call
    },
  }
}

async function collectSocialActivity(input: ProspectAnalysisInput): Promise<SocialActivity | null> {
  if (!process.env.APIFY_API_KEY) return null
  try {
    if (input.facebook_url) {
      const page = await scrapeFacebookPage(input.facebook_url)
      return { platform: 'facebook', followers: page.followersCount, posts_last_30d: page.postsLast30Days }
    }
    if (input.instagram_url) {
      const handle = input.instagram_url.match(/instagram\.com\/([A-Za-z0-9_.\-]+)/)?.[1]
      if (!handle) return null
      const profile = await scrapeInstagramProfile(handle)
      return { platform: 'instagram', followers: profile.followersCount, posts_last_30d: profile.postsLast30Days }
    }
  } catch {
    return null
  }
  return null
}

// ─── Synthesis ────────────────────────────────────────────────────────────────

const SYNTHESIS_SYSTEM_PROMPT = `You are a digital marketing auditor for Australian and New Zealand local service businesses. Given evidence about one business, produce a compact JSON assessment for an internal sales team. Rules:
- Every claim must be grounded in the evidence provided. Never invent numbers, tools, or facts.
- If evidence for a pillar is missing, score it 50 and say "not enough data" in the summary.
- Pillar scores are HEALTH scores (100 = excellent, 0 = broken).
- top_problems: exactly 3, each concrete and verifiable from the evidence (e.g. "No Google Analytics installed", not "weak marketing").
- email_hook: one warm, specific opening sentence in Australian English referencing something genuinely positive about this business (their reviews, years trading, work quality). No greeting, no pitch.
- owner_name: only if the evidence clearly names an owner/founder; otherwise null.
Respond with a single JSON object, no markdown:
{"owner_name": string|null, "top_problems": [string, string, string], "email_hook": string, "competitors_mentioned": string[], "pillars": {"seo": {"score": number, "summary": string}, "geo": {"score": number, "summary": string}, "social": {"score": number, "summary": string}, "gbp": {"score": number, "summary": string}}}`

interface SynthesisJson {
  owner_name: string | null
  top_problems: string[]
  email_hook: string
  competitors_mentioned: string[]
  pillars: ProspectAnalysis['pillars']
}

function buildSynthesisPrompt(
  input: ProspectAnalysisInput,
  homepage: string | null,
  geoRaw: string | null,
  social: SocialActivity | null,
): string {
  const weaknesses = (input.score_breakdown ?? [])
    .filter(s => s.kind === 'weakness')
    .map(s => s.signal)
    .join(', ') || 'none recorded'

  return [
    `BUSINESS: ${input.business_name} — ${input.industry.replace(/_/g, ' ')} in ${input.city.replace(/_/g, ' ')}, ${input.country}`,
    `GBP: rating ${input.rating ?? 'unknown'}, ${input.review_count ?? 'unknown'} reviews`,
    `WEBSITE: ${input.website_url ?? input.domain ?? 'none'}`,
    `RULE-AUDIT WEAKNESSES: ${weaknesses}`,
    `SOCIAL ACTIVITY: ${social ? `${social.platform} — ${social.followers} followers, ${social.posts_last_30d} posts in last 30 days` : 'no data (no linked profile or scrape unavailable)'}`,
    `AI-SEARCH ANSWER for "best ${INDUSTRY_LABELS[input.industry] ?? input.industry} in ${input.city}": ${geoRaw ?? 'no data'}`,
    `HOMEPAGE CONTENT (truncated): ${homepage ?? 'unavailable'}`,
  ].join('\n\n')
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Run the short-mode analysis for one qualified prospect. Never throws. */
export async function analyzeProspect(input: ProspectAnalysisInput): Promise<ProspectAnalysis> {
  const analyzed_at = new Date().toISOString()
  const skips: string[] = []

  const [homepage, geo, social] = await Promise.all([
    collectHomepage(input.website_url ?? input.domain),
    collectGeoProbe(input).catch(() => null),
    collectSocialActivity(input),
  ])
  if (!homepage) skips.push('homepage_unavailable')
  if (!geo) skips.push('geo_probe_skipped')
  if (!social) skips.push('social_scrape_skipped')

  const segment = deriveSegment({
    breakdown: input.score_breakdown ?? [],
    has_social_links: Boolean(input.facebook_url || input.instagram_url),
    social_posts_30d: social?.posts_last_30d ?? null,
  })

  try {
    const result = await callClaudeChat({
      systemPrompt: SYNTHESIS_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildSynthesisPrompt(input, homepage, geo?.raw ?? null, social) }],
      maxOutputTokens: 1500,
    })
    const parsed = parseJsonResponse<SynthesisJson>(result.text)

    return {
      analyzed_at,
      segment,
      owner_name:   parsed.owner_name ?? null,
      top_problems: (parsed.top_problems ?? []).slice(0, 3),
      email_hook:   parsed.email_hook ?? '',
      pillars:      parsed.pillars,
      geo_probe: geo
        ? { ...geo.probe, competitors_mentioned: (parsed.competitors_mentioned ?? []).slice(0, 5) }
        : null,
      social_activity: social,
      skips,
    }
  } catch (err) {
    return {
      analyzed_at,
      segment,
      owner_name: null,
      top_problems: [],
      email_hook: '',
      pillars: {
        seo:    { score: 50, summary: 'analysis failed' },
        geo:    { score: 50, summary: 'analysis failed' },
        social: { score: 50, summary: 'analysis failed' },
        gbp:    { score: 50, summary: 'analysis failed' },
      },
      geo_probe: geo?.probe ?? null,
      social_activity: social,
      skips,
      error: err instanceof Error ? err.message : 'synthesis failed',
    }
  }
}
