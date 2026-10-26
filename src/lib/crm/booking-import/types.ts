// Pure type definitions for the local, read-only booking import preview tool.
// No IO, no supabase, no fs, no process, no console.
// These types describe validated input rows, reader facts, and the resulting plan.
// All identifiers are opaque strings; no PII is stored beyond what the reader returns.

export type OriginKind = 'company_confirmed' | 'customer_stated' | 'staff_entered'

/** One line of the local input file, after validation and normalisation. */
export interface ImportRow {
  index: number                 // 0-based position in the input file
  invoice: string               // normalised: upper-case, no whitespace, no hyphens; must be exactly 5 digits
  originKind: OriginKind
  partySize: number             // integer 1..60
  tourKey: string               // tour slug as in the tour catalog, e.g. "essentials"
  departOn: string              // YYYY-MM-DD
  bookedOn: string              // YYYY-MM-DD (invoice date)
  phone: string | null
  email: string | null          // lower-cased
  depositPaid: boolean
  paidOn: string | null         // YYYY-MM-DD, required when depositPaid
}

export type ParseOutcome =
  | { ok: true; row: ImportRow }
  | { ok: false; index: number; code: string }   // code examples: bad_invoice, bad_party_size, bad_origin, bad_date, missing_contact, missing_paid_on, bad_tour

export type ContactMatch =
  | { kind: 'none' }
  | { kind: 'one'; contactId: string }
  | { kind: 'many'; contactIds: string[] }

export interface ResolvedDeparture {
  departureId: string
  tourId: string
  /** raw status from the catalog (open / limited / sold_out / closed / cancelled), null when unknown */
  status: string | null
}

export interface ExistingOrder {
  bookingId: string
  contactId: string
  departureId: string | null
  /** the tour the order is for (an order may be hung on a tour with no departure chosen) */
  tourId: string | null
  status: 'active' | 'cancelled'
  evidenceRef: string | null
  partySize: number | null
  originKind: string | null
}

/** Everything the read-only reader found out about ONE input row. */
export interface RowFacts {
  contact: ContactMatch
  departure: ResolvedDeparture | null
  /** more than one catalog departure matched tour key + date: refuse to guess */
  departureAmbiguous: boolean
  /** an ACTIVE order that already holds this invoice number, if any */
  orderWithInvoice: ExistingOrder | null
  /** an ACTIVE order of the same guest on the same departure, if any */
  orderForGuestAndDeparture: ExistingOrder | null
}

export type PlanStatus = 'ready' | 'skip_already_imported' | 'needs_human'

export interface PlanItem {
  index: number
  invoice: string
  /** the tour key and date as typed in the input, for labelling the preview */
  tourKey: string
  departOn: string
  status: PlanStatus
  reasons: string[]             // machine codes, e.g. contact_not_found
  contactId: string | null
  tourId: string | null
  departureId: string | null
  partySize: number
  originKind: OriginKind
  bookedOn: string
  depositPaid: boolean
  paidOn: string | null
}

export interface PlanSummary {
  total: number
  ready: number
  skipAlreadyImported: number
  needsHuman: number
  readyPeople: number
  depositsToMarkPaid: number
  reasonCounts: Record<string, number>
  /** ready people per departure id */
  peopleByDeparture: Record<string, number>
}
