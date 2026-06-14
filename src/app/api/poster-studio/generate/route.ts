import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAnthropicClientDirect, MODEL_SONNET } from '@/lib/anthropic/client'
import { fetchUrlAsMarkdown } from '@/lib/brief/jina'
import { submitImageGeneration } from '@/lib/visual/atlas'
import { parseJsonResponse } from '@/lib/anthropic/client'

export const maxDuration = 120

type Mode = 'magic_lab_class' | 'ray_perspective'
type Platform = 'xiaohongshu' | 'instagram' | 'linkedin' | 'wechat'
type InputType = 'url' | 'text' | 'image_url'

interface GenerateBody {
  mode: Mode
  platform: Platform
  input_type: InputType
  input_url?: string
  input_text?: string
  input_image_url?: string
  source_label?: string
  generate_image?: boolean
}

interface CopyOutput {
  headline: string
  body: string
  hashtags: string[]
  platform_note: string
  image_prompt: string
}

// ── Platform dimensions for Atlas ─────────────────────────────────────────────
const PLATFORM_DIMS: Record<Platform, { width: number; height: number }> = {
  xiaohongshu: { width: 768,  height: 1024 },
  instagram:   { width: 1024, height: 1024 },
  linkedin:    { width: 1024, height: 576  },
  wechat:      { width: 1024, height: 1024 },
}

// ── Brand voice prompts ────────────────────────────────────────────────────────
const SYSTEM_PROMPTS: Record<Mode, string> = {
  magic_lab_class: `
你是 Magic Lab 的内容导师。把提供的原始素材改写成「Magic Lab Class」教学帖，供同事发布在社交媒体。

风格规范：
- 开头一句话钩子：引发共鸣（反常识结论、数据、痛点）
- 主体 3-5 个有编号的干货知识点，每点不超过 2 行
- 结尾：一句话总结 + 软性互动问题（"你试过这个方法吗？"）
- 语言：中英自然混合（专业词汇英文，叙述中文）
- 语气：权威但亲切，像资深数字营销教练
- 必须结合 AU/NZ 中小企业真实场景
- 禁止说「干货」「赋能」「分享」「闭环」这类词

返回 JSON（不要 markdown 代码块）：
{
  "headline": "标题（15字内）",
  "body": "正文（根据平台长度要求）",
  "hashtags": ["tag1", "tag2", ...最多8个"],
  "platform_note": "针对此平台的一句话发布建议",
  "image_prompt": "English prompt for image generation (50-80 words, professional/educational aesthetic, no text in image)"
}`,

  ray_perspective: `
你是 Ray（大瑞），Magic Lab 创始人，直接、有主见的数字营销人。把素材改写成你的个人视角帖。

风格规范：
- 第一句话必须是你的直接个人观点，不绕弯子
- 用「我」第一人称，分享你的观察或经历
- 语气直接、有个性，敢说别人不敢说的话
- 中英自然混用（不刻意）
- 字数：小红书/微信 150-250 字，Instagram/LinkedIn 100-180 字
- 结尾一个引发讨论的问题或锐利观点
- 禁止「干货」「赋能」「分享」「大咖」这类词

返回 JSON（不要 markdown 代码块）：
{
  "headline": "标题（15字内，要有点冲）",
  "body": "正文",
  "hashtags": ["tag1", "tag2", ...最多6个"],
  "platform_note": "针对此平台的一句话发布建议",
  "image_prompt": "English prompt for image generation (50-80 words, bold personal brand aesthetic, authentic feel, no text in image)"
}`,
}

const PLATFORM_GUIDANCE: Record<Platform, string> = {
  xiaohongshu: '小红书：竖版、段落短、emoji 点缀、话题标签重要',
  instagram:   'Instagram：中英双语或纯英，hashtags 放评论区，CTA 清晰',
  linkedin:    'LinkedIn：正式语气，英文为主，专业洞察，篇幅可适当长',
  wechat:      '微信：简体中文，段落清晰，少 emoji，标题党',
}

export async function POST(req: NextRequest) {
  try {
    const body: GenerateBody = await req.json()
    const {
      mode,
      platform,
      input_type,
      input_url,
      input_text,
      input_image_url,
      source_label,
      generate_image = true,
    } = body

    if (!mode || !platform || !input_type) {
      return NextResponse.json({ error: 'mode, platform, input_type are required' }, { status: 400 })
    }

    // ── Step 1: get raw material ───────────────────────────────────────────────
    let rawContent = ''
    let scrapedContent = ''

    if (input_type === 'url' && input_url) {
      const jina = await fetchUrlAsMarkdown(input_url)
      rawContent = jina.markdown
      scrapedContent = rawContent
    } else if (input_type === 'text' && input_text) {
      rawContent = input_text
    } else if (input_type === 'image_url' && input_image_url) {
      rawContent = `[Reference image: ${input_image_url}]\nPlease analyze the visual content and create copy based on the image theme.`
    } else {
      return NextResponse.json({ error: 'Input content is missing' }, { status: 400 })
    }

    // ── Step 2: create DB job row ──────────────────────────────────────────────
    const { data: job, error: insertErr } = await supabaseAdmin
      .from('poster_studio_jobs')
      .insert({
        mode,
        platform,
        input_type,
        input_url: input_url ?? null,
        input_text: input_text ?? null,
        input_image_url: input_image_url ?? null,
        scraped_content: scrapedContent || null,
        source_label: source_label ?? null,
        status: 'processing',
        trigger_type: 'manual',
      })
      .select('id')
      .single()

    if (insertErr || !job) {
      return NextResponse.json({ error: 'Failed to create job' }, { status: 500 })
    }

    const jobId = job.id

    // ── Step 3: call Claude to generate copy ──────────────────────────────────
    const systemPrompt = SYSTEM_PROMPTS[mode]
    const userMessage = `平台：${platform}（${PLATFORM_GUIDANCE[platform]}）

原始素材：
${rawContent.slice(0, 8000)}

请改写为「${mode === 'magic_lab_class' ? 'Magic Lab Class' : '大瑞视角'}」风格的${platform}帖子。`

    const anthropic = getAnthropicClientDirect()
    const claudeRes = await anthropic.messages.create({
      model: MODEL_SONNET,
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    })

    const rawJson = (claudeRes.content[0] as { type: string; text: string }).text
    const copy: CopyOutput = parseJsonResponse(rawJson)

    if (!copy.headline || !copy.body) {
      throw new Error('Claude returned incomplete copy')
    }

    // ── Step 4: kick off Atlas image generation (async) ───────────────────────
    let atlasJobId: string | null = null
    let imageStatus: 'none' | 'pending' = 'none'

    if (generate_image && copy.image_prompt) {
      const dims = PLATFORM_DIMS[platform]
      const { job_id } = await submitImageGeneration({
        prompt: copy.image_prompt,
        width: dims.width,
        height: dims.height,
      })
      atlasJobId = job_id
      imageStatus = 'pending'
    }

    // ── Step 5: update DB row ─────────────────────────────────────────────────
    const { headline, body: copyBody, hashtags, platform_note, image_prompt } = copy
    await supabaseAdmin
      .from('poster_studio_jobs')
      .update({
        generated_copy: { headline, body: copyBody, hashtags, platform_note },
        image_prompt,
        atlas_job_id: atlasJobId,
        image_status: imageStatus,
        status: 'completed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    return NextResponse.json({
      success: true,
      job_id: jobId,
      copy: { headline, body: copyBody, hashtags, platform_note },
      image_prompt,
      image_url: null,
      image_status: imageStatus,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
