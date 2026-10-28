// Work-order brief gets a required `platform` and optional `creative_tags`
// (self-reported by the order creator, not measured). Only NEW orders are
// checked; old orders without platform stay readable and read as 'unknown'.

import {
  normalizePlatform,
  SOCIAL_PLATFORMS,
  type SocialPlatform,
} from '@/lib/social/platforms'

export const TOPIC_SOURCES = ['trend', 'evergreen', 'comment', 'calendar'] as const
export type TopicSource = (typeof TOPIC_SOURCES)[number]

export interface CreativeTags {
  opening_type?: string
  series?: string
  topic_source?: TopicSource
  bgm_track_id?: string
}

// The factory only publishes to Facebook today; in-repo signal producers use
// this until a second platform's output is wired; replace per-slot at that point.
export const CURRENT_FACTORY_OUTPUT_PLATFORM: SocialPlatform = 'facebook'

export type CreativeTagsParse =
  | { ok: true; tags: CreativeTags | null }
  | { ok: false; detail: string }

const STRING_TAG_KEYS = ['opening_type', 'series', 'bgm_track_id'] as const
const MAX_TAG_STRING_LENGTH = 80

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTopicSource(value: unknown): value is TopicSource {
  return (
    typeof value === 'string' &&
    (TOPIC_SOURCES as readonly string[]).includes(value)
  )
}

export function parseCreativeTags(raw: unknown): CreativeTagsParse {
  if (raw === undefined || raw === null) {
    return { ok: true, tags: null }
  }
  if (!isPlainObject(raw)) {
    return { ok: false, detail: 'creative_tags must be an object' }
  }

  const tags: CreativeTags = {}

  for (const key of STRING_TAG_KEYS) {
    const value = raw[key]
    if (value === undefined || value === null) continue
    if (typeof value !== 'string') {
      return {
        ok: false,
        detail: `creative_tags.${key} must be a non-empty string up to ${MAX_TAG_STRING_LENGTH} chars`,
      }
    }
    const trimmed = value.trim()
    if (trimmed.length === 0 || trimmed.length > MAX_TAG_STRING_LENGTH) {
      return {
        ok: false,
        detail: `creative_tags.${key} must be a non-empty string up to ${MAX_TAG_STRING_LENGTH} chars`,
      }
    }
    tags[key] = trimmed
  }

  const topicSource = raw.topic_source
  if (topicSource !== undefined && topicSource !== null) {
    if (!isTopicSource(topicSource)) {
      return {
        ok: false,
        detail: `creative_tags.topic_source must be one of ${TOPIC_SOURCES.join('|')}`,
      }
    }
    tags.topic_source = topicSource
  }

  if (Object.keys(tags).length === 0) {
    return { ok: true, tags: null }
  }
  return { ok: true, tags }
}

export type StampResult<B extends object> =
  | {
      ok: true
      brief: B & { platform: SocialPlatform; creative_tags?: CreativeTags }
      /** true = the caller sent no platform and we filled in the current factory output platform */
      platform_defaulted: boolean
    }
  | {
      ok: false
      reason: 'platform_required' | 'creative_tags_invalid'
      detail: string
    }

export function stampPlatformAndTags<B extends object>(
  brief: B,
  request: unknown,
): StampResult<B> {
  const req: Record<string, unknown> = isPlainObject(request) ? request : {}

  // A missing platform (external callers that predate S1) falls back to the platform the
  // factory publishes to today. A platform that is present but unrecognised is still rejected.
  const platformMissing = req.platform === undefined || req.platform === null
  const platform = platformMissing
    ? CURRENT_FACTORY_OUTPUT_PLATFORM
    : normalizePlatform(req.platform)
  if (platform === null) {
    const detail = `request.platform "${String(req.platform).slice(0, 20)}" is not one of ${SOCIAL_PLATFORMS.join('|')}`
    return { ok: false, reason: 'platform_required', detail }
  }

  const parsed = parseCreativeTags(req.creative_tags)
  if (!parsed.ok) {
    return { ok: false, reason: 'creative_tags_invalid', detail: parsed.detail }
  }

  const stamped: B & { platform: SocialPlatform; creative_tags?: CreativeTags } = {
    ...brief,
    platform,
    ...(parsed.tags ? { creative_tags: parsed.tags } : {}),
  }
  return { ok: true, brief: stamped, platform_defaulted: platformMissing }
}

export function readBriefPlatform(brief: unknown): SocialPlatform | 'unknown' {
  if (!isPlainObject(brief)) return 'unknown'
  return normalizePlatform(brief.platform) ?? 'unknown'
}

export function readBriefCreativeTags(brief: unknown): CreativeTags | null {
  if (!isPlainObject(brief)) return null
  const parsed = parseCreativeTags(brief.creative_tags)
  return parsed.ok ? parsed.tags : null
}
