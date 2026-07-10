/**
 * Meta Page posts — fetch organic FB Page Reels/videos + score by engagement.
 *
 * Used by winner-reel-sync engine to identify winners for automatic promotion
 * to a paid Pool Builder Ad Set.
 */

const GRAPH_BASE = 'https://graph.facebook.com/v20.0'

export interface PagePost {
  postId: string
  fullId: string       // "<page_id>_<post_id>"
  createdAt: string    // ISO
  message: string
  mediaType: string    // 'video' | 'photo' | 'album' | 'link' | ...
  reactions: number
  comments: number
  shares: number
  score: number        // engagement score, see scorePost()
}

interface RawAttachment {
  media_type?: string
}

interface RawPost {
  id: string
  message?: string
  created_time?: string
  attachments?: { data?: RawAttachment[] }
  reactions?: { summary?: { total_count?: number } }
  comments?:  { summary?: { total_count?: number } }
  shares?:    { count?: number }
}

/**
 * engagement score with a recency boost so a strong new post outranks a stale one.
 * Weights: reactions=1, comments=2, shares=3 (shares are the strongest interest signal).
 * recencyBoost: 1.5 if within 7 days, 1.2 within 30 days, 1.0 older.
 */
export function scorePost(
  reactions: number,
  comments: number,
  shares: number,
  createdAt: string,
): number {
  const base = reactions + comments * 2 + shares * 3
  const ageDays = (Date.now() - new Date(createdAt).getTime()) / 86_400_000
  const boost = ageDays < 7 ? 1.5 : ageDays < 30 ? 1.2 : 1.0
  return Math.round(base * boost)
}

/**
 * Fetch recent published posts from a FB Page.
 * Requires a Page Access Token (User Token cannot list /published_posts).
 */
export async function fetchPagePosts(
  pageId: string,
  pageAccessToken: string,
  limit = 30,
): Promise<PagePost[]> {
  const fields = [
    'id',
    'message',
    'created_time',
    'attachments{media_type}',
    'reactions.summary(true)',
    'comments.summary(true)',
    'shares',
  ].join(',')

  const url = `${GRAPH_BASE}/${pageId}/published_posts?fields=${fields}&limit=${limit}&access_token=${encodeURIComponent(pageAccessToken)}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`fetchPagePosts ${pageId}: ${res.status} ${await res.text()}`)
  }

  const body = (await res.json()) as { data?: RawPost[]; error?: { message: string } }
  if (body.error) throw new Error(`fetchPagePosts ${pageId}: ${body.error.message}`)

  return (body.data ?? []).map((p) => {
    const postId = p.id.includes('_') ? p.id.split('_')[1] : p.id
    const attachment = p.attachments?.data?.[0]
    const rx = p.reactions?.summary?.total_count ?? 0
    const cm = p.comments?.summary?.total_count  ?? 0
    const sh = p.shares?.count                   ?? 0
    const createdAt = p.created_time ?? new Date().toISOString()
    return {
      postId,
      fullId: p.id,
      createdAt,
      message: p.message ?? '',
      mediaType: attachment?.media_type ?? 'unknown',
      reactions: rx,
      comments: cm,
      shares: sh,
      score: scorePost(rx, cm, sh, createdAt),
    }
  })
}

/**
 * Filter posts to video-type only, drop blacklisted-keyword posts, then sort by score.
 */
export function rankVideoWinners(
  posts: PagePost[],
  blacklistKeywords: string[] = [],
  minScore = 0,
): PagePost[] {
  const bl = blacklistKeywords.map((k) => k.toLowerCase())
  return posts
    .filter((p) => p.mediaType === 'video')
    .filter((p) => p.score >= minScore)
    .filter((p) => !bl.some((k) => p.message.toLowerCase().includes(k)))
    .sort((a, b) => b.score - a.score)
}

/**
 * Exchange the caller's User access token for a Page access token.
 * Meta's /me/accounts endpoint returns each Page the user manages + its own token.
 */
export async function getPageAccessToken(
  userToken: string,
  pageId: string,
): Promise<string | null> {
  const url = `${GRAPH_BASE}/me/accounts?fields=id,access_token&access_token=${encodeURIComponent(userToken)}`
  const res = await fetch(url)
  if (!res.ok) return null
  const body = (await res.json()) as { data?: Array<{ id: string; access_token: string }> }
  return body.data?.find((p) => p.id === pageId)?.access_token ?? null
}
