/**
 * 把计划步骤上的投放位置翻译成广告组要锁的版位。
 *
 * 词表是平台位置名，不是某个客户的规矩。空列表 = 这次不另锁，
 * 看完类视频仍用原来的 Facebook + Instagram，其它类型仍交给 Meta 默认。
 * Audience Network 一律不认（PITFALLS D9）。
 */

export interface PlacementLock {
  publisherPlatforms: string[]
  facebookPositions?: string[]
  instagramPositions?: string[]
}

export type PlacementLockResult =
  | { ok: true; lock: PlacementLock | null }
  | { ok: false; message: string }

interface TokenSpec {
  platform: 'facebook' | 'instagram'
  facebook?: string
  instagram?: string
}

const TOKENS: Readonly<Record<string, TokenSpec>> = {
  facebook: { platform: 'facebook' },
  instagram: { platform: 'instagram' },
  instagram_only: { platform: 'instagram' },
  facebook_feed: { platform: 'facebook', facebook: 'feed' },
  facebook_reels: { platform: 'facebook', facebook: 'facebook_reels' },
  facebook_stories: { platform: 'facebook', facebook: 'story' },
  instagram_feed: { platform: 'instagram', instagram: 'stream' },
  instagram_stream: { platform: 'instagram', instagram: 'stream' },
  instagram_reels: { platform: 'instagram', instagram: 'reels' },
  instagram_stories: { platform: 'instagram', instagram: 'story' },
  instagram_story: { platform: 'instagram', instagram: 'story' },
  instagram_explore: { platform: 'instagram', instagram: 'explore' },
}

/** 计划没写位置时返回 lock=null。认不出的词失败关闭，不猜成自动版位。 */
export function lockPlacements(tokens: readonly string[]): PlacementLockResult {
  if (tokens.length === 0) return { ok: true, lock: null }
  const platforms = new Set<string>()
  const facebook = new Set<string>()
  const instagram = new Set<string>()
  for (const raw of tokens) {
    const key = raw.trim().toLowerCase()
    const spec = TOKENS[key]
    if (!spec) return { ok: false, message: rejectPlacement(key) }
    platforms.add(spec.platform)
    if (spec.facebook) facebook.add(spec.facebook)
    if (spec.instagram) instagram.add(spec.instagram)
  }
  return { ok: true, lock: lockFrom(platforms, facebook, instagram) }
}

/** 写进 Meta 广告组 targeting 的那几项。只在有具体位置时才带位置数组。 */
export function targetingPlacement(lock: PlacementLock): Record<string, unknown> {
  return {
    publisher_platforms: lock.publisherPlatforms,
    ...(lock.facebookPositions ? { facebook_positions: lock.facebookPositions } : {}),
    ...(lock.instagramPositions ? { instagram_positions: lock.instagramPositions } : {}),
  }
}

/** 回读闸门用的期望。锁不成或不锁时返回空对象，调用方保持原检查。 */
export function expectedPlacement(tokens: readonly string[] | undefined): {
  expectedPublisherPlatforms?: string[]
  expectedFacebookPositions?: string[]
  expectedInstagramPositions?: string[]
} {
  const locked = lockPlacements(tokens ?? [])
  if (!locked.ok || !locked.lock) return {}
  const lock = locked.lock
  return {
    expectedPublisherPlatforms: lock.publisherPlatforms,
    ...(lock.facebookPositions ? { expectedFacebookPositions: lock.facebookPositions } : {}),
    ...(lock.instagramPositions ? { expectedInstagramPositions: lock.instagramPositions } : {}),
  }
}

/** 对不上时返回给人看的一句；对上返回 null。空的回读按没锁到。 */
export function placementDrift(got: readonly string[] | undefined, want: readonly string[]): string | null {
  const have = new Set((got ?? []).map((p) => p.toLowerCase()))
  if (have.has('audience_network')) return `现在含 Audience Network（${[...have].join('、')}）`
  return setDrift(have, want, '现在是自动版位，读不到计划要求的版位', '投放位置')
}

/** 计划没写具体位置时不查。写了就必须回读对得上。 */
export function positionDrift(got: readonly string[] | undefined, want: readonly string[] | undefined): string | null {
  if (!want || want.length === 0) return null
  const have = new Set((got ?? []).map((p) => p.toLowerCase()))
  return setDrift(have, want, '读不到计划要求的具体位置', '具体位置')
}

function lockFrom(platforms: Set<string>, facebook: Set<string>, instagram: Set<string>): PlacementLock {
  return {
    publisherPlatforms: [...platforms].sort(),
    ...(facebook.size > 0 ? { facebookPositions: [...facebook].sort() } : {}),
    ...(instagram.size > 0 ? { instagramPositions: [...instagram].sort() } : {}),
  }
}

function setDrift(have: Set<string>, want: readonly string[], empty: string, label: string): string | null {
  const need = new Set(want.map((p) => p.toLowerCase()))
  const same = have.size === need.size && [...need].every((p) => have.has(p))
  if (same) return null
  if (have.size === 0) return empty
  return `${label}是 ${[...have].join('、')}，计划要求 ${[...need].join('、')}`
}

function rejectPlacement(token: string): string {
  if (token === 'audience_network') return '不能投放 Audience Network。计划里的版位不认这个位置。'
  if (token === 'reels' || token === 'stories') return `「${token}」没写清是 Facebook 还是 Instagram，不能锁版位。`
  if (token === 'messenger' || token === 'threads') return `「${token}」不是这次能锁的投放位置。`
  if (token === '') return '版位里有空项，不能锁。'
  return `不认识的投放位置「${token}」，不能按这个去建。`
}
