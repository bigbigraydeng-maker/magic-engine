import type { SocialChannelStatus } from '@/lib/platform-oauth/social-onboarding'

export type SocialPlatform = SocialChannelStatus['platform']

// Record<SocialPlatform, true> makes the compiler fail if a platform is added to the union but not here.
const PLATFORM_FLAGS: Record<SocialPlatform, true> = {
  facebook: true,
  instagram: true,
  threads: true,
  tiktok: true,
  youtube: true,
  x: true,
}

export const SOCIAL_PLATFORMS: readonly SocialPlatform[] = Object.freeze(
  Object.keys(PLATFORM_FLAGS) as SocialPlatform[],
)

/** Case-insensitive, trims. Anything not one of the six -> null. Never guesses. */
export function normalizePlatform(raw: unknown): SocialPlatform | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim().toLowerCase()
  if (!Object.prototype.hasOwnProperty.call(PLATFORM_FLAGS, value)) return null
  return value as SocialPlatform
}
