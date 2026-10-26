/**
 * Browser-side API layer for the CRM "订单与付款" feature.
 *
 * Imported by client React components, so it must NOT import any server
 * module (no supabase, no next/server). Only type-only imports from the
 * shared booking modules.
 */

import type {
  BookingView,
  BookingMember,
  MilestoneKind,
  NudgeList,
  NudgeMode,
} from '@/lib/crm/booking-types'
import type { BookingOptionTour } from '@/lib/crm/booking-options'

export type ApiFailureKind = 'hidden' | 'stale' | 'other'
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: ApiFailureKind; message: string }

export const STALE_MESSAGE = '别人刚改过，已为你刷新'
export const CHANGED_MESSAGE = '这张订单刚刚有变化，已为你刷新'
export const GENERIC_ERROR = '没有成功，请稍后再试'
export const BAD_INPUT_ERROR = '填写的内容有问题，请检查后再试'
export const BOOKINGS_CHANGED_EVENT = 'crm-bookings-changed'

/** Broadcast that booking data changed so other components can refetch. */
export function announceBookingsChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(BOOKINGS_CHANGED_EVENT))
}

/** Narrow an unknown value to a plain record without using `any`. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {}
}

/** Map a 400 error code to a plain-Chinese message for staff. */
function badInputMessage(code: unknown): string {
  switch (code) {
    case 'invalid_cancel_note':
      return '请写一句取消原因（不超过 200 字，不要写金额）'
    case 'invalid_note':
      return '备注太长或含有不能用的字符（最多 500 字）'
    case 'invalid_party_size':
      return '人数请填 1 到 60 之间的整数'
    case 'invalid_paid_on':
      return '收款日期不对，请重新选'
    case 'invalid_due_on':
      return '到期日不对，请重新选'
    case 'invalid_booked_on':
      return '预订日期不对，请重新选'
    case 'invalid_tour_id':
      return '请先选一个团'
    case 'tour_not_found':
      return '团目录里找不到这个团了，请刷新后再选'
    case 'departure_not_found':
      return '团目录里找不到这个出发日期了，请刷新后再选'
    default:
      return BAD_INPUT_ERROR
  }
}

/** Perform a JSON fetch and normalise the response into an ApiResult. */
export async function callApi<T>(
  url: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<ApiResult<T>> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    return { ok: false, kind: 'other', message: GENERIC_ERROR }
  }

  const parsed = asRecord(await res.json().catch(() => ({})))

  if (res.ok) {
    return { ok: true, data: parsed as T }
  }

  if (res.status === 403) {
    return { ok: false, kind: 'hidden', message: '' }
  }
  if (res.status === 404 && parsed.error === 'booking_tracker_not_enabled') {
    return { ok: false, kind: 'hidden', message: '' }
  }
  if (method !== 'GET' && res.status === 404 && parsed.error === 'not_found') {
    return { ok: false, kind: 'stale', message: CHANGED_MESSAGE }
  }
  if (res.status === 409) {
    if (parsed.error === 'stale') {
      return { ok: false, kind: 'stale', message: STALE_MESSAGE }
    }
    if (method !== 'GET' && parsed.error === 'booking_not_active') {
      return { ok: false, kind: 'stale', message: CHANGED_MESSAGE }
    }
    const message =
      typeof parsed.message === 'string' && parsed.message.length > 0
        ? parsed.message
        : GENERIC_ERROR
    return { ok: false, kind: 'other', message }
  }
  if (res.status === 400) {
    return { ok: false, kind: 'other', message: badInputMessage(parsed.error) }
  }

  return { ok: false, kind: 'other', message: GENERIC_ERROR }
}

/** Build the bookings API URL for a client, optionally with a sub-path. */
export function bookingsUrl(clientId: string, path = ''): string {
  return `/api/clients/${clientId}/crm/bookings${path}`
}

export type BookingsListResponse = { bookings: BookingView[] }
export type OptionsResponse = { tours: BookingOptionTour[] }
export type NudgeResponse = { nudge: NudgeList }
export type MembersResponse = { members: BookingMember[] }

export interface NewBookingInput {
  contactId: string
  tourId: string
  departureId: string | null
  bookedOn: string
  partySize?: number
  isCruise?: boolean
  note?: string
}

export interface BookingPatch {
  tourId?: string
  departureId?: string | null
  note?: string | null
  partySize?: number | null
  isCruise?: boolean
}

/** Fetch all bookings for a contact. */
export function fetchBookings(
  clientId: string,
  contactId: string,
): Promise<ApiResult<BookingsListResponse>> {
  return callApi<BookingsListResponse>(
    bookingsUrl(clientId, `?contactId=${encodeURIComponent(contactId)}`),
    'GET',
  )
}

/** Fetch the tour/departure options for the booking form. */
export function fetchOptions(clientId: string): Promise<ApiResult<OptionsResponse>> {
  return callApi<OptionsResponse>(bookingsUrl(clientId, '/options'), 'GET')
}

/** Fetch the nudge list (up to `limit` rows). */
export function fetchNudgeList(
  clientId: string,
  limit: number,
): Promise<ApiResult<NudgeResponse>> {
  return callApi<NudgeResponse>(bookingsUrl(clientId, `/nudge-list?limit=${limit}`), 'GET')
}

/** Mark a milestone as paid. */
export function markPaid(
  clientId: string,
  bookingId: string,
  kind: MilestoneKind,
  expectedUpdatedAt: string,
  paidOn: string,
): Promise<ApiResult<unknown>> {
  return callApi<unknown>(
    bookingsUrl(clientId, `/${bookingId}/milestones/${kind}/paid`),
    'POST',
    { expectedUpdatedAt, paidOn },
  )
}

/** Mark a milestone as unpaid. */
export function markUnpaid(
  clientId: string,
  bookingId: string,
  kind: MilestoneKind,
  expectedUpdatedAt: string,
): Promise<ApiResult<unknown>> {
  return callApi<unknown>(
    bookingsUrl(clientId, `/${bookingId}/milestones/${kind}/unpaid`),
    'POST',
    { expectedUpdatedAt },
  )
}

/** Set or clear a milestone's manual due-date override. */
export function overrideDue(
  clientId: string,
  bookingId: string,
  kind: MilestoneKind,
  expectedUpdatedAt: string,
  dueOn: string | null,
): Promise<ApiResult<unknown>> {
  return callApi<unknown>(
    bookingsUrl(clientId, `/${bookingId}/milestones/${kind}/override-due`),
    'POST',
    { expectedUpdatedAt, dueOn },
  )
}

/** Nudge a milestone (nudged today, snooze for `days`, or quiet). */
export function nudgeMilestone(
  clientId: string,
  bookingId: string,
  kind: MilestoneKind,
  expectedUpdatedAt: string,
  mode: NudgeMode,
  days?: 3 | 7 | 14,
): Promise<ApiResult<unknown>> {
  return callApi<unknown>(
    bookingsUrl(clientId, `/${bookingId}/milestones/${kind}/nudge`),
    'POST',
    { expectedUpdatedAt, mode, ...(mode === 'snooze' ? { days } : {}) },
  )
}

/** Confirm the booking's departure after a catalog change. */
export function confirmDeparture(
  clientId: string,
  bookingId: string,
  expectedUpdatedAt: string,
): Promise<ApiResult<unknown>> {
  return callApi<unknown>(
    bookingsUrl(clientId, `/${bookingId}/confirm-departure`),
    'POST',
    { expectedUpdatedAt },
  )
}

/** Patch a booking's editable fields. */
export function patchBooking(
  clientId: string,
  bookingId: string,
  expectedUpdatedAt: string,
  patch: BookingPatch,
): Promise<ApiResult<unknown>> {
  return callApi<unknown>(bookingsUrl(clientId, `/${bookingId}`), 'PATCH', {
    expectedUpdatedAt,
    patch,
  })
}

/** Cancel a booking with a required cancel note. */
export function cancelBooking(
  clientId: string,
  bookingId: string,
  expectedUpdatedAt: string,
  cancelNote: string,
): Promise<ApiResult<unknown>> {
  return callApi<unknown>(bookingsUrl(clientId, `/${bookingId}/cancel`), 'POST', {
    expectedUpdatedAt,
    cancelNote,
  })
}

/** Create a new booking for a contact. */
export function createBooking(
  clientId: string,
  input: NewBookingInput,
): Promise<ApiResult<unknown>> {
  return callApi<unknown>(bookingsUrl(clientId), 'POST', input)
}

/** Fetch the list of members allowed to see the booking tracker. */
export function fetchMembers(clientId: string): Promise<ApiResult<MembersResponse>> {
  return callApi<MembersResponse>(bookingsUrl(clientId, '/members'), 'GET')
}

/** Add a member by email. */
export function addMember(
  clientId: string,
  email: string,
): Promise<ApiResult<MembersResponse>> {
  return callApi<MembersResponse>(bookingsUrl(clientId, '/members'), 'POST', { email })
}

/** Remove a member by email. */
export function removeMember(
  clientId: string,
  email: string,
): Promise<ApiResult<MembersResponse>> {
  return callApi<MembersResponse>(
    bookingsUrl(clientId, `/members?email=${encodeURIComponent(email)}`),
    'DELETE',
  )
}
