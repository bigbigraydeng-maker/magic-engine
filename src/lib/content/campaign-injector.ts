// Campaign Brief 注入器
// 为内容生成提供短期推广上下文，与 Master Brief 配合使用

import { supabaseAdmin } from '@/lib/supabase'
import type { CampaignBrief, CampaignKeywordSnapshot } from '@/types/magic-engine'

type CampaignPromptFields = Pick<
  CampaignBrief,
  | 'title'
  | 'description'
  | 'parsed_content'
  | 'semrush_keywords'
  | 'valid_from'
  | 'valid_until'
  | 'offer'
  | 'target_audience_detail'
  | 'proof_points'
  | 'primary_cta'
  | 'channel_goal'
  | 'campaign_angle'
  // Campaign-level visual direction (narrows/extends MB vi_*, must never contradict)
  | 'vi_mood'
  | 'vi_color_accent'
  | 'vi_specific_dos'
  | 'vi_specific_donts'
  | 'vi_reference_note'
  | 'vi_input_notes'
  | 'vi_input_file_urls'
>

export async function getActiveCampaigns(clientId: string): Promise<CampaignBrief[]> {
  const { data } = await supabaseAdmin
    .from('campaign_briefs')
    .select('*')
    .eq('client_id', clientId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })

  return data ?? []
}

export async function getCampaignById(
  clientId: string,
  campaignId: string
): Promise<CampaignBrief | null> {
  const { data } = await supabaseAdmin
    .from('campaign_briefs')
    .select('*')
    .eq('id', campaignId)
    .eq('client_id', clientId)
    .single()

  return data ?? null
}

export function formatCampaignForPrompt(campaign: CampaignPromptFields): string {
  const keywords = (campaign.semrush_keywords ?? [])
    .slice(0, 10)
    .map((k: CampaignKeywordSnapshot) => k.keyword)
    .join(', ')

  const dateRange = campaign.valid_from && campaign.valid_until
    ? `${campaign.valid_from} ~ ${campaign.valid_until}`
    : campaign.valid_from
      ? `${campaign.valid_from} 起`
      : ''

  const lines: string[] = [
    '当前推广活动（高优先级，内容须体现推广重点）：',
    `- 推广主题：${campaign.title}`,
  ]

  if (campaign.description) {
    lines.push(`- 推广描述：${campaign.description}`)
  }

  if (dateRange) {
    lines.push(`- 活动时间：${dateRange}`)
  }

  if (campaign.parsed_content) {
    const content = campaign.parsed_content.slice(0, 2000)
    lines.push(`- 产品/活动详情：\n${content}${campaign.parsed_content.length > 2000 ? '…' : ''}`)
  }

  if (campaign.offer) {
    lines.push(`- 推广优惠/核心卖点：${campaign.offer}`)
  }

  if (campaign.target_audience_detail) {
    lines.push(`- 目标受众：${campaign.target_audience_detail}`)
  }

  if (campaign.proof_points) {
    lines.push(`- 信任背书：${campaign.proof_points}`)
  }

  if (campaign.primary_cta) {
    lines.push(`- 行动号召：${campaign.primary_cta}`)
  }

  if (campaign.channel_goal) {
    lines.push(`- 渠道目标：${campaign.channel_goal}`)
  }

  if (campaign.campaign_angle) {
    lines.push(`- 推广角度：${campaign.campaign_angle}`)
  }

  if (keywords) {
    lines.push(`- 推广关键词：${keywords}`)
  }

  // Campaign-level visual direction — narrows or extends the brand DNA from MB.
  // Always layered ON TOP of MB vi_* fields, never contradicting them.
  const visualLines: string[] = []
  if (campaign.vi_mood) {
    visualLines.push(`- 活动情绪基调：${campaign.vi_mood}`)
  }
  if (campaign.vi_color_accent) {
    visualLines.push(`- 活动主色 / 重点色：${campaign.vi_color_accent}`)
  }
  if (campaign.vi_specific_dos?.length) {
    visualLines.push(`- 活动专属视觉要做：${campaign.vi_specific_dos.join('、')}`)
  }
  if (campaign.vi_specific_donts?.length) {
    visualLines.push(`- 活动专属视觉禁止：${campaign.vi_specific_donts.join('、')}`)
  }
  if (campaign.vi_reference_note) {
    visualLines.push(`- 视觉参考说明：${campaign.vi_reference_note}`)
  }
  if (campaign.vi_input_notes) {
    visualLines.push(`- 视觉灵感笔记：${campaign.vi_input_notes}`)
  }
  if (campaign.vi_input_file_urls?.length) {
    visualLines.push(`- 视觉参考素材：${campaign.vi_input_file_urls.length} 个文件已上传（已审核）`)
  }

  if (visualLines.length > 0) {
    lines.push('', '活动视觉指令（与品牌 vi_* 配合，可细化但绝不可冲突）：', ...visualLines)
  }

  return lines.join('\n')
}
