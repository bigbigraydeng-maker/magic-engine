/**
 * Marketing Plan Generator — Strategy Engine (Claude Sonnet)
 *
 * 输入：Master Brief + Campaign Brief（可选）+ 内容策略数据（可选）+ 邮件渠道历史表现（可选）
 * 输出：结构化 MarketingPlanData（社媒 / 博客 / 邮件 / KPI / 任务清单）
 *
 * 设计思路：
 *   - 用 Claude 而不是 GPT-4o-mini：因为这是策略层（需要深度推理），不是大批量内容生产
 *   - 任务列表（tasks）在 Plan 批准后才派发到 Luban — 生成时只输出"计划意图"
 *   - 任务的 due_date 由 AI 根据 start_date/end_date + 频率算出
 *   - 复用现有 lib/strategy 提取 SEO 主题建议（在调用方拼装到 prompt）
 */

import { callClaudeWithDocs, parseJsonResponse } from '@/lib/anthropic/client'
import type { ClaudeDocInput } from '@/lib/anthropic/client'
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

  "email": {
    "cadence_days": <int, 0 if no Email Channel Performance section was provided below>,
    "topics": [
      {
        "title": "<newsletter subject line>",
        "angle": "<1 sentence: the content angle>",
        "due_date": "YYYY-MM-DD",
        "rationale": "<1 sentence: why send this, this topic, on this date — reference the performance data or a real seasonal/business trigger, never invent one>",
        "target_segment": "<free-text description of who this should go to, e.g. 'first-time enquirers who opened but did not click in the last 30 days', or null for the whole active list>",
        "requires_link": <bool — see EMAIL RULES below>
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
      "kind": "social_post" | "social_reel" | "social_story" | "blog_article" | "newsletter_email",
      "platform": "facebook" | "instagram" | "tiktok" | "linkedin",
      "title": "<short task title for the kanban card>",
      "description": "<2-3 sentence task brief — what to create, what angle, what CTA>",
      "due_date": "YYYY-MM-DD",
      "topic": "<topic line, can match a blog topic>",
      "source_blog_topic_index": <int index into blog.topics or null>,
      "source_email_topic_index": <int index into email.topics or null, only for kind="newsletter_email">,
      "requires_link": <bool, only for kind="newsletter_email" — copy the same topic's requires_link>,
      "source_strategy_item_id": "<uuid or null>"
    }
  ]
}

SCOPE NOTE — Marketing Plan is the SOLE owner of content production:
- Social content (posts / reels / stories) across Facebook, Instagram, TikTok
- SEO blog articles and long-form content
- Email newsletter topic + send-cadence planning (ONLY when an "Email Channel Performance" section is provided below — see EMAIL RULES)
- Ad creative briefs (copy direction, visual concept) for paid campaigns
The diagnostic system handles technical fixes only. Do NOT hold back on content tasks here.

EMAIL RULES (do not skip — this exists because a real client email shipped with zero links and a guaranteed 0% click rate):
- If NO "Email Channel Performance" section appears below, this client has no active email channel. Output "email": {"cadence_days": 0, "topics": []} and create ZERO "newsletter_email" tasks. Do not invent an email plan for a client with no channel.
- If the section IS present, base cadence and topic ideas on the real open-rate / click-rate / send-date history given — do not assume a generic industry cadence.
- Every email topic that names, features, or promotes a specific tour / product / listing / offer MUST set "requires_link": true, and the corresponding task's "description" MUST explicitly instruct including a real hyperlink to that specific item's page as the call-to-action — never describe a specific offer without a link.
- A soft, no-specific-offer touch (e.g. a check-in, a seasonal reminder with no named product) MAY set "requires_link": false, but even then the task description MUST spell out what low-friction next step the reader is given (a link, or an explicit "ask them to reply with X" instruction) — never leave the task description silent on what action the reader can take.
- The performance section below may also note how many contacts recently received an automated welcome-sequence email. If so, the task description MUST tell the FDE to avoid sending this newsletter to contacts still mid-sequence, to prevent double-touching the same people within a short window.

CAMPAIGN PRIORITY RULE:
- When an Active Campaign Brief is present, its specific requirements (dates, offers, target audience, creative angle, uploaded materials) OVERRIDE the Brand Brief defaults. Let the campaign shape the content calendar, KPI targets, task angles, and CTAs. The Brand Brief provides background DNA only.

CRITICAL RULES:
- The "tasks" array MUST be derived from the social mix + blog count. Spread tasks evenly across the date range.
- Each blog topic MUST produce exactly one task with kind="blog_article". Set platform to null.
- Social tasks MUST match the platform's content mix (posts_per_week × weeks → posts, reels_per_month × months → reels, etc.)
- "social_story" tasks: omit "platform" for tiktok (no stories).
- due_date MUST fall between start_date and end_date.
- Tone, voice, and angle MUST reflect the brand brief and (if present) campaign angle.
- All output text in AU/NZ English unless brand brief specifies otherwise.
- Volume follows the Intensity setting (see Plan Parameters). Quality bar follows the brand brief — premium brands deserve premium-quality tasks at WHATEVER volume the intensity dictates. Do NOT lower volume just because the brand is premium.
- Platform coverage: if the Brand Brief includes a Platform Strategy section with explicit enabled/disabled settings, you MUST honour them — a platform marked disabled gets 0 for all values. If no platform strategy is set, apply the default for consumer-facing brands (home/interior, fashion, food, beauty, retail, design, lifestyle, hospitality): ALL THREE platforms (Facebook, Instagram, TikTok) MUST have non-zero presence. Exclude a platform only for clear B2B-industrial cases (then TikTok can be 0).
- Each email topic (if any) MUST produce exactly one task with kind="newsletter_email". Set platform to null.
- Return ONLY raw JSON. No markdown, no code fences, no explanation.`

// ─── User prompt builder ──────────────────────────────────────────────────────

interface BuildPromptParams {
  briefText: string
  campaignText: string | null
  campaignDocs?: ClaudeDocInput[]            // 上传文件已作为 doc 附件传入 Claude，此处仅标注
  strategySuggestions: string | null         // 已格式化的 SEO 主题清单（可选）
  viralReferences: string | null             // 已格式化的爆款风格参考（可选）
  /** 已格式化的邮件渠道历史表现——只有客户开通了邮件渠道才传，null = 不规划邮件 */
  emailPerformance?: string | null
  request: GeneratePlanRequest
}

function buildUserPrompt(p: BuildPromptParams): string {
  const { briefText, campaignText, campaignDocs, strategySuggestions, viralReferences, emailPerformance, request } = p
  const days = Math.max(
    1,
    Math.round(
      (new Date(request.end_date).getTime() - new Date(request.start_date).getTime())
      / (1000 * 60 * 60 * 24),
    ),
  )
  const weeks = Math.max(1, Math.round(days / 7))
  const intensity = request.intensity ?? 'standard'

  return `${campaignText ? `## Active Campaign Brief — HIGH PRIORITY (overrides Brand Brief where they differ)
${campaignText}
${(campaignDocs?.length ?? 0) > 0 ? `[${campaignDocs!.length} campaign file(s) attached above — treat their content as authoritative campaign material]\n` : ''}
` : ''}## Brand Brief${campaignText ? ' (background DNA — subordinate to Campaign Brief above)' : ' (long-term DNA)'}
${briefText}

${strategySuggestions ? `## SEO Topic Suggestions (data-driven candidates — reuse uuids in source_strategy_item_id)\n${strategySuggestions}\n` : ''}
${viralReferences ? `## Viral Style References (high-performing content in this niche — use as style/technique inspiration for social task descriptions)\n${viralReferences}\n` : ''}
${emailPerformance ? `## Email Channel Performance (last 60 days — real Mailchimp data, this client HAS an active email channel)\n${emailPerformance}\n` : ''}
## Plan Parameters
- Plan Title: ${request.title}
- Period: ${request.start_date} → ${request.end_date} (~${weeks} week${weeks > 1 ? 's' : ''}, ${days} days)
- Intensity: ${intensity}
${
    intensity === 'light'
      ? `  → CONSERVATIVE cadence per active platform: posts_per_week=2-3, reels_per_month=2-3, stories_per_week=2-3. Blogs: 1 per 4 weeks. Use when brand wants premium scarcity feel.`
      : intensity === 'aggressive'
        ? `  → HIGH VOLUME cadence per active platform: posts_per_week=5-7, reels_per_month=6-10, stories_per_week=5-7. Blogs: 2-3 per 4 weeks. Use for launches, clearances, rapid-cycle campaigns. Volume is critical — quality should still be high, but do NOT under-deliver on quantity. For sub-2-week campaign windows, scale volumes proportionally but keep daily cadence high.`
        : intensity === 'ai_factory'
          ? `  → AI FACTORY full-throttle cadence per active platform: posts_per_week=7-8, reels_per_month=8-12, stories_per_week=7. Blogs: 3-4 per 4 weeks. This tier powers the AI Content Factory production pipeline — maximum sustainable volume for FDE managed clients. Spread tasks densely and evenly; every slot will be mass-produced downstream by the factory. Keep quality bar high — volume must NOT come at the cost of brand fit.`
          : `  → BALANCED cadence per active platform: posts_per_week=3-5, reels_per_month=4-6, stories_per_week=3-5. Blogs: 1-2 per 4 weeks. Sustainable steady-state cadence.`
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
    /** true = 撞到 maxOutputTokens 上限被截断，plan_data 可能不完整，UI 应该提示人工核对。 */
    truncated: boolean
  }
}

export async function generatePlanData(params: {
  briefText: string
  campaignText: string | null
  campaignDocs?: ClaudeDocInput[]
  strategySuggestions: string | null
  viralReferences: string | null
  /** 已格式化的邮件渠道历史表现——不传或传 null 时 AI 不会规划任何 newsletter_email 任务 */
  emailPerformance?: string | null
  request: GeneratePlanRequest
}): Promise<GenerateResult> {
  const userPrompt = buildUserPrompt(params)

  // bypassGateway: true — Marketing Plan generation can take 60-120s+. CF AI
  // Gateway kills requests after ~60s (524). Calling Anthropic directly avoids
  // the timeout. See: fix/marketing-plan-cf-timeout
  //
  // maxOutputTokens 16000（原 8000）：2026-09-08 CTS newsletter 排期实测——一次
  // 加进 email 维度、topics 数量多的计划会把 8000 用满（output_tokens===8000
  // 精确等于上限，是 stop_reason:'max_tokens' 截断的信号），email.topics 数组
  // 完整生成了，但 tasks 数组只转出前面几条就被截断——calling route 的
  // maxDuration 已同步调大（见 route.ts），非流式请求下 16000 是 Anthropic 官方
  // 建议的安全默认值（Claude Sonnet 4.6 非流式上限 128K，但更大就该切流式）。
  const result = await callClaudeWithDocs({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: userPrompt,
    docs: params.campaignDocs,
    maxOutputTokens: 16000,
    bypassGateway: true,
  })

  if (result.stop_reason === 'max_tokens') {
    // 不隐藏——调用方 UI 应该能看到"这份计划可能没生成完"，而不是静默拿到
    // 一份看起来正常、实际半截的 JSON（parseJsonResponse 的 jsonrepair 会把
    // 截断的 JSON 修成语法合法但内容不完整的对象，从结构上完全看不出被切过）。
    console.warn('[marketing-plan generator] Claude 输出在 16000 token 上限被截断，plan_data 可能不完整')
  }

  const planData = parseJsonResponse<MarketingPlanData>(result.text)

  // 兜底：保证 tasks 数组存在
  if (!Array.isArray(planData.tasks)) {
    planData.tasks = []
  }
  // 兜底：保证 blog.topics 数组存在
  if (!planData.blog || !Array.isArray(planData.blog.topics)) {
    planData.blog = { monthly_count: 0, topics: [] }
  }
  // 兜底：保证 email.topics 数组存在；没传 emailPerformance 时强制清空，
  // 防止 AI 在没有真实数据的情况下臆造邮件计划（换客户测试：Roman/Oztop 无渠道时必须是空壳）
  if (!params.emailPerformance || !planData.email || !Array.isArray(planData.email.topics)) {
    planData.email = { cadence_days: 0, topics: [] }
    // 双保险：没传邮件表现数据时，就算 AI 破例生成了 newsletter_email 任务也一律剔除
    if (!params.emailPerformance) {
      planData.tasks = planData.tasks.filter((t) => t.kind !== 'newsletter_email')
    }
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
      prompt_version: 'mp-v2-intensity-volumes',
      generation_cost_usd: result.cost_usd,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
      generated_at: new Date().toISOString(),
      truncated: result.stop_reason === 'max_tokens',
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

// ─── Viral Reference Library 格式化（供调用方使用）─────────────────────────────

interface ViralReference {
  id: string
  platform: string
  content_goal: string
  style_tags: string[] | null
  key_techniques: string[] | null
  style_description: string | null
}

/**
 * 把 viral_reference_library 表数据格式化为 prompt 注入文本。
 * 给 AI 提供「爆款内容的风格与技法」参考，用于丰富社媒任务描述。
 * 调用方负责从数据库拉数据。
 */
export function formatViralReferences(items: ViralReference[]): string {
  if (items.length === 0) return ''
  const lines = items
    .slice(0, 8)               // 最多注入 8 条，控制 prompt 大小
    .map(it => {
      const tags = it.style_tags?.slice(0, 5).join(', ') ?? '—'
      const techniques = it.key_techniques?.slice(0, 4).join(', ') ?? '—'
      const desc = it.style_description
        ? it.style_description.slice(0, 120).replace(/\n/g, ' ')
        : ''
      return `- [${it.platform}/${it.content_goal}] Style: ${tags} | Techniques: ${techniques}${desc ? ` | "${desc}…"` : ''}`
    })
  return lines.join('\n')
}

// ─── 邮件渠道历史表现格式化（供调用方使用）──────────────────────────────────────

interface EmailCampaignSummary {
  title: string
  subject: string
  sentAt: string | null
  emailsSent: number
  openRate: number
  clickRate: number
}

/**
 * 把 Mailchimp `listSentCampaigns()`（`src/lib/mailchimp/client.ts`，已有只读封装，
 * 本函数不新增 API 调用）的结果 + 最近自动欢迎序列触达人数，格式化为 prompt 注入文本。
 *
 * 调用方只应在客户**确实配置了邮件渠道**（`readAudienceId` 非空）时才调用本函数并
 * 把结果传给 `generatePlanData`——不传 = AI 不会规划任何 newsletter_email 任务，
 * 这是防止把"没有邮件渠道"的客户也拖进邮件规划推理的唯一开关（见 types.ts email 字段注释）。
 *
 * `recentAutoSequenceTouches`：过去 7 天内收到过自动欢迎序列（auto_e1-e4）邮件的人数。
 * 现有系统没有"某个具体联系人当前处于欢迎序列第几步"的读取路径，这个数字只是一个
 * 粗粒度的碰撞提示——不精确，但比完全不提示要好，且如实标注了口径。
 */
export function formatEmailPerformance(
  campaigns: EmailCampaignSummary[],
  recentAutoSequenceTouches: number,
): string {
  const lines: string[] = []
  if (campaigns.length === 0) {
    lines.push('- No campaigns sent in the last 60 days — no send-cadence history to anchor on. Propose a conservative cadence and say so in rationale.')
  } else {
    for (const c of campaigns.slice(0, 20)) {
      const date = c.sentAt ? c.sentAt.slice(0, 10) : '?'
      lines.push(
        `- ${date} · "${c.subject || c.title}" · sent to ${c.emailsSent} · open rate ${c.openRate}% · click rate ${c.clickRate}%`,
      )
    }
  }
  lines.push(
    recentAutoSequenceTouches > 0
      ? `- ${recentAutoSequenceTouches} contact(s) received an automated welcome-sequence email in the last 7 days (coarse signal, not per-contact — see EMAIL RULES).`
      : '- No automated welcome-sequence activity detected in the last 7 days.',
  )
  return lines.join('\n')
}
