/**
 * Story auto-publish — authorise and revoke services (slice 2b).
 *
 * `authorizeStoryPack` turns a preview into a real grant. The write order is
 * deliberately conservative: the pack is re-evaluated and re-checked against
 * the preview's content hash before anything is written, the grant is inserted
 * inactive, the items are linked, the pack is re-read to confirm nothing moved,
 * and only then is the authorisation event sent and the grant armed. Every
 * failure after the insert rolls the grant back by id and reports whether that
 * rollback itself worked, so a caller can never be left with a half-armed grant
 * it does not know about.
 *
 * `revokeStoryPack` stops anything not yet sent. It never removes a story that
 * was already published — that is a manual action in Facebook / Instagram.
 */
import { computeItemFingerprint, computeManifestHash } from './fingerprint'
import { evaluateStoryPack, type EvaluatedStoryPack } from './evaluate'
import {
  buildStoryPackPreview,
  requireGlobalAdmin,
} from './preview'
import type { StoryActor, StoryPackPreview, StoryServicePorts } from './service-ports'
import type { StoryAttemptView } from './store'
import {
  STORY_EVENTS,
  storyItemKey,
  type StoryAttemptStatus,
  type StoryChannel,
} from './types'

export type AuthorizeOutcome =
  | { mode: 'PREVIEW'; preview: StoryPackPreview }
  | {
      mode: 'AUTHORIZED'
      authorization_id: string
      request_id: string
      expires_at: string
      item_count: number
      provider_impact: 'NONE'
      note: string
    }

/** A failure result for the authorise / revoke services. */
export type AuthorizeFailure = {
  ok: false
  status: number
  error: string
  details?: unknown
  rollback?: 'OK' | 'FAILED'
}

export type AuthorizeResult = ({ ok: true; value: AuthorizeOutcome } | AuthorizeFailure) & {
  rollback?: 'OK' | 'FAILED'
  details?: unknown
}

const DEFAULT_EXPIRES_IN_DAYS = 7
const MIN_EXPIRES_IN_DAYS = 1
const MAX_EXPIRES_IN_DAYS = 14
const UNARMED_GRACE_MS = 5 * 60 * 1000
const MAX_REASON_LENGTH = 300

const AUTHORIZED_NOTE = 'Recorded only. The automatic publisher is not running yet.'

const REVOKE_NOTE =
  'Revoking stops anything not yet sent. Stories already published are NOT removed: delete them by hand in Facebook / Instagram.'

/** Statuses that mean "in flight, not yet sent". */
const IN_FLIGHT_STATUSES: ReadonlySet<StoryAttemptStatus> = new Set([
  'CLAIMED',
  'RETRYABLE',
  'CONTAINER_CREATED',
  'PUBLISHING',
  'UNKNOWN_OUTCOME',
])

/** Statuses that mean "already sent". */
const ALREADY_SENT_STATUSES: ReadonlySet<StoryAttemptStatus> = new Set([
  'PUBLISHED_UNVERIFIED',
  'PUBLISHED',
])

const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/

/** Validate the requested lifetime; returns the day count or null when invalid. */
function resolveExpiresInDays(value: number | undefined): number | null {
  const days = value ?? DEFAULT_EXPIRES_IN_DAYS
  if (
    !Number.isInteger(days) ||
    days < MIN_EXPIRES_IN_DAYS ||
    days > MAX_EXPIRES_IN_DAYS
  ) {
    return null
  }
  return days
}

/** The items that must be opened but were not, as `{ item_id, channel }` pairs. */
function unopenedItems(preview: StoryPackPreview): Array<{ item_id: string; channel: StoryChannel }> {
  return preview.items
    .filter((item) => item.requires_open && !item.opened_by_me)
    .map((item) => ({ item_id: item.item_id, channel: item.channel }))
}

/** Per-item problem lists, only for items that actually have problems. */
function problemDetails(
  preview: StoryPackPreview,
): Array<{ item_id: string; channel: StoryChannel; problems: string[] }> {
  return preview.items
    .filter((item) => item.problems.length > 0)
    .map((item) => ({ item_id: item.item_id, channel: item.channel, problems: [...item.problems] }))
}

/** True when the grant may be replaced: expired, or never armed and old enough. */
function isSupersedable(
  live: { expires_at: string; activated_at: string | null; authorized_at: string },
  now: Date,
): boolean {
  const expiresMs = Date.parse(live.expires_at)
  if (Number.isNaN(expiresMs) || expiresMs <= now.getTime()) return true
  if (live.activated_at !== null) return false
  const authorizedMs = Date.parse(live.authorized_at)
  if (Number.isNaN(authorizedMs)) return true
  return now.getTime() - authorizedMs > UNARMED_GRACE_MS
}

/** Revoke a grant we just created; reports whether the rollback itself worked. */
async function rollbackGrant(input: {
  ports: StoryServicePorts
  authId: string
  packId: string
  clientId: string
  now: Date
}): Promise<'OK' | 'FAILED'> {
  const { ports, authId, packId, clientId, now } = input
  try {
    const revoked = await ports.store.revokeAuthorization({
      authId,
      packId,
      clientId,
      byEmail: 'system:authorize-failed',
      reason: 'authorisation failed after insert',
      now,
    })
    return revoked === null ? 'FAILED' : 'OK'
  } catch {
    return 'FAILED'
  }
}

/** Best-effort event: a failure here never changes the outcome of the caller. */
async function sendEventQuietly(
  ports: StoryServicePorts,
  event: { id: string; name: string; data: Record<string, unknown> },
): Promise<void> {
  try {
    await ports.sendEvent(event)
  } catch {
    console.error('[story-authorize] event not sent', event.name)
  }
}

/** Supersede a stale live grant, or report that it still blocks a new one. */
async function supersedeIfStale(input: {
  ports: StoryServicePorts
  live: { id: string; expires_at: string; activated_at: string | null; authorized_at: string }
  packId: string
  clientId: string
  now: Date
}): Promise<{ ok: true } | { ok: false }> {
  const { ports, live, packId, clientId, now } = input
  if (!isSupersedable(live, now)) return { ok: false }

  const revoked = await ports.store.revokeAuthorization({
    authId: live.id,
    packId,
    clientId,
    byEmail: 'system:superseded',
    reason: 'superseded by a new authorisation',
    now,
  })
  if (revoked === null) return { ok: false }

  await sendEventQuietly(ports, {
    id: `${live.id}:superseded`,
    name: STORY_EVENTS.packRevoked,
    data: {
      client_id: clientId,
      pack_id: packId,
      authorization_id: live.id,
      authorization: 'REVOKED',
      provider_impact: 'NONE',
    },
  })
  return { ok: true }
}

/** Re-read the pack and confirm nothing changed since it was evaluated. */
async function verifyUnchanged(input: {
  ports: StoryServicePorts
  packId: string
  clientId: string
  expiresAt: string
  approvedFingerprints: Record<string, string>
  manifestHash: string
}): Promise<boolean> {
  const { ports, packId, clientId, expiresAt, approvedFingerprints, manifestHash } = input
  const items = await ports.store.getPackItems(packId, clientId)

  const keys = Object.keys(approvedFingerprints)
  if (keys.length !== items.length) return false

  for (const item of items) {
    const key = storyItemKey(item)
    const approved = approvedFingerprints[key]
    if (approved === undefined) return false
    if (computeItemFingerprint(item, expiresAt) !== approved) return false
  }

  return computeManifestHash(items, expiresAt) === manifestHash
}

/** The three checks the preview and the fresh evaluation must both pass. */
function checkEvaluated(
  evaluated: EvaluatedStoryPack,
  expectedContentHash: string,
): { ok: true; value: true } | AuthorizeFailure {
  if (evaluated.contentHash !== expectedContentHash) {
    return { ok: false, status: 409, error: 'PACK_CHANGED_SINCE_PREVIEW' }
  }

  const unopened = evaluated.items.filter((entry) => entry.requiresOpen && !entry.openedByActor)
  if (unopened.length > 0) {
    return {
      ok: false,
      status: 409,
      error: 'ITEMS_NOT_OPENED',
      details: unopened.map((entry) => ({ item_id: entry.item.item_id, channel: entry.item.channel })),
    }
  }

  const withProblems = evaluated.items.filter((entry) => entry.problems.length > 0)
  if (withProblems.length > 0) {
    return {
      ok: false,
      status: 422,
      error: 'PACK_NOT_AUTHORIZABLE',
      details: withProblems.map((entry) => ({
        item_id: entry.item.item_id,
        channel: entry.item.channel,
        problems: [...entry.problems],
      })),
    }
  }

  return { ok: true, value: true }
}

/** The three checks the preview itself must pass before we go any further. */
function checkPreview(preview: StoryPackPreview): { ok: true; value: true } | AuthorizeFailure {
  if (preview.blocking.includes('ITEMS_NOT_OPENED')) {
    return { ok: false, status: 409, error: 'ITEMS_NOT_OPENED', details: unopenedItems(preview) }
  }
  if (preview.blocking.length > 0) {
    return { ok: false, status: 422, error: 'PACK_NOT_AUTHORIZABLE', details: problemDetails(preview) }
  }
  return { ok: true, value: true }
}

/** Validate the caller-supplied content hash against the preview. */
function checkContentHash(
  expected: string | undefined,
  preview: StoryPackPreview,
): { ok: true; value: true } | AuthorizeFailure {
  if (typeof expected !== 'string' || !CONTENT_HASH_PATTERN.test(expected)) {
    return { ok: false, status: 400, error: 'CONTENT_HASH_REQUIRED' }
  }
  if (expected !== preview.content_hash) {
    return { ok: false, status: 409, error: 'PACK_CHANGED_SINCE_PREVIEW' }
  }
  return { ok: true, value: true }
}

/** Link the items to the grant, rolling the grant back on failure. */
async function linkItemsOrRollback(input: {
  ports: StoryServicePorts
  authId: string
  packId: string
  clientId: string
  items: Array<{ item_id: string; channel: StoryChannel }>
  now: Date
}): Promise<{ ok: true } | AuthorizeFailure> {
  const { ports, authId, packId, clientId, items, now } = input
  try {
    await ports.store.linkItemsToAuthorization({ authId, packId, clientId, items })
    return { ok: true }
  } catch {
    const rollback = await rollbackGrant({ ports, authId, packId, clientId, now })
    return { ok: false, status: 500, error: 'ITEMS_NOT_LINKED', rollback }
  }
}

/** Re-read the pack and confirm nothing moved, rolling the grant back on failure. */
async function verifyOrRollback(input: {
  ports: StoryServicePorts
  authId: string
  packId: string
  clientId: string
  expiresAt: string
  approvedFingerprints: Record<string, string>
  manifestHash: string
  now: Date
}): Promise<{ ok: true } | AuthorizeFailure> {
  const { ports, authId, packId, clientId, expiresAt, approvedFingerprints, manifestHash, now } = input
  const unchanged = await verifyUnchanged({
    ports,
    packId,
    clientId,
    expiresAt,
    approvedFingerprints,
    manifestHash,
  })
  if (unchanged) return { ok: true }
  const rollback = await rollbackGrant({ ports, authId, packId, clientId, now })
  return { ok: false, status: 409, error: 'PACK_CHANGED_DURING_AUTHORIZATION', rollback }
}

/** Send the packAuthorized event, rolling the grant back on failure. */
async function sendAuthorizedEventOrRollback(input: {
  ports: StoryServicePorts
  authId: string
  requestId: string
  packId: string
  clientId: string
  actor: StoryActor
  expiresAt: string
  itemCount: number
  now: Date
}): Promise<{ ok: true } | AuthorizeFailure> {
  const { ports, authId, requestId, packId, clientId, actor, expiresAt, itemCount, now } = input
  try {
    await ports.sendEvent({
      id: requestId,
      name: STORY_EVENTS.packAuthorized,
      data: {
        request_id: requestId,
        client_id: clientId,
        pack_id: packId,
        item_count: itemCount,
        expires_at: expiresAt,
        authorized_by_email: actor.email.trim().toLowerCase(),
        authorized_by_user_id: actor.id,
        authorization: 'AUTHORIZED',
        provider_impact: 'NONE',
        mode: 'DRY_RUN',
        created_at: now.toISOString(),
      },
    })
    return { ok: true }
  } catch {
    const rollback = await rollbackGrant({ ports, authId, packId, clientId, now })
    return { ok: false, status: 500, error: 'AUTHORIZATION_EVENT_NOT_SENT', rollback }
  }
}

/** Arm the grant; on failure roll back and send the best-effort packRevoked event. */
async function activateOrRollback(input: {
  ports: StoryServicePorts
  authId: string
  packId: string
  clientId: string
  now: Date
}): Promise<{ ok: true } | AuthorizeFailure> {
  const { ports, authId, packId, clientId, now } = input
  let activated: unknown
  try {
    activated = await ports.store.activateAuthorization(authId, clientId)
  } catch {
    const rollback = await rollbackGrant({ ports, authId, packId, clientId, now })
    await announceRollback(ports, authId, packId, clientId)
    return { ok: false, status: 500, error: 'AUTHORIZATION_NOT_ACTIVATED', rollback }
  }
  if (activated === null) {
    // someone revoked it between the event and the arming: downstream already heard "authorised"
    await announceRollback(ports, authId, packId, clientId)
    return { ok: false, status: 409, error: 'AUTHORIZATION_REVOKED_DURING_ARMING', rollback: 'OK' }
  }
  return { ok: true }
}

/** Tell downstream that a grant whose "authorised" event already went out no longer stands. */
async function announceRollback(ports: StoryServicePorts, authId: string, packId: string, clientId: string): Promise<void> {
  await sendEventQuietly(ports, {
    id: `${authId}:rollback`,
    name: STORY_EVENTS.packRevoked,
    data: {
      client_id: clientId,
      pack_id: packId,
      authorization_id: authId,
      authorization: 'REVOKED',
      provider_impact: 'NONE',
    },
  })
}

/** Insert the inactive grant, or report that one already exists. */
async function insertGrant(input: {
  ports: StoryServicePorts
  requestId: string
  packId: string
  clientId: string
  actor: StoryActor
  evaluated: EvaluatedStoryPack
  now: Date
}): Promise<{ ok: true; value: string } | AuthorizeFailure> {
  const { ports, requestId, packId, clientId, actor, evaluated, now } = input
  const inserted = await ports.store.insertAuthorization({
    request_id: requestId,
    pack_id: packId,
    client_id: clientId,
    authorized_by_email: actor.email.trim().toLowerCase(),
    authorized_by_user_id: actor.id,
    authorized_at: now.toISOString(),
    expires_at: evaluated.expiresAt,
    manifest_hash: evaluated.manifestHash,
    approved_item_fingerprints: evaluated.approvedFingerprints,
  })
  if (!inserted.ok) {
    return { ok: false, status: 409, error: 'ALREADY_AUTHORIZED' }
  }
  return { ok: true, value: inserted.authorization.id }
}

/** Supersede a stale live grant, or report that it still blocks a new one. */
async function clearLiveGrant(input: {
  ports: StoryServicePorts
  packId: string
  clientId: string
  now: Date
}): Promise<{ ok: true; value: true } | AuthorizeFailure> {
  const { ports, packId, clientId, now } = input
  const live = await ports.store.getLiveAuthorization(packId, clientId)
  if (live === null) return { ok: true, value: true }

  const superseded = await supersedeIfStale({ ports, live, packId, clientId, now })
  if (!superseded.ok) {
    return {
      ok: false,
      status: 409,
      error: 'ALREADY_AUTHORIZED',
      details: { hint: 'revoke the current authorisation first', authorization_id: live.id },
    }
  }
  return { ok: true, value: true }
}

/** Admin, expiry, preview and confirm checks; returns the preview or a failure. */
async function confirmChecks(input: {
  ports: StoryServicePorts
  packId: string
  clientId: string
  actor: StoryActor
  confirm: boolean
  expiresInDays: number | undefined
  expectedContentHash: string | undefined
  now: Date
}): Promise<{ ok: true; value: StoryPackPreview } | AuthorizeFailure> {
  const { ports, packId, clientId, actor, confirm, expiresInDays, expectedContentHash, now } = input

  const admin = requireGlobalAdmin(ports, actor)
  if (!admin.ok) return admin

  const days = resolveExpiresInDays(expiresInDays)
  if (days === null) return { ok: false, status: 400, error: 'BAD_EXPIRY' }

  const previewResult = await buildStoryPackPreview({ ports, packId, clientId, actor, now, expiresInDays: days })
  if (!previewResult.ok) return previewResult
  const preview = previewResult.value

  if (confirm !== true) return { ok: true, value: preview }

  const hashCheck = checkContentHash(expectedContentHash, preview)
  if (!hashCheck.ok) return hashCheck

  const previewCheck = checkPreview(preview)
  if (!previewCheck.ok) return previewCheck

  return { ok: true, value: preview }
}

/** Insert, link, verify, send the event, then arm — rolling back on any failure. */
/** The pack-wide items of an evaluation as `{ item_id, channel }` pairs. */
function itemKeys(evaluated: EvaluatedStoryPack): Array<{ item_id: string; channel: StoryChannel }> {
  return evaluated.items.map((entry) => ({ item_id: entry.item.item_id, channel: entry.item.channel }))
}

/**
 * Write order: insert (inactive) -> link items -> verify unchanged -> send the authorised event -> activate.
 * Each step after the insert rolls the grant back on failure.
 */
async function armInOrder(input: {
  ports: StoryServicePorts
  authId: string
  requestId: string
  packId: string
  clientId: string
  actor: StoryActor
  evaluated: EvaluatedStoryPack
  now: Date
}): Promise<{ ok: true } | AuthorizeFailure> {
  const { ports, authId, requestId, packId, clientId, actor, evaluated, now } = input
  const items = itemKeys(evaluated)

  const linked = await linkItemsOrRollback({ ports, authId, packId, clientId, items, now })
  if (!linked.ok) return linked

  const { expiresAt, approvedFingerprints, manifestHash } = evaluated
  const verified = await verifyOrRollback({
    ports, authId, packId, clientId, expiresAt, approvedFingerprints, manifestHash, now,
  })
  if (!verified.ok) return verified

  const sent = await sendAuthorizedEventOrRollback({
    ports, authId, requestId, packId, clientId, actor, expiresAt, itemCount: items.length, now,
  })
  if (!sent.ok) return sent

  return activateOrRollback({ ports, authId, packId, clientId, now })
}

async function writeGrant(input: {
  ports: StoryServicePorts
  packId: string
  clientId: string
  actor: StoryActor
  evaluated: EvaluatedStoryPack
  now: Date
}): Promise<{ ok: true; value: AuthorizeOutcome } | AuthorizeFailure> {
  const { ports, packId, clientId, actor, evaluated, now } = input

  const cleared = await clearLiveGrant({ ports, packId, clientId, now })
  if (!cleared.ok) return cleared

  const requestId = ports.newId()
  const inserted = await insertGrant({ ports, requestId, packId, clientId, actor, evaluated, now })
  if (!inserted.ok) return inserted
  const authId = inserted.value

  const armed = await armInOrder({ ports, authId, requestId, packId, clientId, actor, evaluated, now })
  if (!armed.ok) return armed

  return {
    ok: true,
    value: {
      mode: 'AUTHORIZED',
      authorization_id: authId,
      request_id: requestId,
      expires_at: evaluated.expiresAt,
      item_count: evaluated.items.length,
      provider_impact: 'NONE',
      note: AUTHORIZED_NOTE,
    },
  }
}

export async function authorizeStoryPack(input: {
  ports: StoryServicePorts
  packId: string
  clientId: string
  actor: StoryActor
  confirm: boolean
  expiresInDays?: number
  expectedContentHash?: string
  now: Date
}): Promise<AuthorizeResult> {
  const { ports, packId, clientId, actor, confirm, now } = input

  const checked = await confirmChecks({
    ports,
    packId,
    clientId,
    actor,
    confirm,
    expiresInDays: input.expiresInDays,
    expectedContentHash: input.expectedContentHash,
    now,
  })
  if (!checked.ok) return checked

  if (confirm !== true) {
    return { ok: true, value: { mode: 'PREVIEW', preview: checked.value } }
  }

  const expiresInDays = resolveExpiresInDays(input.expiresInDays)
  if (expiresInDays === null) {
    return { ok: false, status: 400, error: 'BAD_EXPIRY' }
  }

  const evaluated = await evaluateStoryPack({ ports, packId, clientId, actor, now, expiresInDays })

  const evaluatedCheck = checkEvaluated(evaluated, checked.value.content_hash)
  if (!evaluatedCheck.ok) return evaluatedCheck

  return writeGrant({ ports, packId, clientId, actor, evaluated, now })
}

/** Attempts still in flight for a pack (nothing terminal, nothing sent). */
function inFlightAttempts(attempts: StoryAttemptView[]): Array<{
  item_id: string
  channel: StoryChannel
  status: StoryAttemptStatus
}> {
  return attempts
    .filter((attempt) => IN_FLIGHT_STATUSES.has(attempt.status))
    .map((attempt) => ({
      item_id: attempt.item_id,
      channel: attempt.channel,
      status: attempt.status,
    }))
}

/** Attempts already sent for a pack. */
function alreadySentAttempts(attempts: StoryAttemptView[]): Array<{
  item_id: string
  channel: StoryChannel
  status: StoryAttemptStatus
}> {
  return attempts
    .filter((attempt) => ALREADY_SENT_STATUSES.has(attempt.status))
    .map((attempt) => ({
      item_id: attempt.item_id,
      channel: attempt.channel,
      status: attempt.status,
    }))
}

/** Read the attempts after a successful revoke; a failure here never fails the revoke. */
async function readAttempts(
  ports: StoryServicePorts,
  packId: string,
): Promise<{ attempts: StoryAttemptView[]; known: boolean }> {
  try {
    const attempts = await ports.store.listAttempts(packId)
    return { attempts, known: true }
  } catch {
    return { attempts: [], known: false }
  }
}

/** Validate the revoke reason; returns the trimmed reason or a failure. */
function readRevokeInput(reason: string): { ok: true; value: string } | AuthorizeFailure {
  const trimmed = reason.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_REASON_LENGTH) {
    return { ok: false, status: 400, error: 'BAD_REASON' }
  }
  return { ok: true, value: trimmed }
}

/** Read the attempts and build the revoke summary. */
async function summariseAttempts(
  ports: StoryServicePorts,
  packId: string,
): Promise<{
  in_flight: Array<{ item_id: string; channel: StoryChannel; status: StoryAttemptStatus }>
  already_sent: Array<{ item_id: string; channel: StoryChannel; status: StoryAttemptStatus }>
  attempts_known: boolean
}> {
  const { attempts, known } = await readAttempts(ports, packId)
  return {
    in_flight: known ? inFlightAttempts(attempts) : [],
    already_sent: known ? alreadySentAttempts(attempts) : [],
    attempts_known: known,
  }
}

/** What a revoke reports back. */
export interface RevokeOutcome {
  authorization_id: string
  in_flight: Array<{ item_id: string; channel: StoryChannel; status: StoryAttemptStatus }>
  already_sent: Array<{ item_id: string; channel: StoryChannel; status: StoryAttemptStatus }>
  attempts_known: boolean
  note: string
}

/** Revoke the live grant of a pack and announce it; 404 when there is nothing live to revoke. */
async function revokeLiveGrant(input: {
  ports: StoryServicePorts
  packId: string
  clientId: string
  actor: StoryActor
  reason: string
  now: Date
}): Promise<{ ok: true; value: string } | AuthorizeFailure> {
  const { ports, packId, clientId, actor, reason, now } = input
  const live = await ports.store.getLiveAuthorization(packId, clientId)
  if (live === null) return { ok: false, status: 404, error: 'NOTHING_TO_REVOKE' }

  const byEmail = actor.email.trim().toLowerCase()
  const revoked = await ports.store.revokeAuthorization({ authId: live.id, packId, clientId, byEmail, reason, now })
  if (revoked === null) return { ok: false, status: 404, error: 'NOTHING_TO_REVOKE' }

  await sendEventQuietly(ports, {
    id: `${live.id}:revoked`,
    name: STORY_EVENTS.packRevoked,
    data: {
      client_id: clientId,
      pack_id: packId,
      authorization_id: live.id,
      revoked_by_email: byEmail,
      reason,
      authorization: 'REVOKED',
      provider_impact: 'NONE',
    },
  })
  return { ok: true, value: live.id }
}

export async function revokeStoryPack(input: {
  ports: StoryServicePorts
  packId: string
  clientId: string
  actor: StoryActor
  reason: string
  now: Date
}): Promise<{ ok: true; value: RevokeOutcome } | AuthorizeFailure> {
  const { ports, packId, clientId, actor, now } = input

  const admin = requireGlobalAdmin(ports, actor)
  if (!admin.ok) return admin

  const reasonCheck = readRevokeInput(input.reason)
  if (!reasonCheck.ok) return reasonCheck

  const revoked = await revokeLiveGrant({ ports, packId, clientId, actor, reason: reasonCheck.value, now })
  if (!revoked.ok) return revoked

  const summary = await summariseAttempts(ports, packId)
  return {
    ok: true,
    value: {
      authorization_id: revoked.value,
      in_flight: summary.in_flight,
      already_sent: summary.already_sent,
      attempts_known: summary.attempts_known,
      note: REVOKE_NOTE,
    },
  }
}
