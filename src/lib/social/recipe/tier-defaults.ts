/**
 * Platform defaults for the social agent's daily quotas, keyed by clients.plan_tier.
 * Internal only: these are NOT customer-facing promises (membership tiers are not final).
 * Every client is OFF until publishing_calendar_config.social_agent.enabled === true (set by PM).
 */
export type PlanTier = 'starter' | 'growth' | 'enterprise'

export interface TierQuota {
  reelPerDay: number
  postPerDay: number
  storyPerDay: number
}

export const TIER_DEFAULTS: Readonly<Record<PlanTier, TierQuota>> = {
  starter: { reelPerDay: 1, postPerDay: 0, storyPerDay: 1 },
  growth: { reelPerDay: 1, postPerDay: 1, storyPerDay: 3 },
  enterprise: { reelPerDay: 2, postPerDay: 1, storyPerDay: 3 },
}

/** Knife 1 publishes at one hour per client per day, so at most one reel per day is scheduled. */
export const DAILY_REEL_HARD_CAP = 1
export const DAILY_IMAGE_POST_HARD_CAP = 1

export interface SocialAgentSettings {
  enabled: boolean
  reelPerDay: number
  /** where reelPerDay came from */
  reelSource: 'client' | 'tier' | 'off'
  imagePostPerDay: number
  imagePostSource: 'client' | 'tier' | 'off'
  /** Image-post layout recipe from `social_agent.image_post_recipe`; null = post the photo as-is (default). */
  imagePostRecipe: ImagePostRecipeId | null
  tier: PlanTier | null
}

/** Whitelist of image-post recipes a client may opt into. Anything else reads as null (off). */
export const IMAGE_POST_RECIPE_IDS = ['tour_poster_v1'] as const
export type ImagePostRecipeId = (typeof IMAGE_POST_RECIPE_IDS)[number]

export function parseImagePostRecipe(raw: unknown): ImagePostRecipeId | null {
  return typeof raw === 'string' && (IMAGE_POST_RECIPE_IDS as readonly string[]).includes(raw)
    ? (raw as ImagePostRecipeId)
    : null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function parsePlanTier(raw: unknown): PlanTier | null {
  if (raw === 'starter' || raw === 'growth' || raw === 'enterprise') {
    return raw
  }
  return null
}

/** A whole-number daily quota the client set explicitly, or null. */
function clientQuota(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && Number.isInteger(raw) && raw >= 0 ? raw : null
}

/**
 * Image posts without the daily social agent (PM 2026-11-15): a client in the weekly loop can draft image
 * posts on its draft day while its reel cadence stays weekly. Needs `image_post_standalone === true` AND an
 * explicit `image_post_per_day`; no tier default, so no client starts drafting by accident.
 */
function standaloneImagePosts(
  socialAgent: unknown,
): Pick<SocialAgentSettings, 'imagePostPerDay' | 'imagePostSource' | 'imagePostRecipe'> {
  const off = { imagePostPerDay: 0, imagePostSource: 'off' as const, imagePostRecipe: null }
  if (!isRecord(socialAgent) || socialAgent.image_post_standalone !== true) return off
  const perDay = clientQuota(socialAgent.image_post_per_day)
  if (perDay === null || perDay === 0) return off
  return {
    imagePostPerDay: Math.min(perDay, DAILY_IMAGE_POST_HARD_CAP),
    imagePostSource: 'client',
    imagePostRecipe: parseImagePostRecipe(socialAgent.image_post_recipe),
  }
}

export function readSocialAgentSettings(
  config: unknown,
  planTier: unknown,
): SocialAgentSettings {
  const tier = parsePlanTier(planTier)

  const socialAgent = isRecord(config) ? config.social_agent : undefined
  const enabled = isRecord(socialAgent) && socialAgent.enabled === true

  if (!enabled) {
    return { ...standaloneImagePosts(socialAgent), enabled: false, reelPerDay: 0, reelSource: 'off', tier }
  }

  const rawReelPerDay = isRecord(socialAgent) ? socialAgent.reel_per_day : undefined
  const hasClientValue =
    typeof rawReelPerDay === 'number' &&
    Number.isFinite(rawReelPerDay) &&
    Number.isInteger(rawReelPerDay) &&
    rawReelPerDay >= 0

  let value: number
  let reelSource: SocialAgentSettings['reelSource']

  if (hasClientValue) {
    value = rawReelPerDay as number
    reelSource = 'client'
  } else if (tier !== null) {
    value = TIER_DEFAULTS[tier].reelPerDay
    reelSource = 'tier'
  } else {
    value = 0
    reelSource = 'off'
  }

  // Image post quota (same pattern as reel)
  const rawImagePostPerDay = isRecord(socialAgent) ? socialAgent.image_post_per_day : undefined
  const hasClientImagePost =
    typeof rawImagePostPerDay === 'number' &&
    Number.isFinite(rawImagePostPerDay) &&
    Number.isInteger(rawImagePostPerDay) &&
    rawImagePostPerDay >= 0

  let imagePostValue: number
  let imagePostSource: SocialAgentSettings['imagePostSource']

  if (hasClientImagePost) {
    imagePostValue = rawImagePostPerDay as number
    imagePostSource = 'client'
  } else if (tier !== null) {
    imagePostValue = TIER_DEFAULTS[tier].postPerDay
    imagePostSource = 'tier'
  } else {
    imagePostValue = 0
    imagePostSource = 'off'
  }

  return {
    enabled: true,
    reelPerDay: Math.min(value, DAILY_REEL_HARD_CAP),
    reelSource,
    imagePostPerDay: Math.min(imagePostValue, DAILY_IMAGE_POST_HARD_CAP),
    imagePostSource,
    imagePostRecipe: parseImagePostRecipe(isRecord(socialAgent) ? socialAgent.image_post_recipe : undefined),
    tier,
  }
}
