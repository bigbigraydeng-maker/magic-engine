import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'

type RouteContext = { params: { id: string; campaignId: string } }

// POST /api/clients/[id]/campaign/[campaignId]/generate-visual
// AI-assisted generation of campaign visual direction fields.
// Reads MB vi_* as the immutable brand guardrail, then specialises
// for this campaign's context + any user-supplied campaign visual inputs.
// Returns a preview — does NOT save.
// Saving is done via PATCH /api/clients/[id]/campaign/[campaignId].
export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: clientId, campaignId } = params

  // 1. Fetch campaign
  const { data: campaign, error: campErr } = await supabaseAdmin
    .from('campaign_briefs')
    .select('*')
    .eq('id', campaignId)
    .eq('client_id', clientId)
    .single()

  if (campErr || !campaign) {
    return NextResponse.json({ success: false, error: 'Campaign not found' }, { status: 404 })
  }

  // 2. Read optional campaign visual inputs from request body
  //    Fall back to values already saved on the campaign record
  let bodyInputNotes: string | null = null
  let bodyInputFilePaths: string[] = []
  try {
    const body = await req.json()
    bodyInputNotes = body.vi_input_notes ?? null
    bodyInputFilePaths = Array.isArray(body.vi_input_file_urls) ? body.vi_input_file_urls : []
  } catch {
    // no body is fine
  }
  const viInputNotes: string | null = bodyInputNotes ?? campaign.vi_input_notes ?? null
  const viInputFilePaths: string[] = bodyInputFilePaths.length > 0
    ? bodyInputFilePaths
    : (campaign.vi_input_file_urls ?? [])

  // 3. Fetch Master Brief (vi_* is the brand visual constitution)
  const { data: brief } = await supabaseAdmin
    .from('master_briefs')
    .select('brand_name, vi_colors, vi_style_keywords, vi_dos, vi_donts, visual_style, color_palette')
    .eq('client_id', clientId)
    .or('status.eq.active,is_active.eq.true')
    .order('version', { ascending: false })
    .limit(1)
    .single()

  // 4. Serialise MB visual DNA (gracefully handles missing fields)
  const mbColors = brief?.vi_colors
    ? Object.values(brief.vi_colors as Record<string, string>).filter(Boolean).join(', ')
    : brief?.color_palette?.join(', ') ?? '未设置'

  const mbStyleKeywords = brief?.vi_style_keywords?.join(', ')
    ?? brief?.visual_style
    ?? '未设置'

  const mbDos   = brief?.vi_dos?.join('\n- ') ?? '未设置'
  const mbDonts = brief?.vi_donts?.join('\n- ') ?? '未设置'

  // 5. Serialise campaign context
  const campaignContext = [
    `活动标题: ${campaign.title}`,
    campaign.description        ? `活动描述: ${campaign.description}` : null,
    campaign.offer              ? `核心 Offer: ${campaign.offer}` : null,
    campaign.campaign_angle     ? `推广角度: ${campaign.campaign_angle}` : null,
    campaign.target_audience_detail ? `目标受众: ${campaign.target_audience_detail}` : null,
    campaign.channel_goal       ? `渠道目标: ${campaign.channel_goal}` : null,
    campaign.valid_from         ? `活动时段: ${campaign.valid_from} → ${campaign.valid_until ?? '?'}` : null,
  ].filter(Boolean).join('\n')

  // 6. Download campaign visual reference files (text + PDF)
  const campaignDocsBlocks: Anthropic.ContentBlockParam[] = []
  const campaignTextSnippets: string[] = []

  for (const filePath of viInputFilePaths.slice(0, 3)) {
    try {
      const { data: blob, error: dlErr } = await supabaseAdmin.storage
        .from('campaign-uploads')
        .download(filePath)
      if (dlErr || !blob) continue

      const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
      if (ext === 'pdf') {
        const buffer = Buffer.from(await blob.arrayBuffer())
        campaignDocsBlocks.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') },
        } as unknown as Anthropic.ContentBlockParam)
      } else {
        // txt / docx treated as plain text
        campaignTextSnippets.push(await blob.text())
      }
    } catch {
      // skip individual file failures silently
    }
  }

  // 7. Build Claude message content
  const campaignVisualInputSection = [
    viInputNotes
      ? `## 本次活动视觉要点（用户输入）— 高优先级，请重点体现\n${viInputNotes}`
      : null,
    campaignTextSnippets.length > 0
      ? `## 活动参考文件内容\n${campaignTextSnippets.join('\n\n---\n\n')}`
      : null,
    campaignDocsBlocks.length > 0
      ? `## 参考文件（PDF，见附件）\n请参考已附上的 ${campaignDocsBlocks.length} 份 PDF 参考文件提炼视觉方向。`
      : null,
  ].filter(Boolean).join('\n\n')

  const promptText = `你是一位品牌视觉策略师。请为以下推广活动生成视觉方向。

## 品牌视觉宪法（Master Brief）— 不可违背，只能在此范围内专化
品牌: ${brief?.brand_name ?? '未知'}
色系: ${mbColors}
视觉风格: ${mbStyleKeywords}
视觉要做:
- ${mbDos}
视觉禁止:
- ${mbDonts}

## 本次推广活动上下文
${campaignContext}
${campaignVisualInputSection ? `\n${campaignVisualInputSection}` : ''}

## 任务
基于品牌视觉宪法，为这次活动生成专属视觉方向。要求：
1. 活动视觉必须在品牌色系和风格范围内（不能违背）
2. 如用户提供了"活动视觉要点"，必须将其核心元素体现在输出中
3. 可以更具体、更有季节感/主题感，但不能偏离品牌基调
4. vi_specific_dos 和 vi_specific_donts 是对 MB 的追加，不是替换

请严格输出以下 JSON，不要有任何其他文字：
{
  "vi_mood": "一句话描述本活动的视觉情绪基调（中文，20字以内）",
  "vi_color_accent": "活动专属强调色描述 + hex（例：收获金 #C9A84C）",
  "vi_specific_dos": ["活动专属视觉要做1", "要做2", "要做3"],
  "vi_specific_donts": ["活动专属视觉禁止1", "禁止2"],
  "vi_reference_note": "给AI图片生成工具的一句话视觉参考（英文，用于ChatGPT/Midjourney提示词）"
}`

  // 8. Call Claude — include PDF doc blocks if any
  const client = new Anthropic()
  const userContent: Anthropic.MessageParam['content'] = [
    ...campaignDocsBlocks,
    { type: 'text', text: promptText },
  ]

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: userContent }],
  })

  // 9. Parse response
  const raw = message.content[0].type === 'text' ? message.content[0].text : ''
  let generated: {
    vi_mood: string
    vi_color_accent: string
    vi_specific_dos: string[]
    vi_specific_donts: string[]
    vi_reference_note: string
  }

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON found in response')
    generated = JSON.parse(jsonMatch[0])
  } catch {
    return NextResponse.json(
      { success: false, error: 'AI 返回格式异常，请重试', raw },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true, generated })
}
