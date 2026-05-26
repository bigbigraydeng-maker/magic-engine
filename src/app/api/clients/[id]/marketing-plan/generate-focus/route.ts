/**
 * POST /api/clients/[id]/marketing-plan/generate-focus
 *
 * AI-generates a draft FDE 关注点 (focus_note) for a Marketing Plan.
 * Reads MB brand DNA + Campaign context to produce a 2-3 sentence
 * execution focus note in Chinese.
 *
 * Body: { campaign_id?: string }
 * Returns: { success: true, focus_note: string }
 *
 * Does NOT save — caller shows preview and user may edit before submitting.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { formatBriefForPrompt } from '@/lib/content/brief-injector'
import { formatCampaignForPrompt, getCampaignById } from '@/lib/content/campaign-injector'
import Anthropic from '@anthropic-ai/sdk'
import type { MasterBrief } from '@/types/magic-engine'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const clientId = params.id

  let campaignId: string | undefined
  try {
    const body = await req.json()
    campaignId = body.campaign_id ?? undefined
  } catch {
    // no body is fine
  }

  // 1. Master Brief
  const { data: brief, error: briefErr } = await supabaseAdmin
    .from('master_briefs')
    .select('*')
    .eq('client_id', clientId)
    .or('status.eq.active,is_active.eq.true')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (briefErr || !brief) {
    return NextResponse.json(
      { success: false, error: 'No active Master Brief found.' },
      { status: 400 }
    )
  }

  const briefText = formatBriefForPrompt(brief as unknown as MasterBrief)

  // 2. Campaign (optional)
  let campaignText: string | null = null
  if (campaignId) {
    const campaign = await getCampaignById(clientId, campaignId)
    if (campaign) {
      campaignText = formatCampaignForPrompt(campaign)
    }
  }

  // 3. Build prompt
  const prompt = `你是一位资深数字营销 FDE（Frontline Deployment Engineer）。根据以下品牌信息${campaignText ? '和推广活动背景' : ''}，为即将生成的 Marketing Plan 写一段执行关注点备注（focus note）。

要求：
- 2-3 句话，中文
- 第一句：指出本次计划重点服务的受众群体或场景
- 第二句：明确内容策略重心（哪类内容、哪个平台、什么节奏）
- 第三句（可选）：特别提醒 AI 需要注意的调性禁忌或优先级
- 语气简练专业，像内部 brief 备注，不要营销腔

## 品牌 DNA
${briefText}
${campaignText ? `\n## 本次推广活动\n${campaignText}` : ''}

请只输出 focus note 正文，不要任何前缀或解释。`

  // 4. Call Claude
  const client = new Anthropic()
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
  })

  const focusNote = message.content[0].type === 'text'
    ? message.content[0].text.trim()
    : ''

  if (!focusNote) {
    return NextResponse.json(
      { success: false, error: 'AI returned empty response, please retry.' },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true, focus_note: focusNote })
}
