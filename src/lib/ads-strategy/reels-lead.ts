/**
 * Short-video lead ads on the existing paused-draft card.
 * Default until the launch rules are confirmed: both Reels positions, an
 * already uploaded video, the same lead-form objective and button as
 * `lead_form`. No new card, no new token, no filled-in placement.
 * The draft card only creates paused objects. Opening is the go-live card.
 */

import type { AdDraft, AdDraftCreative, DraftProblem } from './ad-draft'

export const REELS_LEAD_KIND = 'reels_lead' as const

/** Both positions are required. An empty list is not filled in. */
export const REELS_LEAD_PLACEMENTS = ['facebook_reels', 'instagram_reels'] as const

const PLACEMENT_SET = new Set<string>(REELS_LEAD_PLACEMENTS)
const HTTPS_URL = /^https:\/\/\S+$/i

const PLACEMENT_MESSAGE =
  '短视频留资必须同时写上 facebook_reels 和 instagram_reels。没写不会替你选，多写别的版位也不建'

export function reelsLeadPlacementsMatch(tokens: readonly string[] | undefined): boolean {
  if (!tokens || tokens.length === 0) return false
  const got = new Set(tokens.map((token) => token.trim().toLowerCase()).filter((token) => token.length > 0))
  if (got.size !== PLACEMENT_SET.size) return false
  for (const token of PLACEMENT_SET) if (!got.has(token)) return false
  return true
}

export function reelsLeadCreativeProblems(
  creative: AdDraftCreative,
  prefix: string,
  index: number,
): DraftProblem[] {
  const field = `${prefix}creatives[${index}]`
  const problems: DraftProblem[] = []
  if (!creative.videoId) {
    problems.push({ field: `${field}.videoId`, message: '短视频留资只用已经上传好的视频，没有视频就不能建' })
  }
  if (creative.imageHash) {
    problems.push({ field: `${field}.imageHash`, message: '短视频留资不建图片广告。封面写在 thumbnailImageHash 或 thumbnailUrl' })
  }
  if (creative.videoId && !hasThumbnail(creative)) {
    problems.push({ field: `${field}.thumbnail`, message: '短视频留资要有封面（thumbnailImageHash，或 https 开头的 thumbnailUrl）' })
  }
  return problems
}

export function reelsLeadDraftProblems(draft: AdDraft): DraftProblem[] {
  if (draft.kind !== REELS_LEAD_KIND) return []
  const problems: DraftProblem[] = []
  if (Array.isArray(draft.adSets)) {
    problems.push({ field: 'adSets', message: '短视频留资这次只建一个广告组，不走多个广告组' })
  }
  if (draft.existingAdSetId) {
    problems.push({
      field: 'existingAdSetId',
      message: '短视频留资要新建广告组才能锁 Reels 版位。往已有广告组加广告不会改版位，这次没有去建',
    })
  }
  if (!draft.leadFormId) {
    problems.push({ field: 'leadFormId', message: '短视频留资没挂表单，收不到联系方式' })
  }
  if (!reelsLeadPlacementsMatch(draft.placements)) {
    problems.push({ field: 'placements', message: PLACEMENT_MESSAGE })
  }
  return problems
}

/** The old open button must not turn this kind on. The go-live card may. */
export function reelsLeadOpenBlocked(kind: unknown, entry: string): boolean {
  return kind === REELS_LEAD_KIND && entry !== 'go-live-card'
}

export function reelsLeadPublishRefusal(draft: AdDraft): { step: 'adset' | 'creative'; error: string } | null {
  if (draft.kind !== REELS_LEAD_KIND) return null
  if (draft.existingAdSetId || Array.isArray(draft.adSets) || !reelsLeadPlacementsMatch(draft.placements)) {
    return { step: 'adset', error: '短视频留资要新建一个广告组，并且只锁两条 Reels，这次没有去建。' }
  }
  if (!draft.leadFormId) {
    return { step: 'creative', error: '短视频留资没挂表单，这次没有去建。' }
  }
  if (draft.creatives.some((creative) => !creative.videoId || creative.imageHash)) {
    return { step: 'creative', error: '短视频留资没有已上传的视频，这次没有去建。' }
  }
  return null
}

function hasThumbnail(creative: AdDraftCreative): boolean {
  return !!creative.thumbnailImageHash || (!!creative.thumbnailUrl && HTTPS_URL.test(creative.thumbnailUrl))
}
