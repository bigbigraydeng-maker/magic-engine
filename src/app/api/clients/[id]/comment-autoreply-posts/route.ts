/**
 * Social comment auto-reply — page post list (diagnostic + pin picker).
 *
 * GET → paginates the page's published posts and returns each post's id,
 * message snippet, created time, and TOTAL comment count. Backs the pin picker
 * (FDE pins an evergreen post to always monitor) and doubles as a diagnostic:
 * it shows exactly which posts exist and how many comments each has, so a
 * "0 new comments" run can be explained (post missing? all comments old?).
 *
 * Read-only. Dashboard-authenticated.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { getPageAccessToken, fetchPageReels } from '@/lib/meta/page-posts'
import { fetchAdStoryIds } from '@/lib/meta/ads-posts'

const GRAPH_BASE = 'https://graph.facebook.com/v20.0'
const MAX_POSTS = 200

interface PostSummary {
  post_id: string
  full_id: string
  snippet: string
  created_at: string
  comment_count: number
  is_reel?: boolean
  is_ad?: boolean
}

interface RawFeedPost {
  id: string
  message?: string
  story?: string
  created_time?: string
  comments?: { summary?: { total_count?: number } }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { data: config } = await supabaseAdmin
    .from('social_comment_config')
    .select('fb_page_id')
    .eq('client_id', clientId)
    .maybeSingle()
  const pageId = (config?.fb_page_id as string) || ''
  if (!pageId) return NextResponse.json({ error: '先填 Facebook 主页 ID 并保存' }, { status: 400 })

  const { data: clientRow } = await supabaseAdmin
    .from('clients')
    .select('meta_ad_account_id')
    .eq('id', clientId)
    .maybeSingle()
  const adAccountId = (clientRow?.meta_ad_account_id as string) || ''

  const userToken = await getMetaTokenForClient(clientId)
  if (!userToken) return NextResponse.json({ error: '未找到该客户的 Meta token' }, { status: 400 })
  const pageToken = await getPageAccessToken(userToken, pageId)
  if (!pageToken) return NextResponse.json({ error: '无法解析 Page access token' }, { status: 502 })

  const fields = 'id,message,story,created_time,comments.filter(stream).summary(true).limit(0)'
  let url: string | null =
    `${GRAPH_BASE}/${pageId}/published_posts?fields=${fields}&limit=50&access_token=${encodeURIComponent(pageToken)}`

  const posts: PostSummary[] = []
  let guard = 0
  while (url && posts.length < MAX_POSTS && guard < 8) {
    guard++
    let res: Response
    try {
      res = await fetch(url)
    } catch {
      break
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return NextResponse.json({ error: `Graph HTTP ${res.status}: ${body.slice(0, 200)}` }, { status: 502 })
    }
    const json = (await res.json()) as { data?: RawFeedPost[]; paging?: { next?: string }; error?: { message: string } }
    if (json.error) return NextResponse.json({ error: json.error.message }, { status: 502 })

    for (const p of json.data ?? []) {
      const shortId = p.id.includes('_') ? p.id.split('_')[1] : p.id
      const text = (p.message ?? p.story ?? '').replace(/\s+/g, ' ').trim()
      posts.push({
        post_id: shortId,
        full_id: p.id,
        snippet: text.slice(0, 90),
        created_at: p.created_time ?? '',
        comment_count: p.comments?.summary?.total_count ?? 0,
      })
    }
    url = json.paging?.next ?? null
  }

  // Reels — their comments live on the video object, so /published_posts
  // undercounts them. Surface reels separately with their real comment count.
  const reels = await fetchPageReels(pageId, pageToken, 100)
  const reelSummaries: PostSummary[] = reels.map(r => ({
    post_id: r.postId,
    full_id: r.fullId,
    snippet: (r.message || '').replace(/\s+/g, ' ').trim().slice(0, 90),
    created_at: r.createdAt,
    comment_count: r.comments,
    is_reel: true,
  }))

  // Boosted-ad story posts — carry paid-delivery comments the organic edges miss.
  const adSummaries: PostSummary[] = []
  if (adAccountId) {
    const storyIds = await fetchAdStoryIds(adAccountId, userToken).catch(() => [])
    const known = new Set([...posts.map(p => p.full_id), ...reelSummaries.map(r => r.full_id)])
    for (const sid of storyIds) {
      if (known.has(sid)) continue // same as an organic post already listed
      const detail = await fetchStoryDetail(sid, pageToken)
      if (detail) adSummaries.push(detail)
    }
  }

  // Merge, drop feed duplicates of reels (same short id), newest first.
  const reelIds = new Set(reelSummaries.map(r => r.post_id))
  const merged = [...adSummaries, ...reelSummaries, ...posts.filter(p => !reelIds.has(p.post_id))]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  return NextResponse.json({ posts: merged, count: merged.length })
}

/** Fetch one ad story post's snippet + comment count via the Page token. */
async function fetchStoryDetail(storyId: string, pageToken: string): Promise<PostSummary | null> {
  const fields = 'id,message,story,created_time,comments.filter(stream).summary(true).limit(0)'
  const url = `${GRAPH_BASE}/${storyId}?fields=${fields}&access_token=${encodeURIComponent(pageToken)}`
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    return null
  }
  if (!res.ok) return null
  const p = (await res.json()) as RawFeedPost & { error?: unknown }
  if (!p || p.error || !p.id) return null
  const shortId = p.id.includes('_') ? p.id.split('_')[1] : p.id
  const text = (p.message ?? p.story ?? '').replace(/\s+/g, ' ').trim()
  return {
    post_id: shortId,
    full_id: p.id,
    snippet: text.slice(0, 90),
    created_at: p.created_time ?? '',
    comment_count: p.comments?.summary?.total_count ?? 0,
    is_ad: true,
  }
}
