/**
 * One purchase when staff record a configured deal.
 *
 * A payment of the configured milestone is approved by the system and sent
 * through the existing sender. A hand-entered stage deal stays pending review
 * and is not sent from here. The inserted row id is the platform event id.
 * A second source that already has an approved purchase for this contact
 * inside 30 days blocks a new row.
 *
 * Catalog totals are starting prices ("From …" × party size). A missing party
 * size does not fall back to a staff-typed amount, and this module does not
 * insert a purchase with no amount: the sale table still rejects that.
 */

import type { DncTouch } from '@/lib/crm/dnc'
import { isDoNotContact } from '@/lib/crm/dnc'
import { readCapiClientConfig, type DealMilestone } from './capi-client-config'
import { legalPartySize } from './crm-deal-party'
import { autoPassMessage, CRM_DEAL_AUTO_ACTOR, partyReadNote, type DealSendClass } from './crm-deal-send'
import { buildIntakeRow, type IntakeRow } from './intake'
import { minorToDecimalString, priceDealFromCatalog } from './tour-deal-price'
import { toMinorUnits } from './money'

export type DealWrite = {
  reviewStatus: 'approved'
  reviewedBy: string
  reviewedAt: string
  milestoneKind: DealMilestone
}

export const DEAL_DEDUPE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
export const CRM_STAGE_MANUAL_SOURCE = 'crm_stage_manual'

export type ApprovedPurchase = {
  sourceKind: string
  occurredAt: string
  reviewStatus: string
  outcomeKind?: string
}

export type DealBooking = {
  contactId: string
  partySize: number | null
  tourId: string | null
  departureId: string | null
  /** Present once the milestone rows were read. Absent only in older callers. */
  paidOnByKind?: Partial<Record<DealMilestone, string | null>>
}

export type DealIo = {
  loadClient(clientId: string): Promise<{
    conversionStage: string | null
    defaultPhoneCountry: string | null
    leadsConfig: unknown
  } | null>
  loadContact(clientId: string, contactId: string): Promise<{
    email: string | null
    phone: string | null
    doNotContact: boolean
  } | null>
  loadPsid(clientId: string, contactId: string): Promise<string | null>
  loadMetaLeadId(clientId: string, contactId: string): Promise<string | null>
  loadBooking(clientId: string, bookingId: string): Promise<DealBooking | null>
  loadPriceTexts(clientId: string, tourId: string | null, departureId: string | null): Promise<{
    departurePriceText: string | null
    tourPriceText: string | null
  }>
  loadApprovedPurchases(clientId: string, contactId: string): Promise<ApprovedPurchase[]>
  loadDncTouches(clientId: string, contactId: string): Promise<DncTouch[] | null>
  /** Headcount already stored on follow-ups or mail previews. Not used for hand-entered deals. */
  loadStoredPartySize?(clientId: string, contactId: string): Promise<number | null>
  insertOutcome(row: IntakeRow, write?: DealWrite): Promise<{ ok: true; id: string } | { ok: false; duplicate: boolean }>
  /** The row that already owns this source ref, if the insert collided. */
  loadExistingSourceDeal(clientId: string, sourceKind: string, sourceRef: string): Promise<ExistingSourceDeal | null>
  /** Reopen a payment-voided deal. `write` approves it again; without it the row waits for review. */
  restoreVoidedDeal(id: string, row: IntakeRow, stoppedSendIds: string[], write?: DealWrite): Promise<{ ok: boolean }>
  /** Send an already approved payment deal. Must not throw. */
  dispatchSend?(outcomeId: string): Promise<DealSendClass>
}

export type ExistingSourceDeal = {
  id: string
  voidedByPaymentReversal: boolean
  stoppedSendIds: string[]
}

export type DealRecordResult = {
  attempted: boolean
  recorded: boolean
  alreadyRecorded: boolean
  outcomeId: string | null
  reason: string | null
  message: string
  advanceStage: boolean
  doNotContact: boolean
}

const MSG = {
  recorded: '记下了，等审核后再发给广告平台。',
  dnc: '记下了，等审核。这位客人在拒联名单上，审核通过也不会发给广告平台。',
  already: '这笔已经记过了，没有再插入一条。',
  restored: '这笔之前因为撤销收款作废了。款又记下之后，已重新打开，等审核后再发给广告平台。',
  notLive: '这位客户还没开到正式发送，这笔没有写成成交记录。',
  noMatch: '没有邮箱、电话或私信身份，成交记录没有写成。',
  missingParty: '订单没有人数，不能按标价估算，成交记录没有写成。',
  unpriced: '没有可用的标价，成交记录没有写成。现有的成交表要求必须有金额，所以没有空着金额存一条。',
  dedupe: '近 30 天已有另一来源的已批准成交，这条没有再记。',
  failed: '成交记录没有写成。',
  contactMismatch: '订单上的客人和这一步要记的不是同一人，成交记录没有写成，阶段也没有往前推。',
  paymentFailed: '款已记下，成交记录没有写成。请稍后再试，这笔款不会因此丢失。',
  missingPaid: '这笔款没有记下付款日，成交记录没有写成。',
}

export function crmDealSourceRef(contactId: string, bookingId: string | null, stageKey: string | null): string {
  if (bookingId) return `crm_deal:${contactId}:${bookingId}`
  return `crm_deal:${contactId}:stage:${stageKey ?? ''}`
}

/**
 * A loaded milestone map wins over the request. Missing or unusable stored
 * dates refuse (`undefined`) instead of substituting the request or today.
 * Callers that never loaded the map still pass the requested date through.
 */
export function milestonePaidOn(
  booking: DealBooking,
  kind: DealMilestone,
  requested: string | null,
): string | null | undefined {
  if (booking.paidOnByKind === undefined) return requested
  const stored = booking.paidOnByKind[kind]
  if (typeof stored === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(stored)) return stored
  return undefined
}

/** Noon at +12 keeps the paid-on calendar date across AU/NZ. */
export function dealOccurredAt(paidOn: string | null, now: Date): string {
  if (paidOn && /^\d{4}-\d{2}-\d{2}$/.test(paidOn)) {
    return new Date(`${paidOn}T12:00:00+12:00`).toISOString()
  }
  if (paidOn) {
    const parsed = new Date(paidOn)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return now.toISOString()
}

/** Approved purchase from another source, occurred_at within 30 days (t === since blocks). */
export function blockingApprovedPurchase(rows: ApprovedPurchase[], now: Date): { sourceKind: string } | null {
  const since = now.getTime() - DEAL_DEDUPE_WINDOW_MS
  for (const row of rows) {
    if (row.reviewStatus !== 'approved' || row.sourceKind === CRM_STAGE_MANUAL_SOURCE) continue
    if (row.outcomeKind != null && row.outcomeKind !== 'purchase') continue
    const t = Date.parse(row.occurredAt)
    if (Number.isNaN(t) || t < since) continue
    return { sourceKind: row.sourceKind }
  }
  return null
}

export async function recordMilestoneDeal(
  io: DealIo,
  input: { clientId: string; bookingId: string; kind: DealMilestone; paidOn: string | null; actor: string | null },
  now: Date,
): Promise<DealRecordResult> {
  const client = await io.loadClient(input.clientId)
  if (!client) return idle('config_absent')
  const cfg = readCapiClientConfig(client.leadsConfig)
  if (cfg.dealMilestoneMalformed) {
    logSkip('config_malformed')
    return idle('config_malformed')
  }
  if (cfg.dealMilestone == null || cfg.dealMilestone !== input.kind) return idle('config_absent')
  if (client.conversionStage !== 'live') return logged('not_live', false, MSG.notLive)
  const booking = await io.loadBooking(input.clientId, input.bookingId)
  if (!booking) return logged('booking_missing', false, MSG.failed)
  const paidOn = milestonePaidOn(booking, input.kind, input.paidOn)
  if (paidOn === undefined) return logged('paid_on_missing', false, MSG.missingPaid)
  return finishDeal(io, client.defaultPhoneCountry, {
    clientId: input.clientId,
    contactId: booking.contactId,
    bookingId: input.bookingId,
    booking,
    stageKey: null,
    occurredAt: dealOccurredAt(paidOn, now),
    actor: input.actor,
    staffAmount: null,
    staffCurrency: null,
    advanceOnDedupe: false,
    warnDnc: false,
    autoPass: true,
    milestoneKind: input.kind,
    partyFromStored: false,
  }, now)
}

export async function recordStageDeal(
  io: DealIo,
  input: {
    clientId: string
    contactId: string
    stageKey: string
    bookingId: string | null
    occurredAt: string | null
    actor: string | null
    staffAmount: string | null
    staffCurrency: string | null
  },
  now: Date,
): Promise<DealRecordResult> {
  const client = await io.loadClient(input.clientId)
  if (!client) return idle('stage_mismatch')
  const cfg = readCapiClientConfig(client.leadsConfig)
  if (cfg.dealStageKeyMalformed) {
    logSkip('config_malformed')
    return idle('stage_mismatch')
  }
  if (cfg.dealStageKey == null || cfg.dealStageKey !== input.stageKey) return idle('stage_mismatch')
  if (client.conversionStage !== 'live') return logged('not_live', true, MSG.notLive)
  const booking = input.bookingId ? await io.loadBooking(input.clientId, input.bookingId) : null
  if (input.bookingId && !booking) return logged('booking_missing', false, MSG.failed)
  if (booking && booking.contactId !== input.contactId) {
    return logged('contact_mismatch', false, MSG.contactMismatch)
  }
  return finishDeal(io, client.defaultPhoneCountry, {
    clientId: input.clientId,
    contactId: input.contactId,
    bookingId: input.bookingId,
    booking,
    stageKey: input.stageKey,
    occurredAt: dealOccurredAt(input.occurredAt, now),
    actor: input.actor,
    staffAmount: input.staffAmount,
    staffCurrency: input.staffCurrency,
    advanceOnDedupe: true,
    warnDnc: true,
    autoPass: false,
    milestoneKind: null,
    partyFromStored: false,
  }, now)
}

type FinishInput = {
  clientId: string
  contactId: string
  bookingId: string | null
  booking: DealBooking | null
  stageKey: string | null
  occurredAt: string
  actor: string | null
  staffAmount: string | null
  staffCurrency: string | null
  advanceOnDedupe: boolean
  warnDnc: boolean
  autoPass: boolean
  milestoneKind: DealMilestone | null
  partyFromStored: boolean
}

async function finishDeal(io: DealIo, phoneCountry: string | null, input: FinishInput, now: Date): Promise<DealRecordResult> {
  const ready = await applyStoredParty(io, input)
  const priced = await resolveAmount(io, ready)
  if (!priced.ok) return logged(priced.reason, false, priced.reason === 'missing_party_size' ? MSG.missingParty : priced.reason === 'invalid_amount' ? MSG.failed : MSG.unpriced)
  const contact = await io.loadContact(input.clientId, input.contactId)
  if (!contact) return logged('contact_missing', false, MSG.failed)
  const block = blockingApprovedPurchase(await io.loadApprovedPurchases(input.clientId, input.contactId), now)
  if (block) {
    logSkip('recent_other_source', block.sourceKind)
    return { ...logged('recent_other_source', input.advanceOnDedupe, MSG.dedupe), alreadyRecorded: false }
  }
  return insertDeal(io, phoneCountry, ready, contact, priced, now)
}

async function insertDeal(
  io: DealIo,
  phoneCountry: string | null,
  input: FinishInput,
  contact: { email: string | null; phone: string | null; doNotContact: boolean },
  priced: { amount: string; currency: string },
  now: Date,
): Promise<DealRecordResult> {
  const built = buildIntakeRow({
    clientId: input.clientId,
    contactId: input.contactId,
    outcomeKind: 'purchase',
    customerEmail: contact.email,
    customerPhone: contact.phone,
    pageScopedUserId: await io.loadPsid(input.clientId, input.contactId),
    metaLeadId: await io.loadMetaLeadId(input.clientId, input.contactId),
    amount: priced.amount,
    currency: priced.currency,
    occurredAt: input.occurredAt,
    sourceKind: CRM_STAGE_MANUAL_SOURCE,
    // Row id from insertOutcome is the platform event_id. Do not mint a second one.
    sourceRef: crmDealSourceRef(input.contactId, input.bookingId, input.stageKey),
    orderRef: input.bookingId,
    createdBy: input.actor,
  }, { defaultPhoneCountry: phoneCountry, now })
  if (!built.ok) {
    const noKey = built.errors.some((e) => e.includes('至少要有'))
    return logged(noKey ? 'no_match_key' : 'unpriced', false, noKey ? MSG.noMatch : MSG.unpriced)
  }
  const write = dealWrite(input, now)
  const inserted = await io.insertOutcome(built.row, write)
  if (!inserted.ok && inserted.duplicate) return resolveDuplicate(io, built.row, input, contact, now)
  if (!inserted.ok) return logged('record_failed', false, MSG.failed)
  return finishRecorded(io, input, contact, inserted.id, 'recorded')
}

async function resolveDuplicate(
  io: DealIo,
  row: IntakeRow,
  input: FinishInput,
  contact: { doNotContact: boolean },
  now: Date,
): Promise<DealRecordResult> {
  const sourceRef = row.source_ref
  if (!sourceRef) return already(input)
  const existing = await io.loadExistingSourceDeal(row.client_id, row.source_kind, sourceRef)
  if (!existing?.voidedByPaymentReversal) return already(input)
  const restored = await io.restoreVoidedDeal(existing.id, row, existing.stoppedSendIds, dealWrite(input, now))
  if (!restored.ok) return logged('record_failed', false, MSG.failed)
  return finishRecorded(io, input, contact, existing.id, 'restored')
}

async function applyStoredParty(io: DealIo, input: FinishInput): Promise<FinishInput> {
  if (!input.autoPass || !input.booking || legalPartySize(input.booking.partySize) != null) return input
  if (!io.loadStoredPartySize) return input
  const stored = legalPartySize(await io.loadStoredPartySize(input.clientId, input.contactId))
  if (stored == null || !input.booking) return input
  return { ...input, partyFromStored: true, booking: { ...input.booking, partySize: stored } }
}

function dealWrite(input: FinishInput, now: Date): DealWrite | undefined {
  if (!input.autoPass || input.milestoneKind == null) return undefined
  return {
    reviewStatus: 'approved',
    reviewedBy: CRM_DEAL_AUTO_ACTOR,
    reviewedAt: now.toISOString(),
    milestoneKind: input.milestoneKind,
  }
}

async function finishRecorded(
  io: DealIo,
  input: FinishInput,
  contact: { doNotContact: boolean },
  outcomeId: string,
  kind: 'recorded' | 'restored',
): Promise<DealRecordResult> {
  if (!input.autoPass) return pendingResult(io, input, contact, outcomeId, kind)
  const send = await safeDispatch(io, outcomeId)
  const message = partyReadNote(autoPassMessage(kind, send), input.partyFromStored)
  return { ...base(true, null, message), recorded: true, outcomeId, advanceStage: false, doNotContact: false }
}

async function pendingResult(
  io: DealIo,
  input: FinishInput,
  contact: { doNotContact: boolean },
  outcomeId: string,
  kind: 'recorded' | 'restored',
): Promise<DealRecordResult> {
  const dnc = input.warnDnc ? await dncOf(io, input, contact.doNotContact) : false
  const message = dnc ? MSG.dnc : kind === 'restored' ? MSG.restored : MSG.recorded
  return { ...base(true, null, message), recorded: true, outcomeId, advanceStage: input.advanceOnDedupe, doNotContact: dnc }
}

async function safeDispatch(io: DealIo, outcomeId: string): Promise<DealSendClass> {
  if (!io.dispatchSend) return 'failed'
  try {
    return await io.dispatchSend(outcomeId)
  } catch {
    return 'failed'
  }
}

function already(input: FinishInput): DealRecordResult {
  return { ...base(true, 'already_recorded', MSG.already), alreadyRecorded: true, advanceStage: input.advanceOnDedupe }
}

async function resolveAmount(
  io: DealIo,
  input: FinishInput,
): Promise<{ ok: true; amount: string; currency: string } | { ok: false; reason: string }> {
  if (!input.booking) return staffAmount(input.staffAmount, input.staffCurrency)
  const texts = await io.loadPriceTexts(input.clientId, input.booking.tourId, input.booking.departureId)
  const priced = priceDealFromCatalog({ ...texts, partySize: input.booking.partySize })
  if (priced.ok) return { ok: true, amount: priced.amount, currency: priced.currency }
  if (priced.reason === 'missing_party_size') return priced
  const partyOk = typeof input.booking.partySize === 'number' && Number.isInteger(input.booking.partySize) && input.booking.partySize >= 1 && input.booking.partySize <= 60
  if (partyOk) {
    const staff = staffAmount(input.staffAmount, input.staffCurrency)
    if (staff.ok) return staff
  }
  return priced
}

function staffAmount(amount: string | null, currency: string | null): { ok: true; amount: string; currency: string } | { ok: false; reason: string } {
  if (amount == null || amount.trim() === '') return { ok: false, reason: 'unpriced' }
  if (currency == null || !/^[A-Za-z]{3}$/.test(currency.trim())) return { ok: false, reason: 'invalid_amount' }
  const code = currency.trim().toUpperCase()
  const minor = toMinorUnits(amount.trim(), code)
  if (minor == null || minor <= 0) return { ok: false, reason: 'invalid_amount' }
  const decimal = minorToDecimalString(minor, code)
  if (decimal == null) return { ok: false, reason: 'invalid_amount' }
  return { ok: true, amount: decimal, currency: code }
}

async function dncOf(io: DealIo, input: FinishInput, flag: boolean): Promise<boolean> {
  const touches = await io.loadDncTouches(input.clientId, input.contactId)
  return isDoNotContact(flag, touches ?? [])
}

function idle(reason: string): DealRecordResult {
  return { ...base(false, reason, ''), advanceStage: false }
}

function logged(reason: string, advanceStage: boolean, message: string): DealRecordResult {
  if (reason !== 'recent_other_source') logSkip(reason)
  return { ...base(true, reason, message), advanceStage }
}

function base(attempted: boolean, reason: string | null, message: string): DealRecordResult {
  return { attempted, recorded: false, alreadyRecorded: false, outcomeId: null, reason, message, advanceStage: false, doNotContact: false }
}

function logSkip(reason: string, otherSource?: string): void {
  const payload: Record<string, string> = { event: 'crm_deal.skipped', reason }
  if (otherSource) payload.otherSource = otherSource
  console.info(JSON.stringify(payload))
}

export const PAYMENT_DEAL_FAIL_MESSAGE = MSG.paymentFailed
