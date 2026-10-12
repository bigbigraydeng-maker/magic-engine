/**
 * Story auto-publish — pack evaluation (slice 2b).
 *
 * Produces a *provisional* view of a pack: for every stored item it runs the
 * real gate decision (`decideStoryPublish`) at the item's slot time against a
 * would-be grant, so a preview can show exactly what would happen if the pack
 * were authorised now. Nothing is written: the grant is built in memory and
 * never inserted, and the switches are forced off so a fully green item yields
 * DRY_RUN rather than PUBLISH.
 */
import {
  computeContentFingerprint,
  computeContentManifestHash,
  computeItemFingerprint,
  computeManifestHash,
} from './fingerprint'
import { decideStoryPublish, type StoryGateDecision } from './gates'
import {
  itemRequiresOpen,
  nzDateOf,
  STORY_OPEN_VALIDITY_MS,
  type StoryActor,
  type StoryServicePorts,
} from './service-ports'
import type {
  RegisteredStoryAccounts,
  StoredStoryItem,
  StoryAttemptView,
  StoryOpenRecord,
  StoryPauseMark,
} from './store'
import { storyItemKey, type StoryAttemptStatus, type StoryAuthorization } from './types'

/**
 * Attempt statuses that mean "a sent or in-flight story already exists" and so
 * block authorisation. DRY_RUN, BLOCKED and SKIPPED_NOT_AUTHORIZED are absent
 * on purpose: they are not attempts to publish.
 */
const ATTEMPT_BLOCKS_AUTHORIZATION: ReadonlySet<StoryAttemptStatus> = new Set([
  'CLAIMED',
  'RETRYABLE',
  'CONTAINER_CREATED',
  'PUBLISHING',
  'PUBLISHED_UNVERIFIED',
  'PUBLISHED',
  'FAILED_FINAL',
  'UNKNOWN_OUTCOME',
  'MISSED_WINDOW',
])

/** An open record may be at most this far in the future (clock skew tolerance). */
const OPEN_FUTURE_TOLERANCE_MS = 60_000

export interface EvaluatedStoryItem {
  item: StoredStoryItem
  /** Gate dry-run outcome simulated AT the item's slot time with the would-be grant. */
  decision: StoryGateDecision
  problems: string[]
  requiresOpen: boolean
  openedByActor: boolean
  alreadyAttempted: StoryAttemptStatus | null
}

export interface EvaluatedStoryPack {
  items: EvaluatedStoryItem[]
  grant: StoryAuthorization
  manifestHash: string
  approvedFingerprints: Record<string, string>
  expiresAt: string
  /** Hash of everything the preview shows (`computeContentManifestHash`). */
  contentHash: string
}

export async function evaluateStoryPack(input: {
  ports: StoryServicePorts
  packId: string
  clientId: string
  actor: StoryActor
  now: Date
  expiresInDays: number
}): Promise<EvaluatedStoryPack> {
  const { ports, packId, clientId, actor, now, expiresInDays } = input

  const items = await ports.store.getPackItems(packId, clientId)

  const expiresAt = new Date(now.getTime() + expiresInDays * 86_400_000).toISOString()

  const approvedFingerprints: Record<string, string> = {}
  for (const item of items) {
    approvedFingerprints[storyItemKey(item)] = computeItemFingerprint(item, expiresAt)
  }
  const manifestHash = computeManifestHash(items, expiresAt)
  const contentHash = computeContentManifestHash(items, { lifetimeDays: expiresInDays })

  const grant = buildGrant({
    packId,
    clientId,
    actor,
    now,
    expiresAt,
    manifestHash,
    approvedFingerprints,
  })

  const accounts = await ports.store.getRegisteredAccounts(clientId)
  const opens = await ports.store.listOpens(packId)
  const attempts = await ports.store.listAttempts(packId)
  const marks = await ports.store.getActivePauses(packId, clientId)

  const evaluated: EvaluatedStoryItem[] = []
  for (const item of items) {
    evaluated.push(
      await evaluateItem({
        ports,
        item,
        items,
        grant,
        clientId,
        accounts,
        actor,
        now,
        opens,
        attempts,
        marks,
      }),
    )
  }

  return {
    items: evaluated,
    grant,
    manifestHash,
    approvedFingerprints,
    expiresAt,
    contentHash,
  }
}

/** Build the provisional grant (never written to the store). */
function buildGrant(input: {
  packId: string
  clientId: string
  actor: StoryActor
  now: Date
  expiresAt: string
  manifestHash: string
  approvedFingerprints: Record<string, string>
}): StoryAuthorization {
  return {
    id: 'provisional',
    pack_id: input.packId,
    client_id: input.clientId,
    authorized_by_email: input.actor.email.trim().toLowerCase(),
    authorized_by_user_id: input.actor.id,
    authorized_at: input.now.toISOString(),
    activated_at: input.now.toISOString(),
    expires_at: input.expiresAt,
    revoked_at: null,
    manifest_hash: input.manifestHash,
    approved_item_fingerprints: { ...input.approvedFingerprints },
  }
}

/** Map a gate decision to the problem list a preview shows. */
function problemsOf(decision: StoryGateDecision): string[] {
  if (decision.action === 'DRY_RUN') return []
  if (decision.action === 'PUBLISH') return ['UNEXPECTED_PUBLISH']
  return [decision.reason_code]
}

/** True when the item's slot is readable and already in the past. */
function isSlotInPast(item: StoredStoryItem, now: Date): boolean {
  const slotMs = Date.parse(item.slot_at)
  return !Number.isNaN(slotMs) && slotMs < now.getTime()
}

/** True when an open record is recent enough to still count. */
function isOpenFresh(open: StoryOpenRecord, now: Date): boolean {
  const openedMs = Date.parse(open.opened_at)
  if (Number.isNaN(openedMs)) return false
  const nowMs = now.getTime()
  if (openedMs > nowMs + OPEN_FUTURE_TOLERANCE_MS) return false
  return nowMs - openedMs <= STORY_OPEN_VALIDITY_MS
}

/** Whether the acting person has a fresh open record for this exact item version. */
function isOpenedByActor(input: {
  item: StoredStoryItem
  opens: StoryOpenRecord[]
  actor: StoryActor
  now: Date
}): boolean {
  const { item, opens, actor, now } = input
  const contentFingerprint = computeContentFingerprint(item)
  return opens.some(
    (open) =>
      open.item_id === item.item_id &&
      open.channel === item.channel &&
      open.opened_by_user_id === actor.id &&
      open.opened_fingerprint === contentFingerprint &&
      isOpenFresh(open, now),
  )
}

/** The attempt status on file for this item, or null when it does not block. */
function blockingAttempt(
  attempts: StoryAttemptView[],
  item: StoredStoryItem,
): StoryAttemptStatus | null {
  const attempt = attempts.find((c) => c.item_id === item.item_id && c.channel === item.channel)
  if (!attempt) return null
  return ATTEMPT_BLOCKS_AUTHORIZATION.has(attempt.status) ? attempt.status : null
}

/** Circuit state for one item, derived from the pack's active pause marks. */
function circuitFor(
  item: StoredStoryItem,
  marks: StoryPauseMark[],
): { itemPaused: boolean; packChannelPaused: boolean } {
  const itemPaused =
    item.paused_at !== null ||
    marks.some(
      (m) => m.item_id === item.item_id && (m.channel === null || m.channel === item.channel),
    )
  const packChannelPaused = marks.some(
    (m) => m.item_id === null && (m.channel === null || m.channel === item.channel),
  )
  return { itemPaused, packChannelPaused }
}

/** Run the gate for one item at its slot time against the provisional grant. */
async function gateDryRun(input: {
  ports: StoryServicePorts
  item: StoredStoryItem
  items: StoredStoryItem[]
  grant: StoryAuthorization
  clientId: string
  accounts: RegisteredStoryAccounts | null
  now: Date
  marks: StoryPauseMark[]
}): Promise<StoryGateDecision> {
  const { ports, item, items, grant, clientId, accounts, now, marks } = input

  const slotMs = Date.parse(item.slot_at)
  const gateNow = Number.isNaN(slotMs) ? now : new Date(slotMs)

  const fileCheck = await safeCheckFile(ports, item)
  const assetUsage = await ports.store.getAssetUsage(item.media_sha256)
  const priceGate = item.contains_price ? await safeCheckPrice(ports, item) : 'OK'

  const slotDate = nzDateOf(item.slot_at)
  const replyOwnerPresent =
    slotDate === null ? false : await ports.store.hasReplyOwner(clientId, slotDate)

  const registeredAccountId =
    item.channel === 'facebook_story'
      ? accounts?.facebook_page_id ?? null
      : accounts?.instagram_user_id ?? null

  return decideStoryPublish({
    now: gateNow,
    item,
    auth: {
      authorization: grant,
      itemAuthorizationId: 'provisional',
      packItems: items,
      adminEmails: ports.adminEmails,
    },
    switches: { live: false, clientIds: [], channels: [] },
    clientStatus: accounts?.client_status ?? null,
    // Stories are not tied to a campaign yet; keep the campaign gate green.
    campaignStatus: 'active',
    registeredAccountId,
    circuit: circuitFor(item, marks),
    fileCheck,
    assetUsage,
    priceGate,
    replyOwnerPresent,
    existingAttempt: null,
    config: ports.config,
  })
}

/** A throwing file check fails closed as UNREACHABLE. */
async function safeCheckFile(
  ports: StoryServicePorts,
  item: StoredStoryItem,
): Promise<'OK' | 'CHANGED' | 'UNREACHABLE'> {
  try {
    return await ports.checkFile(item)
  } catch {
    return 'UNREACHABLE'
  }
}

/** A throwing price check fails closed as ERROR. */
async function safeCheckPrice(
  ports: StoryServicePorts,
  item: StoredStoryItem,
): Promise<'OK' | 'BLOCKED' | 'ERROR'> {
  try {
    return await ports.checkPrice(item)
  } catch {
    return 'ERROR'
  }
}

/** Evaluate one item: dry-run gate, open evidence and any attempt already on file. */
async function evaluateItem(input: {
  ports: StoryServicePorts
  item: StoredStoryItem
  items: StoredStoryItem[]
  grant: StoryAuthorization
  clientId: string
  accounts: RegisteredStoryAccounts | null
  actor: StoryActor
  now: Date
  opens: StoryOpenRecord[]
  attempts: StoryAttemptView[]
  marks: StoryPauseMark[]
}): Promise<EvaluatedStoryItem> {
  const { ports, item, items, grant, clientId, accounts, actor, now, opens, attempts, marks } = input
  const decision = await gateDryRun({ ports, item, items, grant, clientId, accounts, now, marks })
  const problems = problemsOf(decision)

  const openedByActor = isOpenedByActor({ item, opens, actor, now })

  const alreadyAttempted = blockingAttempt(attempts, item)
  if (alreadyAttempted !== null) problems.push('ALREADY_ATTEMPTED')

  if (isSlotInPast(item, now) && !problems.includes('SLOT_IN_PAST')) {
    problems.push('SLOT_IN_PAST')
  }

  return {
    item,
    decision,
    problems,
    requiresOpen: itemRequiresOpen(item),
    openedByActor,
    alreadyAttempted,
  }
}
