/**
 * Story "lite" — the sweep. Runs every ten minutes over every live pack and decides, per item,
 * whether to send, wait, or give up. Fail-closed: anything we cannot prove is treated as unsafe.
 *
 * Pure orchestration over `LiteStore` plus injected ports (file re-check, page token, publisher,
 * event sender). No I/O of its own, no `process.env`, no `any`. A thrown store error propagates;
 * a thrown error from `checkFile` / `getPageToken` is caught per item and treated as
 * UNREACHABLE / no token.
 */
import { computeItemFingerprint } from './fingerprint'
import type { LiteStore } from './store'
import { isLiveFor, type LiteFileCheck, type LiteItem, type LiteItemStatus, type LitePack, type LiteSwitches } from './types'

export interface SweepConfig {
  earlyMinutes: number
  maxLateMinutes: number
  staleClaimMinutes: number
}

export const DEFAULT_SWEEP_CONFIG: SweepConfig = { earlyMinutes: 5, maxLateMinutes: 20, staleClaimMinutes: 15 }

export interface SenderDeps {
  now: Date
  store: LiteStore
  switches: LiteSwitches
  config: SweepConfig
  /** Re-download the media and compare its sha256. */
  checkFile(item: LiteItem): Promise<LiteFileCheck>
  /** The Facebook Page token for (client, page); null when none can be found. */
  getPageToken(clientId: string, pageId: string): Promise<string | null>
  /** Send one story. Throws PagePublishError on failure. */
  publish(input: { item: LiteItem; pageToken: string }): Promise<{ postId: string }>
  /** Best-effort receipt event; a failure never changes the outcome. */
  emit(event: { id: string; name: string; data: Record<string, unknown> }): Promise<void>
}

export type SweepOutcome =
  | 'SENT'
  | 'DRY_RUN'
  | 'SKIPPED_NOT_DUE'
  | 'MISSED'
  | 'BLOCKED'
  | 'RETRY_LATER'
  | 'FAILED'
  | 'UNKNOWN_OUTCOME'
  | 'LOST_CLAIM'

export interface SweepRecord {
  item_id: string
  pack_id: string
  outcome: SweepOutcome
  reason_code: string | null
  mode: 'DRY_RUN' | 'LIVE'
  provider_receipt: string | null
}

export interface SweepSummary {
  records: SweepRecord[]
  staleExpired: string[]
  counts: Record<string, number>
}

const MINUTE_MS = 60 * 1000

/** Live only for the exact string 'true'; clients = comma list trimmed, lowercased, non-empty. */
export function readLiteSwitches(env: {
  STORY_AUTO_PUBLISH_LIVE?: string
  STORY_AUTO_PUBLISH_CLIENTS?: string
}): LiteSwitches {
  const live = env.STORY_AUTO_PUBLISH_LIVE === 'true'
  const raw = env.STORY_AUTO_PUBLISH_CLIENTS ?? ''
  const clientIds = raw
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0)
  return { live, clientIds }
}

/** A per-item decision, before any write. */
interface Decision {
  outcome: SweepOutcome
  reason: string | null
}

function record(
  item: LiteItem,
  outcome: SweepOutcome,
  reason: string | null,
  mode: 'DRY_RUN' | 'LIVE',
  providerReceipt: string | null = null,
): SweepRecord {
  return {
    item_id: item.item_id,
    pack_id: item.pack_id,
    outcome,
    reason_code: reason,
    mode,
    provider_receipt: providerReceipt,
  }
}

/** Best-effort event: a failure is swallowed and never changes the outcome. */
async function emitBestEffort(
  deps: SenderDeps,
  item: LiteItem,
  outcome: SweepOutcome,
  reason: string | null,
  mode: 'DRY_RUN' | 'LIVE',
  providerReceipt: string | null,
): Promise<void> {
  try {
    await deps.emit({
      // a rehearsal never changes attempt_count: key it by the run time so its receipts are not de-duplicated away
      id: mode === 'DRY_RUN' ? `${item.item_id}:dry:${deps.now.getTime()}` : `${item.item_id}:${item.attempt_count}`,
      name: 'story.item.attempted',
      data: {
        client_id: item.client_id,
        pack_id: item.pack_id,
        item_id: item.item_id,
        channel: item.channel,
        status: outcome,
        reason_code: reason,
        provider_receipt: providerReceipt,
        mode,
        provider_impact: outcome === 'SENT' ? 'STORY_PUBLISHED' : 'NONE',
        created_at: deps.now.toISOString(),
      },
    })
  } catch {
    // swallowed on purpose
  }
}

/** Timing gate: null means "proceed"; otherwise the item is not due or is too late. */
function timingDecision(item: LiteItem, now: Date, config: SweepConfig): Decision | null {
  const ms = Date.parse(item.slot_at)
  if (Number.isNaN(ms)) return { outcome: 'BLOCKED', reason: 'BAD_SLOT' }
  if (now.getTime() < ms - config.earlyMinutes * MINUTE_MS) return { outcome: 'SKIPPED_NOT_DUE', reason: null }
  if (now.getTime() > ms + config.maxLateMinutes * MINUTE_MS) return { outcome: 'MISSED', reason: 'SLOT_PASSED' }
  return null
}

/** The pre-send checks, in a fixed order; the first failure wins. Null means "all clear". */
async function checkItem(
  deps: SenderDeps,
  item: LiteItem,
  registration: { facebook_page_id: string | null; client_status: string | null } | null,
): Promise<string | null> {
  if (registration === null || registration.client_status !== 'active') return 'CLIENT_NOT_ACTIVE'
  if (registration.facebook_page_id !== item.account_id) return 'ACCOUNT_MISMATCH'
  if (item.channel !== 'facebook_story') return 'CHANNEL_NOT_SUPPORTED'
  if (item.authorized_fingerprint === null || item.authorized_fingerprint !== computeItemFingerprint(item)) {
    return 'FINGERPRINT_CHANGED'
  }

  let fileResult: LiteFileCheck
  try {
    fileResult = await deps.checkFile(item)
  } catch {
    fileResult = 'UNREACHABLE'
  }
  if (fileResult === 'CHANGED') return 'FILE_CHANGED'
  if (fileResult === 'UNREACHABLE') return 'FILE_UNREACHABLE'
  if (fileResult === 'BAD_VIDEO') return 'VIDEO_NOT_ACCEPTABLE'
  return null
}

/** Rehearsal: never claim, never publish; just record what we saw. */
async function runRehearsal(deps: SenderDeps, item: LiteItem, reason: string | null): Promise<SweepRecord> {
  await deps.store.recordCheck(item.item_id, reason ?? 'OK', deps.now)
  const rec = record(item, 'DRY_RUN', reason, 'DRY_RUN')
  await emitBestEffort(deps, item, 'DRY_RUN', reason, 'DRY_RUN', null)
  return rec
}

/** Settle a claimed item; false means the claim was lost. */
async function settle(
  deps: SenderDeps,
  item: LiteItem,
  to: LiteItemStatus,
  reason: string | null,
  providerReceipt: string | null = null,
): Promise<boolean> {
  return deps.store.settleItem({
    itemId: item.item_id,
    to,
    reasonCode: reason,
    providerReceipt,
    now: deps.now,
  })
}

/** After a send, a lost claim (or a failed write) means the story may be out there: never retried. */
async function settleAfterSend(
  deps: SenderDeps,
  item: LiteItem,
  to: LiteItemStatus,
  reason: string | null,
  providerReceipt: string | null,
): Promise<SweepRecord> {
  let settled = false
  let failure: 'SETTLE_LOST' | 'SETTLE_FAILED' = 'SETTLE_LOST'
  try {
    settled = await settle(deps, item, to, reason, providerReceipt)
  } catch {
    failure = 'SETTLE_FAILED'
    // the story id exists only in memory now: leave it in the log and in the receipt event
    console.error('[story-lite] settle failed after send', { item_id: item.item_id, provider_receipt: providerReceipt })
  }
  if (!settled) {
    const rec = record(item, 'UNKNOWN_OUTCOME', failure, 'LIVE', providerReceipt)
    await emitBestEffort(deps, item, 'UNKNOWN_OUTCOME', failure, 'LIVE', providerReceipt)
    return rec
  }
  const rec = record(item, to === 'SENT' ? 'SENT' : to === 'FAILED' ? 'FAILED' : 'UNKNOWN_OUTCOME', reason, 'LIVE', providerReceipt)
  await emitBestEffort(deps, item, rec.outcome, reason, 'LIVE', providerReceipt)
  return rec
}

/** The pack must still be live after we claimed: authorised, not revoked, not expired. */
async function packStillLive(deps: SenderDeps, pack: LitePack): Promise<boolean> {
  const fresh = await deps.store.getPack(pack.id, pack.client_id)
  if (fresh === null) return false
  if (fresh.revoked_at !== null) return false
  if (fresh.authorized_at === null) return false
  if (fresh.expires_at === null) return false
  return fresh.expires_at > deps.now.toISOString()
}

/** The pack stopped being live after the claim: hand the item back untouched, nothing is sent. */
async function releaseNotLive(deps: SenderDeps, claimed: LiteItem): Promise<SweepRecord> {
  await settle(deps, claimed, 'PENDING', 'PACK_NOT_LIVE')
  const rec = record(claimed, 'RETRY_LATER', 'PACK_NOT_LIVE', 'LIVE')
  await emitBestEffort(deps, claimed, 'RETRY_LATER', 'PACK_NOT_LIVE', 'LIVE', null)
  return rec
}

/** Live path: claim, re-check the pack, re-run the checks, get a token, publish, settle. */
async function sendClaimed(
  deps: SenderDeps,
  pack: LitePack,
  item: LiteItem,
  registration: { facebook_page_id: string | null; client_status: string | null } | null,
): Promise<SweepRecord> {
  const claimed = await deps.store.claimItem(item.item_id, deps.now)
  if (claimed === null) return record(item, 'LOST_CLAIM', null, 'LIVE')

  if (!(await packStillLive(deps, pack))) return releaseNotLive(deps, claimed)

  const reason = await checkItem(deps, claimed, registration)
  if (reason !== null) {
    if (reason === 'FILE_UNREACHABLE') {
      await settle(deps, claimed, 'PENDING', reason)
      const rec = record(claimed, 'RETRY_LATER', reason, 'LIVE')
      await emitBestEffort(deps, claimed, 'RETRY_LATER', reason, 'LIVE', null)
      return rec
    }
    await settle(deps, claimed, 'BLOCKED', reason)
    const rec = record(claimed, 'BLOCKED', reason, 'LIVE')
    await emitBestEffort(deps, claimed, 'BLOCKED', reason, 'LIVE', null)
    return rec
  }

  let token: string | null
  try {
    token = await deps.getPageToken(claimed.client_id, claimed.account_id)
  } catch {
    token = null
  }
  if (token === null) {
    await settle(deps, claimed, 'BLOCKED', 'NO_PAGE_TOKEN')
    const rec = record(claimed, 'BLOCKED', 'NO_PAGE_TOKEN', 'LIVE')
    await emitBestEffort(deps, claimed, 'BLOCKED', 'NO_PAGE_TOKEN', 'LIVE', null)
    return rec
  }

  // the checks above took network time: look at the pack once more, immediately before sending
  if (!(await packStillLive(deps, pack))) return releaseNotLive(deps, claimed)

  return publishClaimed(deps, claimed, token)
}

/** Publish a claimed item and map the outcome. */
async function publishClaimed(deps: SenderDeps, claimed: LiteItem, token: string): Promise<SweepRecord> {
  try {
    const { postId } = await deps.publish({ item: claimed, pageToken: token })
    return settleAfterSend(deps, claimed, 'SENT', null, postId)
  } catch (error) {
    const certainty = readCertainty(error)
    if (certainty === 'rejected') return settleAfterSend(deps, claimed, 'FAILED', 'PROVIDER_REJECTED', null)
    if (certainty === 'rate_limited') {
      await settle(deps, claimed, 'PENDING', 'RATE_LIMITED')
      const rec = record(claimed, 'RETRY_LATER', 'RATE_LIMITED', 'LIVE')
      await emitBestEffort(deps, claimed, 'RETRY_LATER', 'RATE_LIMITED', 'LIVE', null)
      return rec
    }
    return settleAfterSend(deps, claimed, 'UNKNOWN_OUTCOME', 'OUTCOME_UNKNOWN', null)
  }
}

/** Read `.certainty` off a thrown error without importing the class (keeps this file dependency-free). */
function readCertainty(error: unknown): 'rejected' | 'rate_limited' | 'unknown' {
  if (typeof error === 'object' && error !== null && 'certainty' in error) {
    const value = (error as { certainty?: unknown }).certainty
    if (value === 'rejected' || value === 'rate_limited' || value === 'unknown') return value
  }
  return 'unknown'
}

/** Too late (or an unreadable slot): in a live run the item is settled for good; a rehearsal only notes it. */
async function settleTiming(
  deps: SenderDeps,
  item: LiteItem,
  timing: Decision,
  live: boolean,
): Promise<SweepRecord> {
  if (timing.outcome === 'SKIPPED_NOT_DUE') return record(item, 'SKIPPED_NOT_DUE', null, 'DRY_RUN')
  if (!live) return runRehearsal(deps, item, timing.reason)

  const claimed = await deps.store.claimItem(item.item_id, deps.now)
  if (claimed === null) return record(item, 'LOST_CLAIM', null, 'LIVE')
  // MISSED: never sent late. BAD_SLOT: blocked, so the row is not retried forever.
  const to: LiteItemStatus = timing.outcome === 'MISSED' ? 'MISSED' : 'BLOCKED'
  await settle(deps, claimed, to, timing.reason)
  const rec = record(claimed, timing.outcome, timing.reason, 'LIVE')
  await emitBestEffort(deps, claimed, timing.outcome, timing.reason, 'LIVE', null)
  return rec
}

/** One PENDING item: timing, then rehearsal or live. */
async function evaluateItem(
  deps: SenderDeps,
  pack: LitePack,
  item: LiteItem,
  registration: { facebook_page_id: string | null; client_status: string | null } | null,
): Promise<SweepRecord | null> {
  if (item.status !== 'PENDING') return null

  const live = isLiveFor(deps.switches, pack.client_id)
  const timing = timingDecision(item, deps.now, deps.config)
  if (timing !== null) return settleTiming(deps, item, timing, live)

  if (!live) {
    const reason = await checkItem(deps, item, registration)
    return runRehearsal(deps, item, reason)
  }

  return sendClaimed(deps, pack, item, registration)
}

/** One pack: fetch its items and registration, then evaluate each PENDING item. */
async function sweepPack(deps: SenderDeps, pack: LitePack): Promise<SweepRecord[]> {
  const items = await deps.store.getItems(pack.id, pack.client_id)
  const registration = await deps.store.getClientRegistration(pack.client_id)
  const records: SweepRecord[] = []
  for (const item of items) {
    const rec = await evaluateItem(deps, pack, item, registration)
    if (rec !== null) records.push(rec)
  }
  return records
}

/** The sweep. Runs every ten minutes. */
export async function runStorySweep(deps: SenderDeps): Promise<SweepSummary> {
  const staleExpired = await deps.store.expireStaleClaims(deps.now, deps.config.staleClaimMinutes * MINUTE_MS)

  const packs = await deps.store.listLivePacks(deps.now)
  const records: SweepRecord[] = []
  for (const pack of packs) {
    const packRecords = await sweepPack(deps, pack)
    records.push(...packRecords)
  }

  const counts: Record<string, number> = {}
  for (const rec of records) counts[rec.outcome] = (counts[rec.outcome] ?? 0) + 1

  return { records, staleExpired, counts }
}
