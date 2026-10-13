// Pure parsing and validation for the local booking import preview tool.
// Takes already-parsed JSON (unknown) and returns per-row outcomes.
// Never throws, never logs, never touches IO.
// The first failing check decides the error code for a row.

import type { ImportRow, OriginKind, ParseOutcome } from './types'

const ORIGIN_KINDS: readonly OriginKind[] = [
  'company_confirmed',
  'customer_stated',
  'staff_entered',
]

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/** Default invoice shape (5 digits); another client's format is passed in by the caller, not edited here. */
export const DEFAULT_INVOICE_PATTERN = /^\d{5}$/

/** Trim, upper-case, and remove all whitespace and hyphens. */
export function normaliseInvoice(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]+/g, '')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  if (month < 1 || month > 12) return false
  if (day < 1 || day > 31) return false
  const d = new Date(Date.UTC(year, month - 1, day))
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  )
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function isOriginKind(value: unknown): value is OriginKind {
  return typeof value === 'string' && (ORIGIN_KINDS as readonly string[]).includes(value)
}

function fail(index: number, code: string): ParseOutcome {
  return { ok: false, index, code }
}

function parseOne(index: number, raw: unknown, invoicePattern: RegExp): ParseOutcome {
  if (!isPlainObject(raw)) return fail(index, 'bad_row')

  const invoiceRaw = readString(raw.invoice)
  if (invoiceRaw === null) return fail(index, 'bad_invoice')
  const invoice = normaliseInvoice(invoiceRaw)
  if (!invoicePattern.test(invoice)) return fail(index, 'bad_invoice')

  if (!isOriginKind(raw.originKind)) return fail(index, 'bad_origin')

  const partySize = raw.partySize
  if (
    typeof partySize !== 'number' ||
    !Number.isInteger(partySize) ||
    partySize < 1 ||
    partySize > 60
  ) {
    return fail(index, 'bad_party_size')
  }

  const tourKey = readString(raw.tourKey)
  if (tourKey === null || tourKey.trim().length === 0) return fail(index, 'bad_tour')

  const departOn = readString(raw.departOn)
  if (departOn === null || !isRealDate(departOn)) return fail(index, 'bad_date')

  const bookedOn = readString(raw.bookedOn)
  if (bookedOn === null || !isRealDate(bookedOn)) return fail(index, 'bad_date')

  // A phone given as a JSON number (no quotes) must not be silently dropped.
  if (raw.phone !== undefined && raw.phone !== null && typeof raw.phone !== 'string') return fail(index, 'bad_phone')
  const phone = readOptionalString(raw.phone)
  const emailRaw = readOptionalString(raw.email)
  const email = emailRaw === null ? null : emailRaw.toLowerCase()
  if (phone === null && email === null) return fail(index, 'missing_contact')

  const depositRaw = raw.depositPaid
  if (depositRaw !== undefined && typeof depositRaw !== 'boolean') {
    return fail(index, 'bad_deposit_flag')
  }
  const depositPaid = depositRaw === true

  let paidOn: string | null = null
  if (depositPaid) {
    const paidOnRaw = readString(raw.paidOn)
    if (paidOnRaw === null || !isRealDate(paidOnRaw)) return fail(index, 'missing_paid_on')
    paidOn = paidOnRaw
  }
  // ISO dates compare as strings: the invoice cannot be later than the departure, nor the payment before the invoice.
  if (bookedOn > departOn) return fail(index, 'bad_date_order')
  if (paidOn !== null && paidOn < bookedOn) return fail(index, 'bad_date_order')

  const row: ImportRow = {
    index,
    invoice,
    originKind: raw.originKind,
    partySize,
    tourKey: tourKey.trim(),
    departOn,
    bookedOn,
    phone,
    email,
    depositPaid,
    paidOn,
  }
  return { ok: true, row }
}

/** Parse and validate the parsed JSON input. Returns one outcome per element. */
export function parseRows(raw: unknown, invoicePattern: RegExp = DEFAULT_INVOICE_PATTERN): ParseOutcome[] {
  if (!Array.isArray(raw)) {
    return [{ ok: false, index: -1, code: 'not_an_array' }]
  }
  return raw.map((element, index) => parseOne(index, element, invoicePattern))
}
