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
    // Trim to avoid excessive prompt length
    const content = campaign.parsed_content.slice(0, 800)
    lines.push(`- 产品/活动详情：\n${content}${campaign.parsed_content.length > 800 ? '…' : ''}`)
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

  return lines.join('\n')
}
