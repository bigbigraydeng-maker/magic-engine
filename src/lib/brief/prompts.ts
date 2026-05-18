/**
 * Prompt templates and schema for Master Brief generation and chat refinement.
 * Separated from pipeline.ts so prompts can evolve independently.
 */

import type { JinaFetchResult } from './jina'
import type { DomainOverviewSnapshot } from '../semrush/client'

// ── Generation ────────────────────────────────────────────────────────────────

export const BRIEF_SYSTEM_PROMPT = `You are an expert brand strategist and content marketing specialist.
Your task is to analyze the provided brand materials (website content, documents, keyword data) and
produce a comprehensive Master Brief — a structured brand strategy document that will guide all
future AI-generated content for this client.

RULES:
1. Output ONLY valid JSON — no prose, no markdown fences, no explanation outside the JSON.
2. Every field must be populated. If data is insufficient, make a reasonable inference and note it.
3. Be specific and actionable — avoid generic platitudes like "high quality" or "customer-focused".
4. Content pillars must be MUTUALLY EXCLUSIVE and cover 100% of post_ratio combined.
5. Infer visual identity (colors, style) from website screenshots/descriptions where possible.
6. Extract real competitor domains from the SEMrush data provided.
7. keyword_seeds must be 8–15 high-value keywords derived from the source data.

OUTPUT JSON SCHEMA (follow exactly):
{
  "brand_name": "string — official brand name",
  "core_proposition": "string — one crisp sentence: what they do, for whom, and why it's different",
  "content_pillars": [
    {
      "id": "string — lowercase slug, e.g. 'educational'",
      "name": "string — display name, e.g. 'Education & How-To'",
      "description": "string — 1–2 sentences on what content belongs here",
      "post_ratio": 0.0,
      "content_types": ["string array — e.g. 'tips', 'how-to', 'myth-busting'"],
      "example_topics": ["string array — 3 specific post ideas for this pillar"]
    }
  ],
  "brand_voice": {
    "tone_keywords": ["3–5 adjectives, e.g. 'warm', 'authoritative', 'playful'"],
    "avoid_keywords": ["2–4 words/phrases to never use"],
    "formality": "casual | neutral | professional",
    "emoji_usage": "none | minimal | moderate",
    "language_mix": "string — e.g. 'english-primary' or 'bilingual-en-zh'"
  },
  "target_audience": {
    "age_range": "string — e.g. '28–45'",
    "location": "string — primary geographic market",
    "gender": "string or null",
    "interests": ["4–6 interest tags"],
    "pain_points": ["3–5 specific pain points"],
    "platforms": ["platforms where audience is most active"]
  },
  "platform_strategy": {
    "instagram": { "enabled": true, "post_frequency": "5x/week", "primary_content_type": "string" },
    "facebook": { "enabled": true, "post_frequency": "3x/week", "primary_content_type": "string" },
    "tiktok": { "enabled": false, "post_frequency": "0x/week", "primary_content_type": "string" }
  },
  "keyword_seeds": ["8–15 seed keywords derived from data"],
  "competitor_domains": ["2–5 competitor domains without https://"],
  "vi_colors": {
    "primary": "#hex or null",
    "secondary": "#hex or null",
    "accent": "#hex or null",
    "background": "#hex or null"
  },
  "vi_style_keywords": ["3–5 visual style adjectives, e.g. 'minimalist', 'warm', 'bold'"],
  "vi_dos": ["3–5 visual DO guidelines"],
  "vi_donts": ["3–5 visual DON'T guidelines"],
  "brand_story_md": "string — 150–300 word brand narrative in Markdown",
  "style_guide_md": "string — concise writing style guide in Markdown (tone, formatting, dos/don'ts)",
  "competitive_notes_md": "string — 100–200 word competitive landscape summary in Markdown"
}`

// ── Refinement ─────────────────────────────────────────────────────────────────

export const BRIEF_REFINE_SYSTEM_PROMPT = `You are a brand strategy assistant helping to refine a
Master Brief based on the client's feedback.

You will receive:
1. The current Master Brief (JSON) as context
2. A conversation history
3. The user's latest refinement request

CRITICAL OUTPUT RULES:
1. Your ENTIRE response must be a single valid JSON object — nothing before or after it.
2. Start your response IMMEDIATELY with { — no preamble, no explanation, no markdown fences.
3. Only include fields that need to change in "patch" — omit unchanged fields.
4. "reasoning" must be plain text (no Markdown) inside the JSON string.
5. If the request is purely conversational (asking a question, requesting an explanation, no changes needed), return patch as {} and put your full answer in "reasoning".
6. Nested objects (brand_voice, target_audience, etc.) must be FULLY REPLACED — include all sub-fields.

REQUIRED OUTPUT FORMAT (respond ONLY with this JSON, nothing else):
{"reasoning":"your explanation or change summary here","patch":{...only changed fields, or empty {} if no changes...}}`

// ── Message builder ────────────────────────────────────────────────────────────

export interface BriefBuilderInput {
  websitePages: JinaFetchResult[]
  semrushSnapshot: DomainOverviewSnapshot | null
  domain?: string
  // P8.11.F.1: high-confidence anchors from 张骞 discovery. When supplied,
  // Claude is told to treat these as fixed inputs rather than rederive them.
  discoverySeedKeywords?: string[]
  discoveryCompetitorDomains?: string[]
}

export function buildBriefUserMessage(input: BriefBuilderInput): string {
  const parts: string[] = []

  parts.push('Please generate a Master Brief based on the following brand data.')
  parts.push('')

  // 0. Discovery anchors — Claude must surface these in keyword_seeds /
  //    competitor_domains and align target_audience / competitive_notes_md
  //    to them. Keeps high-confidence 张骞 output authoritative.
  const hasSeedAnchors = (input.discoverySeedKeywords?.length ?? 0) > 0
  const hasCompAnchors = (input.discoveryCompetitorDomains?.length ?? 0) > 0
  if (hasSeedAnchors || hasCompAnchors) {
    parts.push('## DISCOVERY ANCHORS (高置信度,必须采用)')
    if (hasSeedAnchors) {
      parts.push('### Seed Keywords — copy into keyword_seeds verbatim:')
      parts.push(input.discoverySeedKeywords!.map(k => `- ${k}`).join('\n'))
      parts.push('')
    }
    if (hasCompAnchors) {
      parts.push('### Competitor Domains — copy into competitor_domains verbatim:')
      parts.push(input.discoveryCompetitorDomains!.map(d => `- ${d}`).join('\n'))
      parts.push('')
    }
  }

  // 1. Website content
  if (input.websitePages.length > 0) {
    parts.push('## WEBSITE CONTENT')
    for (const page of input.websitePages) {
      parts.push(`### Page: ${page.title} (${page.url})`)
      parts.push(page.markdown)
      parts.push('')
    }
  } else {
    parts.push('## WEBSITE CONTENT')
    parts.push('No website pages were provided.')
    parts.push('')
  }

  // 2. SEMrush data
  if (input.semrushSnapshot) {
    parts.push('## SEMRUSH DATA')
    const snap = input.semrushSnapshot

    if (snap.top_keywords.length > 0) {
      parts.push('### Top Organic Keywords (by volume):')
      const kwLines = snap.top_keywords.slice(0, 20).map(k =>
        `- "${k.keyword}" | vol:${k.volume} | KD:${k.kd} | CPC:$${k.cpc.toFixed(2)} | intent:${k.intent}`
      )
      parts.push(kwLines.join('\n'))
      parts.push('')
    }

    if (snap.competitor_domains.length > 0) {
      parts.push('### Competitor Domains:')
      parts.push(snap.competitor_domains.map(d => `- ${d}`).join('\n'))
      parts.push('')
    }

    if (input.domain) {
      parts.push(`### Analyzed Domain: ${input.domain}`)
      parts.push('')
    }
  } else {
    parts.push('## SEMRUSH DATA')
    parts.push('SEMrush data unavailable.')
    parts.push('')
  }

  parts.push('---')
  parts.push('Now output the Master Brief JSON. Remember: output ONLY the JSON object, nothing else.')

  return parts.join('\n')
}

/**
 * Build the refinement user message that includes current brief context.
 * The brief JSON is injected as context so Claude can reference specific field values.
 */
export function buildRefineUserMessage(params: {
  brief: Record<string, unknown>
  userRequest: string
}): string {
  const briefJson = JSON.stringify(params.brief, null, 2)
  return `CURRENT MASTER BRIEF:
\`\`\`json
${briefJson}
\`\`\`

USER REQUEST: ${params.userRequest}

Output the JSON patch to apply.`
}
