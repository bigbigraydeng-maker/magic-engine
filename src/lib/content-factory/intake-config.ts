// 选题进料配置（每客户一份）— 定时任务照这个抓爆款 + 改写。
// 存在 clients.factory_config->'topic_intake'（jsonb 合并，不覆盖已有的广告工厂配置），零 migration。

import { supabaseAdmin } from '@/lib/supabase'
import { validateNewsFeedUrl } from './intake-news-feed-url'

export type IntakePlatform = 'xiaohongshu' | 'douyin' | 'news'
export type IntakeCadence = 'off' | 'weekly' | 'daily'

export interface IntakeConfig {
  enabled: boolean
  keywords: string[]          // 抓什么关键词 / 赛道
  platforms: IntakePlatform[] // 小红书 / 抖音 / 新闻 RSS（默认关）
  cadence: IntakeCadence      // 多久跑一次
  scrapePerPlatform: number   // 每平台抓几条（默认 20）
  rewriteCount: number        // 每次改写几条候选（默认 5，控成本）
  preferences: string         // 客户喜好 / 风格（对话提取的自由文本）
  news_feeds: string[]        // 客户自配 RSS/Atom URL（仅 platforms 含 news 时用）
}

export const DEFAULT_INTAKE: IntakeConfig = {
  enabled: false,
  keywords: [],
  platforms: ['xiaohongshu'],
  cadence: 'weekly',
  scrapePerPlatform: 20,
  rewriteCount: 5,
  preferences: '',
  news_feeds: [],
}

// 成本硬顶：无论对话助理/前端传什么，落库前 clamp，防一次改写几百条烧钱。
const MAX_REWRITE = 10
const MAX_SCRAPE = 50
export const MAX_NEWS_FEEDS = 10
const clampInt = (v: unknown, def: number, min: number, max: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : def
  return Math.min(max, Math.max(min, n))
}

/** http/https only, dedupe, cap count — for topic_intake.news_feeds JSON. */
export function normalizeNewsFeedUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim()
    if (!trimmed) continue
    const check = validateNewsFeedUrl(trimmed)
    if (!check.ok) continue
    const href = check.url
    if (seen.has(href)) continue
    seen.add(href)
    out.push(href)
    if (out.length >= MAX_NEWS_FEEDS) break
  }
  return out
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
    ...saved,
    // 没配过关键词时，用客户已有的主关键词当种子，别让它空着（必须放 ...saved 之后，否则被 saved.keywords=[] 盖掉）
    keywords: saved?.keywords?.length ? saved.keywords : seedKeywords,
    // 保证数组/字段类型稳
    platforms: saved?.platforms?.length ? saved.platforms : DEFAULT_INTAKE.platforms,
    news_feeds: normalizeNewsFeedUrls(saved?.news_feeds),
    scrapePerPlatform: clampInt(saved?.scrapePerPlatform, DEFAULT_INTAKE.scrapePerPlatform, 1, MAX_SCRAPE),
    rewriteCount: clampInt(saved?.rewriteCount, DEFAULT_INTAKE.rewriteCount, 1, MAX_REWRITE),
  }
}

/** 保存（部分更新）。读-改-写：只动 factory_config.topic_intake，保留其它 key。 */
export async function saveIntakeConfig(
  clientId: string,
  patch: Partial<IntakeConfig>,
): Promise<IntakeConfig> {
  const current = await getIntakeConfig(clientId)
  const merged: IntakeConfig = { ...current, ...patch }
  // 落库前再 clamp 一次（对话助理/前端可能传超大值）
  const next: IntakeConfig = {
    ...merged,
    news_feeds: normalizeNewsFeedUrls(merged.news_feeds),
    scrapePerPlatform: clampInt(merged.scrapePerPlatform, DEFAULT_INTAKE.scrapePerPlatform, 1, MAX_SCRAPE),
    rewriteCount: clampInt(merged.rewriteCount, DEFAULT_INTAKE.rewriteCount, 1, MAX_REWRITE),
  }

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
