// 进料 runner — 跑一个客户的选题进料：读配置 → Apify 抓小红书/抖音爆款 → 选题助理改写 → 写 content_posts。
// 手动触发或 cron 调用。成本受控：只改写配置里 rewriteCount 条（默认 5）。

import { runActorAndGetResults } from '@/lib/apify/client'
import { supabaseAdmin } from '@/lib/supabase'
import { getIntakeConfig } from './intake-config'
import { fetchNewsViralsForIntake } from './intake-news-feeds'
import { mixIntakePicks } from './intake-pick-mix'
import { generateCandidate, type ViralRef } from './topic-agent'

type Row = Record<string, unknown>
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' ? v : 0)

// 去重键：只用标题，不带点赞数（点赞会变，带上就永远命中不了、同一条反复改写烧钱）
const sourceKey = (title: string): string => `抓自：${title}`.trim()

function unseenRefs(refs: ViralRef[], seen: Set<string>): ViralRef[] {
  return refs.filter((v) => !seen.has(sourceKey(v.title)))
}

// content_posts 里已有的、来自同一爆款的 source，避免重复抓同一条反复改写
async function existingSources(clientId: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from('content_posts')
    .select('source')
    .eq('client_id', clientId)
    .not('source', 'is', null)
    .order('created_at', { ascending: false })
    .limit(500)
  return new Set((data ?? []).map((r) => str((r as Row).source)))
}

function mapXhs(rows: Row[]): ViralRef[] {
  return rows.map((r) => {
    const eng = (r.engagement as Row) ?? {}
    return {
      title: str(r.title) || str(r.desc).slice(0, 40) || '(无标题)',
      transcript: str(r.desc),
      engagement: `${num(eng.liked_count ?? r.liked_count)}赞`,
    }
  })
}
function mapDouyin(rows: Row[]): ViralRef[] {
  return rows.map((r) => {
    const stats = (r.statistics as Row) ?? (r.stats as Row) ?? {}
    return {
      title: str(r.title) || str(r.desc).slice(0, 40) || '(无标题)',
      transcript: str(r.desc) || str(r.title),
      engagement: `${num(stats.digg_count ?? stats.likes ?? r.likes)}赞`,
    }
  })
}

export interface IntakeRunResult {
  scanned: number
  created: number
  errors: string[]
}

/** 跑一个客户一次进料。返回抓了几条、生成几条候选。 */
export async function runIntakeForClient(clientId: string): Promise<IntakeRunResult> {
  const config = await getIntakeConfig(clientId)
  const errors: string[] = []
  if (!config.enabled || config.keywords.length === 0) {
    return { scanned: 0, created: 0, errors: ['未开启或没配关键词'] }
  }

  const virals: ViralRef[] = []

  if (config.platforms.includes('xiaohongshu')) {
    const res = await runActorAndGetResults<Row>('zen-studio/rednote-search-scraper', {
      keywords: config.keywords,
      maxResults: config.scrapePerPlatform,
      sortType: 'popularity_descending',
      noteType: 'all',
      timeFilter: '6mo',
      topUpFromOtherSorts: false,
    })
    if (res.success) virals.push(...mapXhs(res.data ?? []))
    else errors.push(`小红书抓取失败：${res.error ?? '未知'}`)
  }

  if (config.platforms.includes('douyin')) {
    const res = await runActorAndGetResults<Row>('zen-studio/douyin-search-scraper', {
      keywords: config.keywords,
      maxResultsPerQuery: config.scrapePerPlatform,
      sort: '0',
      publishTime: '0',
    })
    if (res.success) virals.push(...mapDouyin(res.data ?? []))
    else errors.push(`抖音抓取失败：${res.error ?? '未知'}`)
  }

  let newsVirals: ViralRef[] = []
  if (config.platforms.includes('news')) {
    if (config.news_feeds.length === 0) {
      console.warn(`[intake] ${clientId}: news 平台已开但未配置 news_feeds，跳过 RSS`)
    } else {
      const news = await fetchNewsViralsForIntake({
        keywords: config.keywords,
        maxItems: config.scrapePerPlatform,
        feedUrls: config.news_feeds,
      })
      newsVirals = news.items
      for (const w of news.warnings) {
        console.warn(`[intake] ${clientId}: ${w}`)
      }
    }
  }

  const seen = await existingSources(clientId)
  const picks = mixIntakePicks(
    unseenRefs(virals, seen),
    unseenRefs(newsVirals, seen),
    config.rewriteCount,
  )

  let created = 0
  for (const v of picks) {
    const source = sourceKey(v.title)
    if (seen.has(source)) continue
    seen.add(source)  // 本轮内也去重（同一次抓到两条同标题不重复改写）
    try {
      const c = await generateCandidate(clientId, v)
      const { error } = await supabaseAdmin.from('content_posts').insert({
        client_id: clientId,
        title: c.title,
        script: c.script,
        caption: c.hook,
        pillar_id: c.pillar,
        platforms: c.platforms ?? [],
        status: 'draft',
        route: 'route_a',
        source: source,
      })
      if (error) errors.push(`落库失败：${error.message}`)
      else created += 1
    } catch (e) {
      errors.push(`改写失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return { scanned: virals.length + newsVirals.length, created, errors }
}
