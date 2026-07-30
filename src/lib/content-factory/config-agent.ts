// 内容工厂"配置助理" — FDE/客户跟它聊，它把选题进料配置(关键词/平台/频率/喜好)提取并保存。
// 照鲁班可写工具 pattern：save_intake_config 的 handler 用闭包捕获 clientId，
// 工具入参只放配置字段，绝不暴露 clientId（防越权改到别客户）。

import type Anthropic from '@anthropic-ai/sdk'
import { callClaudeWithTools } from '@/lib/anthropic/client'
import { getActiveBrief, formatBriefForPrompt } from '@/lib/content/brief-injector'
import { getIntakeConfig, saveIntakeConfig, type IntakeConfig } from './intake-config'

const SAVE_TOOL: Anthropic.Tool = {
  name: 'save_intake_config',
  description: '把用户说定的进料配置（部分即可）保存下来。只传用户明确表达过的字段。',
  input_schema: {
    type: 'object',
    properties: {
      enabled:   { type: 'boolean', description: '是否开启自动进料' },
      keywords:  { type: 'array', items: { type: 'string' }, description: '抓什么关键词/赛道' },
      platforms: { type: 'array', items: { type: 'string', enum: ['xiaohongshu', 'douyin'] }, description: '抓哪些平台' },
      cadence:   { type: 'string', enum: ['off', 'weekly', 'daily'], description: '多久跑一次' },
      scrapePerPlatform: { type: 'number', description: '每平台抓几条' },
      rewriteCount: { type: 'number', description: '每次改写几条候选' },
      preferences:  { type: 'string', description: '客户的内容喜好/风格（自由文本，累积保存）' },
    },
  },
}

export interface ConfigChatResult {
  reply: string
  config: IntakeConfig
}

export async function chatIntakeConfig(
  clientId: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<ConfigChatResult> {
  const [brief, current] = await Promise.all([
    getActiveBrief(clientId).catch(() => null),
    getIntakeConfig(clientId),
  ])

  const systemPrompt = [
    '你是"内容工厂配置助理"。任务：用聊天帮客户/FDE 把"选题进料"设好——设好后系统会照这个配置，定期从小红书/抖音找到当下受欢迎的内容风向，帮客户产出贴合品牌的选题候选。',
    '',
    '你要问清并帮他定这几样（自然对话，一次问一两个，别一口气抛）：',
    '1. 覆盖什么话题/赛道（客户做什么生意、想让内容围绕哪些方向）',
    '2. 在哪些平台找风向（小红书 / 抖音）',
    '3. 多久更新一次（每周 / 每天 / 先关着）',
    '4. 内容喜好/风格（想要什么调性、避免什么——累积记进 preferences）',
    '',
    '规则：',
    '- 用户说定了某项，立刻用 save_intake_config 存下来（只传他说过的字段）。',
    '- 关键词别让用户从零想：先根据下方业务背景主动列 3-5 个话题/赛道候选，让他挑或改。',
    '- 平台/频率用场景问，别像勾选项——如"你的客人平时更多刷小红书还是抖音？""想勤快点每天更新，还是先每周攒一批看看？"',
    '- 每存一次，用一句话复述当前已定的几项，让他心里有数。',
    '- 说人话，不用专业词。绝不对客户说"抓爆款/扒别人的改写"这类话——只说"找当下受欢迎的方向、产出贴合品牌的选题"。',
    '',
    `# 当前配置\n${JSON.stringify(current, null, 2)}`,
    brief ? `\n# 客户业务背景（帮你建议关键词/风格，别照搬）\n${formatBriefForPrompt(brief).slice(0, 1500)}` : '',
  ].join('\n')

  const result = await callClaudeWithTools({
    systemPrompt,
    messages: history.map((m) => ({ role: m.role, content: m.content })),
    tools: [SAVE_TOOL],
    toolHandlers: {
      save_intake_config: async (input: unknown) => {
        const saved = await saveIntakeConfig(clientId, input as Partial<IntakeConfig>)
        return JSON.stringify(saved)
      },
    },
    maxToolRounds: 3,
    maxOutputTokens: 1500,
  })

  // 存完再读一次，返回最新配置给前端刷新
  const config = await getIntakeConfig(clientId)
  return { reply: result.text, config }
}
