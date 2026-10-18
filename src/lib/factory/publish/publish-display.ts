// Display + record helpers for the factory publish path (pure functions).

export interface PublishedView {
  video_state: 'DRAFT' | 'PUBLISHED' | null
  permalink: string | null
  published_at: string | null
  /** true = upload started but never confirmed (interrupted run); no final receipt yet */
  provisional: boolean
  /** true = 已公开但首评没发成功,需要补发(只在为 true 时出现)。 */
  first_comment_pending?: boolean
}

/** Plain, token-free failure reason for content_work_orders.reject_reason. */
export function sanitizeFailReason(raw: string): string {
  let out = raw
  out = out.replace(/access_token[=:"'\s]*[^\s"',}&]+/gi, 'access_token=[已隐藏]')
  out = out.replace(/https?:\/\/[^\s"'<>]+/g, '[链接]')
  out = out.replace(/storage\/v1\/\S+/g, '[路径]') // internal storage paths
  out = out.replace(/fbtrace_id["':=\s]*[A-Za-z0-9_-]+/gi, 'fbtrace_id=[已隐藏]')
  out = out.replace(/EAA[A-Za-z0-9]{10,}/g, '[已隐藏]') // Meta access tokens
  out = out.replace(/[A-Za-z0-9_-]{40,}/g, '[已隐藏]') // other long secret-like strings; UUIDs / exception names survive
  out = out.replace(/\s+/g, ' ').trim()
  if (out.length > 200) {
    out = out.slice(0, 200) + '…'
  }
  if (out.length === 0) {
    return '发布失败(原因未记录)'
  }
  return out
}

/** Whitelist projection of published_ref for the dashboard. */
export function toPublishedView(ref: unknown): PublishedView | null {
  if (ref === null || typeof ref !== 'object' || Array.isArray(ref)) {
    return null
  }

  const source = ref as Record<string, unknown>

  const rawState = source.video_state
  const video_state: PublishedView['video_state'] =
    rawState === 'DRAFT' || rawState === 'PUBLISHED' ? rawState : null

  const published_at = typeof source.published_at === 'string' ? source.published_at : null

  let permalink: string | null = null
  if (typeof source.permalink === 'string') {
    let candidate = source.permalink
    if (candidate.startsWith('/')) {
      candidate = 'https://www.facebook.com' + candidate
    }
    try {
      const url = new URL(candidate)
      const host = url.hostname
      if (url.protocol === 'https:' && !url.username && !url.password && (host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.watch')) {
        permalink = url.toString()
      }
    } catch {
      permalink = null
    }
  }

  return {
    video_state, permalink, published_at, provisional: source.provisional === true,
    ...(source.first_comment_pending === true ? { first_comment_pending: true } : {}),
  }
}
