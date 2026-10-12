// Pure planning logic for the local booking import preview tool.
// Turns validated rows plus reader facts into a plan and a summary.
// Never mutates inputs, never throws except on a length mismatch.
// planHash uses globalThis.crypto.subtle and hashes ids only (no PII).

import type {
  ImportRow,
  PlanItem,
  PlanStatus,
  PlanSummary,
  RowFacts,
} from './types'

function decideStatus(reasons: string[]): PlanStatus {
  if (reasons.length === 0) return 'ready'
  if (reasons.length === 1 && reasons[0] === 'already_imported') {
    return 'skip_already_imported'
  }
  return 'needs_human'
}

function buildItem(row: ImportRow, facts: RowFacts, reasons: string[]): PlanItem {
  const contactId = facts.contact.kind === 'one' ? facts.contact.contactId : null
  const departure = facts.departure
  return {
    index: row.index,
    invoice: row.invoice,
    tourKey: row.tourKey,
    departOn: row.departOn,
    status: decideStatus(reasons),
    reasons: reasons.slice(),
    contactId,
    tourId: departure === null ? null : departure.tourId,
    departureId: departure === null ? null : departure.departureId,
    partySize: row.partySize,
    originKind: row.originKind,
    bookedOn: row.bookedOn,
    depositPaid: row.depositPaid,
    paidOn: row.paidOn,
  }
}

// Whitelist (same as the public catalog output): any other or unknown status goes to a human.
const OPEN_STATUSES = new Set(['open', 'limited'])

function guestDepartureKey(facts: RowFacts): string | null {
  if (facts.contact.kind !== 'one' || facts.departure === null) return null
  return `${facts.contact.contactId}|${facts.departure.departureId}`
}

function countBy(keys: Array<string | null>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const key of keys) {
    if (key !== null) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function departureReasons(facts: RowFacts): string[] {
  if (facts.departureAmbiguous) return ['departure_ambiguous']
  if (facts.departure === null) return ['departure_not_found']
  if (facts.departure.status === null) return ['departure_status_unknown']
  if (!OPEN_STATUSES.has(facts.departure.status)) return ['departure_not_open']
  return []
}

function invoiceOrderReasons(row: ImportRow, facts: RowFacts, blocking: boolean): string[] {
  const order = facts.orderWithInvoice
  if (order === null) return []
  const sameContact = facts.contact.kind === 'one' && facts.contact.contactId === order.contactId
  const sameDeparture = facts.departure !== null && order.departureId === facts.departure.departureId
  if (!sameContact || !sameDeparture || blocking) return ['invoice_used_elsewhere']
  // Same invoice, same guest, same departure: only "already imported" when nothing about it differs.
  const differs = order.partySize !== row.partySize || order.originKind !== row.originKind
  return differs ? ['imported_but_differs'] : ['already_imported']
}

/** Reasons for ONE row. Duplicates are decided on the whole input first, so BOTH rows of a pair are held back. */
function collectReasons(
  row: ImportRow,
  facts: RowFacts,
  invoiceCounts: Map<string, number>,
  guestCounts: Map<string, number>,
): string[] {
  const reasons: string[] = []
  if ((invoiceCounts.get(row.invoice) ?? 0) > 1) reasons.push('duplicate_in_input')
  const guestKey = guestDepartureKey(facts)
  if (guestKey !== null && (guestCounts.get(guestKey) ?? 0) > 1) reasons.push('duplicate_guest_in_input')

  if (facts.contact.kind === 'none') reasons.push('contact_not_found')
  if (facts.contact.kind === 'many') reasons.push('contact_ambiguous')
  reasons.push(...departureReasons(facts))

  reasons.push(...invoiceOrderReasons(row, facts, reasons.length > 0))

  const order = facts.orderWithInvoice
  const guestOrder = facts.orderForGuestAndDeparture
  // Compare by booking id: the reader may hand back two separate objects for the same order.
  if (guestOrder !== null && (order === null || guestOrder.bookingId !== order.bookingId)) {
    reasons.push('order_exists_for_guest')
  }
  return reasons
}

/** Build one plan item per row. facts[i] belongs to rows[i]. */
export function buildPlan(rows: ImportRow[], facts: RowFacts[]): PlanItem[] {
  if (rows.length !== facts.length) {
    throw new Error('rows and facts length mismatch')
  }
  const invoiceCounts = countBy(rows.map((row) => row.invoice))
  const guestCounts = countBy(facts.map(guestDepartureKey))
  return rows.map((row, i) => buildItem(row, facts[i], collectReasons(row, facts[i], invoiceCounts, guestCounts)))
}

/**
 * When the order table has no invoice column yet (migration not applied), the "already imported?" check was NOT done,
 * so nothing may be called ready: the plan is not usable for a real import.
 */
export function markInvoiceCheckUnavailable(items: PlanItem[]): PlanItem[] {
  return items.map((item) =>
    item.status === 'ready'
      ? { ...item, status: 'needs_human' as const, reasons: [...item.reasons, 'invoice_check_unavailable'] }
      : item,
  )
}

/** Aggregate counts and per-departure people for a plan. */
export function summarise(items: PlanItem[]): PlanSummary {
  const reasonCounts: Record<string, number> = {}
  const peopleByDeparture: Record<string, number> = {}
  let ready = 0
  let skipAlreadyImported = 0
  let needsHuman = 0
  let readyPeople = 0
  let depositsToMarkPaid = 0

  for (const item of items) {
    if (item.status === 'ready') {
      ready += 1
      readyPeople += item.partySize
      if (item.depositPaid) depositsToMarkPaid += 1
      if (item.departureId !== null) {
        peopleByDeparture[item.departureId] =
          (peopleByDeparture[item.departureId] ?? 0) + item.partySize
      }
    } else if (item.status === 'skip_already_imported') {
      skipAlreadyImported += 1
    } else {
      needsHuman += 1
    }
    for (const reason of item.reasons) {
      reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1
    }
  }

  return {
    total: items.length,
    ready,
    skipAlreadyImported,
    needsHuman,
    readyPeople,
    depositsToMarkPaid,
    reasonCounts,
    peopleByDeparture,
  }
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let out = ''
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0')
  }
  return out
}

/** Hex sha256 of the JSON of the items (ids only, no PII). */
export async function planHash(items: PlanItem[]): Promise<string> {
  const json = JSON.stringify(items)
  const encoded = new TextEncoder().encode(json)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded)
  return toHex(digest)
}
