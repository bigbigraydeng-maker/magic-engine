/**
 * Per-client publish switches. Missing, "true", 1, and false all stay off.
 * Only the boolean `true` under `publishing_calendar_config.publish_live` arms a kind.
 * No client name or id is read here.
 */
export const PUBLISH_LIVE_KINDS = ['story_register', 'image_post', 'reel_public'] as const
export type PublishLiveKind = (typeof PUBLISH_LIVE_KINDS)[number]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** True only when this client's config has the kind set to boolean true. */
export function publishLiveEnabled(config: unknown, kind: PublishLiveKind): boolean {
  if (!isRecord(config)) return false
  const gate = config.publish_live
  if (!isRecord(gate)) return false
  return gate[kind] === true
}
