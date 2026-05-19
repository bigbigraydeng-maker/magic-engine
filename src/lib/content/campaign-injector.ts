// Campaign Brief 注入器
// 为内容生成提供短期推广上下文，与 Master Brief 配合使用

import { supabaseAdmin } from '@/lib/supabase'
import type { CampaignBrief, CampaignKeywordSnapshot } from '@/types/magic-engine'

type CampaignPromptFields = Pick<
  CampaignBrief,
  'title' | 'description' | 'parsed_content' | 'semrush_keywords' | 'valid_from' | 'valid_until'
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

  if (keywords) {
    lines.push(`- 推广关键词：${keywords}`)
  }

  return lines.join('\n')
}
