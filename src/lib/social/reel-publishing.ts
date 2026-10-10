import type { ContentCheckItemResult } from './content-review'

const TRACKING_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const

function readableText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeUrl(value: string): URL | null {
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null
    return url
  } catch {
    return null
  }
}

export type ReelTrackingSource = 'facebook' | 'instagram'

export function buildTrackedReelUrl(
  rawUrl: unknown,
  workOrderId: string,
  source: ReelTrackingSource = 'facebook',
  utmCampaign = 'me_factory_reel',
): string | null {
  const url = normalizeUrl(readableText(rawUrl))
  if (!url || !workOrderId.trim()) return null
  url.searchParams.set('utm_source', source)
  url.searchParams.set('utm_medium', 'organic_social')
  url.searchParams.set('utm_campaign', utmCampaign)
  url.searchParams.set('utm_content', workOrderId)
  return url.toString()
}

export function buildReelFirstComment(
  endcard: Record<string, unknown>,
  workOrderId: string,
  source: ReelTrackingSource = 'facebook',
): { text: string; trackedUrl: string } | null {
  const cta = readableText(endcard.cta)
  const trackedUrl = buildTrackedReelUrl(endcard.url, workOrderId, source)
  if (!cta || !trackedUrl) return null
  const offer = Array.isArray(endcard.offer)
    ? endcard.offer.map(readableText).filter(Boolean).join(' · ')
    : ''
  return { text: [cta, offer, trackedUrl].filter(Boolean).join('\n'), trackedUrl }
}

export function buildReelPostCaption(copy: Record<string, unknown>): string {
  const direct = readableText(copy.caption)
  if (direct) return direct
  const segments = Array.isArray(copy.segments) ? copy.segments : []
  return segments.flatMap(raw => {
    if (!raw || typeof raw !== 'object') return []
    const segment = raw as Record<string, unknown>
    return [readableText(segment.title_sub) || readableText(segment.caption) || readableText(segment.title_main)]
  }).filter(Boolean).join(' · ')
}

function normalizePhrase(value: string): string {
  return value.toLocaleLowerCase().replace(/[\W_]+/g, '')
}

export function buildReelPublishAutoChecks(input: {
  workOrderId: string
  body: string
  endcard: Record<string, unknown>
}): ContentCheckItemResult[] {
  const firstComment = buildReelFirstComment(input.endcard, input.workOrderId)
  const cta = readableText(input.endcard.cta)
  const normalizedBody = normalizePhrase(input.body)
  const ctaInBody = Boolean(cta) && normalizedBody.includes(normalizePhrase(cta))
  const urlInBody = readableText(input.endcard.url) !== '' && input.body.includes(readableText(input.endcard.url))
  const commentCheck = {
    key: 'cta_in_first_comment_not_body' as const,
    judge: 'AUTO' as const,
    outcome: firstComment && !ctaInBody && !urlInBody ? 'PASS' as const : 'FAIL' as const,
    detail: firstComment && !ctaInBody && !urlInBody
      ? 'CTA and destination link are assigned to the first comment.'
      : 'A valid first comment could not be built, or the post body contains its CTA/link.',
    source_ref: null,
  }
  const trackingCheck = {
    key: 'first_comment_link_has_tracking_params' as const,
    judge: 'AUTO' as const,
    outcome: firstComment && TRACKING_KEYS.every(key => Boolean(new URL(firstComment.trackedUrl).searchParams.get(key)))
      ? 'PASS' as const
      : 'FAIL' as const,
    detail: firstComment
      ? 'First-comment link includes source, medium, campaign, and work-order tracking parameters.'
      : 'A valid HTTPS first-comment link could not be built.',
    source_ref: null,
  }
  return [commentCheck, trackingCheck]
}
