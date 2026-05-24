/**
 * Marketing Plan Generator — Strategy Engine (Claude Sonnet)
 *
 * 输入：Master Brief + Campaign Brief（可选）+ 内容策略数据（可选）
 * 输出：结构化 MarketingPlanData（社媒 / 博客 / KPI / 任务清单）
 *
 * 设计思路：
 *   - 用 Claude 而不是 GPT-4o-mini：因为这是策略层（需要深度推理），不是大批量内容生产
 *   - 任务列表（tasks）在 Plan 批准后才派发到 Luban — 生成时只输出"计划意图"
 *   - 任务的 due_date 由 AI 根据 start_date/end_date + 频率算出
 *   - 复用现有 lib/strategy 提取 SEO 主题建议（在调用方拼装到 prompt）
 */

import { callClaudeWithDocs, parseJsonResponse } from '@/lib/anthropic/client'
import type {
  GeneratePlanRequest,
  MarketingPlanData,
} from './types'

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior marketing manager planning the next period of work for an AU/NZ brand.
Your job: turn the brand brief + active campaign + SEO opportunities into a concrete marketing plan
that a Frontline Deployment Engineer (FDE) can execute against.

Output a single JSON object with these exact keys (no markdown, no code fences):

{
  "executive_summary": "<2-3 sentences: the plan's core thesis and why this mix will hit the campaign goal>",

  "social": {
    "facebook":  { "posts_per_week": <int>, "reels_per_month": <int>, "stories_per_week": <int>, "tone_note": "<optional Facebook-specific tone note>" },
    "instagram": { "posts_per_week": <int>, "reels_per_month": <int>, "stories_per_week": <int>, "tone_note": null },
    "tiktok":    { "posts_per_week": <int>, "reels_per_month": <int>, "stories_per_week": 0, "tone_note": null }
  },

  "blog": {
    "monthly_count": <int>,
    "topics": [
      {
        "title": "<blog post title>",
        "primary_keyword": "<seo keyword or null>",
        "keyword_volume": <int or null>,
        "keyword_kd": <int 0-100 or null>,
        "due_week": <int 1-4>,
        "rationale": "<1 sentence: why this topic now>",
        "source_strategy_item_id": "<uuid from suggested topics if applicable, else null>",
        "content_mode": "unified" | "geo_only" | "seo_only"
      }
    ]
  },

  "kpis": {
    "social_engagement": "<concrete target, e.g. 'avg 30 likes per FB post, 5% engagement rate'>",
    "blog_traffic": "<concrete target, e.g. '500 organic visits/month by end of period'>",
    "ai_visibility": "<concrete target, e.g. 'rank in top 3 for 3 of 5 tracked AI queries'>",
    "other": null
  },

  "tasks": [
    {
      "kind": "social_post" | "social_reel" | "social_story" | "blog_article",
      "platform": "facebook" | "instagram" | "tiktok" | "linkedin",
      "title": "<short task title for the kanban card>",
      "description": "<2-3 sentence task brief — what to create, what angle, what CTA>",
      "due_date": "YYYY-MM-DD",
      "topic": "<topic line, can match a blog topic>",
      "source_blog_topic_index": <int index into blog.topics or null>,
      "source_strategy_item_id": "<uuid or null>"
    }
  ]
}

CRITICAL RULES:
- The "tasks" array MUST be derived from the social mix + blog count. Spread tasks evenly across the date range.
- Each blog topic MUST produce exactly one task with kind="blog_article". Set platform to null.
- Social tasks MUST match the platform's content mix (posts_per_week × weeks → posts, reels_per_month × months → reels, etc.)
- "social_story" tasks: omit "platform" for tiktok (no stories).
- due_date MUST fall between start_date and end_date.
- Tone, voice, and angle MUST reflect the brand brief and (if present) campaign angle.
- All output text in AU/NZ English unless brand brief specifies otherwise.
- Be realistic: prefer fewer high-quality tasks over many shallow ones if the brief suggests a premium positioning.
- Return ONLY raw JSON. No markdown, no code fences, no explanation.`

// ─── User prompt builder ──────────────────────────────────────────────────────

interface BuildPromptParams {
  briefText: string
  campaignText: string | null
  strategySuggestions: string | null         // 已格式化的 SEO 主题清单（可选）
  request: GeneratePlanRequest
}

function buildUserPrompt(p: BuildPromptParams): string {
  const { briefText, campaignText, strategySuggestions, request } = p
  const days = Math.max(
    1,
    Math.round(
      (new Date(request.end_date).getTime() - new Date(request.start_date).getTime())
      / (1000 * 60 * 60 * 24),
    ),
  )
  const weeks = Math.max(1, Math.round(days / 7))
  const intensity = request.intensity ?? 'standard'

  return `## Brand Brief (long-term DNA)
${briefText}

${campaignText ? `## Active Campaign Brief (this period's focus)\n${campaignText}\n` : ''}
${strategySuggestions ? `## SEO Topic Suggestions (data-driven candidates — reuse uuids in source_strategy_item_id)\n${strategySuggestions}\n` : ''}

## Plan Parameters
- Plan Title: ${request.title}
- Period: ${request.start_date} → ${request.end_date} (~${weeks} week${weeks > 1 ? 's' : ''}, ${days} days)
- Intensity: ${intensity}  ← ${
    intensity === 'light' ? 'conservative volumes, premium quality' :
    intensity === 'aggressive' ? 'high volume, accept some lower-quality tasks' :
    'balanced volume and quality'
  }
${request.focus_note ? `- FDE Focus Note: ${request.focus_note}` : ''}

Now produce the marketing plan JSON as specified in the system prompt.`
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface GenerateResult {
  plan_data: MarketingPlanData
  meta: {
    model: string
    prompt_version: string
    generation_cost_usd: number
    input_tokens: number
    output_tokens: number
    generated_at: string
  }
}

export async function generatePlanData(params: {
  briefText: string
  campaignText: string | null
  strategySuggestions: string | null
  request: GeneratePlanRequest
}): Promise<GenerateResult> {
  const userPrompt = buildUserPrompt(params)

  const result = await callClaudeWithDocs({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: userPrompt,
    maxOutputTokens: 8000,
  })

  const planData = parseJsonResponse<MarketingPlanData>(result.text)

  // 兜底：保证 tasks 数组存在
  if (!Array.isArray(planData.tasks)) {
    planData.tasks = []
  }
  // 兜底：保证 blog.topics 数组存在
  if (!planData.blog || !Array.isArray(planData.blog.topics)) {
    planData.blog = { monthly_count: 0, topics: [] }
  }
  // 兜底：保证 social 对象存在
  if (!planData.social || typeof planData.social !== 'object') {
    planData.social = {}
  }
  // 兜底：保证 kpis 对象存在
  if (!planData.kpis || typeof planData.kpis !== 'object') {
    planData.kpis = {}
  }

  return {
    plan_data: planData,
    meta: {
      model: 'claude-sonnet-4-6',
      prompt_version: 'mp-v1',
      generation_cost_usd: result.cost_usd,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
      generated_at: new Date().toISOString(),
    },
  }
}

// ─── Strategy 数据格式化（供调用方使用）────────────────────────────────────────

interface StrategySuggestion {
  id: string
  proposed_title: string
  rationale: string
  source_keyword: string | null
  keyword_volume: number | null
  keyword_kd: number | null
  priority_score: number
}

/**
 * 把 content_strategy_items 表的建议格式化为 prompt 注入文本。
 * 调用方负责从数据库拉数据（避免本 lib 文件耦合 supabase 客户端）。
 */
export function formatStrategySuggestions(items: StrategySuggestion[]): string {
  if (items.length === 0) return ''
  const lines = items
    .slice(0, 12)              // 限制注入数量，避免 prompt 过长
    .map(it => {
      const kw = it.source_keyword
        ? `Keyword: "${it.source_keyword}" (vol=${it.keyword_volume ?? '?'}, kd=${it.keyword_kd ?? '?'})`
        : 'No keyword'
      return `- [${it.id}] "${it.proposed_title}" (score=${it.priority_score}) — ${kw}. ${it.rationale}`
    })
  return lines.join('\n')
}
