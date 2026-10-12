/**
 * Story auto-publish — authorise and revoke services (slice 2b).
 *
 * `authorizeStoryPack` turns a preview into a real grant: it re-evaluates the
 * pack, supersedes a stale grant when allowed, inserts the grant, sends the
 * authorisation event, arms it and links the items. Every step after the insert
 * is guarded: a failure revokes the grant it just created and reports whether
 * that rollback succeeded, so a caller can never be left with a half-armed
 * grant it does not know about.
 *
 * `revokeStoryPack` stops anything not yet sent. It never removes a story that
 * was already published — that is a manual action in Facebook / Instagram.
 */
import { computeItemFingerprint, computeManifestHash } from './fingerprint'
import { evaluateStoryPack } from './evaluate'
import {
  buildStoryPackPreview,
  requireGlobalAdmin,
  type StoryServiceResult,
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
    }

export type AuthorizeResult = StoryServiceResult<AuthorizeOutcome> & {
  rollback?: 'OK' | 'FAILED'
  details?: unknown
}

const DEFAULT_EXPIRES_IN_DAYS = 7
const MIN_EXPIRES_IN_DAYS = 1
const MAX_EXPIRES_IN_DAYS = 14
const UNARMED_GRACE_MS = 5 * 60 * 1000
const MAX_REASON_LENGTH = 300

const IN_FLIGHT_STATUSES: ReadonlySet<StoryAttemptStatus> = new Set([
  'CLAIMED',
  'RETRYABLE',
  'CONTAINER_CREATED',
  'PUBLISHING',
  'PUBLISHED_UNVERIFIED',
  'UNKNOWN_OUTCOME',
])

const REVOKE_NOTE =
  'Revoking stops anything not yet sent. Stories already published are NOT removed: delete them by hand in Facebook / Instagram.'

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
    // Intentionally swallowed: the event is a notification, not the source of truth.
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

  await ports.store.revokeAuthorization({
    authId: live.id,
    packId,
    clientId,
    byEmail: 'system:superseded',
    reason: 'superseded by a new authorisation',
    now,
  })
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

/** Send the authorisation event, arm the grant and link the items. */
async function armGrant(input: {
  ports: StoryServicePorts
  authId: string
  requestId: string
  packId: string
  clientId: string
  actor: StoryActor
  expiresAt: string
  itemCount: number
  items: Array<{ item_id: string; channel: StoryChannel }>
  now: Date
}): Promise<{ ok: true } | { ok: false; status: number; error: string; rollback: 'OK' | 'FAILED' }> {
  const { ports, authId, requestId, packId, clientId, actor, expiresAt, itemCount, items, now } = input

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
  } catch {
    const rollback = await rollbackGrant({ ports, authId, packId, clientId, now })
    return { ok: false, status: 500, error: 'AUTHORIZATION_EVENT_NOT_SENT', rollback }
  }

  let activated: unknown
  try {
    activated = await ports.store.activateAuthorization(authId, clientId)
  } catch {
    const rollback = await rollbackGrant({ ports, authId, packId, clientId, now })
    return { ok: false, status: 500, error: 'AUTHORIZATION_NOT_ACTIVATED', rollback }
  }
  if (activated === null) {
    return { ok: false, status: 409, error: 'AUTHORIZATION_REVOKED_DURING_ARMING', rollback: 'OK' }
  }

  try {
    await ports.store.linkItemsToAuthorization({ authId, items })
  } catch {
    const rollback = await rollbackGrant({ ports, authId, packId, clientId, now })
    return { ok: false, status: 500, error: 'ITEMS_NOT_LINKED', rollback }
  }

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

export async function authorizeStoryPack(input: {
  ports: StoryServicePorts
  packId: string
  clientId: string
  actor: StoryActor
  confirm: boolean
  expiresInDays?: number
  now: Date
}): Promise<AuthorizeResult> {
  const { ports, packId, clientId, actor, confirm, now } = input

  const admin = requireGlobalAdmin(ports, actor)
  if (!admin.ok) return admin

  const expiresInDays = resolveExpiresInDays(input.expiresInDays)
  if (expiresInDays === null) {
    return { ok: false, status: 400, error: 'BAD_EXPIRY' }
  }

  const previewResult = await buildStoryPackPreview({
    ports,
    packId,
    clientId,
    actor,
    now,
    expiresInDays,
  })
  if (!previewResult.ok) return previewResult
  const preview = previewResult.value

  if (confirm !== true) {
    return { ok: true, value: { mode: 'PREVIEW', preview } }
  }

  if (preview.blocking.includes('ITEMS_NOT_OPENED')) {
    return {
      ok: false,
      status: 409,
      error: 'ITEMS_NOT_OPENED',
      details: unopenedItems(preview),
    }
  }
  if (preview.blocking.length > 0) {
    return {
      ok: false,
      status: 422,
      error: 'PACK_NOT_AUTHORIZABLE',
      details: problemDetails(preview),
    }
  }

  const evaluated = await evaluateStoryPack({
    ports,
    packId,
    clientId,
    actor,
    now,
    expiresInDays,
  })

  // The pack is read again for the write; whatever it shows NOW must pass the same checks the
  // preview did (an edit between the two reads must not be approved on the strength of an old look).
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

  const live = await ports.store.getLiveAuthorization(packId, clientId)
  if (live !== null) {
    const superseded = await supersedeIfStale({ ports, live, packId, clientId, now })
    if (!superseded.ok) {
      return {
        ok: false,
        status: 409,
        error: 'ALREADY_AUTHORIZED',
        details: { hint: 'revoke the current authorisation first', authorization_id: live.id },
      }
    }
  }

  const requestId = ports.newId()
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

  const authId = inserted.authorization.id
  const items = evaluated.items.map((entry) => ({
    item_id: entry.item.item_id,
    channel: entry.item.channel,
  }))

  const armed = await armGrant({
    ports,
    authId,
    requestId,
    packId,
    clientId,
    actor,
    expiresAt: evaluated.expiresAt,
    itemCount: items.length,
    items,
    now,
  })
  if (!armed.ok) {
    return { ok: false, status: armed.status, error: armed.error, rollback: armed.rollback }
  }

  const unchanged = await verifyUnchanged({
    ports,
    packId,
    clientId,
    expiresAt: evaluated.expiresAt,
    approvedFingerprints: evaluated.approvedFingerprints,
    manifestHash: evaluated.manifestHash,
  })
  if (!unchanged) {
    const rollback = await rollbackGrant({ ports, authId, packId, clientId, now })
    return {
      ok: false,
      status: 409,
      error: 'PACK_CHANGED_DURING_AUTHORIZATION',
      rollback,
    }
  }

  return {
    ok: true,
    value: {
      mode: 'AUTHORIZED',
      authorization_id: authId,
      request_id: requestId,
      expires_at: evaluated.expiresAt,
      item_count: items.length,
      provider_impact: 'NONE',
    },
  }
}

/** Attempts that are still in flight for a pack (nothing terminal, nothing sent). */
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

export async function revokeStoryPack(input: {
  ports: StoryServicePorts
  packId: string
  clientId: string
  actor: StoryActor
  reason: string
  now: Date
}): Promise<
  StoryServiceResult<{
    authorization_id: string
    in_flight: Array<{ item_id: string; channel: StoryChannel; status: StoryAttemptStatus }>
    note: string
  }>
> {
  const { ports, packId, clientId, actor, now } = input

  const admin = requireGlobalAdmin(ports, actor)
  if (!admin.ok) return admin

  const reason = input.reason.trim()
  if (reason.length === 0 || reason.length > MAX_REASON_LENGTH) {
    return { ok: false, status: 400, error: 'BAD_REASON' }
  }

  const live = await ports.store.getLiveAuthorization(packId, clientId)
  if (live === null) {
    return { ok: false, status: 404, error: 'NOTHING_TO_REVOKE' }
  }

  const revoked = await ports.store.revokeAuthorization({
    authId: live.id,
    packId,
    clientId,
    byEmail: actor.email.trim().toLowerCase(),
    reason,
    now,
  })
  if (revoked === null) {
    return { ok: false, status: 404, error: 'NOTHING_TO_REVOKE' }
  }

  await sendEventQuietly(ports, {
    id: `${live.id}:revoked`,
    name: STORY_EVENTS.packRevoked,
    data: {
      client_id: clientId,
      pack_id: packId,
      authorization_id: live.id,
      revoked_by_email: actor.email.trim().toLowerCase(),
      reason,
      authorization: 'REVOKED',
      provider_impact: 'NONE',
    },
  })

  const attempts = await ports.store.listAttempts(packId)

  return {
    ok: true,
    value: {
      authorization_id: live.id,
      in_flight: inFlightAttempts(attempts),
      note: REVOKE_NOTE,
    },
  }
}
