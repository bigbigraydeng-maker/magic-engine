// Content quality rubric — mixed rule + lightweight LLM evaluation.
// SDK clients must be injected by callers; this module has NO top-level SDK imports.

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RubricContext {
  brief: {
    brand_name?: string | null
    tone?: string | null
    avoid_words?: string[] | null
    platforms?: string[] | null
    primary_audience?: string | null
  }
  campaign?: {
    title?: string | null
    offer?: string | null
    primary_cta?: string | null
    campaign_angle?: string | null
    target_audience_detail?: string | null
  } | null
  /** Rendering platform, e.g. 'facebook' | 'tiktok' | 'instagram' | 'youtube' | 'blog' | 'reels' */
  platform: string
  contentType: 'social_a' | 'social_b' | 'social_c' | 'blog' | 'reels'
  /** Target keyword for dimension-goal check (primary_keyword for blog, campaign title for social) */
  primaryKeyword?: string | null
}

export interface DimensionScore {
  dimension: string
  score: number       // 0–10
  pass: boolean       // score >= PASS_THRESHOLD (or advisory=true)
  reason: string
  method: 'rule' | 'llm'
}

export interface RubricResult {
  overallScore: number    // average of all dimension scores, rounded to 1 dp
  pass: boolean           // true when all non-advisory core dimensions pass
  dimensions: DimensionScore[]
}

/** Minimal interface for an injected OpenAI-compatible LLM client. */
export interface LLMClient {
  chat: {
    completions: {
      create(params: {
        model: string
        messages: Array<{ role: 'user' | 'system'; content: string }>
        temperature?: number
        response_format?: { type: 'json_object' }
      }): Promise<{ choices: Array<{ message: { content: string | null } }> }>
    }
  }
}

/** Route-specific dimension injected by the caller (e.g. viral-structure-preservation for Route B). */
export interface RouteDimension {
  id: string
  description: string   // fed directly to the LLM scoring prompt
  advisory: boolean     // if true, score is informational — does NOT affect overall pass
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PASS_THRESHOLD = 7

/** Approximate word-count range per platform. Used by platform-fit rule. */
const PLATFORM_WORD_RANGES: Record<string, { min: number; max: number }> = {
  facebook:  { min: 60,  max: 400 },
  tiktok:    { min: 50,  max: 200 },
  instagram: { min: 30,  max: 300 },
  youtube:   { min: 100, max: 800 },
  blog:      { min: 400, max: 5000 },
  reels:     { min: 30,  max: 200 },
}

/** Common CTA signal words/phrases (EN + ZH).
 *  EN uses \b word boundaries; CJK uses no \b (word boundary semantics don't apply to CJK). */
const CTA_RE = /\b(book|enquire?|contact|sign[\s-]?up|register|call us|shop now|buy now|get started|click here|learn more|find out|explore now|try (it|for) free|join (us|now)|apply (now|today)|reserve (now|your)|request (a|an|your)|subscribe (now|today)|download (now|today)|check it out|see (more|it)|read more|visit (us|our|the|ctstours|website|page))\b|(预约|咨询|联系我们|立即了解|立即点击|立即购买|立即报名|立即注册|探索更多|点击查看|马上开始)/i

const LLM_DIMENSIONS = ['brand-fit', 'campaign-fit', 'specificity'] as const
const RULE_DIMENSIONS = ['platform-fit', 'cta', 'dimension-goal'] as const
const ALL_CORE_DIMENSIONS = [...RULE_DIMENSIONS, ...LLM_DIMENSIONS]

const LLM_DIMENSION_DESCRIPTIONS: Record<string, string> = {
  'brand-fit':    'Does the content match the brand tone, voice, and avoid prohibited words?',
  'campaign-fit': 'Does the content reflect the campaign angle, offer, and key messaging priorities?',
  'specificity':  'Is the content specific and concrete (uses real product names, numbers, locations, benefits) rather than generic?',
}

// ─── Rule-based checks ────────────────────────────────────────────────────────

function checkPlatformFit(content: string, ctx: RubricContext): DimensionScore {
  const key = ctx.platform.toLowerCase()
  const range = PLATFORM_WORD_RANGES[key]
  if (!range) {
    return {
      dimension: 'platform-fit',
      score: 8,
      pass: true,
      reason: `Platform "${ctx.platform}" has no length rule — check skipped.`,
      method: 'rule',
    }
  }

  const wordCount = content.split(/\s+/).filter(Boolean).length

  if (wordCount < range.min) {
    const score = Math.max(2, Math.round(6 * (wordCount / range.min)))
    return {
      dimension: 'platform-fit',
      score,
      pass: false,
      reason: `Content is too short for ${key} (${wordCount} words; expected at least ${range.min}).`,
      method: 'rule',
    }
  }

  if (wordCount > range.max) {
    const ratio = wordCount / range.max
    const score = ratio > 2 ? 3 : ratio > 1.5 ? 5 : 6
    return {
      dimension: 'platform-fit',
      score,
      pass: score >= PASS_THRESHOLD,
      reason: `Content may be too long for ${key} (${wordCount} words; ideal ≤${range.max}).`,
      method: 'rule',
    }
  }

  return {
    dimension: 'platform-fit',
    score: 9,
    pass: true,
    reason: `Word count (${wordCount}) is within the ideal range for ${key}.`,
    method: 'rule',
  }
}

function checkCTA(content: string): DimensionScore {
  const has = CTA_RE.test(content)
  return {
    dimension: 'cta',
    score: has ? 9 : 4,
    pass: has,
    reason: has
      ? 'A clear call-to-action is present.'
      : 'No recognisable call-to-action found. Add action language such as "Book now" or "Learn more".',
    method: 'rule',
  }
}

function checkDimensionGoal(content: string, ctx: RubricContext): DimensionScore {
  const keyword = ctx.primaryKeyword?.trim() || ctx.campaign?.title?.trim() || null
  if (!keyword) {
    return {
      dimension: 'dimension-goal',
      score: 7,
      pass: true,
      reason: 'No target keyword defined — check skipped.',
      method: 'rule',
    }
  }

  const lower = content.toLowerCase()
  const lowerKw = keyword.toLowerCase()

  if (lower.includes(lowerKw)) {
    return {
      dimension: 'dimension-goal',
      score: 9,
      pass: true,
      reason: `Target keyword "${keyword}" appears in the content.`,
      method: 'rule',
    }
  }

  // Partial: every significant word (>3 chars) present individually
  const words = lowerKw.split(/\s+/).filter(w => w.length > 3)
  if (words.length > 1 && words.every(w => lower.includes(w))) {
    return {
      dimension: 'dimension-goal',
      score: 7,
      pass: true,
      reason: `All words of "${keyword}" appear in content (not as an exact phrase).`,
      method: 'rule',
    }
  }

  return {
    dimension: 'dimension-goal',
    score: 3,
    pass: false,
    reason: `Target keyword "${keyword}" is missing from the content.`,
    method: 'rule',
  }
}

// ─── LLM batch evaluation ─────────────────────────────────────────────────────

async function evaluateWithLLM(
  content: string,
  ctx: RubricContext,
  llmCoreDimensions: readonly string[],
  routeDimensions: RouteDimension[],
  llmClient: LLMClient,
): Promise<DimensionScore[]> {
  const allDims = [
    ...llmCoreDimensions.map(id => ({
      id,
      description: LLM_DIMENSION_DESCRIPTIONS[id] || id,
      advisory: false,
    })),
    ...routeDimensions.map(d => ({
      id: d.id,
      description: d.description,
      advisory: d.advisory,
    })),
  ]

  const briefInfo = [
    ctx.brief.brand_name     ? `Brand: ${ctx.brief.brand_name}` : '',
    ctx.brief.tone           ? `Tone: ${ctx.brief.tone}` : '',
    ctx.brief.primary_audience ? `Audience: ${ctx.brief.primary_audience}` : '',
    ctx.brief.avoid_words?.length ? `Avoid words: ${ctx.brief.avoid_words.join(', ')}` : '',
  ].filter(Boolean).join('\n') || 'Not provided.'

  const campaignInfo = ctx.campaign
    ? [
        ctx.campaign.title         ? `Campaign: ${ctx.campaign.title}` : '',
        ctx.campaign.offer         ? `Offer: ${ctx.campaign.offer}` : '',
        ctx.campaign.primary_cta   ? `CTA goal: ${ctx.campaign.primary_cta}` : '',
        ctx.campaign.campaign_angle ? `Angle: ${ctx.campaign.campaign_angle}` : '',
        ctx.campaign.target_audience_detail ? `Target: ${ctx.campaign.target_audience_detail}` : '',
      ].filter(Boolean).join('\n')
    : 'No campaign context.'

  const dimList = allDims
    .map(d => `- ${d.id}${d.advisory ? ' (advisory)' : ''}: ${d.description}`)
    .join('\n')

  const snippet = content.length > 2000 ? `${content.slice(0, 2000)}\n...[truncated]` : content

  const prompt = `You are a content quality analyst. Score the following content on each dimension (0–10; 7+ = pass).

BRAND CONTEXT:
${briefInfo}

CAMPAIGN CONTEXT:
${campaignInfo}

CONTENT:
${snippet}

DIMENSIONS:
${dimList}

Return JSON only:
{"scores":{"<dimension-id>":{"score":<0-10>,"reason":"<one sentence>"},...}}`

  const resp = await llmClient.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: prompt }],
  })

  type LLMScores = Record<string, { score?: number; reason?: string }>
  let parsed: LLMScores = {}
  try {
    const result = JSON.parse(resp.choices[0].message.content ?? '{}') as { scores?: LLMScores }
    parsed = result.scores ?? {}
  } catch {
    // Fall through — every dim will use fallback score 5
  }

  return allDims.map(d => {
    const entry = parsed[d.id]
    const raw = typeof entry?.score === 'number' ? entry.score : 5
    const score = Math.min(10, Math.max(0, Math.round(raw)))
    return {
      dimension: d.id,
      score,
      pass: d.advisory || score >= PASS_THRESHOLD,
      reason: entry?.reason ?? `Could not evaluate ${d.id}.`,
      method: 'llm' as const,
    }
  })
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Evaluate content quality against the standard rubric.
 *
 * @param content        - Plain-text content to evaluate (caller prepares the string)
 * @param ctx            - Brand + campaign + platform context
 * @param options.coreDimensions  - Subset of core dimensions to run (default: all 6)
 * @param options.routeDimensions - Extra route-specific dimensions (e.g. viral-structure-preservation)
 * @param options.llmClient       - Injected LLM client (OpenAI-compatible)
 */
export async function evaluate(
  content: string,
  ctx: RubricContext,
  options: {
    coreDimensions?: string[]
    routeDimensions?: RouteDimension[]
    llmClient: LLMClient
  },
): Promise<RubricResult> {
  const { coreDimensions = ALL_CORE_DIMENSIONS, routeDimensions = [], llmClient } = options

  // Rule-based (synchronous)
  const ruleResults: DimensionScore[] = []
  if (coreDimensions.includes('platform-fit'))    ruleResults.push(checkPlatformFit(content, ctx))
  if (coreDimensions.includes('cta'))             ruleResults.push(checkCTA(content))
  if (coreDimensions.includes('dimension-goal'))  ruleResults.push(checkDimensionGoal(content, ctx))

  // LLM-based (single batched call)
  const activeLLMCore = LLM_DIMENSIONS.filter(d => coreDimensions.includes(d))
  const llmResults = (activeLLMCore.length > 0 || routeDimensions.length > 0)
    ? await evaluateWithLLM(content, ctx, activeLLMCore, routeDimensions, llmClient)
    : []

  const all = [...ruleResults, ...llmResults]

  const overallScore = all.length > 0
    ? Math.round(all.reduce((s, d) => s + d.score, 0) / all.length * 10) / 10
    : 0

  // Advisory route dimensions do not affect the pass verdict
  const advisoryIds = new Set(routeDimensions.filter(r => r.advisory).map(r => r.id))
  const pass = all.filter(d => !advisoryIds.has(d.dimension)).every(d => d.pass)

  return { overallScore, pass, dimensions: all }
}
