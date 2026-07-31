// 讲课式文案 — 把一个选题写成「上课件 + 下真人数字人口播」讲课短视频的结构化脚本。
// 输出：开场钩子 + 2-4 个教学要点(每个带 口播词 + 课件 slide 标题/要点) + 结尾 CTA。
// 铁律：第一人称人设 / 禁词 / 不编数字用【】/ 不带货 / 口播能一口气念。

import { callClaudeChat, parseJsonResponse } from '@/lib/anthropic/client'
import { getActiveBrief, formatBriefForPrompt } from '@/lib/content/brief-injector'

export interface LectureSection {
  spoken: string        // 这一段数字人念的口播词
  slideTitle: string    // 课件 slide 大标题
  slidePoints: string[] // 课件 slide 要点(每条短）
}

export interface LectureScript {
  title: string         // 视频标题
  hookSpoken: string    // 开场钩子口播(数字人念)
  sections: LectureSection[]
  ctaSpoken: string     // 结尾行动号召口播
}

const SYSTEM = `你是短视频「讲课式文案」编剧。把一个选题写成「上课件 + 下真人口播」的讲课短视频脚本。

结构(固定)：
1. 开场钩子(hookSpoken)：3 秒抓人的一句，口播，制造好奇或戳痛点。
2. 2-4 个教学要点(sections)：每个要点给
   - spoken：这段口播词(口语、短句、能一口气念，约 15-30 字)
   - slideTitle：课件大标题(≤10 字，抓这段核心)
   - slidePoints：课件要点 2-3 条(每条 ≤12 字，大白话)
3. 结尾(ctaSpoken)：一句行动号召口播(关注 / 私信 / 留言)。

铁律(违反即失败)：
- 全程第一人称，严格按客户 master_brief 的人设 / 语气 / 支柱 / 禁词。禁词一个都不能出现。
- 绝不编造客户的业务数字或事实。任何具体数字用【】占位(如【填真实数字】)，让客户自己填。
- 教的是「怎么用 AI」，客户不带货，别写成卖货。
- 全部口播加起来 40-60 秒的量。
- 输出必须是严格 JSON，前后无多余文字、不带 markdown 代码围栏。`

/** 生成一条讲课式短视频的结构化文案。 */
export async function planLectureScript(params: {
  clientId: string
  topic: string          // 选题(标题或一句话主题，来自爆款选题)
  reference?: string     // 可选：参考的爆款内容(抄结构/钩子)
}): Promise<LectureScript> {
  const { clientId, topic, reference } = params
  if (!topic.trim()) throw new Error('topic is empty')

  const brief = await getActiveBrief(clientId)
  const briefBlock = brief
    ? formatBriefForPrompt(brief)
    : '（该客户暂无 master_brief，按通用中文口播人设，务必保守，绝不编造任何事实与数字）'

  const userMsg = [
    '# 客户人设(master_brief)',
    briefBlock,
    '',
    `# 选题\n${topic}`,
    reference ? `\n# 爆款参考(抄它的结构 / 钩子，不抄字)\n${reference}` : '',
    '',
    '# 输出(严格 JSON，无多余文字)',
    '{"title":"视频标题","hookSpoken":"开场钩子口播","sections":[{"spoken":"这段口播词","slideTitle":"课件标题","slidePoints":["要点1","要点2"]}],"ctaSpoken":"结尾号召口播"}',
  ]
    .filter(Boolean)
    .join('\n')

  const result = await callClaudeChat({
    systemPrompt: SYSTEM,
    messages: [{ role: 'user', content: userMsg }],
    maxOutputTokens: 2500,
  })

  const parsed = parseJsonResponse<LectureScript>(result.text)
  if (!parsed?.hookSpoken || !Array.isArray(parsed.sections) || parsed.sections.length === 0) {
    throw new Error('lecture script incomplete')
  }
  return parsed
}
