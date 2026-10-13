/**
 * Story auto-publish — gate decisions (pure).
 *
 * This module owns the *decisions* an unattended story publisher must make
 * before it is allowed to touch a provider: whether the feature is live for a
 * client and channel, and whether a single story item may be published right
 * now. It never touches a database, the network, or `process.env` directly —
 * the environment is passed in as a plain object, so every rule here is unit
 * testable without a Supabase stub or a fetch mock.
 *
 * The decision order is fail-closed and first-hit-wins: the first rule that
 * matches produces the result, and anything short of a fully green set of
 * gates yields a non-PUBLISH outcome.
 */
import {
  STORY_ATTEMPT_STATUSES,
  STORY_CHANNELS,
  STORY_TERMINAL_STATUSES,
  type StoryAttemptStatus,
  type StoryAuthorization,
  type AdminEmailSet,
  type StoryChannel,
  type StoryItemSpec,
  type StorySwitches,
} from './types'
import { judgeStoryAuthorization } from './authorization'

// ─── Feature switches ─────────────────────────────────────────────────────────

/**
 * Read the story auto-publish switches from an environment object.
 *
 * `live` is strict on purpose: `'TRUE'`, `'1'`, `' true'` and `'yes'` all leave
 * the feature off. A typo in a deploy config must fail closed, not arm an
 * unattended publisher. Channels are filtered against the known channel list so
 * an unknown value in the config can never widen what may be published.
 */
export function readStorySwitches(env: {
  STORY_AUTO_PUBLISH_LIVE?: string
  STORY_AUTO_PUBLISH_CLIENTS?: string
  STORY_AUTO_PUBLISH_CHANNELS?: string
}): StorySwitches {
  const live = env.STORY_AUTO_PUBLISH_LIVE === 'true'

  const clientIds = splitList(env.STORY_AUTO_PUBLISH_CLIENTS)

  const channels = splitList(env.STORY_AUTO_PUBLISH_CHANNELS).filter(
    (value): value is StoryChannel => (STORY_CHANNELS as readonly string[]).includes(value),
  )

  return { live, clientIds, channels }
}

/** Split a comma list into trimmed, lowercased, non-empty parts. */
function splitList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map(part => part.trim().toLowerCase())
    .filter(part => part.length > 0)
}

/**
 * Whether unattended publishing is enabled for a specific client and channel.
 *
 * All three switches must agree: the global `live` flag, the client's presence
 * in the allow-list, and the channel's presence in the channel list. An empty
 * allow-list therefore disables the feature entirely, even when `live` is true.
 */
export function isStoryLiveFor(
  switches: StorySwitches,
  clientId: string,
  channel: StoryChannel,
): boolean {
  if (!switches.live) return false
  if (!switches.clientIds.includes(clientId.toLowerCase())) return false
  return switches.channels.includes(channel)
}

// ─── Gate input / output ──────────────────────────────────────────────────────

/** Everything the gate decision needs, passed in as plain data. */
export interface StoryGateInput {
  now: Date
  item: StoryItemSpec
  /**
   * Raw authorisation inputs. The gate recomputes the authorisation state
   * itself via `judgeStoryAuthorization`, so a stale cached state can never be
   * passed in.
   */
  auth: {
    authorization: StoryAuthorization | null
    itemAuthorizationId: string | null
    packItems: StoryItemSpec[]
    adminEmails: AdminEmailSet
  }
  switches: StorySwitches
  /** Must be 'active'. */
  clientStatus: string | null
  /** Must be 'active'. */
  campaignStatus: string | null
  /** The account id registered for this client/channel; must match the item. */
  registeredAccountId: string | null
  circuit: { itemPaused: boolean; packChannelPaused: boolean }
  fileCheck: 'OK' | 'CHANGED' | 'UNREACHABLE'
  /**
   * Whether this media file was already published as a post / reel / story.
   * Facebook refuses a Story built from a file used before, so Facebook only
   * passes on 'UNUSED'; a missing record ('UNKNOWN') blocks, it never passes.
   */
  assetUsage: 'UNUSED' | 'USED' | 'UNKNOWN'
  priceGate: 'OK' | 'BLOCKED' | 'ERROR'
  replyOwnerPresent: boolean
  existingAttempt: {
    status: string
    updated_at: string
    next_retry_at: string | null
    retry_count: number
  } | null
  config: {
    maxLateMinutes: number
    earlyMinutes: number
    staleClaimMinutes: number
    stalePublishingMinutes: number
    maxWebsiteAgeDays: number
    maxRetries: number
  }
}

/** What the publisher should do with one story item. */
export type StoryGateDecision =
  | { action: 'PUBLISH' }
  | { action: 'DRY_RUN' }
  | {
      action: 'SKIP'
      reason_code: 'ALREADY_TERMINAL' | 'IN_PROGRESS' | 'NOT_DUE' | 'WAITING_RETRY'
    }
  | { action: 'RECORD'; status: StoryAttemptStatus; reason_code: string; retryable: boolean }

// ─── Small helpers ────────────────────────────────────────────────────────────

/** Build a RECORD decision. */
function record(
  status: StoryAttemptStatus,
  reason_code: string,
  retryable: boolean,
): StoryGateDecision {
  return { action: 'RECORD', status, reason_code, retryable }
}

/** Build a SKIP decision. */
function skip(
  reason_code: 'ALREADY_TERMINAL' | 'IN_PROGRESS' | 'NOT_DUE' | 'WAITING_RETRY',
): StoryGateDecision {
  return { action: 'SKIP', reason_code }
}

/** Parse an ISO instant, returning null when it is missing or unreadable. */
function parseInstant(value: string | null): number | null {
  if (value === null) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

/** The UTC calendar date (YYYY-MM-DD) for an instant. */
function utcDateString(instant: number): string {
  return new Date(instant).toISOString().slice(0, 10)
}

/** Whole days between two YYYY-MM-DD labels (b - a). */
function daysBetween(a: string, b: string): number {
  const from = Date.parse(`${a}T00:00:00.000Z`)
  const to = Date.parse(`${b}T00:00:00.000Z`)
  return Math.round((to - from) / 86_400_000)
}

/** True when a value is a finite number >= 0. */
function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

/** True when a value is a non-negative integer. */
function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0
}

/** True when a string is a real YYYY-MM-DD calendar date (round-trips). */
function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  const built = new Date(Date.UTC(year, month - 1, day))
  return built.toISOString().slice(0, 10) === value
}

/** True when a string is a member of the known attempt statuses. */
function isKnownAttemptStatus(value: string): value is StoryAttemptStatus {
  return (STORY_ATTEMPT_STATUSES as readonly string[]).includes(value)
}

// ─── Rule groups ──────────────────────────────────────────────────────────────

/** Rule (0): the config and clock must be sane before anything else runs. */
function checkConfig(input: StoryGateInput): StoryGateDecision | null {
  const { config, now } = input
  if (Number.isNaN(now.getTime())) return record('BLOCKED', 'BAD_CONFIG', false)

  const numbers = [
    config.maxLateMinutes,
    config.earlyMinutes,
    config.staleClaimMinutes,
    config.stalePublishingMinutes,
    config.maxWebsiteAgeDays,
  ]
  if (!numbers.every(isNonNegativeFinite)) return record('BLOCKED', 'BAD_CONFIG', false)
  if (!isNonNegativeInteger(config.maxRetries)) return record('BLOCKED', 'BAD_CONFIG', false)

  return null
}

/**
 * Rule (a): an existing attempt row may stop re-evaluation.
 *
 * Terminal statuses are final. A `CLAIMED` or `PUBLISHING` row that has gone
 * stale is recorded as an unknown outcome so the item is not retried blindly.
 * A `RETRYABLE` row waits until its retry time, or blocks once retries are
 * exhausted. Any other in-flight status is skipped as in progress. Statuses
 * such as `DRY_RUN`, `BLOCKED` and `SKIPPED_NOT_AUTHORIZED` do not stop
 * re-evaluation.
 */
function checkExistingAttempt(input: StoryGateInput): StoryGateDecision | null {
  const existing = input.existingAttempt
  if (existing === null) return null

  if (!isKnownAttemptStatus(existing.status)) {
    return record('BLOCKED', 'UNKNOWN_EXISTING_STATUS', false)
  }

  if (STORY_TERMINAL_STATUSES.has(existing.status)) return skip('ALREADY_TERMINAL')

  const updated = parseInstant(existing.updated_at)
  const nowMs = input.now.getTime()

  if (existing.status === 'CLAIMED') {
    const staleBefore = nowMs - input.config.staleClaimMinutes * 60_000
    if (updated === null || updated < staleBefore) {
      return record('UNKNOWN_OUTCOME', 'STALE_CLAIM', false)
    }
  }

  if (existing.status === 'PUBLISHING') {
    const staleBefore = nowMs - input.config.stalePublishingMinutes * 60_000
    if (updated === null || updated < staleBefore) {
      return record('UNKNOWN_OUTCOME', 'STALE_PUBLISHING', false)
    }
  }

  if (
    existing.status === 'CLAIMED' ||
    existing.status === 'CONTAINER_CREATED' ||
    existing.status === 'PUBLISHING'
  ) {
    return skip('IN_PROGRESS')
  }

  if (existing.status === 'RETRYABLE') {
    if (!Number.isFinite(existing.retry_count)) return record('BLOCKED', 'RETRY_STATE_INVALID', false)
    if (existing.retry_count >= input.config.maxRetries) {
      return record('BLOCKED', 'FILE_UNREACHABLE', false)
    }
    if (!Number.isFinite(existing.retry_count)) return record('BLOCKED', 'RETRY_STATE_INVALID', false)
    const nextRetry = parseInstant(existing.next_retry_at)
    // a RETRYABLE row must always carry a readable retry time; without one it would wait forever
    if (nextRetry === null) return record('BLOCKED', 'RETRY_STATE_INVALID', false)
    if (nextRetry > nowMs) return skip('WAITING_RETRY')
  }

  return null
}

/**
 * Rule (b): the slot must be due.
 *
 * An unreadable `slot_at` is a data fault, not a timing question, so it is
 * recorded as a permanent block rather than a skip.
 */
function checkDue(input: StoryGateInput): StoryGateDecision | null {
  const slot = parseInstant(input.item.slot_at)
  if (slot === null) return record('BLOCKED', 'BAD_SLOT', false)

  const earliest = slot - input.config.earlyMinutes * 60_000
  if (input.now.getTime() < earliest) return skip('NOT_DUE')

  return null
}

/** Rule (c): the client and campaign must be active. */
function checkContext(input: StoryGateInput): StoryGateDecision | null {
  if (input.clientStatus !== 'active') return record('BLOCKED', 'CLIENT_NOT_ACTIVE', false)
  if (input.campaignStatus !== 'active') return record('BLOCKED', 'CAMPAIGN_NOT_ACTIVE', false)
  return null
}

/** Rule (d): the item must be fully authorised right now. */
function checkAuthorization(input: StoryGateInput): StoryGateDecision | null {
  const authState = judgeStoryAuthorization({
    authorization: input.auth.authorization,
    item: input.item,
    itemAuthorizationId: input.auth.itemAuthorizationId,
    packItems: input.auth.packItems,
    adminEmails: input.auth.adminEmails,
    now: input.now,
  })
  if (authState !== 'ACTIVE') {
    return record('SKIPPED_NOT_AUTHORIZED', authState, false)
  }
  return null
}

/** Rule (k): an item with no fact-library source can never be published. */
function checkSource(input: StoryGateInput): StoryGateDecision | null {
  if (input.item.source_record_ids.length === 0) return record('BLOCKED', 'SOURCE_MISSING', false)
  return null
}

/** Rule (l): the item's account must match the registered account. */
function checkAccount(input: StoryGateInput): StoryGateDecision | null {
  const registered = input.registeredAccountId
  if (registered === null || registered === '' || registered !== input.item.account_id) {
    return record('BLOCKED', 'ACCOUNT_MISMATCH', false)
  }
  return null
}

/** Rule (e): neither the item nor its pack/channel may be paused. */
function checkCircuit(input: StoryGateInput): StoryGateDecision | null {
  if (input.circuit.itemPaused || input.circuit.packChannelPaused) {
    return record('BLOCKED', 'CIRCUIT_PAUSED', false)
  }
  return null
}

/** Rule (f): the slot must not be too far in the past. */
function checkLateness(input: StoryGateInput): StoryGateDecision | null {
  const slot = parseInstant(input.item.slot_at)
  if (slot === null) return null
  const latest = slot + input.config.maxLateMinutes * 60_000
  if (input.now.getTime() > latest) return record('MISSED_WINDOW', 'SLOT_PASSED', false)
  return null
}

/** Rule (g): the media file must still match its recorded hash. */
function checkFile(input: StoryGateInput): StoryGateDecision | null {
  if (input.fileCheck === 'UNREACHABLE') {
    return record('RETRYABLE', 'FILE_UNREACHABLE', true)
  }
  if (input.fileCheck !== 'OK') return record('BLOCKED', 'FILE_CHANGED', false)
  return null
}

/** Rule (g2): Facebook refuses a Story made from an already-published file. */
function checkAssetUsage(input: StoryGateInput): StoryGateDecision | null {
  if (input.item.channel !== 'facebook_story') return null
  if (input.assetUsage === 'UNUSED') return null
  return record('BLOCKED', input.assetUsage === 'USED' ? 'ASSET_ALREADY_USED' : 'ASSET_USAGE_UNKNOWN', false)
}

/**
 * Rule (g3): a price in the picture's text must be declared on the item.
 *
 * BEST EFFORT: this pattern only sees currency symbols, currency codes, "dollar(s)", "per person" and
 * common Chinese currency words in `text_line`. It cannot read prices drawn into the picture itself;
 * the human-declared `contains_price` stays the source of truth (it decides which items a person
 * must open before authorising).
 */
function checkPriceDeclared(input: StoryGateInput): StoryGateDecision | null {
  if (input.item.contains_price) return null
  const pattern = /[$€£¥￥＄]|\b(?:nzd|aud|usd|rmb|cny)\b|\bdollars?\b|\bper person\b|纽币|澳币|美元|人民币|\d\s*(?:元|块)|(?:元|块)\s*\d/i
  if (pattern.test(input.item.text_line)) return record('BLOCKED', 'PRICE_UNDECLARED', false)
  return null
}

/** Rule (h): the price gate must be green. */
function checkPrice(input: StoryGateInput): StoryGateDecision | null {
  if (input.priceGate === 'ERROR') return record('BLOCKED', 'PRICE_GATE_ERROR', true)
  if (input.priceGate !== 'OK') return record('BLOCKED', 'PRICE_GATE_BLOCKED', false)
  return null
}

/**
 * Rule (m): a reply CTA in the text must be declared on the item.
 *
 * BEST EFFORT: this word list is a heuristic safety net (English and Chinese).
 * The real source of truth is the human-declared `has_reply_cta`.
 */
function checkReplyCtaDeclared(input: StoryGateInput): StoryGateDecision | null {
  if (input.item.has_reply_cta) return null
  const pattern = /\b(reply|replies|dm us|message us|inbox|comment below)\b|回复|私信|留言|评论|咨询我们|联系我们/i
  if (pattern.test(input.item.text_line)) {
    return record('BLOCKED', 'REPLY_CTA_UNDECLARED', false)
  }
  return null
}

/** Rule (i): a reply CTA needs someone on duty to answer it. */
function checkReplyOwner(input: StoryGateInput): StoryGateDecision | null {
  if (input.item.has_reply_cta && !input.replyOwnerPresent) {
    return record('BLOCKED', 'NO_REPLY_OWNER', true)
  }
  return null
}

/**
 * Rule (j): the website reference must be https and recently checked.
 *
 * The check date must be a real calendar date (round-tripped, so `2026-13-01`
 * and `2026-02-31` are rejected) and may be at most one day in the future to
 * absorb timezone skew between the checker and this process.
 */
function checkWebsite(input: StoryGateInput): StoryGateDecision | null {
  if (!input.item.website_ref.startsWith('https://')) {
    return record('BLOCKED', 'WEBSITE_CHECK_STALE', true)
  }
  if (!isValidCalendarDate(input.item.website_checked_on)) {
    return record('BLOCKED', 'WEBSITE_CHECK_STALE', true)
  }

  const today = utcDateString(input.now.getTime())
  const ageDays = daysBetween(input.item.website_checked_on, today)
  if (Number.isNaN(ageDays)) return record('BLOCKED', 'WEBSITE_CHECK_STALE', true)
  if (ageDays > input.config.maxWebsiteAgeDays) {
    return record('BLOCKED', 'WEBSITE_CHECK_STALE', true)
  }
  if (ageDays < -1) return record('BLOCKED', 'WEBSITE_CHECK_STALE', true)

  return null
}

// ─── Main decision ────────────────────────────────────────────────────────────

/**
 * Decide what to do with one story item.
 *
 * Rules run in a fixed order and the first hit wins, so the result is
 * deterministic and fail-closed. Only when every gate is green does the
 * function consult the feature switches: live for this client and channel
 * yields PUBLISH, otherwise DRY_RUN.
 */
export function decideStoryPublish(input: StoryGateInput): StoryGateDecision {
  const checks: Array<(input: StoryGateInput) => StoryGateDecision | null> = [
    checkConfig,
    checkExistingAttempt,
    checkDue,
    checkContext,
    checkAuthorization,
    checkSource,
    checkAccount,
    checkCircuit,
    checkLateness,
    checkFile,
    checkAssetUsage,
    checkPriceDeclared,
    checkPrice,
    checkReplyCtaDeclared,
    checkReplyOwner,
    checkWebsite,
  ]

  for (const check of checks) {
    const decision = check(input)
    if (decision !== null) return decision
  }

  return isStoryLiveFor(input.switches, input.item.client_id, input.item.channel)
    ? { action: 'PUBLISH' }
    : { action: 'DRY_RUN' }
}
