// Read-only fact gathering for the local booking import preview tool.
// Looks up contacts by identity, resolves departures by tour slug + date, and
// finds existing active orders by invoice or by guest+departure.
// The Supabase client is always passed in; this module never creates one.
// Never writes: no insert/update/delete/upsert/rpc anywhere in this file.

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '../../supabase-paginate'
import { loadSalesDepartureFacts } from '../../tour-catalog/sales-facts'
import type {
  ContactMatch,
  ExistingOrder,
  ImportRow,
  ResolvedDeparture,
  RowFacts,
} from './types'

export interface Normalisers {
  normalisePhone: (raw: string | null | undefined) => string | null
  normaliseEmail: (raw: string | null | undefined) => string | null
}

export interface ReadFactsResult {
  facts: RowFacts[]
  originColumnsMissing: boolean
}

const IDENTITY_CHUNK = 100
const EVIDENCE_REF_MISSING_RE = /column\s+[\w."]*\b(evidence_ref|origin_kind)"?\s+does not exist/i

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

/** Trim, upper-case, and remove all whitespace and hyphens (matches parse.ts). */
function normaliseInvoice(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]+/g, '')
}

interface IdentityRow {
  contact_id: string
  kind: string
  value: string
}

function mapIdentityRow(raw: unknown): IdentityRow | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  if (!isNonEmptyString(row.contact_id)) return null
  if (!isNonEmptyString(row.kind)) return null
  if (!isNonEmptyString(row.value)) return null
  return { contact_id: row.contact_id, kind: row.kind, value: row.value }
}

/**
 * Only plain identity characters may be put into a PostgREST filter: quotes, backslashes, commas, brackets and control
 * characters can break the filter (and make the error text echo the value, which is a contact detail). A value with
 * anything else is simply never looked up, so the row ends up as "contact not found" and a human looks at it.
 */
const SAFE_IDENTITY = /^[A-Za-z0-9+@._'-]+$/

function isSafeIdentity(value: string): boolean {
  return SAFE_IDENTITY.test(value)
}

/** Collect the distinct normalised identity values across all rows. */
function collectIdentityValues(rows: ImportRow[], norm: Normalisers): string[] {
  const values = new Set<string>()
  for (const row of rows) {
    const phone = norm.normalisePhone(row.phone)
    if (phone !== null && isSafeIdentity(phone)) values.add(phone)
    const email = norm.normaliseEmail(row.email)
    if (email !== null && isSafeIdentity(email)) values.add(email)
  }
  return Array.from(values)
}

async function loadIdentityChunk(
  db: SupabaseClient,
  clientId: string,
  values: string[],
): Promise<IdentityRow[]> {
  // The database error text may echo the looked-up values (contact details): never let it out.
  const raw = await fetchAll<unknown>(
    (from, to) =>
      db
        .from('contact_identities')
        .select('contact_id, kind, value')
        .eq('client_id', clientId)
        .in('kind', ['phone', 'email'])
        .in('value', values)
        .order('id', { ascending: true })
        .range(from, to),
    5000,
  ).catch(() => {
    throw new Error('identity_lookup_failed')
  })
  const out: IdentityRow[] = []
  for (const element of raw) {
    const mapped = mapIdentityRow(element)
    if (mapped === null) throw new Error('unmappable contact identity row')
    out.push(mapped)
  }
  return out
}

/** value -> set of contact ids that carry it. */
async function loadIdentityIndex(
  db: SupabaseClient,
  clientId: string,
  values: string[],
): Promise<Map<string, Set<string>>> {
  const index = new Map<string, Set<string>>()
  if (values.length === 0) return index
  for (const part of chunk(values, IDENTITY_CHUNK)) {
    const rows = await loadIdentityChunk(db, clientId, part)
    for (const row of rows) {
      const existing = index.get(row.value)
      if (existing === undefined) {
        index.set(row.value, new Set([row.contact_id]))
      } else {
        existing.add(row.contact_id)
      }
    }
  }
  return index
}

function matchContact(
  row: ImportRow,
  index: Map<string, Set<string>>,
  norm: Normalisers,
): ContactMatch {
  const ids = new Set<string>()
  const phone = norm.normalisePhone(row.phone)
  if (phone !== null && isSafeIdentity(phone)) {
    const found = index.get(phone)
    if (found !== undefined) for (const id of found) ids.add(id)
  }
  const email = norm.normaliseEmail(row.email)
  if (email !== null && isSafeIdentity(email)) {
    const found = index.get(email)
    if (found !== undefined) for (const id of found) ids.add(id)
  }
  if (ids.size === 0) return { kind: 'none' }
  const sorted = Array.from(ids).sort()
  if (sorted.length === 1) return { kind: 'one', contactId: sorted[0] }
  return { kind: 'many', contactIds: sorted }
}

interface DepartureIndex {
  /** `${slug}|${depart_on}` -> every catalog departure with that key (more than one = ambiguous) */
  byKey: Map<string, ResolvedDeparture[]>
}

/** Departures come ONLY through the sanctioned catalog reader (sales-facts): this tool never touches the tables. */
async function loadDepartureIndex(db: SupabaseClient, clientId: string): Promise<DepartureIndex> {
  const facts = await loadSalesDepartureFacts(db, clientId)
  const byKey = new Map<string, ResolvedDeparture[]>()
  for (const fact of facts) {
    if (fact.tourSlug === null) continue
    const key = `${fact.tourSlug}|${fact.departOn}`
    const list = byKey.get(key) ?? []
    list.push({ departureId: fact.departureId, tourId: fact.tourId, status: fact.status })
    byKey.set(key, list)
  }
  return { byKey }
}

interface OrderRow {
  id: string
  contact_id: string
  departure_id: string | null
  tour_id: string | null
  status: string
  evidence_ref: string | null
  party_size: number | null
  origin_kind: string | null
}

function mapOrderRow(raw: unknown, withOrigin: boolean): OrderRow | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  if (!isNonEmptyString(row.id)) return null
  if (!isNonEmptyString(row.contact_id)) return null
  if (!isNonEmptyString(row.status)) return null
  return {
    id: row.id,
    contact_id: row.contact_id,
    departure_id: isNonEmptyString(row.departure_id) ? row.departure_id : null,
    tour_id: isNonEmptyString(row.tour_id) ? row.tour_id : null,
    status: row.status,
    evidence_ref: withOrigin && isNonEmptyString(row.evidence_ref) ? row.evidence_ref : null,
    party_size: typeof row.party_size === 'number' ? row.party_size : null,
    origin_kind: withOrigin && isNonEmptyString(row.origin_kind) ? row.origin_kind : null,
  }
}

interface OrdersResult {
  rows: OrderRow[]
  originColumnsMissing: boolean
}

async function loadOrders(db: SupabaseClient, clientId: string): Promise<OrdersResult> {
  const withEvidence = await fetchAll<unknown>(
    (from, to) =>
      db
        .from('crm_bookings')
        .select('id, contact_id, departure_id, tour_id, status, party_size, evidence_ref, origin_kind')
        .eq('client_id', clientId)
        .eq('status', 'active')
        .order('id', { ascending: true })
        .range(from, to),
    20000,
  ).then(
    (rows) => ({ ok: true as const, rows }),
    (error: unknown) => ({ ok: false as const, error }),
  )

  if (withEvidence.ok) {
    return { rows: mapOrders(withEvidence.rows, true), originColumnsMissing: false }
  }

  const message = withEvidence.error instanceof Error ? withEvidence.error.message : String(withEvidence.error)
  if (!EVIDENCE_REF_MISSING_RE.test(message)) throw withEvidence.error

  const withoutEvidence = await fetchAll<unknown>(
    (from, to) =>
      db
        .from('crm_bookings')
        .select('id, contact_id, departure_id, tour_id, status, party_size')
        .eq('client_id', clientId)
        .eq('status', 'active')
        .order('id', { ascending: true })
        .range(from, to),
    20000,
  )
  return { rows: mapOrders(withoutEvidence, false), originColumnsMissing: true }
}

function mapOrders(raw: unknown[], withEvidence: boolean): OrderRow[] {
  const out: OrderRow[] = []
  for (const element of raw) {
    const mapped = mapOrderRow(element, withEvidence)
    if (mapped === null) throw new Error('unmappable booking row')
    out.push(mapped)
  }
  return out
}

function toExistingOrder(row: OrderRow): ExistingOrder {
  return {
    bookingId: row.id,
    contactId: row.contact_id,
    departureId: row.departure_id,
    tourId: row.tour_id,
    status: 'active',
    evidenceRef: row.evidence_ref,
    partySize: row.party_size,
    originKind: row.origin_kind,
  }
}

function findOrderWithInvoice(orders: OrderRow[], invoice: string): ExistingOrder | null {
  for (const order of orders) {
    if (order.evidence_ref === null) continue
    if (normaliseInvoice(order.evidence_ref) === invoice) return toExistingOrder(order)
  }
  return null
}

/**
 * An active order of the same guest on the same departure — OR on the same tour with no departure chosen (the order
 * table treats "no departure" as its own slot, so such an order is still the same guest on the same tour).
 */
function findOrderForGuest(
  orders: OrderRow[],
  contact: ContactMatch,
  departure: ResolvedDeparture | null,
): ExistingOrder | null {
  if (contact.kind !== 'one' || departure === null) return null
  for (const order of orders) {
    if (order.contact_id !== contact.contactId) continue
    const sameDeparture = order.departure_id === departure.departureId
    const sameTourNoDeparture = order.departure_id === null && order.tour_id === departure.tourId
    if (sameDeparture || sameTourNoDeparture) return toExistingOrder(order)
  }
  return null
}

function buildFacts(
  rows: ImportRow[],
  identityIndex: Map<string, Set<string>>,
  departureIndex: DepartureIndex,
  orders: OrderRow[],
  norm: Normalisers,
): RowFacts[] {
  return rows.map((row) => {
    const contact = matchContact(row, identityIndex, norm)
    const matches = departureIndex.byKey.get(`${row.tourKey}|${row.departOn}`) ?? []
    const departure = matches.length === 1 ? matches[0] : null
    return {
      contact,
      departure,
      departureAmbiguous: matches.length > 1,
      orderWithInvoice: findOrderWithInvoice(orders, row.invoice),
      orderForGuestAndDeparture: findOrderForGuest(orders, contact, departure),
    }
  })
}

/** Read all facts needed to plan the given rows. Read-only; never writes. */
export async function readFacts(
  db: SupabaseClient,
  clientId: string,
  rows: ImportRow[],
  norm: Normalisers,
): Promise<ReadFactsResult> {
  const values = collectIdentityValues(rows, norm)
  const [identityIndex, departureIndex, ordersResult] = await Promise.all([
    loadIdentityIndex(db, clientId, values),
    loadDepartureIndex(db, clientId),
    loadOrders(db, clientId),
  ])
  const facts = buildFacts(rows, identityIndex, departureIndex, ordersResult.rows, norm)
  return { facts, originColumnsMissing: ordersResult.originColumnsMissing }
}
