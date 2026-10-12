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

function buildItem(
  row: ImportRow,
  facts: RowFacts,
  reasons: string[],
): PlanItem {
  const contactId = facts.contact.kind === 'one' ? facts.contact.contactId : null
  const departure = facts.departure
  return {
    index: row.index,
    invoice: row.invoice,
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

function collectReasons(
  row: ImportRow,
  facts: RowFacts,
  seenInvoices: Set<string>,
): string[] {
  const reasons: string[] = []

  if (seenInvoices.has(row.invoice)) reasons.push('duplicate_in_input')
  seenInvoices.add(row.invoice)

  if (facts.contact.kind === 'none') reasons.push('contact_not_found')
  if (facts.contact.kind === 'many') reasons.push('contact_ambiguous')

  if (facts.departure === null) reasons.push('departure_not_found')

  const blocking = reasons.length > 0

  const order = facts.orderWithInvoice
  if (order !== null) {
    const sameContact =
      facts.contact.kind === 'one' && facts.contact.contactId === order.contactId
    const sameDeparture =
      facts.departure !== null && order.departureId === facts.departure.departureId
    if (sameContact && sameDeparture && !blocking) {
      reasons.push('already_imported')
    } else {
      reasons.push('invoice_used_elsewhere')
    }
  }

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
  const seenInvoices = new Set<string>()
  const items: PlanItem[] = []
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    const fact = facts[i]
    const reasons = collectReasons(row, fact, seenInvoices)
    items.push(buildItem(row, fact, reasons))
  }
  return items
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
