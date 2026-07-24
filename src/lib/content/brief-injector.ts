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
  // 叙事人格(brand_voice.persona):有则本条内容用「这个真人」的第一人称口吻写,
  // 没有则保持原来的品牌口吻 —— 不是所有客户都适合真人视角(个人 IP 适合,
  // 匿名品牌号硬套「我」会变成编造身份)。
  const persona = (brief.brand_voice as { persona?: { name?: string; role?: string } } | null)?.persona
  const personaLine = persona?.name
    ? `\n- 叙事人格：${persona.name}${persona.role ? `（${persona.role}）` : ''} —— 用第一人称「我/我们」讲,不用旁白腔`
    : ''

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

  // P4: platform strategy — which platforms are explicitly enabled/disabled
  const platformStrategyText = (() => {
    const ps = brief.platform_strategy as Record<string, { enabled?: boolean; post_frequency?: string; primary_content_type?: string }> | null
    if (!ps) return null
    const lines = Object.entries(ps)
      .map(([platform, cfg]) => {
        const status = cfg.enabled === false ? '❌ disabled' : '✅ enabled'
        const freq = cfg.post_frequency ? ` (${cfg.post_frequency})` : ''
        return `  ${platform}: ${status}${freq}`
      })
    return lines.length > 0 ? lines.join('\n') : null
  })()

  // P1: content pillars — defines content type distribution and example topics
  const pillarsText = (() => {
    if (!brief.content_pillars?.length) return null
    return brief.content_pillars.map((p: { name: string; description: string; post_ratio: number; example_topics?: string[] }) => {
      const pct = Math.round(p.post_ratio * 100)
      const examples = p.example_topics?.slice(0, 3).join(' / ') || ''
      return `  [${pct}%] ${p.name}: ${p.description}${examples ? ` (e.g. ${examples})` : ''}`
    }).join('\n')
  })()

  // P3: brand story — rich narrative context for tone/angle alignment
  const brandStory = brief.brand_story_md
    ? brief.brand_story_md.slice(0, 1500) + (brief.brand_story_md.length > 1500 ? '…' : '')
    : null

  return `
客户品牌信息（必须严格遵守）：
- 品牌名称：${brief.brand_name}
- 一句话定位：${brief.tagline || brief.core_proposition || '未设置'}
- 目标客群：${brief.primary_audience || (brief.target_audience as { description?: string } | null)?.description || '未设置'}
- 客群痛点：${brief.pain_points?.join('、') || '未设置'}
- 购买触发点：${brief.buying_trigger || '未设置'}
- 品牌语气：${brief.tone || (brief.brand_voice as { tone?: string } | null)?.tone || '专业友好'}${personaLine}
- 语气示例：${brief.voice_examples?.join(' / ') || '未设置'}
- 禁止使用的词：${brief.avoid_words?.join('、') || '无'}
- 主力产品：${brief.products?.map((p: { name: string; usp?: string }) => `${p.name}（${p.usp}）`).join('；') || '未设置'}
- 发布平台：${brief.platforms?.join('、') || 'Facebook, TikTok'}
${platformStrategyText ? `\n平台策略（严格遵守启用/禁用设置）：\n${platformStrategyText}` : ''}
${pillarsText ? `\n内容支柱分布（内容比例和主题方向必须遵守）：\n${pillarsText}` : ''}
${brandStory ? `\n品牌故事背景（用于把握语气和角度）：\n${brandStory}` : ''}

视觉品牌 DNA（图片/视频生成必须遵守）：
- 视觉风格：${styleKeywords}
- 品牌色系：${brandColors}
- 视觉要做：${visualDos}
- 视觉禁止：${visualDonts}
`.trim()
}
