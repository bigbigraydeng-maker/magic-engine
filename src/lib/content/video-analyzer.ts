// 爆款视频7维度分析器
// 输入：转录文本 + 元数据
// 输出：结构化的视频解析卡

import { getOpenAIClient } from '@/lib/ai/openai-client'

export interface VideoAnalysis {
  hook: string
  format: VideoFormat
  emotion: EmotionType
  structure: ContentStructure
  pacing: PacingType
  cta: string
  core_message: string
  key_points: string[]
  duration_seconds?: number
}

export type VideoFormat =
  | 'talking_head'
  | 'text_overlay'
  | 'b_roll'
  | 'before_after'
  | 'ugc'

export type EmotionType =
  | 'curiosity'
  | 'fomo'
  | 'inspiration'
  | 'humor'
  | 'shock'
  | 'aspiration'

export type ContentStructure =
  | 'list'
  | 'story'
  | 'problem_solution'
  | 'before_after'
  | 'myth_busting'
  | 'tutorial'
  | 'review'

export type PacingType = 'fast' | 'medium' | 'slow'

export async function analyzeViralVideo(
  transcript: string,
  metadata: { title?: string; duration?: number; platform: string }
): Promise<VideoAnalysis> {
  const openai = getOpenAIClient()
  const prompt = `你是一位顶级社媒内容策略师，专门分析爆款视频的内容结构。

分析以下视频的转录文本，提炼出7个维度的关键信息。

视频信息：
- 平台：${metadata.platform}
- 标题：${metadata.title || '未知'}
- 时长：${metadata.duration ? `${metadata.duration}秒` : '未知'}

转录文本：
${transcript.slice(0, 3000)}

请以 JSON 格式返回分析结果：
{
  "hook": "开头3秒的核心句式或视觉钩子（一句话）",
  "format": "talking_head | text_overlay | b_roll | before_after | ugc",
  "emotion": "curiosity | fomo | inspiration | humor | shock | aspiration",
  "structure": "list | story | problem_solution | before_after | myth_busting | tutorial | review",
  "pacing": "fast | medium | slow",
  "cta": "结尾的行动引导（一句话）",
  "core_message": "这个视频的核心信息/卖点（一句话）",
  "key_points": ["要点1", "要点2", "要点3"]
}

只返回 JSON，不要其他文字。`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  })

  const result = JSON.parse(response.choices[0].message.content || '{}')
  return result as VideoAnalysis
}
