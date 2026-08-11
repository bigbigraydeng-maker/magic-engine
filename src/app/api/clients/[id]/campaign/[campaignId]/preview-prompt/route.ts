import { requireDashboardClientAccess } from '@/lib/auth/client-access'
/**
 * POST /api/clients/[id]/campaign/[campaignId]/preview-prompt
 *
 * Builds the exact prompts that batch-generate would send to OpenAI,
 * WITHOUT executing content generation. Used by the Prompt Preview Modal
 * so users can review and edit before confirming batch generation.
 *
 * Runs the same keyword-planning + topic-planning AI calls as batch-generate
 * so the preview accurately reflects what will be generated.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getActiveBrief, formatBriefForPrompt } from '@/lib/content/brief-injector'
import { getCampaignById, formatCampaignForPrompt } from '@/lib/content/campaign-injector'
import { getOpenAIClient } from '@/lib/ai/openai-client'

interface PreviewRequest {
  platforms: string[]
  direction_note: string
  route_a_count: number
  route_c_count: number
}

type RouteType = 'route_a' | 'route_c'

export interface PreviewPost {
  index: number
  route: RouteType
  input: string
  hint: string
  user_prompt: string
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; campaignId: string } }
) {
  // 鉴权闸（2026-08-05 狄仁杰复审）：这条路由原来**完全没有任何登录校验**，
  // 而中间件的 matcher 只覆盖 /dashboard 和 /portal，不管 /api。
  // 实测：匿名 curl 带一个 client_id 就能拿到该客户的内容流水线（CTS 返回 30KB）。
  const __access = await requireDashboardClientAccess(params.id)
  if (!__access.ok) {
    return NextResponse.json({ error: __access.error }, { status: __access.status })
  }

  const { id: clientId, campaignId } = params

  try {
    const body: PreviewRequest = await req.json()
    const { platforms, direction_note, route_a_count, route_c_count } = body

    const VALID_PLATFORMS = ['facebook', 'tiktok', 'instagram', 'youtube', 'twitter'] as const
    type ValidPlatform = typeof VALID_PLATFORMS[number]
    const safePlatforms = (platforms ?? []).filter(
      (p): p is ValidPlatform => VALID_PLATFORMS.includes(p as ValidPlatform)
    )
    if (safePlatforms.length === 0) {
      return NextResponse.json({ success: false, error: 'No valid platforms provided' }, { status: 400 })
    }

    const safeDirectionNote = (direction_note ?? '').slice(0, 300)
    const totalPosts = (route_a_count ?? 0) + (route_c_count ?? 0)
    if (totalPosts < 1 || totalPosts > 30) {
      return NextResponse.json({ success: false, error: 'Total posts must be 1–30' }, { status: 400 })
    }

    const brief = await getActiveBrief(clientId)
    if (!brief) {
      return NextResponse.json(
        { success: false, error: 'No active Master Brief for this client.' },
        { status: 400 }
      )
    }
    const briefText = formatBriefForPrompt(brief)

    const campaign = await getCampaignById(clientId, campaignId)
    if (!campaign) {
      return NextResponse.json({ success: false, error: 'Campaign not found' }, { status: 404 })
    }
    const campaignText = formatCampaignForPrompt(campaign)

    // Instantiate client inside handler (per project convention)
    const openai = getOpenAIClient()

    // Build keyword list for Route A — mirrors batch-generate exactly
    const campaignKeywords = (campaign.semrush_keywords ?? [])
      .map((k: { keyword: string }) => k.keyword)
      .slice(0, route_a_count)

    const keywordsToUse: string[] = [...campaignKeywords]
    if (keywordsToUse.length < route_a_count) {
      const needed = route_a_count - keywordsToUse.length
      try {
        const supplementRes = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          temperature: 0.7,
          messages: [{
            role: 'user',
            content: `Generate ${needed} distinct SEO keyword phrases (2-5 words each) for this campaign: "${safeDirectionNote || campaign.title}"\nOutput JSON array only: ["keyword1","keyword2",...]`,
          }],
        })
        const raw = supplementRes.choices[0].message.content ?? '[]'
        const extra = JSON.parse(raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()) as string[]
        keywordsToUse.push(...extra.slice(0, needed))
      } catch {
        for (let i = keywordsToUse.length; i < route_a_count; i++) {
          keywordsToUse.push(`${campaign.title} ${i + 1}`)
        }
      }
    }

    // Build topic list for Route C — mirrors batch-generate exactly
    let topicsToUse: string[] = []
    if (route_c_count > 0) {
      try {
        const topicRes = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          temperature: 0.9,
          messages: [{
            role: 'user',
            content: `Generate ${route_c_count} distinct social media content topic angles for this campaign: "${safeDirectionNote || campaign.title}"\nEach topic should have a different emotional hook or audience angle.\nOutput JSON array only: ["topic1","topic2",...]`,
          }],
        })
        const raw = topicRes.choices[0].message.content ?? '[]'
        topicsToUse = JSON.parse(raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()) as string[]
      } catch {
        topicsToUse = Array.from({ length: route_c_count }, (_, i) => `${safeDirectionNote || campaign.title} - angle ${i + 1}`)
      }
    }

    // Build system prompt — identical to batch-generate
    const systemPrompt = `You are a social media content strategist. Create engaging content that fits the brand DNA exactly.
${briefText}

${campaignText}

Output ONLY valid JSON:
{
  "title": "...",
  "script": "...",
  "caption": "...",
  "hashtags": ["..."],
  "visual_brief": "..."
}`

    // Assemble task list — same hint rotation as batch-generate
    const tasks: Array<{ route: RouteType; input: string; hint: string }> = [
      ...keywordsToUse.slice(0, route_a_count).map((kw, i) => ({
        route: 'route_a' as RouteType,
        input: kw,
        hint: i % 2 === 0 ? 'Educational angle — explain value and benefits.' : 'Inspirational angle — use storytelling.',
      })),
      ...topicsToUse.slice(0, route_c_count).map((t, i) => ({
        route: 'route_c' as RouteType,
        input: t,
        hint: i % 2 === 0 ? 'Use a direct, compelling angle.' : 'Use an alternative emotional angle.',
      })),
    ]

    // Build per-post user prompts (no content generation — preview only)
    const posts: PreviewPost[] = tasks.map((t, i) => ({
      index: i,
      route: t.route,
      input: t.input,
      hint: t.hint,
      user_prompt: t.route === 'route_a'
        ? `Create a social media post targeting keyword: "${t.input}"\nPlatforms: ${safePlatforms.join(', ')}\n${t.hint}\nScript: 100-200 words. Caption: 50-100 words. 8-12 hashtags including keyword.`
        : `Create a social media post about: "${t.input}"\nPlatforms: ${safePlatforms.join(', ')}\n${t.hint}\nScript: 100-200 words. Caption: 50-100 words. 8-12 relevant hashtags.`,
    }))

    return NextResponse.json({ success: true, system_prompt: systemPrompt, posts })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[campaign/preview-prompt]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
