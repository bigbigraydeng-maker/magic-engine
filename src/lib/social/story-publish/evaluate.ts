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
import { computeContentFingerprint, computeItemFingerprint, computeManifestHash } from './fingerprint'
import { decideStoryPublish, type StoryGateDecision } from './gates'
import { itemRequiresOpen, nzDateOf, type StoryActor, type StoryServicePorts } from './service-ports'
import type {
  RegisteredStoryAccounts,
  StoredStoryItem,
  StoryAttemptView,
  StoryOpenRecord,
} from './store'
import { storyItemKey, type StoryAttemptStatus, type StoryAuthorization } from './types'

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

  const evaluated: EvaluatedStoryItem[] = []
  for (const item of items) {
    evaluated.push(
      await evaluateItem({ ports, item, items, grant, clientId, accounts, actor, now, opens, attempts }),
    )
  }

  return {
    items: evaluated,
    grant,
    manifestHash,
    approvedFingerprints,
    expiresAt,
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

/** Run the gate for one item at its slot time against the provisional grant. */
async function gateDryRun(input: {
  ports: StoryServicePorts
  item: StoredStoryItem
  items: StoredStoryItem[]
  grant: StoryAuthorization
  clientId: string
  accounts: RegisteredStoryAccounts | null
  now: Date
}): Promise<StoryGateDecision> {
  const { ports, item, items, grant, clientId, accounts, now } = input

  const slotMs = Date.parse(item.slot_at)
  const gateNow = Number.isNaN(slotMs) ? now : new Date(slotMs)

  const fileCheck = await safeCheckFile(ports, item)
  const assetUsage = await ports.store.getAssetUsage(item.media_sha256)
  const priceGate = item.contains_price ? await safeCheckPrice(ports, item) : 'OK'

  const slotDate = nzDateOf(item.slot_at)
  const replyOwnerPresent = slotDate === null ? false : await ports.store.hasReplyOwner(clientId, slotDate)

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
    circuit: { itemPaused: item.paused_at !== null, packChannelPaused: false },
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
}): Promise<EvaluatedStoryItem> {
  const { ports, item, items, grant, clientId, accounts, actor, now, opens, attempts } = input
  const decision = await gateDryRun({ ports, item, items, grant, clientId, accounts, now })
  const problems = problemsOf(decision)

  const contentFingerprint = computeContentFingerprint(item)
  const openedByActor = opens.some(
    (open) =>
      open.item_id === item.item_id &&
      open.channel === item.channel &&
      open.opened_by_user_id === actor.id &&
      open.opened_fingerprint === contentFingerprint,
  )

  const attempt = attempts.find((c) => c.item_id === item.item_id && c.channel === item.channel)
  const alreadyAttempted = attempt ? attempt.status : null
  if (alreadyAttempted !== null) problems.push('ALREADY_ATTEMPTED')

  return { item, decision, problems, requiresOpen: itemRequiresOpen(item), openedByActor, alreadyAttempted }
}
