/**
 * Story auto-publish — preview and open-record services (slice 2b).
 *
 * Read-only preview of a pack plus the "I opened this item" evidence. Both
 * entry points are restricted to global administrators. The preview never
 * writes; the open record is the only write and the fingerprint is always
 * computed on the server, never trusted from the caller.
 */
import { computeContentFingerprint } from './fingerprint'
import { evaluateStoryPack, type EvaluatedStoryItem } from './evaluate'
import type {
  StoryActor,
  StoryPackPreview,
  StoryPreviewItem,
  StoryServicePorts,
} from './service-ports'
import type { StoryChannel } from './types'

export type StoryServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string }

const DEFAULT_EXPIRES_IN_DAYS = 7
const MIN_EXPIRES_IN_DAYS = 1
const MAX_EXPIRES_IN_DAYS = 14

/** Only a global administrator (exact admin email, account not limited to one client) may act. */
export function requireGlobalAdmin(
  ports: Pick<StoryServicePorts, 'adminEmails'>,
  actor: StoryActor,
): StoryServiceResult<true> {
  const email = actor.email.trim().toLowerCase()
  if (actor.allowedClientId !== null || !ports.adminEmails.has(email)) {
    return { ok: false, status: 403, error: 'GLOBAL_ADMIN_REQUIRED' }
  }
  return { ok: true, value: true }
}

/** Map one evaluated item to the shape the preview shows. */
function toPreviewItem(evaluated: EvaluatedStoryItem): StoryPreviewItem {
  const { item } = evaluated
  return {
    item_id: item.item_id,
    channel: item.channel,
    slot_at: item.slot_at,
    media_kind: item.media_kind,
    media_url: item.media_url,
    text_line: item.text_line,
    website_ref: item.website_ref,
    website_checked_on: item.website_checked_on,
    contains_price: item.contains_price,
    names_place: item.names_place,
    has_reply_cta: item.has_reply_cta,
    requires_open: evaluated.requiresOpen,
    opened_by_me: evaluated.openedByActor,
    problems: [...evaluated.problems],
    already_attempted: evaluated.alreadyAttempted,
  }
}

/** Unique problem codes across every item, in first-seen order. */
function collectBlocking(items: StoryPreviewItem[]): string[] {
  const blocking: string[] = []
  const seen = new Set<string>()
  for (const item of items) {
    for (const code of item.problems) {
      if (!seen.has(code)) {
        seen.add(code)
        blocking.push(code)
      }
    }
  }
  const someUnopened = items.some((item) => item.requires_open && !item.opened_by_me)
  if (someUnopened) blocking.push('ITEMS_NOT_OPENED')
  return blocking
}

/** Validate the requested expiry window; returns the day count or an error result. */
function validateExpiry(
  raw: number | undefined,
): StoryServiceResult<number> {
  const expiresInDays = raw ?? DEFAULT_EXPIRES_IN_DAYS
  if (
    !Number.isInteger(expiresInDays) ||
    expiresInDays < MIN_EXPIRES_IN_DAYS ||
    expiresInDays > MAX_EXPIRES_IN_DAYS
  ) {
    return { ok: false, status: 400, error: 'BAD_EXPIRY' }
  }
  return { ok: true, value: expiresInDays }
}

/** Counts shown on the preview header. */
function buildCounts(items: StoryPreviewItem[]): StoryPackPreview['counts'] {
  return {
    total: items.length,
    requires_open: items.filter((item) => item.requires_open).length,
    opened: items.filter((item) => item.requires_open && item.opened_by_me).length,
    with_problems: items.filter((item) => item.problems.length > 0).length,
  }
}

export async function buildStoryPackPreview(input: {
  ports: StoryServicePorts
  packId: string
  clientId: string
  actor: StoryActor
  now: Date
  expiresInDays?: number
}): Promise<StoryServiceResult<StoryPackPreview>> {
  const { ports, packId, clientId, actor, now } = input
  const admin = requireGlobalAdmin(ports, actor)
  if (!admin.ok) return admin

  const expiry = validateExpiry(input.expiresInDays)
  if (!expiry.ok) return expiry

  const evaluated = await evaluateStoryPack({
    ports,
    packId,
    clientId,
    actor,
    now,
    expiresInDays: expiry.value,
  })

  if (evaluated.items.length === 0) {
    return { ok: false, status: 404, error: 'PACK_NOT_FOUND' }
  }

  const items = evaluated.items.map(toPreviewItem)
  const blocking = collectBlocking(items)

  return {
    ok: true,
    value: {
      pack_id: packId,
      client_id: clientId,
      items,
      content_hash: evaluated.contentHash,
      counts: buildCounts(items),
      can_authorize: blocking.length === 0,
      blocking,
    },
  }
}

export async function recordStoryItemOpen(input: {
  ports: StoryServicePorts
  packId: string
  clientId: string
  actor: StoryActor
  itemId: string
  channel: StoryChannel
  now: Date
}): Promise<StoryServiceResult<{ fingerprint: string }>> {
  const { ports, packId, clientId, actor, itemId, channel, now } = input
  const admin = requireGlobalAdmin(ports, actor)
  if (!admin.ok) return admin

  const items = await ports.store.getPackItems(packId, clientId)
  const item = items.find((candidate) => candidate.item_id === itemId && candidate.channel === channel)
  if (!item) {
    return { ok: false, status: 404, error: 'ITEM_NOT_FOUND' }
  }

  const fingerprint = computeContentFingerprint(item)
  await ports.store.recordOpen({
    item_id: itemId,
    channel,
    opened_by_user_id: actor.id,
    opened_fingerprint: fingerprint,
    opened_at: now.toISOString(),
  })

  return { ok: true, value: { fingerprint } }
}
