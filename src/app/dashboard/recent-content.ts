export interface DashboardRecentContent {
  format?: string | null
  source_video_url?: string | null
  platforms?: string[] | null
}

const VIDEO_FORMATS = new Set(['reel', 'video', 'short', 'shorts', '讲课式', '短视频'])

/** Keep video production in the video factory instead of the general dashboard feed. */
export function isVideoContentPost(post: DashboardRecentContent): boolean {
  const format = post.format?.trim().toLowerCase()
  if (format && VIDEO_FORMATS.has(format)) return true
  if (post.source_video_url?.trim()) return true

  return (post.platforms ?? []).some((platform) =>
    /youtube|tiktok|shorts|reels/i.test(platform),
  )
}

/** Keep paging until the dashboard has enough non-video posts to show. */
export async function collectRecentNonVideoPosts<T extends DashboardRecentContent>(
  fetchPage: (from: number, to: number) => Promise<readonly T[]>,
  limit = 6,
  pageSize = 40,
  maxPages = 5,
): Promise<T[]> {
  const selected: T[] = []
  for (let from = 0, page = 0; selected.length < limit && page < maxPages; from += pageSize, page += 1) {
    const page = await fetchPage(from, from + pageSize - 1)
    selected.push(...page.filter((post) => !isVideoContentPost(post)).slice(0, limit - selected.length))
    if (page.length < pageSize) break
  }
  return selected
}
