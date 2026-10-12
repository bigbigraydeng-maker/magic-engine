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
  STORY_CHANNELS,
  STORY_TERMINAL_STATUSES,
  type StoryAttemptStatus,
  type StoryChannel,
  type StoryItemSpec,
  type StorySwitches,
} from './types'
import type { StoryAuthState } from './authorization'

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
  /** Already computed by judgeStoryAuthorization. */
  authState: StoryAuthState
  switches: StorySwitches
  /** Must be 'active'. */
  clientStatus: string | null
  /** Must be 'active'. */
  campaignStatus: string | null
  circuit: { itemPaused: boolean; packChannelPaused: boolean }
  fileCheck: 'OK' | 'CHANGED' | 'UNREACHABLE'
  priceGate: 'OK' | 'BLOCKED' | 'ERROR'
  replyOwnerPresent: boolean
  existingAttempt: { status: StoryAttemptStatus; updated_at: string } | null
  config: {
    maxLateMinutes: number
    earlyMinutes: number
    staleClaimMinutes: number
    maxWebsiteAgeDays: number
  }
}

/** What the publisher should do with one story item. */
export type StoryGateDecision =
  | { action: 'PUBLISH' }
  | { action: 'DRY_RUN' }
  | { action: 'SKIP'; reason_code: 'ALREADY_TERMINAL' | 'IN_PROGRESS' | 'NOT_DUE' }
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
function skip(reason_code: 'ALREADY_TERMINAL' | 'IN_PROGRESS' | 'NOT_DUE'): StoryGateDecision {
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

// ─── Rule groups ──────────────────────────────────────────────────────────────

/**
 * Rule (a): an existing attempt row may stop re-evaluation.
 *
 * Terminal statuses are final. A `CLAIMED` row that has gone stale is recorded
 * as an unknown outcome so the item is not retried blindly. Any other
 * in-flight status is skipped as in progress. Statuses such as `DRY_RUN`,
 * `BLOCKED` and `SKIPPED_NOT_AUTHORIZED` do not stop re-evaluation.
 */
function checkExistingAttempt(input: StoryGateInput): StoryGateDecision | null {
  const existing = input.existingAttempt
  if (existing === null) return null

  if (STORY_TERMINAL_STATUSES.has(existing.status)) return skip('ALREADY_TERMINAL')

  if (existing.status === 'CLAIMED') {
    const updated = parseInstant(existing.updated_at)
    const staleBefore = input.now.getTime() - input.config.staleClaimMinutes * 60_000
    if (updated === null || updated < staleBefore) {
      return record('UNKNOWN_OUTCOME', 'STALE_CLAIM', false)
    }
  }

  if (
    existing.status === 'CLAIMED' ||
    existing.status === 'CONTAINER_CREATED' ||
    existing.status === 'PUBLISHING'
  ) {
    return skip('IN_PROGRESS')
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

/** Rule (k): an item with no fact-library source can never be published. */
function checkSource(input: StoryGateInput): StoryGateDecision | null {
  if (input.item.source_record_ids.length === 0) return record('BLOCKED', 'SOURCE_MISSING', false)
  return null
}

/** Rule (d): the item must be fully authorised right now. */
function checkAuthorization(input: StoryGateInput): StoryGateDecision | null {
  if (input.authState !== 'ACTIVE') {
    return record('SKIPPED_NOT_AUTHORIZED', input.authState, false)
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
  if (input.fileCheck === 'CHANGED') return record('BLOCKED', 'FILE_CHANGED', false)
  if (input.fileCheck === 'UNREACHABLE') return record('BLOCKED', 'FILE_UNREACHABLE', true)
  return null
}

/** Rule (h): the price gate must be green. */
function checkPrice(input: StoryGateInput): StoryGateDecision | null {
  if (input.priceGate === 'BLOCKED') return record('BLOCKED', 'PRICE_GATE_BLOCKED', false)
  if (input.priceGate === 'ERROR') return record('BLOCKED', 'PRICE_GATE_ERROR', true)
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
 * The check date may be at most one day in the future to absorb timezone skew
 * between the checker and this process.
 */
function checkWebsite(input: StoryGateInput): StoryGateDecision | null {
  if (!input.item.website_ref.startsWith('https://')) {
    return record('BLOCKED', 'WEBSITE_CHECK_STALE', true)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.item.website_checked_on)) {
    return record('BLOCKED', 'WEBSITE_CHECK_STALE', true)
  }

  const today = utcDateString(input.now.getTime())
  const ageDays = daysBetween(input.item.website_checked_on, today)
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
    checkExistingAttempt,
    checkDue,
    checkContext,
    checkAuthorization,
    checkSource,
    checkCircuit,
    checkLateness,
    checkFile,
    checkPrice,
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
