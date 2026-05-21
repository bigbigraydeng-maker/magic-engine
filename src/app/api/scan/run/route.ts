/**
 * POST /api/scan/run
 *
 * Public (no auth) brand health scan.
 * Pipeline: Jina.ai crawl → Claude Sonnet analysis → JSON scores.
 *
 * Rate limited: 5 scans / IP / hour (in-memory, resets on server restart).
 */

import { NextRequest, NextResponse } from 'next/server'
import { fetchUrlAsMarkdown } from '@/lib/brief/jina'
import { getAnthropicClient, parseJsonResponse, MODEL_SONNET } from '@/lib/anthropic/client'

// ─── Rate limiter ─────────────────────────────────────────────────────────────

const ipBucket = new Map<string, { count: number; resetAt: number }>()
const MAX_PER_HOUR = 5

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = ipBucket.get(ip)
  if (!entry || entry.resetAt < now) {
    ipBucket.set(ip, { count: 1, resetAt: now + 3_600_000 })
    return false // not limited
  }
  if (entry.count >= MAX_PER_HOUR) return true // limited
  entry.count++
  return false
}

// ─── URL normaliser ───────────────────────────────────────────────────────────

function normaliseUrl(raw: string): string {
  let u = raw.trim()
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`
  try {
    return new URL(u).href
  } catch {
    return u
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScanResult {
  url: string
  businessName: string
  crisisType: string
  overallScore: number
  scores: {
    seo: number
    ai_visibility: number
    social: number
    ads: number
    reputation: number
    competitors: number
  }
  topIssues: string[]
  oneLiner: string
  scanDurationMs: number
}

// ─── Claude prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a brand health analyst for Magic Engine, an AI marketing platform for AU/NZ businesses.

Analyse the website homepage content and return a single JSON object.

SCORING RULES:
- Be realistic — most SMBs genuinely score 20–55 across dimensions
- Only score highly (70+) when there is clear, substantial evidence
- Base every score on observable signals in the content
- Do NOT round all scores to the same number — vary them realistically

DIMENSION GUIDE:
seo            : H1/H2 structure, keyword richness, meta signals, internal links, schema hints
ai_visibility  : FAQ blocks, "what is X" definitions, clear entity names, structured Q&A
social         : Social media links, follower counts, social proof copy, UGC mentions
ads            : CTA clarity, offer specificity, landing page quality, conversion elements
reputation     : Testimonials quality/quantity, awards, media logos, case studies, trust badges
competitors    : Stated unique differentiators, market positioning claims, "why us" content

CRISIS TYPES (pick the most critical):
"AI Invisibility" | "SEO Gap" | "Social Silence" | "Reputation Risk" | "Competitive Pressure" | "Content Drought"

Return ONLY valid JSON — no markdown fences, no explanation text:
{
  "businessName": "extracted brand or business name",
  "crisisType": "one of the six crisis types",
  "overallScore": <weighted average 0–100>,
  "scores": {
    "seo": <0–100>,
    "ai_visibility": <0–100>,
    "social": <0–100>,
    "ads": <0–100>,
    "reputation": <0–100>,
    "competitors": <0–100>
  },
  "topIssues": [
    "specific issue 1 phrased as a problem the business owner recognises",
    "specific issue 2",
    "specific issue 3"
  ],
  "oneLiner": "one sentence describing the single biggest problem"
}`

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (checkRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Too many scans. Please try again in an hour.' },
      { status: 429 },
    )
  }

  let rawUrl: string
  try {
    const body = (await req.json()) as { url?: unknown }
    rawUrl = typeof body.url === 'string' ? body.url.trim() : ''
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (!rawUrl) {
    return NextResponse.json({ error: 'url is required.' }, { status: 400 })
  }

  const url = normaliseUrl(rawUrl)
  const startMs = Date.now()

  // Step 1 — crawl homepage
  let markdown: string
  try {
    const jina = await fetchUrlAsMarkdown(url)
    markdown = jina.markdown
  } catch (err) {
    console.warn('[scan/run] Jina failed:', err)
    return NextResponse.json(
      { error: "Couldn't read that website. Please check the URL and try again." },
      { status: 422 },
    )
  }

  // Step 2 — Claude analysis
  try {
    const client = getAnthropicClient()
    const message = await client.messages.create({
      model: MODEL_SONNET,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Analyse this website homepage.\n\nURL: ${url}\n\n---\n${markdown.slice(0, 20_000)}`,
      }],
    })

    const raw = message.content
      .filter(b => b.type === 'text')
      .map(b => (b as { text: string }).text)
      .join('')

    const parsed = parseJsonResponse<Omit<ScanResult, 'url' | 'scanDurationMs'>>(raw)

    const result: ScanResult = {
      ...parsed,
      url,
      scanDurationMs: Date.now() - startMs,
    }

    return NextResponse.json(result)
  } catch (err) {
    console.error('[scan/run] Claude error:', err)
    return NextResponse.json(
      { error: 'Scan analysis failed. Please try again.' },
      { status: 500 },
    )
  }
}
