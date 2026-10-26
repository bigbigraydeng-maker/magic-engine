/**
 * Content Reel publish — data-layer contract (PR-A).
 *
 * Mirrors supabase/migrations/20260915140000_content_reel_publish_attempts.sql so the
 * application layer (PR-C) never re-types state names, legal transitions or RPC
 * refusal codes by hand. The database is the enforcement point; this module is only
 * the typed vocabulary. `contract.test.ts` reads the migration and fails when the two
 * drift apart.
 *
 * No runtime caller yet — intentionally. See spec
 * docs/specs/2026-09-15-creatomate-reel-publish-spec-v2.md (v2.1 §3, §14).
 */

export const CONTENT_REEL_ACTIVE_STATES = ['authorized', 'claimed', 'uploading', 'in_doubt'] as const

export const CONTENT_REEL_STATES = [
  ...CONTENT_REEL_ACTIVE_STATES,
  'cancelled',
  'preflight_failed',
  'not_on_facebook',
  'draft_published',
  'draft_deleted',
  'published',
  'removed_externally',
] as const

export type ContentReelState = (typeof CONTENT_REEL_STATES)[number]
export type ContentReelActiveState = (typeof CONTENT_REEL_ACTIVE_STATES)[number]

/** Legal (from, to) pairs, identical to public.content_reel_transition_allowed(). */
export const CONTENT_REEL_TRANSITIONS: ReadonlyArray<readonly [ContentReelState, ContentReelState]> = [
  ['authorized', 'claimed'],
  ['authorized', 'cancelled'],
  ['authorized', 'preflight_failed'],
  ['claimed', 'claimed'],
  ['claimed', 'uploading'],
  ['claimed', 'preflight_failed'],
  ['claimed', 'not_on_facebook'],
  ['uploading', 'uploading'],
  ['uploading', 'published'],
  ['uploading', 'draft_published'],
  ['uploading', 'in_doubt'],
  ['in_doubt', 'in_doubt'],
  ['in_doubt', 'published'],
  ['in_doubt', 'draft_published'],
  ['in_doubt', 'not_on_facebook'],
  ['published', 'published'],
  ['published', 'removed_externally'],
  ['published', 'in_doubt'],
  ['draft_published', 'draft_published'],
  ['draft_published', 'draft_deleted'],
  ['not_on_facebook', 'published'],
]

export function isContentReelTransitionAllowed(from: ContentReelState, to: ContentReelState): boolean {
  return CONTENT_REEL_TRANSITIONS.some(([f, t]) => f === from && t === to)
}

/**
 * Keys accepted by content_reel_transition(p_patch). Marker keys (touch_* / mark_* /
 * clear_*) take `true` and are stamped with the database clock — callers can never
 * supply the timestamps that gate absence-based transitions (the row trigger rejects any
 * evidence timestamp that is not exactly now(), even on a direct service_role UPDATE).
 *
 * 🔴 PR-C: evidence columns never accept application time. Do not write them with a JS
 * `new Date()` / ISO string — always go through the marker keys of content_reel_transition.
 */
export const CONTENT_REEL_EVIDENCE_TIMESTAMP_COLUMNS = [
  'last_step_started_at',
  'video_deleted_at',
  'absence_first_confirmed_at',
  'publish_verified_at',
  'first_comment_verified_at',
  'finished_at',
] as const

/** Columns an update may touch in ANY state without going through the transition table. */
export const CONTENT_REEL_BOOKKEEPING_COLUMNS = ['followup', 'trigger_event_ids', 'restart_seq', 'updated_at'] as const

export const CONTENT_REEL_PATCH_VALUE_KEYS = [
  'video_id',
  'video_state',
  'permalink',
  'published_at',
  'publish_confirmation',
  'publish_confirmed_by_user_id',
  'env_live_at_publish',
  'rules_live_at_publish',
  'error_code',
  'error_detail',
  'alert_code',
  'first_comment_state',
  'first_comment_verification_basis',
  'provider_impact',
] as const

export const CONTENT_REEL_PATCH_MARKER_KEYS = [
  'touch_last_step',
  'mark_absence',
  'clear_absence',
  'mark_video_deleted',
  'mark_publish_verified',
  'mark_first_comment_verified',
] as const

export const CONTENT_REEL_FOLLOWUP_KEYS = [
  'books_written',
  'published_event_ids',
  'measurement_registered',
  'draft_delete_results',
  'last_error',
] as const

/** Codes returned as `{ ok: false, code }` (never thrown) by the RPCs. */
export const CONTENT_REEL_RPC_REFUSAL_CODES = [
  // content_reel_video_copy_start / _finish
  'copy_id_reused',
  'post_not_found',
  'copy_not_found',
  'copy_already_finalized',
  // content_reel_authorize
  'authorization_id_reused',
  'post_state_changed',
  'video_copy_mismatch',
  'video_copy_not_ready',
  'video_changed_since_prepare',
  'render_in_progress',
  'active_attempt_exists',
  'post_already_published',
  'duplicate_content_hash',
  // content_reel_transition (soft guard refusals + lock outcome)
  'attempt_not_found',
  'transition_lost',
  'claimed_too_recent',
  'not_on_facebook_requires_deletion',
  'absence_not_confirmed_twice',
  'last_write_too_recent',
  'draft_deleted_requires_deletion',
  // content_reel_transition (unique violations translated)
  'video_id_conflict',
  // content_reel_mark_post_published / abandon_post
  'attempt_not_published',
  'publication_not_verified',
  'drafts_not_deleted',
  // set_content_reel_live_enabled
  'client_not_found',
  'stale',
] as const

export type ContentReelRpcRefusalCode = (typeof CONTENT_REEL_RPC_REFUSAL_CODES)[number]

/**
 * Codes the guard triggers RAISE as `content_reel_guard:<code>` (thrown, not returned).
 * The five soft ones above are caught by content_reel_transition and returned instead;
 * everything else reaches the caller as a Postgres error and means "the caller asked for
 * something the state machine forbids". PR-C must map them, notably `mode_state_mismatch`
 * (a draft request read back as public, or a live request read back as a draft: do NOT
 * retry into published/draft_published — move to in_doubt, spec §3.4 step 8).
 */
export const CONTENT_REEL_GUARD_ERROR_CODES = [
  'absence_not_confirmed_twice',
  'alert_required',
  'attempts_are_append_only',
  'bookkeeping_not_monotonic',
  'claimed_too_recent',
  'copy_already_finalized',
  'copy_insert_must_be_preparing',
  'draft_deleted_requires_deletion',
  'draft_requires_video',
  'evidence_timestamp_db_clock_only',
  'graph_get_requires_verified_at',
  'human_confirmed_requires_confirmer',
  'illegal_transition',
  'immutable_column',
  'insert_must_be_clean_authorized',
  'last_write_too_recent',
  'live_switch_events_are_append_only',
  'live_switch_insert_must_be_false',
  'live_switch_rpc_only',
  'mode_state_mismatch',
  'not_on_facebook_requires_deletion',
  'not_on_facebook_without_video_requires_claimed',
  'only_unverified_human_confirmation_can_reopen',
  'published_receipt_immutable',
  'published_requires_receipt',
  'stale_absence_on_publish',
  'truncate_forbidden',
  'uploading_requires_video_id',
  'video_copies_are_append_only',
  'video_id_immutable',
  'video_id_only_on_upload_start',
] as const

export type ContentReelGuardErrorCode = (typeof CONTENT_REEL_GUARD_ERROR_CODES)[number]

/** Timing floors enforced in SQL (minutes). Spec v2.1 §3.2. */
export const CONTENT_REEL_TIMING_MINUTES = {
  /** start 60s timeout + margin, for a claimed attempt that never got a video_id */
  claimedWithoutVideo: 5,
  /** start 1 + rupload 15 + finish 1 = 17 minutes of bounded Graph writes, + 13 margin */
  lastWriteBeforeAbsence: 30,
  /** minimum age of the first absence evidence before the second one is accepted */
  absenceConfirmationGap: 10,
} as const

/** Same-content re-publish window (PM business window, spec §9, pending confirmation). */
export const CONTENT_REEL_DUPLICATE_HASH_WINDOW_DAYS = 30
