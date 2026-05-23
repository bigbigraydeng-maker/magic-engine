/**
 * YouTube Data API v3 — fetch metadata for viral reference videos.
 *
 * Pulls view count, like count, publish date, title, channel — used to
 * weight style-hint references (more viral videos influence generation more).
 *
 * Requires YOUTUBE_API_KEY env var (Google Cloud Console, Data API v3 enabled).
 */

export interface YouTubeMetadata {
  view_count: number | null
  like_count: number | null
  published_at: string | null
  video_title: string | null
  channel_title: string | null
}

const EMPTY: YouTubeMetadata = {
  view_count: null,
  like_count: null,
  published_at: null,
  video_title: null,
  channel_title: null,
}

/**
 * Extract video ID from any YouTube URL form:
 *   youtube.com/watch?v=ID
 *   youtube.com/shorts/ID
 *   youtu.be/ID
 */
export function extractYouTubeVideoId(url: string): string | null {
  // youtu.be/ID
  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/)
  if (shortMatch) return shortMatch[1]

  // youtube.com/shorts/ID
  const shortsMatch = url.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/)
  if (shortsMatch) return shortsMatch[1]

  // youtube.com/watch?v=ID
  const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/)
  if (watchMatch) return watchMatch[1]

  return null
}

/**
 * Fetch metadata for a single YouTube video.
 * Returns empty object (all nulls) on failure — never throws.
 */
export async function fetchYouTubeMetadata(url: string): Promise<YouTubeMetadata> {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) return EMPTY

  const videoId = extractYouTubeVideoId(url)
  if (!videoId) return EMPTY

  try {
    const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoId}&key=${apiKey}`
    const res = await fetch(apiUrl)
    if (!res.ok) return EMPTY

    const data = await res.json() as {
      items?: Array<{
        snippet?: { title?: string; channelTitle?: string; publishedAt?: string }
        statistics?: { viewCount?: string; likeCount?: string }
      }>
    }

    const item = data.items?.[0]
    if (!item) return EMPTY

    return {
      view_count:    item.statistics?.viewCount ? Number(item.statistics.viewCount) : null,
      like_count:    item.statistics?.likeCount ? Number(item.statistics.likeCount) : null,
      published_at:  item.snippet?.publishedAt ?? null,
      video_title:   item.snippet?.title ?? null,
      channel_title: item.snippet?.channelTitle ?? null,
    }
  } catch (err) {
    console.error('[youtube-metadata] fetch failed:', err)
    return EMPTY
  }
}
