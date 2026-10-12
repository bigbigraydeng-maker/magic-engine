/**
 * Shared HTTP helpers for the CRM booking tracker route handlers (Next.js App Router).
 *
 * Server-side only. The Supabase client is always passed in; this module never
 * imports a client. Responses only ever carry view objects, never raw rows, and
 * never leak SQL messages or internal ids.
 */

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { StoreErrorKind, StoreResult } from './booking-types'
import { findForbiddenField } from './booking-input'
import { getBookingWithMilestones } from './booking-store-reads'
import { getBookingView, nzTodayIso } from './booking-view'
import type { TravelBookingRule } from './industry/travel-booking-rule'
import { asPlainObject, isUuid, readJsonBody } from '@/lib/http/request-helpers'

/** Matches an acceptable JSON content-type header (charset optional). */
const JSON_CONTENT_TYPE = /^application\/json\s*(;\s*charset=[\w.-]+)?\s*$/i

/**
 * Add a `Server-Timing` header (`gate` = access check, `total` = whole handler) so the
 * real server time can be read in browser DevTools. Durations only: no ids, no personal data.
 */
export function withServerTiming(
  response: NextResponse,
  startedAt: number,
  gateMs: number,
): NextResponse {
  const total = Math.max(0, performance.now() - startedAt)
  response.headers.set(
    'Server-Timing',
    `gate;dur=${Math.max(0, gateMs).toFixed(1)}, total;dur=${total.toFixed(1)}`,
  )
  return response
}

/** Build a JSON error response, optionally with a plain-language message. */
export function jsonError(error: string, status: number, message?: string): NextResponse {
  const body: { error: string; message?: string } = { error }
  if (message !== undefined) {
    body.message = message
  }
  return NextResponse.json(body, { status })
}

/** 400 for a malformed request. */
export function invalidRequest(error: string): NextResponse {
  return jsonError(error, 400)
}

/** 404 for a missing booking (or one owned by another client). */
export function notFoundResponse(): NextResponse {
  return jsonError('not_found', 404)
}

/** 404 when the booking tracker is not enabled for this client. */
export function notEnabledResponse(): NextResponse {
  return jsonError('booking_tracker_not_enabled', 404)
}

/** 500 for an unexpected failure; logs the tag and the error server-side. */
export function internalErrorResponse(tag: string, err: unknown): NextResponse {
  console.error('[crm booking] ' + tag, err)
  return jsonError('booking_failed', 500)
}

/** Map a store failure to a safe HTTP response (no SQL text, no internal ids). */
export function storeFailureResponse(failure: { kind: StoreErrorKind; code: string }): NextResponse {
  switch (failure.kind) {
    case 'stale':
      return jsonError('stale', 409, '这条记录刚被别人改过，请刷新后再操作')
    case 'duplicate':
      return jsonError('duplicate_booking', 409, '这位客人已经有一张同一个团、同一个出发日期的订单')
    case 'inactive':
      return jsonError('booking_not_active', 409, '这张订单已经取消了')
    case 'invalid':
      return jsonError(failure.code, 400)
    case 'not_found':
      return jsonError('not_found', 404)
    case 'forbidden':
      return jsonError('Forbidden', 403)
    case 'error':
      return jsonError('booking_failed', 500)
  }
}

/** Reference codes that mean the request body was bad, not that the row is missing. */
const MISSING_REFERENCE_CODES: ReadonlySet<string> = new Set([
  'tour_not_found',
  'departure_not_found',
  'contact_not_found',
])

/**
 * Reclassify a store failure that names a missing *referenced* row (tour,
 * departure, contact) as an invalid request, so the HTTP layer answers 400
 * with that code instead of 404. Every other result is returned unchanged.
 */
export function reclassifyMissingReference<T>(result: StoreResult<T>): StoreResult<T> {
  if (!result.ok && result.kind === 'not_found' && MISSING_REFERENCE_CODES.has(result.code)) {
    return { ok: false, kind: 'invalid', code: result.code }
  }
  return result
}

/** A parsed write body, or the response to return when parsing failed. */
export type BodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: NextResponse }

/** Read and validate a write body: content-type, size cap, plain object, forbidden fields. */
export async function readBookingBody(req: Request): Promise<BodyResult> {
  const contentType = req.headers.get('content-type')
  if (contentType === null || !JSON_CONTENT_TYPE.test(contentType)) {
    return { ok: false, response: jsonError('unsupported_media_type', 415) }
  }
  const parsed = await readJsonBody(req)
  if (!parsed.ok) {
    return { ok: false, response: parsed.response }
  }
  const body = asPlainObject(parsed.body)
  if (body === null) {
    return { ok: false, response: invalidRequest('invalid_body') }
  }
  const forbidden = findForbiddenField(body)
  if (forbidden !== null) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'forbidden_field', field: forbidden }, { status: 400 }),
    }
  }
  return { ok: true, body }
}

/** Validate the id, read the body, and confirm the booking exists for this client. */
export async function prepareBookingWrite(
  req: Request,
  db: SupabaseClient,
  clientId: string,
  bookingId: string,
): Promise<BodyResult> {
  if (!isUuid(bookingId)) {
    return { ok: false, response: invalidRequest('invalid_id') }
  }
  const body = await readBookingBody(req)
  if (!body.ok) {
    return body
  }
  let exists: boolean
  try {
    const item = await getBookingWithMilestones(db, clientId, bookingId)
    exists = item !== null
  } catch (err) {
    return { ok: false, response: internalErrorResponse('booking_lookup_failed', err) }
  }
  if (!exists) {
    return { ok: false, response: notFoundResponse() }
  }
  return body
}

/** The response for a committed write whose view could not be re-read. */
function needsRefreshResponse(
  bookingId: string,
  extra: Record<string, unknown> | undefined,
  status: number,
): NextResponse {
  return NextResponse.json({ ok: true, needsRefresh: true, bookingId, ...extra }, { status })
}

/** Turn a store result into the final response, re-reading the booking view. */
export async function finishBookingWrite(
  result: StoreResult<unknown>,
  db: SupabaseClient,
  clientId: string,
  bookingId: string,
  rule: TravelBookingRule | null,
  extra?: Record<string, unknown>,
  status?: number,
): Promise<NextResponse> {
  if (!result.ok) {
    return storeFailureResponse(result)
  }
  const finalStatus = status ?? 200
  if (rule === null) {
    return needsRefreshResponse(bookingId, extra, finalStatus)
  }
  let view: Awaited<ReturnType<typeof getBookingView>>
  try {
    view = await getBookingView(db, clientId, bookingId, rule, nzTodayIso())
  } catch (err) {
    console.error('[crm booking] booking_view_failed', err)
    return needsRefreshResponse(bookingId, extra, finalStatus)
  }
  if (view === null) {
    return needsRefreshResponse(bookingId, extra, finalStatus)
  }
  return NextResponse.json({ booking: view, ...extra }, { status: finalStatus })
}
