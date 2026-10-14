/**
 * Story "lite" — service layer. Pure orchestration over `LiteStore` plus injected ports
 * (admin check, file re-check, event sender). No I/O of its own, no `process.env`, no `any`.
 *
 * Three operations: build a preview, authorise a pack (record only), revoke a pack.
 * Every function returns a `LiteResult`; nothing throws for expected outcomes.
 */
import { computeItemFingerprint, computePackContentHash } from './fingerprint'
import type { LiteStore } from './store'
import type { LiteActor, LiteChannel, LiteFileCheck, LiteItem, LiteItemStatus, LiteMediaKind, LitePack } from './types'

export interface LiteServicePorts {
  store: LiteStore
  adminEmails: { has(email: string): boolean }
  /** Re-download the file and compare its hash. Injected: the service never touches the network. */
  checkFile(item: LiteItem): Promise<LiteFileCheck>
  sendEvent(event: { id: string; name: string; data: Record<string, unknown> }): Promise<void>
}

export type LiteResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string; details?: unknown }

export type LitePackState = 'DRAFT' | 'AUTHORIZED' | 'REVOKED' | 'EXPIRED'

export interface LitePreviewItem {
  item_id: string
  channel: LiteChannel
  slot_at: string
  media_kind: LiteMediaKind
  media_url: string
  text_line: string
  source_ref: string
  status: LiteItemStatus
  problems: string[]
}

export interface LitePreview {
  pack_id: string
  client_id: string
  title: string
  state: LitePackState
  lifetime_days: number
  expires_at_if_authorized: string
  items: LitePreviewItem[]
  content_hash: string
  can_authorize: boolean
  blocking: string[]
}

const DEFAULT_LIFETIME_DAYS = 7
const MIN_LIFETIME_DAYS = 1
const MAX_LIFETIME_DAYS = 14
const MAX_REASON_LENGTH = 300
const DAY_MS = 24 * 60 * 60 * 1000
const HEX64 = /^[0-9a-f]{64}$/
const PRICE_PATTERN =
  /[$€£¥￥＄]|\b(?:nzd|aud|usd|rmb|cny)\b|\bdollars?\b|\bper person\b|纽币|澳币|美元|人民币|\d\s*(?:元|块)|(?:元|块)\s*\d/i

const AUTHORIZED_NOTE = 'Recorded only. Nothing is sent until the publisher is switched on.'
const REVOKED_NOTE =
  'Revoking stops every story that has not been sent. Stories already published are NOT removed: delete them by hand in Facebook.'

function ok<T>(value: T): LiteResult<T> {
  return { ok: true, value }
}

function fail<T>(status: number, error: string, details?: unknown): LiteResult<T> {
  return details === undefined ? { ok: false, status, error } : { ok: false, status, error, details }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** 403 unless the actor is a global administrator (no client limit) with a known admin email. */
export function requireGlobalAdmin(
  ports: Pick<LiteServicePorts, 'adminEmails'>,
  actor: LiteActor,
): LiteResult<true> {
  if (actor.allowedClientId !== null) return fail(403, 'GLOBAL_ADMIN_REQUIRED')
  if (!ports.adminEmails.has(normalizeEmail(actor.email))) return fail(403, 'GLOBAL_ADMIN_REQUIRED')
  return ok(true)
}

/** Validate the lifetime: default 7, integer 1..14. */
function resolveLifetimeDays(lifetimeDays: number | undefined): LiteResult<number> {
  const days = lifetimeDays ?? DEFAULT_LIFETIME_DAYS
  if (!Number.isInteger(days) || days < MIN_LIFETIME_DAYS || days > MAX_LIFETIME_DAYS) {
    return fail(400, 'BAD_EXPIRY')
  }
  return ok(days)
}

export function packState(pack: LitePack, now: Date): LitePackState {
  if (pack.revoked_at !== null) return 'REVOKED'
  if (pack.authorized_at === null) return 'DRAFT'
  if (pack.expires_at !== null && pack.expires_at > now.toISOString()) return 'AUTHORIZED'
  return 'EXPIRED'
}

function isUnreadableOrPast(slotAt: string, now: Date): boolean {
  const ms = Date.parse(slotAt)
  return Number.isNaN(ms) || ms < now.getTime()
}

function isAfterExpiry(slotAt: string, now: Date, lifetimeDays: number): boolean {
  const ms = Date.parse(slotAt)
  if (Number.isNaN(ms)) return false
  return ms > now.getTime() + lifetimeDays * DAY_MS
}

function accountMismatch(item: LiteItem, pageId: string | null | undefined): boolean {
  if (pageId === null || pageId === undefined) return true
  if (pageId.trim().length === 0) return true
  return pageId !== item.account_id
}

/** Every problem code that applies to one item, in a stable order. */
async function itemProblems(
  ports: LiteServicePorts,
  item: LiteItem,
  pageId: string | null | undefined,
  now: Date,
  lifetimeDays: number,
): Promise<string[]> {
  const problems: string[] = []
  if (item.status !== 'PENDING') problems.push('NOT_PENDING')
  if (item.channel !== 'facebook_story') problems.push('CHANNEL_NOT_SUPPORTED')
  if (isUnreadableOrPast(item.slot_at, now)) problems.push('SLOT_IN_PAST')
  if (isAfterExpiry(item.slot_at, now, lifetimeDays)) problems.push('SLOT_AFTER_EXPIRY')
  if (accountMismatch(item, pageId)) problems.push('ACCOUNT_MISMATCH')
  if (PRICE_PATTERN.test(item.text_line)) problems.push('PRICE_IN_TEXT')

  let fileResult: LiteFileCheck
  try {
    fileResult = await ports.checkFile(item)
  } catch {
    fileResult = 'UNREACHABLE'
  }
  if (fileResult === 'CHANGED') problems.push('FILE_CHANGED')
  if (fileResult === 'UNREACHABLE') problems.push('FILE_UNREACHABLE')
  if (fileResult === 'BAD_VIDEO') problems.push('VIDEO_NOT_ACCEPTABLE')

  return problems
}

function uniqueInOrder(codes: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const code of codes) {
    if (seen.has(code)) continue
    seen.add(code)
    out.push(code)
  }
  return out
}

/** Load the pack and its items, or a 404 when either is missing. */
async function loadPackAndItems(
  ports: LiteServicePorts,
  packId: string,
  clientId: string,
): Promise<LiteResult<{ pack: LitePack; items: LiteItem[] }>> {
  const pack = await ports.store.getPack(packId, clientId)
  if (pack === null) return fail(404, 'PACK_NOT_FOUND')
  const items = await ports.store.getItems(packId, clientId)
  if (items.length === 0) return fail(404, 'PACK_NOT_FOUND')
  return ok({ pack, items })
}

/** The preview re-downloads every picture to compare its hash: do them side by side, not one after another. */
const PREVIEW_CHECK_CONCURRENCY = 9

/** Run `task` over `inputs` with at most `limit` in flight; results keep the input order and an error rejects. */
async function mapWithLimit<T, R>(inputs: T[], limit: number, task: (input: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(inputs.length)
  let next = 0
  async function worker(): Promise<void> {
    for (;;) {
      const index = next++
      if (index >= inputs.length) return
      results[index] = await task(inputs[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, inputs.length) }, () => worker()))
  return results
}

/** Build the per-item preview rows and collect every problem code seen. */
async function buildPreviewItems(
  ports: LiteServicePorts,
  items: LiteItem[],
  pageId: string | null | undefined,
  now: Date,
  lifetimeDays: number,
): Promise<{ previewItems: LitePreviewItem[]; allProblems: string[] }> {
  const checked = await mapWithLimit(items, PREVIEW_CHECK_CONCURRENCY, async (item) => ({
    item,
    problems: await itemProblems(ports, item, pageId, now, lifetimeDays),
  }))
  const previewItems: LitePreviewItem[] = checked.map(({ item, problems }) => ({
    item_id: item.item_id,
    channel: item.channel,
    slot_at: item.slot_at,
    media_kind: item.media_kind,
    media_url: item.media_url,
    text_line: item.text_line,
    source_ref: item.source_ref,
    status: item.status,
    problems,
  }))
  const allProblems = checked.flatMap(({ problems }) => problems)
  return { previewItems, allProblems }
}

/** The blocking codes for the whole pack, in a stable order. */
function packBlocking(
  allProblems: string[],
  clientStatus: string | null | undefined,
  state: LitePackState,
): string[] {
  const blocking = uniqueInOrder(allProblems)
  if (clientStatus !== 'active') blocking.push('CLIENT_NOT_ACTIVE')
  if (state !== 'DRAFT') blocking.push('PACK_NOT_DRAFT')
  return blocking
}

/** Build the preview: what the person sees before confirming. Read-only. */
export async function buildLitePreview(input: {
  ports: LiteServicePorts
  packId: string
  clientId: string
  actor: LiteActor
  now: Date
  lifetimeDays?: number
}): Promise<LiteResult<LitePreview>> {
  const admin = requireGlobalAdmin(input.ports, input.actor)
  if (!admin.ok) return admin

  const lifetime = resolveLifetimeDays(input.lifetimeDays)
  if (!lifetime.ok) return lifetime

  const loaded = await loadPackAndItems(input.ports, input.packId, input.clientId)
  if (!loaded.ok) return loaded
  const { pack, items } = loaded.value

  const registration = await input.ports.store.getClientRegistration(input.clientId)
  const state = packState(pack, input.now)

  const { previewItems, allProblems } = await buildPreviewItems(
    input.ports,
    items,
    registration?.facebook_page_id ?? null,
    input.now,
    lifetime.value,
  )
  const blocking = packBlocking(allProblems, registration?.client_status, state)

  const expiresAt = new Date(input.now.getTime() + lifetime.value * DAY_MS).toISOString()

  return ok({
    pack_id: pack.id,
    client_id: pack.client_id,
    title: pack.title,
    state,
    lifetime_days: lifetime.value,
    expires_at_if_authorized: expiresAt,
    items: previewItems,
    content_hash: computePackContentHash(items, lifetime.value),
    can_authorize: blocking.length === 0,
    blocking,
  })
}

/** Best-effort event: a failure is logged (name only) and never fails the caller. */
async function sendEventBestEffort(
  ports: LiteServicePorts,
  event: { id: string; name: string; data: Record<string, unknown> },
): Promise<void> {
  try {
    await ports.sendEvent(event)
  } catch {
    console.error('[story-lite] event not sent', event.name)
  }
}

function mapAuthorizeError(error: 'ALREADY_AUTHORIZED' | 'REVOKED' | 'NOT_FOUND'): LiteResult<never> {
  if (error === 'ALREADY_AUTHORIZED') return fail(409, 'ALREADY_AUTHORIZED')
  if (error === 'REVOKED') return fail(409, 'PACK_REVOKED')
  return fail(404, 'PACK_NOT_FOUND')
}

/** The confirm-time checks: hash, state and blocking. */
function confirmChecks(
  preview: LitePreview,
  expectedContentHash: string | undefined,
): LiteResult<true> {
  if (typeof expectedContentHash !== 'string' || !HEX64.test(expectedContentHash)) {
    return fail(400, 'CONTENT_HASH_REQUIRED')
  }
  if (expectedContentHash !== preview.content_hash) return fail(409, 'PACK_CHANGED_SINCE_PREVIEW')
  if (preview.state === 'REVOKED') return fail(409, 'PACK_REVOKED')
  if (preview.state === 'AUTHORIZED' || preview.state === 'EXPIRED') {
    return fail(409, 'ALREADY_AUTHORIZED')
  }
  if (!preview.can_authorize) {
    const details = [
      ...preview.items
        .filter((item) => item.problems.length > 0)
        .map((item) => ({ item_id: item.item_id, problems: item.problems })),
      ...preview.blocking.filter((code) => code === 'CLIENT_NOT_ACTIVE' || code === 'PACK_NOT_DRAFT'),
    ]
    return fail(422, 'PACK_NOT_AUTHORIZABLE', details)
  }
  return ok(true)
}

/** Call the store and map its error codes to HTTP results. */
async function storeAuthorization(input: {
  ports: LiteServicePorts
  packId: string
  clientId: string
  byEmail: string
  byUserId: string
  now: Date
  expiresAt: Date
  contentHash: string
  fingerprints: Record<string, string>
}): Promise<LiteResult<LitePack>> {
  const authorized = await input.ports.store.authorizePack({
    packId: input.packId,
    clientId: input.clientId,
    byEmail: input.byEmail,
    byUserId: input.byUserId,
    now: input.now,
    expiresAt: input.expiresAt,
    contentHash: input.contentHash,
    fingerprints: input.fingerprints,
  })
  if (!authorized.ok) return mapAuthorizeError(authorized.error)
  return ok(authorized.pack)
}

/** Authorise a pack: record only, nothing is sent. */
export type LiteAuthorizeOutcome =
  | { mode: 'PREVIEW'; preview: LitePreview }
  | {
      mode: 'AUTHORIZED'
      pack_id: string
      expires_at: string
      item_count: number
      provider_impact: 'NONE'
      note: string
    }

/** Store the authorisation (with every item's fingerprint) and announce it; the database row is the receipt. */
async function writeAuthorization(input: {
  ports: LiteServicePorts
  packId: string
  clientId: string
  actor: LiteActor
  lifetimeDays: number
  contentHash: string
  now: Date
}): Promise<LiteResult<LiteAuthorizeOutcome>> {
  const { ports, packId, clientId, actor, now } = input
  const items = await ports.store.getItems(packId, clientId)
  // The preview took a moment (it downloads every file). What gets authorised is what is stored NOW,
  // so it must still be exactly what the person confirmed.
  if (computePackContentHash(items, input.lifetimeDays) !== input.contentHash) {
    return fail(409, 'PACK_CHANGED_SINCE_PREVIEW')
  }
  const fingerprints: Record<string, string> = {}
  for (const item of items) fingerprints[item.item_id] = computeItemFingerprint(item)

  const expiresAt = new Date(now.getTime() + input.lifetimeDays * DAY_MS)
  const byEmail = normalizeEmail(actor.email)
  const stored = await storeAuthorization({
    ports, packId, clientId, byEmail, byUserId: actor.id, now, expiresAt, contentHash: input.contentHash, fingerprints,
  })
  if (!stored.ok) return stored

  await sendEventBestEffort(ports, {
    id: `${packId}:authorized`,
    name: 'story.pack.authorized',
    data: {
      client_id: clientId,
      pack_id: packId,
      item_count: items.length,
      expires_at: expiresAt.toISOString(),
      authorized_by_email: byEmail,
      authorization: 'AUTHORIZED',
      provider_impact: 'NONE',
    },
  })
  return ok({
    mode: 'AUTHORIZED',
    pack_id: packId,
    expires_at: expiresAt.toISOString(),
    item_count: items.length,
    provider_impact: 'NONE',
    note: AUTHORIZED_NOTE,
  })
}

export async function authorizeLitePack(input: {
  ports: LiteServicePorts
  packId: string
  clientId: string
  actor: LiteActor
  confirm: boolean
  lifetimeDays?: number
  expectedContentHash?: string
  now: Date
}): Promise<LiteResult<LiteAuthorizeOutcome>> {
  const admin = requireGlobalAdmin(input.ports, input.actor)
  if (!admin.ok) return admin

  const lifetime = resolveLifetimeDays(input.lifetimeDays)
  if (!lifetime.ok) return lifetime

  const previewResult = await buildLitePreview({
    ports: input.ports,
    packId: input.packId,
    clientId: input.clientId,
    actor: input.actor,
    now: input.now,
    lifetimeDays: lifetime.value,
  })
  if (!previewResult.ok) return previewResult
  const preview = previewResult.value

  if (input.confirm !== true) return ok({ mode: 'PREVIEW', preview })

  const checks = confirmChecks(preview, input.expectedContentHash)
  if (!checks.ok) return checks

  return writeAuthorization({
    ports: input.ports,
    packId: input.packId,
    clientId: input.clientId,
    actor: input.actor,
    lifetimeDays: lifetime.value,
    contentHash: preview.content_hash,
    now: input.now,
  })
}

/** Validate the revoke reason: 1..300 characters after trimming. */
function validateReason(reason: string): LiteResult<string> {
  const trimmed = reason.trim()
  if (trimmed.length < 1 || trimmed.length > MAX_REASON_LENGTH) return fail(400, 'BAD_REASON')
  return ok(trimmed)
}

/** Read the items back and split them into already-sent and in-flight. */
async function summariseAfterRevoke(
  ports: LiteServicePorts,
  packId: string,
  clientId: string,
): Promise<{
  sent: Array<{ item_id: string; provider_receipt: string | null }>
  in_flight: Array<{ item_id: string; status: LiteItemStatus }>
  available: boolean
}> {
  let items: LiteItem[] = []
  let available = true
  try {
    items = await ports.store.getItems(packId, clientId)
  } catch {
    // the pack IS revoked, but we could not read what was already sent: say so, never claim "nothing sent"
    available = false
  }

  const sent = items
    .filter((item) => item.status === 'SENT')
    .map((item) => ({ item_id: item.item_id, provider_receipt: item.provider_receipt }))
  const inFlight = items
    .filter((item) => item.status === 'CLAIMED' || item.status === 'UNKNOWN_OUTCOME')
    .map((item) => ({ item_id: item.item_id, status: item.status }))

  return { sent, in_flight: inFlight, available }
}

/** Revoke a pack: stops everything not yet sent. Already-published stories stay. */
export interface LiteRevokeOutcome {
  pack_id: string
  sent: Array<{ item_id: string; provider_receipt: string | null }>
  in_flight: Array<{ item_id: string; status: LiteItemStatus }>
  /** False when the pack was stopped but the sent / in-flight summary could not be read. */
  summary_available: boolean
  note: string
}

export async function revokeLitePack(input: {
  ports: LiteServicePorts
  packId: string
  clientId: string
  actor: LiteActor
  reason: string
  now: Date
}): Promise<LiteResult<LiteRevokeOutcome>> {
  const { ports, packId, clientId, actor, now } = input
  const admin = requireGlobalAdmin(ports, actor)
  if (!admin.ok) return admin

  const reason = validateReason(input.reason)
  if (!reason.ok) return reason

  const byEmail = normalizeEmail(actor.email)
  const revoked = await ports.store.revokePack({ packId, clientId, byEmail, reason: reason.value, now })
  if (revoked === null) return fail(404, 'NOTHING_TO_REVOKE')

  await sendEventBestEffort(ports, {
    id: `${packId}:revoked`,
    name: 'story.pack.revoked',
    data: { client_id: clientId, pack_id: packId, revoked_by_email: byEmail, reason: reason.value, provider_impact: 'NONE' },
  })

  const summary = await summariseAfterRevoke(ports, packId, clientId)
  return ok({
    pack_id: packId,
    sent: summary.sent,
    in_flight: summary.in_flight,
    summary_available: summary.available,
    note: REVOKED_NOTE,
  })
}
