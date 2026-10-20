export const CONTENT_CHECK_KEYS = [
  'audio_track_present_nonsilent',
  'resolution_aspect_ratio_correct',
  'subtitle_timing_aligned',
  'cover_frame_not_blank_or_placeholder',
  'factual_claims_have_source',
  'factual_claims_source_verified',
  'viral_recipe_hook_matched',
  'safe_zone_text_in_bounds',
  'logo_watermark_present',
  'subtitle_short_and_large',
  'asset_provenance_labeled',
  'asset_provenance_matches_claim_context',
  'bgm_segmented_with_fades',
  'bgm_listened_no_vocals',
  'standalone_understandable',
  'format_is_reel',
  'cta_in_first_comment_not_body',
  'first_comment_link_has_tracking_params',
] as const

export type ContentCheckItemKey = (typeof CONTENT_CHECK_KEYS)[number]
export type CheckItemJudge = 'AUTO' | 'HUMAN'
export type CheckItemOutcome = 'PASS' | 'FAIL' | 'NOT_MEASURED'

export interface ContentCheckItemResult {
  key: ContentCheckItemKey
  judge: CheckItemJudge
  outcome: CheckItemOutcome
  detail: string | null
  source_ref: string | null
}

export const REEL_A_CLASS_CHECK_KEYS = [
  'audio_track_present_nonsilent',
  'resolution_aspect_ratio_correct',
  'subtitle_timing_aligned',
  'cover_frame_not_blank_or_placeholder',
] as const satisfies readonly ContentCheckItemKey[]

export const REEL_AUTO_CHECK_KEYS = [
  ...REEL_A_CLASS_CHECK_KEYS,
  'format_is_reel',
  // The v0.2 §2.1 example places these D checks in checklist_human even
  // though the shared constraint says D is server-owned. Keep them server-side
  // (Daily Plan Posts: the server computes them from the stored copy — see
  // `buildDailyPlanAutoChecks`; Reels compute them in `buildReelPublishAutoChecks`.)
  'cta_in_first_comment_not_body',
  'first_comment_link_has_tracking_params',
] as const satisfies readonly ContentCheckItemKey[]

// v0.2 calls this six checks but enumerates seven distinct keys. All seven are
// retained so no listed rule silently disappears from the approval contract.
export const REEL_HUMAN_CHECK_KEYS = [
  'factual_claims_have_source',
  'factual_claims_source_verified',
  'viral_recipe_hook_matched',
  'safe_zone_text_in_bounds',
  'logo_watermark_present',
  'subtitle_short_and_large',
  'asset_provenance_labeled',
  'asset_provenance_matches_claim_context',
  'bgm_segmented_with_fades',
] as const satisfies readonly ContentCheckItemKey[]

// Approval-time checklist (2026-10-16): adds an explicit "listened with sound on, no vocals in the
// BGM" item, because a plain approval never proved the reviewer heard the audio.
// REEL_HUMAN_CHECK_KEYS above stays as the legacy 9-key set so receipts stored before this item
// existed still validate at publish time (see humanKeysForStored).
export const REEL_HUMAN_CHECK_KEYS_V2 = [
  ...REEL_HUMAN_CHECK_KEYS,
  'bgm_listened_no_vocals',
] as const satisfies readonly ContentCheckItemKey[]

// Approval-time checklist V3 (2026-10-21): adds "this reel on its own tells the fans what it is about" because
// every machine check can pass on a reel with no content at all (the 17419d99 atmosphere sample did).
export const REEL_HUMAN_CHECK_KEYS_V3 = [
  ...REEL_HUMAN_CHECK_KEYS_V2,
  'standalone_understandable',
] as const satisfies readonly ContentCheckItemKey[]

export const CHECKLIST_VERSION_V3 = 'v3'
// Approvals made on or after this instant MUST carry checklist_version (anti-downgrade): without it a V2-shaped
// receipt would still pass at publish time. Chosen well after the V3 entry points are deployed.
export const CHECKLIST_V3_REQUIRED_FROM = '2026-10-23T00:00:00.000Z'

const hasKey = (value: unknown, key: string): boolean =>
  Array.isArray(value) && value.some(item => !!item && typeof item === 'object' && (item as Record<string, unknown>).key === key)

// Which human key set a STORED approval receipt was made under (receipt = review_ref, pass the whole object).
//  - checklist_version present (any value) -> V3 and the new item is required: a v3 receipt missing the new key is
//    invalid, never silently downgraded;
//  - the new item present without a version -> V3;
//  - approved on/after the cutover without a version -> V3 (so it fails validation instead of passing as V2);
//  - otherwise the historical inference: V2 when it carries the listened item, else the legacy nine.
export function humanKeysForReviewRef(reviewRef: unknown): readonly ContentCheckItemKey[] {
  const ref = reviewRef && typeof reviewRef === 'object' ? (reviewRef as Record<string, unknown>) : {}
  const checklist = ref['checklist_human']
  if (ref['checklist_version'] !== undefined && ref['checklist_version'] !== null) return REEL_HUMAN_CHECK_KEYS_V3
  if (hasKey(checklist, 'standalone_understandable')) return REEL_HUMAN_CHECK_KEYS_V3
  const approvedAt = typeof ref['approved_at'] === 'string' ? Date.parse(ref['approved_at']) : NaN
  if (Number.isFinite(approvedAt) && approvedAt >= Date.parse(CHECKLIST_V3_REQUIRED_FROM)) return REEL_HUMAN_CHECK_KEYS_V3
  return hasKey(checklist, 'bgm_listened_no_vocals') ? REEL_HUMAN_CHECK_KEYS_V2 : REEL_HUMAN_CHECK_KEYS
}

// Legacy helper kept for callers/tests that only have the checklist array (no version, no approval time).
export function humanKeysForStored(value: unknown): readonly ContentCheckItemKey[] {
  return humanKeysForReviewRef({ checklist_human: value })
}

export const POST_HUMAN_CHECK_KEYS = [
  'factual_claims_have_source',
  'factual_claims_source_verified',
  'logo_watermark_present',
  'asset_provenance_labeled',
  'asset_provenance_matches_claim_context',
] as const satisfies readonly ContentCheckItemKey[]

export const POST_AUTO_CHECK_KEYS = [
  'cta_in_first_comment_not_body',
  'first_comment_link_has_tracking_params',
] as const satisfies readonly ContentCheckItemKey[]

const FACTUAL_KEYS = new Set<ContentCheckItemKey>([
  'factual_claims_have_source',
  'factual_claims_source_verified',
])

const keySet = new Set<string>(CONTENT_CHECK_KEYS)

export function unmeasuredAutoChecks(
  keys: readonly ContentCheckItemKey[],
  detail: string,
): ContentCheckItemResult[] {
  return keys.map(key => ({ key, judge: 'AUTO', outcome: 'NOT_MEASURED', detail, source_ref: null }))
}

export function validateContentChecklist(
  value: unknown,
  requiredKeys: readonly ContentCheckItemKey[],
  judge: CheckItemJudge,
): { ok: true; items: ContentCheckItemResult[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: 'checklist must be an array' }
  const byKey = new Map<string, ContentCheckItemResult>()
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'checklist item must be an object' }
    const item = raw as Record<string, unknown>
    if (typeof item.key !== 'string' || !keySet.has(item.key)) return { ok: false, error: 'checklist contains an unknown key' }
    if (byKey.has(item.key)) return { ok: false, error: `duplicate checklist key: ${item.key}` }
    if (item.judge !== judge) return { ok: false, error: `checklist ${item.key} must use judge ${judge}` }
    if (!['PASS', 'FAIL', 'NOT_MEASURED'].includes(String(item.outcome))) {
      return { ok: false, error: `checklist ${item.key} has an invalid outcome` }
    }
    if (item.detail !== null && typeof item.detail !== 'string') return { ok: false, error: `checklist ${item.key} detail must be a string or null` }
    if (item.source_ref !== null && typeof item.source_ref !== 'string') return { ok: false, error: `checklist ${item.key} source_ref must be a string or null` }
    const result: ContentCheckItemResult = {
      key: item.key as ContentCheckItemKey,
      judge,
      outcome: item.outcome as CheckItemOutcome,
      detail: typeof item.detail === 'string' ? item.detail.trim() || null : null,
      source_ref: typeof item.source_ref === 'string' ? item.source_ref.trim() || null : null,
    }
    if (result.outcome === 'FAIL' && !result.detail) return { ok: false, error: `checklist ${result.key} requires a failure detail` }
    // A failed factual check may mean there is no source to cite. Requiring a
    // source in that case prevents reviewers from recording the exact defect.
    // Passing a factual check still requires evidence.
    if (FACTUAL_KEYS.has(result.key) && judge === 'HUMAN' && result.outcome === 'PASS' && !result.source_ref) {
      return { ok: false, error: `checklist ${result.key} requires source_ref` }
    }
    if (!FACTUAL_KEYS.has(result.key) && result.source_ref !== null) {
      return { ok: false, error: `checklist ${result.key} cannot include source_ref` }
    }
    byKey.set(result.key, result)
  }

  for (const key of requiredKeys) {
    if (!byKey.has(key)) return { ok: false, error: `checklist is missing required key: ${key}` }
  }
  if (byKey.size !== requiredKeys.length) return { ok: false, error: 'checklist contains an inapplicable key' }
  return { ok: true, items: requiredKeys.map(key => byKey.get(key)!) }
}

export function checklistPasses(items: readonly ContentCheckItemResult[]): boolean {
  return items.length > 0 && items.every(item => item.outcome === 'PASS')
}

export function hasChecklistFailure(items: readonly ContentCheckItemResult[]): boolean {
  return items.some(item => item.outcome === 'FAIL')
}

export function splitPostChecklist(items: readonly ContentCheckItemResult[]): {
  valid: boolean
  human: ContentCheckItemResult[]
  auto: ContentCheckItemResult[]
} {
  const human = items.filter(item => item.judge === 'HUMAN')
  const auto = items.filter(item => item.judge === 'AUTO')
  const checkedHuman = validateContentChecklist(human, POST_HUMAN_CHECK_KEYS, 'HUMAN')
  const checkedAuto = validateContentChecklist(auto, POST_AUTO_CHECK_KEYS, 'AUTO')
  return {
    valid: checkedHuman.ok && checkedAuto.ok && items.length === POST_HUMAN_CHECK_KEYS.length + POST_AUTO_CHECK_KEYS.length,
    human: checkedHuman.ok ? checkedHuman.items : [],
    auto: checkedAuto.ok ? checkedAuto.items : [],
  }
}

export function postChecklistPasses(items: readonly ContentCheckItemResult[]): boolean {
  const split = splitPostChecklist(items)
  return split.valid && checklistPasses(split.human) && checklistPasses(split.auto)
}

export function isValidContentSourceRef(value: string): boolean {
  if (/^client_asset:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return true
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && Boolean(url.hostname)
  } catch {
    return false
  }
}
