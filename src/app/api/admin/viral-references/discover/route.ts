/**
 * POST /api/admin/viral-references/discover
 *
 * Searches YouTube for viral marketing videos matching the given keywords,
 * filters by minimum view count, deduplicates against the existing DB,
 * inserts new rows as 'pending', and kicks off Gemini analysis.
 *
 * Body:
 *   keywords      string   e.g. "luxury travel New Zealand tour"
 *   industry      string   'travel' | 'flooring'
 *   content_goal  string?  'brand' | 'sales' | 'ugc' | 'education'  (default 'brand' = auto-detect)
 *   min_views     number?  minimum view count filter (default 50 000)
 *   limit         number?  max videos to queue (default 20, max 30)
 *   is_our_video  boolean? default false
 *
 * Quota cost per call: ~100 (search) + limit×1 (videos.list) ≈ 120 units
 * Free daily quota: 10 000 units → ~83 discovery runs/day at no cost.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { analyzeViralReference } from '@/lib/reels/viral-analyzer'

const DEFAULT_MIN_VIEWS = 50_000
const DEFAULT_LIMIT     = 20
const MAX_LIMIT         = 30

// ─── YouTube API helpers ──────────────────────────────────────────────────────

interface YTSearchItem {
  id: { videoId: string }
  snippet: { title: string; channelTitle: string; publishedAt: string }
}

interface YTVideoItem {
  id: string
  snippet:    { title: string; channelTitle: string; publishedAt: string }
  statistics: { viewCount?: string; likeCount?: string }
}

async function searchYouTube(
  keywords: string,
  apiKey: string,
  maxResults: number,
): Promise<YTSearchItem[]> {
  const params = new URLSearchParams({
    part:          'snippet',
    q:             keywords,
    type:          'video',
    videoDuration: 'short',   // Shorts / reels ≤ 4 min
    order:         'viewCount',
    maxResults:    String(Math.min(maxResults * 2, 50)), // fetch extra, filter after
    key:           apiKey,
  })

  const res  = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`)
  const data = await res.json() as { items?: YTSearchItem[]; error?: { message: string } }

  if (data.error) throw new Error(`YouTube Search API: ${data.error.message}`)
  return data.items ?? []
}

async function getVideoDetails(
  videoIds: string[],
  apiKey: string,
): Promise<YTVideoItem[]> {
  if (videoIds.length === 0) return []

  const params = new URLSearchParams({
    part: 'snippet,statistics',
    id:   videoIds.join(','),
    key:  apiKey,
  })

  const res  = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`)
  const data = await res.json() as { items?: YTVideoItem[]; error?: { message: string } }

  if (data.error) throw new Error(`YouTube Videos API: ${data.error.message}`)
  return data.items ?? []
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: {
    keywords?: string
    industry?: string
    content_goal?: string
    min_views?: number
    limit?: number
    is_our_video?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const keywords   = (body.keywords ?? '').trim()
  const industry   = (body.industry ?? '').trim()
  const goal       = (body.content_goal ?? 'brand').trim()
  const minViews   = Math.max(0, body.min_views ?? DEFAULT_MIN_VIEWS)
  const limit      = Math.min(body.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
  const isOurVideo = body.is_our_video ?? false

  if (!keywords) {
    return NextResponse.json({ success: false, error: 'keywords is required' }, { status: 400 })
  }
  if (!industry) {
    return NextResponse.json({ success: false, error: 'industry is required' }, { status: 400 })
  }

  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) {
    return NextResponse.json({ success: false, error: 'YOUTUBE_API_KEY not configured on server' }, { status: 500 })
  }

  // ── 1. Search YouTube ──────────────────────────────────────────────────────
  let searchItems: YTSearchItem[]
  try {
    searchItems = await searchYouTube(keywords, apiKey, limit)
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'YouTube search failed' },
      { status: 502 }
    )
  }

  if (searchItems.length === 0) {
    return NextResponse.json({ success: true, found: 0, skipped: 0, below_threshold: 0, queued: 0, references: [] })
  }

  // ── 2. Fetch video details (view counts) ───────────────────────────────────
  const videoIds = searchItems.map(i => i.id.videoId)
  let details: YTVideoItem[]
  try {
    details = await getVideoDetails(videoIds, apiKey)
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'YouTube videos fetch failed' },
      { status: 502 }
    )
  }

  // Build a map id → detail
  const detailMap = new Map(details.map(d => [d.id, d]))

  // ── 3. Fetch existing URLs to deduplicate ──────────────────────────────────
  const candidateUrls = videoIds.map(id => `https://www.youtube.com/watch?v=${id}`)
  const { data: existing } = await supabaseAdmin
    .from('viral_reference_library')
    .select('source_url')
    .in('source_url', candidateUrls)

  const existingSet = new Set((existing ?? []).map(r => r.source_url))

  // ── 4. Filter: dedup + min_views ───────────────────────────────────────────
  let belowThreshold = 0
  let skipped        = 0

  const toInsert: Array<{
    url:           string
    videoId:       string
    view_count:    number
    like_count:    number | null
    published_at:  string | null
    video_title:   string
    channel_title: string
  }> = []

  for (const item of searchItems) {
    if (toInsert.length >= limit) break

    const vid    = item.id.videoId
    const url    = `https://www.youtube.com/watch?v=${vid}`
    const detail = detailMap.get(vid)
    const views  = detail?.statistics?.viewCount ? Number(detail.statistics.viewCount) : 0

    if (existingSet.has(url)) { skipped++;        continue }
    if (views < minViews)     { belowThreshold++; continue }

    toInsert.push({
      url,
      videoId:       vid,
      view_count:    views,
      like_count:    detail?.statistics?.likeCount ? Number(detail.statistics.likeCount) : null,
      published_at:  detail?.snippet?.publishedAt ?? null,
      video_title:   detail?.snippet?.title ?? item.snippet.title,
      channel_title: detail?.snippet?.channelTitle ?? item.snippet.channelTitle,
    })
  }

  if (toInsert.length === 0) {
    return NextResponse.json({
      success: true,
      found:           searchItems.length,
      skipped,
      below_threshold: belowThreshold,
      queued:          0,
      references:      [],
    })
  }

  // ── 5. Insert rows ─────────────────────────────────────────────────────────
  const rows = toInsert.map(v => ({
    source_url:    v.url,
    industry,
    content_goal:  goal,
    is_our_video:  isOurVideo,
    platform:      'youtube',
    analysis_status: 'pending',
    // Pre-fill metadata so we don't need a second fetch during analysis
    view_count:    v.view_count,
    like_count:    v.like_count,
    published_at:  v.published_at,
    video_title:   v.video_title,
    channel_title: v.channel_title,
  }))

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('viral_reference_library')
    .insert(rows)
    .select('id, source_url, video_title, view_count')

  if (insertErr) {
    return NextResponse.json({ success: false, error: insertErr.message }, { status: 500 })
  }

  // ── 6. Kick off analysis (non-blocking) ────────────────────────────────────
  for (const ref of inserted ?? []) {
    analyzeViralReference(ref.id, ref.source_url).catch(err => {
      console.error(`[discover] analysis failed for ${ref.id}:`, err)
    })
  }

  return NextResponse.json({
    success:         true,
    found:           searchItems.length,
    skipped,
    below_threshold: belowThreshold,
    queued:          inserted?.length ?? 0,
    references:      inserted ?? [],
  })
}
