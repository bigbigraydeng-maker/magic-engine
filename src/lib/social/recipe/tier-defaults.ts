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

export interface SocialAgentSettings {
  enabled: boolean
  reelPerDay: number
  /** where reelPerDay came from */
  reelSource: 'client' | 'tier' | 'off'
  tier: PlanTier | null
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

export function readSocialAgentSettings(
  config: unknown,
  planTier: unknown,
): SocialAgentSettings {
  const tier = parsePlanTier(planTier)

  const socialAgent = isRecord(config) ? config.social_agent : undefined
  const enabled = isRecord(socialAgent) && socialAgent.enabled === true

  if (!enabled) {
    return { enabled: false, reelPerDay: 0, reelSource: 'off', tier }
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

  return {
    enabled: true,
    reelPerDay: Math.min(value, DAILY_REEL_HARD_CAP),
    reelSource,
    tier,
  }
}
