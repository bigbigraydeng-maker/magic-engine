import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAnthropicClientDirect, MODEL_SONNET } from '@/lib/anthropic/client'
import { parseJsonResponse } from '@/lib/anthropic/client'
import { submitImageGeneration } from '@/lib/visual/atlas'

/**
 * GET /api/cron/poster-studio-daily
 *
 * Daily cron — generates 3 draft content ideas (Magic Lab Class style) based on
 * current AU/NZ digital marketing trends. Saves as cron-triggered jobs for team review.
 *
 * Auth: Bearer ${CRON_SECRET}
 * Schedule: 08:00 NZST daily (20:00 UTC prev day)
 */
export const maxDuration = 180

const TOPICS_PROMPT = `
你是 Magic Lab 内容策略师。生成今日 3 个 AU/NZ 数字营销热点内容想法，用于 Magic Lab Class 教学帖。

要求：
- 结合当前数字营销趋势（AI SEO、GEO、Meta Ads、小红书出海、Google SGE 等）
- 每个 idea 必须对 AU/NZ 中小企业老板有直接实用价值
- 避免重复上周常见话题（SGE、ChatGPT SEO 已被讲烂）

返回 JSON 数组（不要 markdown 代码块）：
[
  {
    "topic": "话题标题",
    "angle": "具体切入角度（一句话）",
    "headline": "帖子标题（15字内）",
    "body": "正文（150-200字，Magic Lab Class风格：钩子+3个知识点+CTA）",
    "hashtags": ["tag1", "tag2", "tag3", "tag4"],
    "image_prompt": "English image prompt for Flux (50-80 words, professional marketing aesthetic)"
  }
]
`

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'Server misconfiguration: CRON_SECRET not set' }, { status: 500 })
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const anthropic = getAnthropicClientDirect()
    const claudeRes = await anthropic.messages.create({
      model: MODEL_SONNET,
      max_tokens: 3000,
      messages: [{ role: 'user', content: TOPICS_PROMPT }],
    })

    const rawJson = (claudeRes.content[0] as { type: string; text: string }).text
    const ideas: Array<{
      topic: string
      angle: string
      headline: string
      body: string
      hashtags: string[]
      image_prompt: string
    }> = parseJsonResponse(rawJson)

    if (!Array.isArray(ideas) || ideas.length === 0) {
      throw new Error('No ideas generated')
    }

    const results: string[] = []

    for (const idea of ideas.slice(0, 3)) {
      // Kick off Atlas image gen
      let atlasJobId: string | null = null
      try {
        const { job_id } = await submitImageGeneration({
          prompt: idea.image_prompt,
          width: 768,
          height: 1024,
        })
        atlasJobId = job_id
      } catch {
        // Non-fatal: proceed without image
      }

      const { data: row } = await supabaseAdmin
        .from('poster_studio_jobs')
        .insert({
          mode: 'magic_lab_class',
          platform: 'xiaohongshu',
          input_type: 'text',
          input_text: `Topic: ${idea.topic}\nAngle: ${idea.angle}`,
          source_label: `Daily cron — ${idea.topic}`,
          generated_copy: {
            headline: idea.headline,
            body: idea.body,
            hashtags: idea.hashtags,
            platform_note: 'Cron-generated draft — review before publishing',
          },
          image_prompt: idea.image_prompt,
          atlas_job_id: atlasJobId,
          image_status: atlasJobId ? 'pending' : 'none',
          status: 'completed',
          trigger_type: 'cron',
        })
        .select('id')
        .single()

      if (row?.id) results.push(row.id)
    }

    return NextResponse.json({ success: true, generated: results.length, job_ids: results })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
