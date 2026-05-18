/**
 * Apify social media scraper wrappers.
 *
 * Scrapes Instagram and Facebook public page data via Apify actors.
 * Callers are responsible for timeouts / retry logic.
 */

const APIFY_BASE = 'https://api.apify.com/v2'

// ─── P8.10.S2.3: top post sampling ───────────────────────────────────────────
export interface SocialPostSample {
  platform: 'Instagram' | 'Facebook' | 'TikTok'
  url: string | null
  caption: string          // truncated to 200 chars
  likes: number
  comments: number
  hashtags: string[]       // unique, lowercase, without leading #
  posted_at: string | null // ISO timestamp; null when not parseable
}

const SAMPLE_CAPTION_MAX = 200
const SAMPLE_COUNT = 3
const SAMPLE_WINDOW_DAYS = 30

function extractHashtags(text: string): string[] {
  // ASCII letters + digits + underscore. Non-ASCII tags are out of scope for AU/NZ markets.
  const matches = text.match(/#[A-Za-z0-9_]+/g) ?? []
  return Array.from(new Set(matches.map(m => m.slice(1).toLowerCase())))
}

function truncateCaption(text: string): string {
  return text.length > SAMPLE_CAPTION_MAX ? `${text.slice(0, SAMPLE_CAPTION_MAX)}…` : text
}

function withinWindow(isoOrSec: string | number | undefined): boolean {
  if (!isoOrSec) return false
  const cutoffMs = Date.now() - SAMPLE_WINDOW_DAYS * 24 * 60 * 60 * 1000
  if (typeof isoOrSec === 'number') {
    const ms = isoOrSec > 1e12 ? isoOrSec : isoOrSec * 1000
    return ms >= cutoffMs
  }
  const ts = Date.parse(isoOrSec)
  return Number.isFinite(ts) && ts >= cutoffMs
}

function toIso(isoOrSec: string | number | undefined): string | null {
  if (!isoOrSec) return null
  if (typeof isoOrSec === 'number') {
    const ms = isoOrSec > 1e12 ? isoOrSec : isoOrSec * 1000
    return new Date(ms).toISOString()
  }
  const t = Date.parse(isoOrSec)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

export interface InstagramProfile {
  username: string
  followersCount: number
  postsLast30Days: number
  engagementRate: number   // decimal: 0.035 = 3.5%
  contentTypes: string[]   // e.g. ['image', 'video', 'reel']
  topPosts30d: SocialPostSample[]  // P8.10.S2.3
}

export interface FacebookPage {
  pageName: string
  followersCount: number
  postsLast30Days: number
  engagementRate: number
  topPosts30d: SocialPostSample[]  // P8.10.S2.3
}

export async function scrapeInstagramProfile(handle: string): Promise<InstagramProfile> {
  const token = process.env.APIFY_API_KEY
  if (!token) throw new Error('APIFY_API_KEY not configured')

  const res = await fetch(
    `${APIFY_BASE}/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${token}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        directUrls: [`https://www.instagram.com/${handle}/`],
        resultsType: 'details',
      }),
    },
  )

  if (!res.ok) throw new Error(`Apify Instagram error: ${res.status}`)

  const items = (await res.json()) as Record<string, unknown>[]
  const p = items[0] ?? {}

  const latestPosts = (p['latestPosts'] as Record<string, unknown>[] | undefined) ?? []
  const topPosts30d = pickTopPosts(latestPosts, 'Instagram', {
    timestamp: 'timestamp',
    likes: 'likesCount',
    comments: 'commentsCount',
    caption: 'caption',
    url: 'url',
  })

  return {
    username: (p['username'] as string | undefined) ?? handle,
    followersCount: (p['followersCount'] as number | undefined) ?? 0,
    postsLast30Days: (p['postsCount'] as number | undefined) ?? 0,
    engagementRate: ((p['engagementRate'] as number | undefined) ?? 0) / 100,
    contentTypes: (p['contentTypes'] as string[] | undefined) ?? [],
    topPosts30d,
  }
}

interface PostFieldMap {
  timestamp: string
  likes: string
  comments: string
  caption: string
  url: string
}

function pickTopPosts(
  raw: Record<string, unknown>[],
  platform: 'Instagram' | 'Facebook' | 'TikTok',
  fields: PostFieldMap,
): SocialPostSample[] {
  const samples: SocialPostSample[] = raw
    .filter(item => withinWindow(item[fields.timestamp] as string | number | undefined))
    .map(item => {
      const caption = (item[fields.caption] as string | undefined) ?? ''
      return {
        platform,
        url: (item[fields.url] as string | undefined) ?? null,
        caption: truncateCaption(caption),
        likes: (item[fields.likes] as number | undefined) ?? 0,
        comments: (item[fields.comments] as number | undefined) ?? 0,
        hashtags: extractHashtags(caption),
        posted_at: toIso(item[fields.timestamp] as string | number | undefined),
      }
    })
  samples.sort((a, b) => (b.likes + b.comments) - (a.likes + a.comments))
  return samples.slice(0, SAMPLE_COUNT)
}

export async function scrapeFacebookPage(pageUrl: string): Promise<FacebookPage> {
  const token = process.env.APIFY_API_KEY
  if (!token) throw new Error('APIFY_API_KEY not configured')

  const res = await fetch(
    `${APIFY_BASE}/acts/apify~facebook-pages-scraper/run-sync-get-dataset-items?token=${token}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ startUrls: [{ url: pageUrl }] }),
    },
  )

  if (!res.ok) throw new Error(`Apify Facebook error: ${res.status}`)

  const items = (await res.json()) as Record<string, unknown>[]
  const p = items[0] ?? {}

  const posts = (p['posts'] as Record<string, unknown>[] | undefined) ?? []
  const topPosts30d = pickTopPosts(posts, 'Facebook', {
    timestamp: 'time',
    likes: 'likes',
    comments: 'comments',
    caption: 'text',
    url: 'postUrl',
  })

  return {
    pageName: (p['title'] as string | undefined) ?? pageUrl,
    followersCount: (p['likes'] as number | undefined) ?? 0,
    postsLast30Days: (p['postsCount'] as number | undefined) ?? 0,
    engagementRate: ((p['engagementRate'] as number | undefined) ?? 0) / 100,
    topPosts30d,
  }
}

export interface TiktokProfile {
  handle: string
  followersCount: number
  postsLast30Days: number
  engagementRate: number  // decimal: 0.035 = 3.5%
  contentTypes: string[]  // always ['video'] for TikTok
  topPosts30d: SocialPostSample[]  // P8.10.S2.3
}

export async function scrapeTiktokProfile(handle: string): Promise<TiktokProfile> {
  const token = process.env.APIFY_API_KEY
  if (!token) throw new Error('APIFY_API_KEY not configured')

  const cleanHandle = handle.replace(/^@/, '')
  const profileUrl = `https://www.tiktok.com/@${cleanHandle}`

  const res = await fetch(
    `${APIFY_BASE}/acts/clockworks~tiktok-profile-scraper/run-sync-get-dataset-items?token=${token}&timeout=60`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        profiles: [profileUrl],
        resultsPerPage: 30,
      }),
    },
  )

  if (!res.ok) throw new Error(`Apify TikTok error: ${res.status}`)

  const items = (await res.json()) as Record<string, unknown>[]
  if (items.length === 0) {
    return { handle: cleanHandle, followersCount: 0, postsLast30Days: 0, engagementRate: 0, contentTypes: ['video'], topPosts30d: [] }
  }

  const first = items[0]
  const authorMeta = (first['authorMeta'] as Record<string, unknown> | undefined) ?? {}
  const followersCount = (authorMeta['fans'] as number | undefined) ?? 0

  // Count posts published in the last 30 days.
  // TikTok createTime is unix seconds (10 digits); guard against actor versions
  // that return milliseconds (13 digits) by normalising to seconds.
  const cutoffSec = (Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000
  const recentPosts = items.filter(item => {
    let ts = (item['createTime'] as number | undefined) ?? 0
    if (ts > 1e12) ts = ts / 1000   // milliseconds → seconds
    return ts > cutoffSec
  })

  // Engagement rate = avg (likes + comments) per post / followers
  let totalEngagement = 0
  for (const post of recentPosts) {
    totalEngagement +=
      ((post['diggCount'] as number | undefined) ?? 0) +
      ((post['commentCount'] as number | undefined) ?? 0)
  }
  const engagementRate =
    followersCount > 0 && recentPosts.length > 0
      ? Math.min(1, totalEngagement / (recentPosts.length * followersCount))
      : 0

  // P8.10.S2.3: pick top 3 by engagement (diggCount + commentCount)
  const topPosts30d: SocialPostSample[] = [...recentPosts]
    .sort((a, b) => {
      const aE = ((a['diggCount'] as number | undefined) ?? 0) + ((a['commentCount'] as number | undefined) ?? 0)
      const bE = ((b['diggCount'] as number | undefined) ?? 0) + ((b['commentCount'] as number | undefined) ?? 0)
      return bE - aE
    })
    .slice(0, SAMPLE_COUNT)
    .map(post => {
      const caption = (post['text'] as string | undefined) ?? ''
      return {
        platform: 'TikTok' as const,
        url: (post['webVideoUrl'] as string | undefined) ?? null,
        caption: truncateCaption(caption),
        likes: (post['diggCount'] as number | undefined) ?? 0,
        comments: (post['commentCount'] as number | undefined) ?? 0,
        hashtags: extractHashtags(caption),
        posted_at: toIso(post['createTime'] as number | undefined),
      }
    })

  return {
    handle: cleanHandle,
    followersCount,
    postsLast30Days: recentPosts.length,
    engagementRate,
    contentTypes: ['video'],
    topPosts30d,
  }
}
