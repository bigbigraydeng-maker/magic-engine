// 选题助理 — 把一条平台爆款按客户人设改写成候选逐字稿。
// 铁律：只抄爆款（抄结构/钩子/节奏，不凭空想）、按 master_brief 人设、真数字用【】占位不编。
// 输出写进 content_posts(status='draft' = 看板"选题"段)。

import { callClaudeChat, parseJsonResponse } from '@/lib/anthropic/client'
import { getActiveBrief, formatBriefForPrompt } from '@/lib/content/brief-injector'

/** 爆款参考（来自 Apify 抓取的平台爆款）。 */
export interface ViralRef {
  title: string
  transcript: string     // 逐字稿（Whisper 扒的）或简介/内容
  engagement: string     // 如 "14.7万赞"
  hookPattern?: string   // 可抄的钩子结构（爆款库里那列）
}

/** 改写产出的候选。 */
export interface Candidate {
  title: string
  hook: string           // 前3秒钩子
  script: string         // 完整逐字稿（真数字用【】占位）
  pillar: string         // 对应支柱名
  platforms: string[]
  source: string         // 溯源：抄自哪条爆款
}

const SYSTEM = `你是短视频"选题助理"。任务：把一条平台爆款的结构和钩子，按目标客户的人设，改写成一条可以直接对着念的候选逐字稿。

铁律（必须遵守，违反即失败）：
1. 选题只来自给你的爆款参考，绝不自己凭空想。爆款都是抄出来的——抄的是结构、钩子、节奏，不是抄原字。
2. 严格按客户 master_brief 的人设 / 语气 / 支柱 / 禁词改写。禁词一个都不能出现。
3. 绝不编造客户的业务数字或事实。任何具体数字用【】占位（如【填真实数字】），让客户自己填。不确定的事实宁可不写。
4. 客户若是做服务/教学/咨询的，绝不写成卖货带货。
5. 逐字稿口语、短句、能一口气念完，40-60 秒的量。
6. 输出必须是严格 JSON，前后不带任何多余文字、不带 markdown 代码围栏。`

export async function generateCandidate(
  clientId: string,
  viral: ViralRef,
): Promise<Candidate> {
  const brief = await getActiveBrief(clientId)
  const briefBlock = brief
    ? formatBriefForPrompt(brief)
    : '（该客户暂无 master_brief，按通用中文口播人设，务必保守，绝不编造任何事实与数字）'

  const userMsg = [
    '# 目标客户人设（master_brief）',
    briefBlock,
    '',
    '# 爆款参考（抄它的结构 / 钩子 / 节奏，不抄字）',
    `标题：${viral.title}`,
    `数据：${viral.engagement}`,
    viral.hookPattern ? `可抄的钩子结构：${viral.hookPattern}` : '',
    `逐字稿 / 内容：${viral.transcript}`,
    '',
    '# 输出（严格 JSON，无多余文字）',
    '{"title":"标题","hook":"前3秒钩子一句","script":"完整逐字稿，真实数字用【】占位","pillar":"对应支柱名","platforms":["小红书","抖音"],"source":"抄自：<爆款标题> <数据>"}',
  ]
    .filter(Boolean)
    .join('\n')

  const result = await callClaudeChat({
    systemPrompt: SYSTEM,
    messages: [{ role: 'user', content: userMsg }],
    maxOutputTokens: 2500,
  })

  return parseJsonResponse<Candidate>(result.text)
}
