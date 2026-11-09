import { buildTrackedReelUrl } from '@/lib/social/reel-publishing'
import type { ContentCheckItemResult } from '@/lib/social/content-review'

export const DAILY_PLAN_UTM_CAMPAIGN = 'me_daily_plan'

export interface DailyPlanFirstCommentPost {
  hook: string
  body: string
  cta: string
  cta_url: string
}

const SHORT_LINK_HOSTS = ['bit.ly', 'tinyurl.com', 't.co/', 'goo.gl', 'ow.ly'] as const

const BARE_DOMAIN_PATTERN = /\b[a-z0-9-]+\.(?:co\.nz|com\.au|co\.uk|com|net|org|nz|au)\b/

export function dailyPlanContentId(planId: string, date: string): string {
  return `${planId.replace(/-/g, '').slice(0, 8)}-${date}`
}

function resolveUtmCampaign(ctaUrl: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(ctaUrl)
  } catch {
    return null
  }
  const existing = parsed.searchParams.get('utm_campaign')
  return existing && existing.trim() ? existing : DAILY_PLAN_UTM_CAMPAIGN
}

export function buildDailyPlanFirstComment(input: {
  cta: string
  ctaUrl: string
  planId: string
  date: string
}): { text: string; trackedUrl: string } | null {
  const cta = input.cta.trim()
  if (!cta) return null
  const utmCampaign = resolveUtmCampaign(input.ctaUrl)
  if (utmCampaign === null) return null
  const trackedUrl = buildTrackedReelUrl(
    input.ctaUrl,
    dailyPlanContentId(input.planId, input.date),
    'facebook',
    utmCampaign,
  )
  if (!trackedUrl) return null
  return { text: `${cta}\n${trackedUrl}`, trackedUrl }
}

export function buildDailyPlanPostMessage(post: Pick<DailyPlanFirstCommentPost, 'hook' | 'body'>): string {
  return [post.hook.trim(), post.body.trim()].filter(Boolean).join('\n\n')
}

function normalizeForLeakCheck(value: string): string {
  const normalized = value.normalize('NFKC')
  let decoded = normalized
  try {
    decoded = decodeURIComponent(normalized)
  } catch {
    decoded = normalized
  }
  return decoded.toLowerCase()
}

function normalizePhrase(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function ctaUrlHost(ctaUrl: string): string | null {
  try {
    return new URL(ctaUrl).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

export function dailyPlanPostLeaksCta(post: DailyPlanFirstCommentPost): boolean {
  const visible = normalizeForLeakCheck(`${post.hook}\n${post.body}`)
  if (visible.includes('http://') || visible.includes('https://') || visible.includes('www.')) return true
  if (visible.includes('utm_')) return true
  if (SHORT_LINK_HOSTS.some(host => visible.includes(host))) return true
  if (BARE_DOMAIN_PATTERN.test(visible)) return true
  const host = ctaUrlHost(post.cta_url)
  if (host && visible.includes(host)) return true
  const ctaPhrase = normalizePhrase(post.cta)
  return ctaPhrase !== '' && normalizePhrase(visible).includes(ctaPhrase)
}

export function buildDailyPlanAutoChecks(input: {
  post: DailyPlanFirstCommentPost
  planId: string
  date: string
}): ContentCheckItemResult[] {
  const firstComment = buildDailyPlanFirstComment({
    cta: input.post.cta,
    ctaUrl: input.post.cta_url,
    planId: input.planId,
    date: input.date,
  })
  const leaks = dailyPlanPostLeaksCta(input.post)
  const commentOk = firstComment !== null && !leaks
  const commentCheck: ContentCheckItemResult = {
    key: 'cta_in_first_comment_not_body',
    judge: 'AUTO',
    outcome: commentOk ? 'PASS' : 'FAIL',
    detail: commentOk
      ? 'CTA and destination link are assigned to the first comment.'
      : firstComment === null
        ? 'No valid first comment could be built from the CTA and destination link.'
        : 'The post text contains its CTA or a link.',
    source_ref: null,
  }
  const trackingOk = firstComment !== null && ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].every(
    key => Boolean(new URL(firstComment.trackedUrl).searchParams.get(key)),
  )
  const trackingCheck: ContentCheckItemResult = {
    key: 'first_comment_link_has_tracking_params',
    judge: 'AUTO',
    outcome: trackingOk ? 'PASS' : 'FAIL',
    detail: trackingOk
      ? 'First-comment link includes source, medium, campaign, and content tracking parameters.'
      : 'A valid HTTPS first-comment link with tracking parameters could not be built.',
    source_ref: null,
  }
  return [commentCheck, trackingCheck]
}
