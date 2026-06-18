import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAnthropicClientDirect, MODEL_SONNET, parseJsonResponse } from '@/lib/anthropic/client'
import { fetchUrlAsMarkdown } from '@/lib/brief/jina'
import { generateImage } from '@/lib/visual/openai-images'
import { uploadFromBase64 } from '@/lib/visual/storage'
import { guardAdmin } from '@/lib/auth/require-admin'

export const maxDuration = 180

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

// ── Platform → OpenAI aspect ratio ────────────────────────────────────────────
const PLATFORM_ASPECT: Record<Platform, string> = {
  xiaohongshu: '9:16',
  instagram:   '1:1',
  linkedin:    '16:9',
  wechat:      '1:1',
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
  "hashtags": ["tag1", "tag2", ...最多8个],
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
  "hashtags": ["tag1", "tag2", ...最多6个],
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
  const guard = await guardAdmin()
  if (guard) return guard

  try {
    const reqBody: GenerateBody = await req.json()
    const {
      mode,
      platform,
      input_type,
      input_url,
      input_text,
      input_image_url,
      source_label,
      generate_image = true,
    } = reqBody

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

    // ── Step 3: Claude generates copy + image prompt ──────────────────────────
    const anthropic = getAnthropicClientDirect()
    const claudeRes = await anthropic.messages.create({
      model: MODEL_SONNET,
      max_tokens: 1500,
      system: SYSTEM_PROMPTS[mode],
      messages: [{
        role: 'user',
        content: `平台：${platform}（${PLATFORM_GUIDANCE[platform]}）\n\n原始素材：\n${rawContent.slice(0, 8000)}\n\n请改写为「${mode === 'magic_lab_class' ? 'Magic Lab Class' : '大瑞视角'}」风格的${platform}帖子。`,
      }],
    })

    const rawJson = (claudeRes.content[0] as { type: string; text: string }).text
    const copy: CopyOutput = parseJsonResponse(rawJson)

    if (!copy.headline || !copy.body) {
      throw new Error('Claude returned incomplete copy')
    }

    const { headline, body: copyBody, hashtags, platform_note, image_prompt } = copy

    // ── Step 4: OpenAI image generation (synchronous) ─────────────────────────
    let imageUrl: string | null = null
    let imageStatus: 'none' | 'completed' | 'failed' = 'none'

    if (generate_image && image_prompt) {
      try {
        const aspect_ratio = PLATFORM_ASPECT[platform]
        const { b64 } = await generateImage({ prompt: image_prompt, aspect_ratio })
        const { storage_url } = await uploadFromBase64({
          base64: b64,
          clientId: 'magic-lab-internal',
          folder: `poster-studio/${jobId}`,
          assetType: 'image',
        })
        imageUrl = storage_url
        imageStatus = 'completed'
      } catch {
        imageStatus = 'failed'
      }
    }

    // ── Step 5: persist result ────────────────────────────────────────────────
    await supabaseAdmin
      .from('poster_studio_jobs')
      .update({
        generated_copy: { headline, body: copyBody, hashtags, platform_note },
        image_prompt,
        image_url: imageUrl,
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
      image_url: imageUrl,
      image_status: imageStatus,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
