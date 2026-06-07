/**
 * POST /api/cron/viral-discovery-weekly
 *
 * Automatically discovers viral YouTube videos per industry, runs daily.
 * For each industry config entry: searches YouTube by viewCount AND date order,
 * filters by min view count, deduplicates against the DB, inserts new rows as
 * 'pending', and kicks off Gemini analysis.
 *
 * Auth:     Authorization: Bearer ${CRON_SECRET}
 * Schedule: Every day at 0am UTC (render.yaml)
 *
 * YouTube quota cost:
 *   ~100 units (search) + limit×1 (videos.list) ≈ 120 units/keyword-group
 *   8 industries × 6 groups × 2 orders × 120 ≈ 11,520 units/day
 *   NOTE: slightly over 10k free quota — we use only viewCount order by default,
 *   date order is a second pass that reuses the same search quota where possible.
 *   Actual cost: 8 × 6 × 120 = 5,760 units/day (well within free tier).
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'

export const dynamic    = 'force-dynamic'
export const maxDuration = 300  // 5 min — 8 industries × ~30s each

// ─── Industry keyword config ──────────────────────────────────────────────────

interface IndustryConfig {
  industry:   string
  keywords:   string[]   // each entry = one YouTube search
  min_views:  number
  limit:      number     // max videos per keyword search
}

const INDUSTRY_CONFIGS: IndustryConfig[] = [
  {
    industry:  'travel',
    keywords:  [
      'luxury travel New Zealand tour',
      'NZ travel experience vlog short',
      'New Zealand holiday adventure reel',
      'Australia travel vlog short reel',
      'NZ tourism destination video',
      'travel brand content creator short',
    ],
    min_views: 50_000,
    limit:     20,
  },
  {
    industry:  'flooring',
    keywords:  [
      'hardwood floor installation timelapse',
      'flooring renovation before after',
      'timber floor NZ home renovation',
      'luxury vinyl plank installation short',
      'floor transformation reveal reel',
      'flooring contractor marketing video',
    ],
    min_views: 10_000,
    limit:     20,
  },
  {
    industry:  'real_estate',
    keywords:  [
      'luxury home tour New Zealand',
      'real estate listing walkthrough NZ',
      'property renovation reveal',
      'house tour Australia real estate short',
      'new home build reveal reel',
      'real estate agent marketing video short',
    ],
    min_views: 20_000,
    limit:     20,
  },
  {
    industry:  'food',
    keywords:  [
      'restaurant NZ food reel',
      'New Zealand cafe aesthetic food',
      'food photography plating short',
      'restaurant marketing video short',
      'cafe brunch aesthetic reel',
      'food brand content creator short',
    ],
    min_views: 5_000,
    limit:     20,
  },
  {
    industry:  'fashion',
    keywords:  [
      'fashion haul outfit NZ style',
      'clothing brand lookbook short',
      'fashion styling reel aesthetic',
      'sustainable fashion Australia short',
      'outfit of the day OOTD reel',
      'fashion brand marketing video short',
    ],
    min_views: 30_000,
    limit:     20,
  },
  {
    industry:  'fitness',
    keywords:  [
      'gym workout motivation reel',
      'fitness transformation New Zealand',
      'personal trainer workout short',
      'home workout routine reel',
      'gym marketing video short',
      'fitness brand content creator',
    ],
    min_views: 30_000,
    limit:     20,
  },
  {
    industry:  'tech',
    keywords:  [
      'tech product review short',
      'software app demo reel',
      'tech startup brand video',
      'SaaS product marketing short',
      'tech unboxing review reel',
      'AI tool demo short video',
    ],
    min_views: 20_000,
    limit:     20,
  },
  {
    industry:  'beauty',
    keywords:  [
      'skincare routine NZ beauty',
      'makeup tutorial short reel',
      'beauty product review aesthetic',
      'skincare brand marketing short',
      'beauty unboxing reel Australia',
      'cosmetics brand content creator',
    ],
    min_views: 30_000,
    limit:     20,
  },
]

// ─── YouTube API helpers ──────────────────────────────────────────────────────

interface YTSearchItem {
  id:      { videoId: string }
  snippet: { title: string; channelTitle: string; publishedAt: string }
}

interface YTVideoItem {
  id:         string
  snippet:    { title: string; channelTitle: string; publishedAt: string }
  statistics: { viewCount?: string; likeCount?: string }
}

const YOUTUBE_FETCH_TIMEOUT_MS = 10_000

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), YOUTUBE_FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function searchYouTube(
  keywords: string,
  apiKey:   string,
  limit:    number,
): Promise<YTSearchItem[]> {
  const params = new URLSearchParams({
    part:          'snippet',
    q:             keywords,
    type:          'video',
    videoDuration: 'short',
    order:         'viewCount',
    maxResults:    String(Math.min(limit * 2, 50)),
    key:           apiKey,
  })
  const res  = await fetchWithTimeout(`https://www.googleapis.com/youtube/v3/search?${params}`)
  const data = await res.json() as { items?: YTSearchItem[]; error?: { message: string } }
  if (data.error) throw new Error(`YouTube Search: ${data.error.message}`)
  return data.items ?? []
}

async function getVideoDetails(videoIds: string[], apiKey: string): Promise<YTVideoItem[]> {
  if (videoIds.length === 0) return []
  const params = new URLSearchParams({
    part: 'snippet,statistics',
    id:   videoIds.join(','),
    key:  apiKey,
  })
  const res  = await fetchWithTimeout(`https://www.googleapis.com/youtube/v3/videos?${params}`)
  const data = await res.json() as { items?: YTVideoItem[]; error?: { message: string } }
  if (data.error) throw new Error(`YouTube Videos: ${data.error.message}`)
  return data.items ?? []
}

// ─── Per-keyword discover ─────────────────────────────────────────────────────

interface DiscoverResult {
  industry:        string
  keywords:        string
  found:           number
  skipped:         number
  below_threshold: number
  queued:          number
  error?:          string
}

async function discoverForKeywords(
  cfg:    IndustryConfig,
  kw:     string,
  apiKey: string,
): Promise<DiscoverResult> {
  const base = { industry: cfg.industry, keywords: kw, found: 0, skipped: 0, below_threshold: 0, queued: 0 }

  let searchItems: YTSearchItem[]
  try {
    searchItems = await searchYouTube(kw, apiKey, cfg.limit)
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : 'search failed' }
  }

  if (searchItems.length === 0) return base

  const videoIds = searchItems.map(i => i.id.videoId)

  let details: YTVideoItem[]
  try {
    details = await getVideoDetails(videoIds, apiKey)
  } catch (err) {
    return { ...base, found: searchItems.length, error: err instanceof Error ? err.message : 'details fetch failed' }
  }

  const detailMap   = new Map(details.map(d => [d.id, d]))
  const candidateUrls = videoIds.map(id => `https://www.youtube.com/watch?v=${id}`)

  const { data: existing } = await supabaseAdmin
    .from('viral_reference_library')
    .select('source_url')
    .in('source_url', candidateUrls)

  const existingSet = new Set((existing ?? []).map(r => r.source_url))

  type ToInsert = {
    source_url: string; industry: string; content_goal: string
    is_our_video: boolean; platform: string; analysis_status: string
    view_count: number; like_count: number | null
    published_at: string | null; video_title: string; channel_title: string
  }
  const toInsert: ToInsert[] = []
  let skipped = 0
  let belowThreshold = 0

  for (const item of searchItems) {
    if (toInsert.length >= cfg.limit) break
    const vid    = item.id.videoId
    const url    = `https://www.youtube.com/watch?v=${vid}`
    const detail = detailMap.get(vid)
    const views  = detail?.statistics?.viewCount ? Number(detail.statistics.viewCount) : 0

    if (existingSet.has(url)) { skipped++;        continue }
    if (views < cfg.min_views) { belowThreshold++; continue }

    toInsert.push({
      source_url:      url,
      industry:        cfg.industry,
      content_goal:    'brand',   // AI will override during analysis
      is_our_video:    false,
      platform:        'youtube',
      analysis_status: 'pending',
      view_count:      views,
      like_count:      detail?.statistics?.likeCount ? Number(detail.statistics.likeCount) : null,
      published_at:    detail?.snippet?.publishedAt ?? null,
      video_title:     detail?.snippet?.title ?? item.snippet.title,
      channel_title:   detail?.snippet?.channelTitle ?? item.snippet.channelTitle,
    })
  }

  if (toInsert.length === 0) {
    return { ...base, found: searchItems.length, skipped, below_threshold: belowThreshold }
  }

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('viral_reference_library')
    .insert(toInsert)
    .select('id, source_url')

  if (insertErr) {
    return { ...base, found: searchItems.length, skipped, below_threshold: belowThreshold, error: insertErr.message }
  }

  // NOTE: Do NOT fire-and-forget analyzeViralReference here — bursting hundreds
  // of concurrent Gemini calls exceeds the paid-tier TPM cap (1M tokens/min)
  // and returns 429 despite having credit. Rows are left as 'pending' and
  // drained by the dedicated /api/cron/viral-analyzer-worker (every 2 min,
  // 8 videos per batch, 5s delay between calls).

  return {
    industry:        cfg.industry,
    keywords:        kw,
    found:           searchItems.length,
    skipped,
    below_threshold: belowThreshold,
    queued:          inserted?.length ?? 0,
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('viral-discovery-weekly')

  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) {
    await cronRun.finish({ failed: 1, error: 'YOUTUBE_API_KEY not configured' })
    return NextResponse.json({ error: 'YOUTUBE_API_KEY not configured' }, { status: 500 })
  }

  const results: DiscoverResult[] = []
  let totalQueued = 0

  for (const cfg of INDUSTRY_CONFIGS) {
    for (const kw of cfg.keywords) {
      const result = await discoverForKeywords(cfg, kw, apiKey)
      results.push(result)
      totalQueued += result.queued

      if (result.error) {
        console.error(`[viral-discovery] ${cfg.industry} "${kw}": ${result.error}`)
      } else {
        console.log(
          `[viral-discovery] ${cfg.industry} "${kw}": ` +
          `found=${result.found} queued=${result.queued} ` +
          `skipped=${result.skipped} below_threshold=${result.below_threshold}`,
        )
      }

      // Small delay to be kind to YouTube quota rate limits
      await new Promise(r => setTimeout(r, 300))
    }
  }

  const errorCount = results.filter(r => r.error !== undefined).length
  await cronRun.finish({
    processed: results.length,
    completed: results.length - errorCount,
    failed: errorCount,
    summary: { total_queued: totalQueued },
  })
  return NextResponse.json({
    ok:          true,
    timestamp:   new Date().toISOString(),
    total_queued: totalQueued,
    results,
  })
}
