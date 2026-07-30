// 选题进料配置（每客户一份）— 定时任务照这个抓爆款 + 改写。
// 存在 clients.factory_config->'topic_intake'（jsonb 合并，不覆盖已有的广告工厂配置），零 migration。

import { supabaseAdmin } from '@/lib/supabase'

export type IntakePlatform = 'xiaohongshu' | 'douyin'
export type IntakeCadence = 'off' | 'weekly' | 'daily'

export interface IntakeConfig {
  enabled: boolean
  keywords: string[]          // 抓什么关键词 / 赛道
  platforms: IntakePlatform[] // 小红书 / 抖音
  cadence: IntakeCadence      // 多久跑一次
  scrapePerPlatform: number   // 每平台抓几条（默认 20）
  rewriteCount: number        // 每次改写几条候选（默认 5，控成本）
  preferences: string         // 客户喜好 / 风格（对话提取的自由文本）
}

export const DEFAULT_INTAKE: IntakeConfig = {
  enabled: false,
  keywords: [],
  platforms: ['xiaohongshu'],
  cadence: 'weekly',
  scrapePerPlatform: 20,
  rewriteCount: 5,
  preferences: '',
}

/** 读某客户的进料配置（无则给默认，且带上 clients.primary_keywords 当种子）。 */
export async function getIntakeConfig(clientId: string): Promise<IntakeConfig> {
  const { data } = await supabaseAdmin
    .from('clients')
    .select('factory_config, primary_keywords')
    .eq('id', clientId)
    .maybeSingle()

  const saved = (data?.factory_config as { topic_intake?: Partial<IntakeConfig> } | null)?.topic_intake
  const seedKeywords = (data?.primary_keywords as string[] | null) ?? []

  return {
    ...DEFAULT_INTAKE,
    // 没配过关键词时，用客户已有的主关键词当种子，别让它空着
    keywords: saved?.keywords?.length ? saved.keywords : seedKeywords,
    ...saved,
    // 保证数组/字段类型稳
    platforms: saved?.platforms?.length ? saved.platforms : DEFAULT_INTAKE.platforms,
  }
}

/** 保存（部分更新）。读-改-写：只动 factory_config.topic_intake，保留其它 key。 */
export async function saveIntakeConfig(
  clientId: string,
  patch: Partial<IntakeConfig>,
): Promise<IntakeConfig> {
  const current = await getIntakeConfig(clientId)
  const next: IntakeConfig = { ...current, ...patch }

  const { data } = await supabaseAdmin
    .from('clients')
    .select('factory_config')
    .eq('id', clientId)
    .maybeSingle()
  const fc = (data?.factory_config as Record<string, unknown> | null) ?? {}

  const { error } = await supabaseAdmin
    .from('clients')
    .update({ factory_config: { ...fc, topic_intake: next } })
    .eq('id', clientId)

  if (error) throw error
  return next
}
