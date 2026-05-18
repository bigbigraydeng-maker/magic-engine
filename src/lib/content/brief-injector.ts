// 将 Master Brief 注入内容生成 prompt
// 确保所有生成内容符合客户品牌DNA

import { supabaseAdmin } from '@/lib/supabase'
import type { MasterBrief } from '@/types/magic-engine'

export async function getActiveBrief(clientId: string): Promise<MasterBrief | null> {
  const { data } = await supabaseAdmin
    .from('master_briefs')
    .select('*')
    .eq('client_id', clientId)
    .or('status.eq.active,is_active.eq.true')
    .order('version', { ascending: false })
    .limit(1)
    .single()

  return data
}

export function formatBriefForPrompt(brief: MasterBrief): string {
  // Resolve visual style — prefer structured vi_* fields, fall back to legacy
  const styleKeywords = brief.vi_style_keywords?.join(', ')
    || brief.visual_style
    || '未设置'

  const brandColors = (() => {
    if (brief.vi_colors) {
      const { primary, secondary, accent } = brief.vi_colors as Record<string, string>
      return [primary, secondary, accent].filter(Boolean).join(', ')
    }
    return brief.color_palette?.join(', ') || '未设置'
  })()

  const visualDos   = brief.vi_dos?.join('、') || '未设置'
  const visualDonts = brief.vi_donts?.join('、') || brief.image_preference || '无'

  return `
客户品牌信息（必须严格遵守）：
- 品牌名称：${brief.brand_name}
- 一句话定位：${brief.tagline || brief.core_proposition || '未设置'}
- 目标客群：${brief.primary_audience || (brief.target_audience as { description?: string } | null)?.description || '未设置'}
- 客群痛点：${brief.pain_points?.join('、') || '未设置'}
- 购买触发点：${brief.buying_trigger || '未设置'}
- 品牌语气：${brief.tone || (brief.brand_voice as { tone?: string } | null)?.tone || '专业友好'}
- 语气示例：${brief.voice_examples?.join(' / ') || '未设置'}
- 禁止使用的词：${brief.avoid_words?.join('、') || '无'}
- 主力产品：${brief.products?.map((p: { name: string; usp?: string }) => `${p.name}（${p.usp}）`).join('；') || '未设置'}
- 发布平台：${brief.platforms?.join('、') || 'Facebook, TikTok'}

视觉品牌 DNA（图片/视频生成必须遵守）：
- 视觉风格：${styleKeywords}
- 品牌色系：${brandColors}
- 视觉要做：${visualDos}
- 视觉禁止：${visualDonts}
`.trim()
}
