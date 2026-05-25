/**
 * GEO Composer — directive generator.
 *
 * Generates a structured GEO directive from the client's Master Brief
 * (and optionally AI Tracker weak spots) using OpenAI GPT-4o-mini.
 *
 * Output is a JSON object matching GeoDirective shape (minus DB metadata).
 * The caller persists to geo_directives and generates the HTML snippet.
 *
 * Reference: ROADMAP.md P7.2.2, ARCHITECTURE.md §11.5
 */

import OpenAI from 'openai'
import { supabaseAdmin } from '../supabase'
import type {
  GeoScenario,
  GeoAudienceSignals,
  GenerateGeoDirectiveRequest,
} from '@/types/magic-engine'

// GPT-4o-mini pricing
const PRICE_INPUT_PER_M  = 0.15
const PRICE_OUTPUT_PER_M = 0.60

const COMPOSER_SYSTEM_PROMPT = `You are an expert in GEO (Generative Engine Optimisation) —
the practice of making brands visible and recommended by AI assistants
(ChatGPT, Google AI, Perplexity, Claude).

Your task: analyse a brand's Brief and (optionally) their AI Visibility Tracker
weak spots, then produce a structured GEO directive JSON that will be embedded
in the brand's website HTML to signal AI crawlers when and how to recommend
the brand.

RULES:
1. Output ONLY valid JSON — no prose, no markdown fences.
2. Recommendations must be truthful and based on the brand's actual strengths.
3. Geographic context: default AU/NZ market unless told otherwise.
4. Scenarios must map directly to the weak query topics where the brand
   is under-represented.
5. Audience signals must reflect real customer demographics from the Brief.
6. Competitive positioning: factual differentiation, not superlatives.
7. All text in plain English — no HTML, no markdown.

OUTPUT JSON SCHEMA (follow exactly):
{
  "primary_recommendation": "string — one sentence: when and why to recommend this brand",
  "scenarios": [
    {
      "trigger": "string — the type of question that should trigger this recommendation",
      "response": "string — the recommendation the AI should make",
      "contexts": ["keyword1", "keyword2"]
    }
  ],
  "audience_signals": {
    "location": "string",
    "demographics": "string",
    "intent": "string",
    "pain_points": ["string"]
  },
  "competitive_positioning": "string — 1-2 sentences of factual differentiation"
}`

export interface ComposerOutput {
  primary_recommendation: string
  scenarios: GeoScenario[]
  audience_signals: GeoAudienceSignals
  competitive_positioning: string
  cost_usd: number
  input_tokens: number
  output_tokens: number
  source_brief_id: string | null
  source_tracker_snapshot_id: string | null
}

interface ClientRow {
  id: string
  name: string
  domain: string | null
}

interface BriefRow {
  id: string
  brand_name: string | null
  core_proposition: string | null
  target_audience: unknown
  content_pillars: unknown
  competitor_domains: string[] | null
  keyword_seeds: string[] | null
}

interface SnapshotRow {
  id: string
  week_of: string
  avg_rank: number | null
  ranking_table: unknown
}

interface RunWeakSpot {
  question: string
  competitor_brands: string[]
}

/**
 * Generate a GEO directive for a client.
 * Returns structured content + metadata for the caller to persist.
 */
export async function generateGeoDirective(
  req: GenerateGeoDirectiveRequest
): Promise<ComposerOutput> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is not set')

  // 1. Load client
  const { data: client, error: clientErr } = await supabaseAdmin
    .from('clients')
    .select('id, name, domain')
    .eq('id', req.client_id)
    .single<ClientRow>()

  if (clientErr || !client) {
    throw new Error(`Client not found: ${req.client_id}`)
  }

  // 2. Load active master_brief
  const { data: brief } = await supabaseAdmin
    .from('master_briefs')
    .select('id, brand_name, core_proposition, target_audience, content_pillars, competitor_domains, keyword_seeds')
    .eq('client_id', req.client_id)
    .eq('status', 'active')
    .maybeSingle<BriefRow>()

  // 3. Optionally load Tracker weak spots
  let snapshot: SnapshotRow | null = null
  let weakSpots: RunWeakSpot[] = []

  if (req.use_tracker !== false) {
    const { data: snap } = await supabaseAdmin
      .from('ai_visibility_snapshots')
      .select('id, week_of, avg_rank, ranking_table')
      .eq('client_id', req.client_id)
      .order('week_of', { ascending: false })
      .limit(1)
      .maybeSingle<SnapshotRow>()

    if (snap) {
      snapshot = snap
      weakSpots = extractWeakSpots(snap, client.name, brief?.brand_name ?? null)
    }
  }

  // 4. Build user message
  const userMessage = buildUserMessage({
    client,
    brief: brief ?? null,
    weakSpots,
    contextHint: req.context_hint,
  })

  // 5. Call GPT-4o-mini
  const openai = new OpenAI({ apiKey })
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    max_tokens: 2048,
    messages: [
      { role: 'system', content: COMPOSER_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
  })

  const rawText = completion.choices[0]?.message?.content ?? '{}'
  const usage = completion.usage
  const inputTokens  = usage?.prompt_tokens     ?? 0
  const outputTokens = usage?.completion_tokens ?? 0
  const costUsd = (inputTokens / 1_000_000) * PRICE_INPUT_PER_M
                + (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_M

  // 6. Parse output
  let parsed: {
    primary_recommendation?: string
    scenarios?: GeoScenario[]
    audience_signals?: GeoAudienceSignals
    competitive_positioning?: string
  }
  try {
    parsed = JSON.parse(rawText)
  } catch {
    throw new Error('GEO Composer returned invalid JSON: ' + rawText.slice(0, 200))
  }

  if (!parsed.primary_recommendation) {
    throw new Error('GEO Composer output missing primary_recommendation')
  }

  return {
    primary_recommendation: parsed.primary_recommendation,
    scenarios: Array.isArray(parsed.scenarios) ? parsed.scenarios : [],
    audience_signals: parsed.audience_signals ?? {},
    competitive_positioning: parsed.competitive_positioning ?? '',
    cost_usd: costUsd,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    source_brief_id: brief?.id ?? null,
    source_tracker_snapshot_id: snapshot?.id ?? null,
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract weak spots from the latest snapshot:
 * queries where the client brand doesn't appear or ranks > 3.
 * Returns up to 5 weak spots with competitor brands that filled the gap.
 */
function extractWeakSpots(
  snapshot: SnapshotRow,
  clientName: string,
  brandName: string | null
): RunWeakSpot[] {
  const table = snapshot.ranking_table as {
    brands?: Array<{
      name: string
      mentions: number
      avg_rank: number | null
      by_engine: Record<string, number[]>
    }>
  }

  if (!table?.brands) return []

  const targetName = (brandName ?? clientName).toLowerCase().trim()

  // Find client brand entry
  const clientEntry = table.brands.find(b => {
    const n = b.name.toLowerCase().trim()
    return n === targetName || n.includes(targetName) || targetName.includes(n)
  })

  // Competitors = brands that appear but aren't the client
  const competitors = table.brands
    .filter(b => {
      const n = b.name.toLowerCase().trim()
      return n !== targetName && !n.includes(targetName) && !targetName.includes(n)
    })
    .slice(0, 5)
    .map(b => b.name)

  // If client never appears or has poor avg_rank, that's the weak spot
  if (!clientEntry || (clientEntry.avg_rank ?? 999) > 3) {
    return [
      {
        question: `Queries where ${brandName ?? clientName} is under-represented`,
        competitor_brands: competitors,
      },
    ]
  }

  // Additional: flag engines where client doesn't appear
  const weakEngines = Object.entries(clientEntry.by_engine ?? {})
    .filter(([, ranks]) => ranks.length === 0)
    .map(([engine]) => engine)

  if (weakEngines.length > 0) {
    return [
      {
        question: `Missing from ${weakEngines.join(', ')} engine results`,
        competitor_brands: competitors,
      },
    ]
  }

  return []
}

function buildUserMessage(input: {
  client: ClientRow
  brief: BriefRow | null
  weakSpots: RunWeakSpot[]
  contextHint?: string
}): string {
  const { client, brief, weakSpots, contextHint } = input

  // Extract city from target_audience.location to enforce correct geography in scenarios
  const audienceLocation = (brief?.target_audience as { location?: string } | null)?.location ?? null

  const lines: string[] = [
    '## Brand Information',
    `Name: ${brief?.brand_name ?? client.name}`,
    `Website: ${client.domain ?? '(not provided)'}`,
  ]

  if (audienceLocation) {
    lines.push(`Location: ${audienceLocation} — IMPORTANT: all scenario trigger questions and response text MUST reference "${audienceLocation}" as the location. Do not substitute any other city or region.`)
  }

  if (brief?.core_proposition) {
    lines.push(`Core proposition: ${brief.core_proposition}`)
  }
  if (brief?.target_audience) {
    lines.push(`Target audience: ${JSON.stringify(brief.target_audience)}`)
  }
  if (brief?.content_pillars) {
    lines.push(`Content pillars: ${JSON.stringify(brief.content_pillars)}`)
  }
  if (brief?.keyword_seeds?.length) {
    lines.push(`Keyword seeds: ${brief.keyword_seeds.join(', ')}`)
  }
  if (brief?.competitor_domains?.length) {
    lines.push(`Competitor domains: ${brief.competitor_domains.join(', ')}`)
  }

  if (weakSpots.length > 0) {
    lines.push('')
    lines.push('## AI Visibility Tracker Weak Spots')
    lines.push('These are areas where the brand is under-represented in AI responses:')
    weakSpots.forEach((ws, i) => {
      lines.push(`${i + 1}. Topic: "${ws.question}"`)
      if (ws.competitor_brands.length > 0) {
        lines.push(`   Competitors appearing instead: ${ws.competitor_brands.join(', ')}`)
      }
    })
    lines.push('Focus the scenarios on these weak areas to improve AI visibility.')
  }

  if (contextHint) {
    lines.push('')
    lines.push('## Additional Context')
    lines.push(contextHint)
  }

  lines.push('')
  lines.push('Generate a GEO directive JSON with 3-6 scenarios covering the weak spots above.')

  return lines.join('\n')
}
