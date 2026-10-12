// Read-only fact gathering for the local booking import preview tool.
// Looks up contacts by identity, resolves departures by tour slug + date, and
// finds existing active orders by invoice or by guest+departure.
// The Supabase client is always passed in; this module never creates one.
// Never writes: no insert/update/delete/upsert/rpc anywhere in this file.

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '../../supabase-paginate'
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
const EVIDENCE_REF_MISSING_RE = /column\s+[\w."]*\bevidence_ref"?\s+does not exist/i

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

/** Collect the distinct normalised identity values across all rows. */
function collectIdentityValues(rows: ImportRow[], norm: Normalisers): string[] {
  const values = new Set<string>()
  for (const row of rows) {
    const phone = norm.normalisePhone(row.phone)
    if (phone !== null && phone.length > 0) values.add(phone)
    const email = norm.normaliseEmail(row.email)
    if (email !== null && email.length > 0) values.add(email)
  }
  return Array.from(values)
}

async function loadIdentityChunk(
  db: SupabaseClient,
  clientId: string,
  values: string[],
): Promise<IdentityRow[]> {
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
  )
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
  if (phone !== null) {
    const found = index.get(phone)
    if (found !== undefined) for (const id of found) ids.add(id)
  }
  const email = norm.normaliseEmail(row.email)
  if (email !== null) {
    const found = index.get(email)
    if (found !== undefined) for (const id of found) ids.add(id)
  }
  if (ids.size === 0) return { kind: 'none' }
  const sorted = Array.from(ids).sort()
  if (sorted.length === 1) return { kind: 'one', contactId: sorted[0] }
  return { kind: 'many', contactIds: sorted }
}

interface TourRow {
  id: string
  slug: string
}

interface DepartureRow {
  id: string
  tour_id: string
  depart_on: string
}

function mapTourRow(raw: unknown): TourRow | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  if (!isNonEmptyString(row.id)) return null
  if (!isNonEmptyString(row.slug)) return null
  return { id: row.id, slug: row.slug }
}

function mapDepartureRow(raw: unknown): DepartureRow | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  if (!isNonEmptyString(row.id)) return null
  if (!isNonEmptyString(row.tour_id)) return null
  if (!isNonEmptyString(row.depart_on)) return null
  return { id: row.id, tour_id: row.tour_id, depart_on: row.depart_on }
}

async function loadTours(db: SupabaseClient, clientId: string): Promise<TourRow[]> {
  const raw = await fetchAll<unknown>(
    (from, to) =>
      db
        .from('tour_catalog_tours')
        .select('id, slug')
        .eq('client_id', clientId)
        .order('id', { ascending: true })
        .range(from, to),
    2000,
  )
  const out: TourRow[] = []
  for (const element of raw) {
    const mapped = mapTourRow(element)
    if (mapped === null) throw new Error('unmappable tour row')
    out.push(mapped)
  }
  return out
}

async function loadDepartures(db: SupabaseClient, clientId: string): Promise<DepartureRow[]> {
  const raw = await fetchAll<unknown>(
    (from, to) =>
      db
        .from('tour_catalog_departures')
        .select('id, tour_id, depart_on')
        .eq('client_id', clientId)
        .order('id', { ascending: true })
        .range(from, to),
    5000,
  )
  const out: DepartureRow[] = []
  for (const element of raw) {
    const mapped = mapDepartureRow(element)
    if (mapped === null) throw new Error('unmappable departure row')
    out.push(mapped)
  }
  return out
}

/** `${slug}|${depart_on}` -> resolved departure. */
async function loadDepartureIndex(
  db: SupabaseClient,
  clientId: string,
): Promise<Map<string, ResolvedDeparture>> {
  const [tours, departures] = await Promise.all([
    loadTours(db, clientId),
    loadDepartures(db, clientId),
  ])
  const slugById = new Map<string, string>()
  for (const tour of tours) slugById.set(tour.id, tour.slug)
  const index = new Map<string, ResolvedDeparture>()
  for (const departure of departures) {
    const slug = slugById.get(departure.tour_id)
    if (slug === undefined) continue
    index.set(`${slug}|${departure.depart_on}`, {
      departureId: departure.id,
      tourId: departure.tour_id,
    })
  }
  return index
}

interface OrderRow {
  id: string
  contact_id: string
  departure_id: string | null
  status: string
  evidence_ref: string | null
}

function mapOrderRow(raw: unknown, withEvidence: boolean): OrderRow | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  if (!isNonEmptyString(row.id)) return null
  if (!isNonEmptyString(row.contact_id)) return null
  if (!isNonEmptyString(row.status)) return null
  const departureId = isNonEmptyString(row.departure_id) ? row.departure_id : null
  const evidenceRef = withEvidence && isNonEmptyString(row.evidence_ref) ? row.evidence_ref : null
  return {
    id: row.id,
    contact_id: row.contact_id,
    departure_id: departureId,
    status: row.status,
    evidence_ref: evidenceRef,
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
        .select('id, contact_id, departure_id, status, evidence_ref')
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
        .select('id, contact_id, departure_id, status')
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
    status: 'active',
    evidenceRef: row.evidence_ref,
  }
}

function findOrderWithInvoice(orders: OrderRow[], invoice: string): ExistingOrder | null {
  for (const order of orders) {
    if (order.evidence_ref === null) continue
    if (normaliseInvoice(order.evidence_ref) === invoice) return toExistingOrder(order)
  }
  return null
}

function findOrderForGuest(
  orders: OrderRow[],
  contact: ContactMatch,
  departure: ResolvedDeparture | null,
): ExistingOrder | null {
  if (contact.kind !== 'one' || departure === null) return null
  for (const order of orders) {
    if (order.contact_id === contact.contactId && order.departure_id === departure.departureId) {
      return toExistingOrder(order)
    }
  }
  return null
}

function buildFacts(
  rows: ImportRow[],
  identityIndex: Map<string, Set<string>>,
  departureIndex: Map<string, ResolvedDeparture>,
  orders: OrderRow[],
  norm: Normalisers,
): RowFacts[] {
  return rows.map((row) => {
    const contact = matchContact(row, identityIndex, norm)
    const departure = departureIndex.get(`${row.tourKey}|${row.departOn}`) ?? null
    return {
      contact,
      departure,
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
