import { getOpenAIClient } from '@/lib/ai/openai-client'
import type { VideoAnalysis } from './video-analyzer'
import type { MasterBrief, CampaignBrief } from '@/types/magic-engine'
import { formatCampaignForPrompt } from './campaign-injector'

export interface ContentPackage {
  variant: 1 | 2
  title: string
  script: string
  caption: string
  hashtags: string[]
  visual_brief: string
  platform_notes: string
}

export async function rewriteForBrand(params: {
  analysis: VideoAnalysis
  brief: MasterBrief
  targetPlatforms: string[]
  variant: 1 | 2
  campaign?: CampaignBrief
}): Promise<ContentPackage> {
  const openai = getOpenAIClient()
  const { analysis, brief, targetPlatforms, variant, campaign } = params
  const campaignText = campaign ? `\n${formatCampaignForPrompt(campaign)}` : ''

  const variantInstruction = variant === 1
    ? '这是变体1：保持原视频的主要结构和切入角度'
    : '这是变体2：换一个切入角度，比如从不同的情绪触点或不同的目标客群出发'

  const durationHint = analysis.pacing === 'fast'
    ? '控制在15-30秒'
    : analysis.pacing === 'medium'
      ? '控制在30-60秒'
      : '控制在60秒内'

  const prompt = `你是一位专业的社媒内容创作者。

【任务】
根据一条爆款视频的结构，为客户创作一条全新的内容。
保留爆款的"壳"（结构、情绪、节奏），替换所有内容为客户的品牌和产品。

${variantInstruction}

【爆款视频结构分析】
- 钩子（Hook）：${analysis.hook}
- 内容形式：${analysis.format}
- 情绪触点：${analysis.emotion}
- 内容结构：${analysis.structure}
- 节奏：${analysis.pacing}
- 结尾引导：${analysis.cta}
- 核心信息：${analysis.core_message}
- 主要要点：${analysis.key_points.join('；')}

【客户品牌信息】${campaignText}
品牌：${brief.brand_name}
定位：${brief.tagline || ''}
目标客群：${brief.primary_audience || ''}
客群痛点：${brief.pain_points?.join('、') || ''}
品牌语气：${brief.tone || '专业友好'}
禁用词：${brief.avoid_words?.join('、') || '无'}
主力产品：${brief.products?.slice(0, 3).map((p: { name: string; usp?: string }) => `${p.name} - ${p.usp}`).join('；') || ''}

【发布平台】${targetPlatforms.join('、')}

请以 JSON 格式输出，只返回 JSON：
{
  "title": "这条内容的内部标题（简短描述）",
  "script": "完整视频脚本，按句分行，适合朗读或字幕显示，${durationHint}",
  "caption": "发布时的配文，包含开头钩子、正文、结尾引导，适合${targetPlatforms[0]}风格",
  "hashtags": ["标签1", "标签2", "...共10-15个，中英文混合"],
  "visual_brief": "给AI图片/视频生成工具的提示词，描述画面风格、场景、色调，英文",
  "platform_notes": "针对各平台的发布建议（字数、格式、最佳发布时间等）"
}`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.7,
  })

  const result = JSON.parse(response.choices[0].message.content || '{}')
  return { ...result, variant }
}
