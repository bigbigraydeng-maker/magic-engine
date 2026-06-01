// Batch content generation for a Campaign Brief
// Generates N posts using Route A (keyword) and/or Route C (free topic)
// All posts land in 'draft' status for human review before entering calendar

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getActiveBrief, formatBriefForPrompt } from '@/lib/content/brief-injector'
import { getCampaignById, formatCampaignForPrompt } from '@/lib/content/campaign-injector'
import { auditSocialPost } from '@/lib/content/social-quality-audit'
import type { SocialAuditMetadata } from '@/lib/content/social-quality-audit'
import { getOpenAIClient } from '@/lib/ai/openai-client'

interface BatchGenerateRequest {
  platforms: string[]          // ['facebook', 'tiktok']
  direction_note: string       // campaign angle / tagline
  route_a_count: number        // keyword-based posts
  route_c_count: number        // free-topic posts
  prompt_overrides?: {
    system_prompt?: string            // full system prompt override from preview modal
    post_user_prompts?: string[]      // per-post user prompt overrides (indexed)
  }
}

type RouteType = 'route_a' | 'route_c'

interface PostDraft {
  title: string
  script: string
  caption: string
  hashtags: string[]
  visual_brief: string
  route: RouteType
  input_used: string
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; campaignId: string } }
) {
  const { id: clientId, campaignId } = params

  try {
    const body: BatchGenerateRequest = await req.json()
    const { platforms, direction_note, route_a_count, route_c_count, prompt_overrides } = body

    const openai = getOpenAIClient()

    // Validate + allowlist platforms — never store arbitrary user strings in DB
    const VALID_PLATFORMS = ['facebook', 'tiktok', 'instagram', 'youtube', 'twitter'] as const
    type ValidPlatform = typeof VALID_PLATFORMS[number]
    const safePlatforms = (platforms ?? []).filter(
      (p): p is ValidPlatform => VALID_PLATFORMS.includes(p as ValidPlatform)
    )
    if (safePlatforms.length === 0) {
      return NextResponse.json({ success: false, error: 'No valid platforms provided' }, { status: 400 })
    }

    // Truncate direction_note to prevent prompt injection via long inputs
    const safeDirectionNote = (direction_note ?? '').slice(0, 300)

    const totalPosts = (route_a_count ?? 0) + (route_c_count ?? 0)
    if (totalPosts < 1 || totalPosts > 30) {
      return NextResponse.json({ success: false, error: 'Total posts must be 1–30' }, { status: 400 })
    }

    // 1. Load Master Brief
    const brief = await getActiveBrief(clientId)
    if (!brief) {
      return NextResponse.json(
        { success: false, error: 'No active Master Brief for this client.' },
        { status: 400 }
      )
    }
    const briefText = formatBriefForPrompt(brief)

    // 2. Load Campaign Brief
    const campaign = await getCampaignById(clientId, campaignId)
    if (!campaign) {
      return NextResponse.json({ success: false, error: 'Campaign not found' }, { status: 404 })
    }
    let campaignText = formatCampaignForPrompt(campaign)

    // 2b. Append plain-text campaign files (TXT only — GPT-4o-mini has no PDF doc API)
    // PDF/DOCX files are noted by count so the model knows richer context exists
    const filePaths = (campaign.source_file_urls ?? []).filter(Boolean).slice(0, 3)
    if (filePaths.length > 0) {
      const textSnippets: string[] = []
      let binaryCount = 0
      for (const storagePath of filePaths) {
        const isTxt = storagePath.toLowerCase().endsWith('.txt')
        if (!isTxt) { binaryCount++; continue }
        try {
          const { data, error } = await supabaseAdmin.storage
            .from('campaign-uploads')
            .download(storagePath)
          if (!data || error) continue
          const text = Buffer.from(await data.arrayBuffer()).toString('utf-8').slice(0, 1500)
          textSnippets.push(text)
        } catch { /* non-fatal */ }
      }
      if (textSnippets.length > 0) {
        campaignText += `\n\n- 活动资料文件内容：\n${textSnippets.join('\n---\n')}`
      }
      if (binaryCount > 0) {
        campaignText += `\n- 注：另有 ${binaryCount} 个 PDF/DOCX 格式的活动资料，详细内容见 Marketing Plan。`
      }
    }

    // 3. Build keyword list for Route A
    const campaignKeywords = (campaign.semrush_keywords ?? [])
      .map((k: { keyword: string }) => k.keyword)
      .slice(0, route_a_count)

    // If not enough SEMrush keywords, supplement with AI-generated angles
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
        // Non-fatal: fill with campaign title variations
        for (let i = keywordsToUse.length; i < route_a_count; i++) {
          keywordsToUse.push(`${campaign.title} ${i + 1}`)
        }
      }
    }

    // 4. Build topic list for Route C
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

    // 5. Generate all posts (in controlled batches of 5 concurrent)
    // Use overridden system prompt if provided by Prompt Preview Modal
    const systemPrompt = prompt_overrides?.system_prompt ?? `You are a social media content strategist. Create engaging content that fits the brand DNA exactly.
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

    const generatePost = async (
      route: RouteType,
      inputText: string,
      variantHint: string,
      userPromptOverride?: string,
      refineHint?: string,
    ): Promise<PostDraft> => {
      const basePrompt = userPromptOverride ?? (
        route === 'route_a'
          ? `Create a social media post targeting keyword: "${inputText}"\nPlatforms: ${safePlatforms.join(', ')}\n${variantHint}\nScript: 100-200 words. Caption: 50-100 words. 8-12 hashtags including keyword.`
          : `Create a social media post about: "${inputText}"\nPlatforms: ${safePlatforms.join(', ')}\n${variantHint}\nScript: 100-200 words. Caption: 50-100 words. 8-12 relevant hashtags.`
      )
      const userPrompt = refineHint
        ? `${basePrompt}\n\nQuality Feedback (please address these issues in your response):\n${refineHint}`
        : basePrompt
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.85,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      })

      const raw = completion.choices[0].message.content ?? '{}'
      let parsed: Record<string, unknown> = {}
      try {
        parsed = JSON.parse(raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
      } catch {
        // Non-JSON response from model — use fallback values
        console.warn('[batch-generate] JSON parse failed for input:', inputText, '| raw:', raw.slice(0, 200))
      }

      return {
        title: (parsed.title as string) || inputText,
        script: (parsed.script as string) || '',
        caption: (parsed.caption as string) || '',
        hashtags: (parsed.hashtags as string[]) || [],
        visual_brief: (parsed.visual_brief as string) || '',
        route,
        input_used: inputText,
      }
    }

    // Quality audit metadata (shared across all posts in this batch)
    const auditMeta: SocialAuditMetadata = {
      brand_name:       brief.brand_name ?? null,
      tone:             brief.tone ?? null,
      avoid_words:      brief.avoid_words ?? null,
      platforms:        brief.platforms ?? null,
      primary_audience: brief.primary_audience ?? null,
      campaign: {
        title:                  campaign.title ?? null,
        offer:                  campaign.offer ?? null,
        primary_cta:            campaign.primary_cta ?? null,
        campaign_angle:         campaign.campaign_angle ?? null,
        target_audience_detail: campaign.target_audience_detail ?? null,
      },
    }

    interface PostResult {
      draft: PostDraft
      qualityScore: number | null
      contextSnapshot: Record<string, unknown> | null
    }

    const generatePostWithQualityRetry = async (
      route: RouteType,
      inputText: string,
      variantHint: string,
      userPromptOverride?: string,
    ): Promise<PostResult> => {
      const MAX_ATTEMPTS = 3
      let lastDraft: PostDraft | null = null
      let qualityScore: number | null = null
      let contextSnapshot: Record<string, unknown> | null = null
      let refineHint: string | undefined

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        lastDraft = await generatePost(route, inputText, variantHint, userPromptOverride, refineHint)

        try {
          const contentForAudit = [lastDraft.script, lastDraft.caption, lastDraft.hashtags.join(' ')]
            .filter(Boolean)
            .join('\n')
          const contentType = route === 'route_a' ? 'social_a' as const : 'social_c' as const
          const primaryKeyword = route === 'route_a' ? inputText : null

          const audit = await auditSocialPost(contentForAudit, safePlatforms, contentType, auditMeta, primaryKeyword)
          if (!audit) break

          qualityScore = audit.rubricResult.overallScore
          contextSnapshot = { ...audit.contextSnapshot, attempts: attempt }

          if (audit.rubricResult.pass || attempt === MAX_ATTEMPTS) {
            if (!audit.rubricResult.pass) {
              console.warn(
                `[social quality] Post failed quality threshold after ${attempt} attempt(s)` +
                ` (score: ${audit.rubricResult.overallScore}, route: ${route}, input: ${inputText}).`
              )
            }
            break
          }

          const failed = audit.rubricResult.dimensions.filter(d => !d.pass)
          if (failed.length > 0) {
            refineHint = failed.map(d => `- ${d.dimension}: ${d.reason}`).join('\n')
          }
        } catch (err) {
          console.error('[social quality] Audit error (non-blocking):', err)
          break
        }
      }

      return { draft: lastDraft!, qualityScore, contextSnapshot }
    }

    // Build task list
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

    // Process in batches of 5 to avoid rate limits
    const BATCH_SIZE = 5
    const postResults: PostResult[] = []

    for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
      const batch = tasks.slice(i, i + BATCH_SIZE)
      const settled = await Promise.allSettled(
        batch.map((t, batchIdx) => {
          const globalIdx = i + batchIdx
          const userPromptOverride = prompt_overrides?.post_user_prompts?.[globalIdx]
          return generatePostWithQualityRetry(t.route, t.input, t.hint, userPromptOverride)
        })
      )
      for (const r of settled) {
        if (r.status === 'fulfilled') postResults.push(r.value)
      }
    }

    const generationFailures = tasks.length - postResults.length
    if (postResults.length === 0) {
      throw new Error(`All ${tasks.length} generation attempts failed`)
    }

    // 6. Bulk insert to Supabase
    const rows = postResults.map(r => ({
      client_id:       clientId,
      route:           r.draft.route,
      platforms:       safePlatforms,
      title:           r.draft.title,
      script:          r.draft.script,
      caption:         r.draft.caption,
      hashtags:        r.draft.hashtags,
      visual_brief:    r.draft.visual_brief,
      source_brief_id: brief.id,
      campaign_id:     campaign.id,
      content_mode:    'campaign',
      status:          'draft',
      generation_context_snapshot: r.contextSnapshot,
      quality_score:   r.qualityScore,
    }))

    const { data: savedPosts, error } = await supabaseAdmin
      .from('content_posts')
      .insert(rows)
      .select('id, title, route, status, platforms, script, caption, hashtags, visual_brief, source_video_url, quality_score')

    if (error) throw error

    return NextResponse.json({
      success: true,
      generated: postResults.length,
      saved: savedPosts?.length ?? 0,
      generation_failures: generationFailures,
      db_failures: postResults.length - (savedPosts?.length ?? 0),
      posts: savedPosts,
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[campaign/batch-generate]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
