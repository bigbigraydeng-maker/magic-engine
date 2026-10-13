/**
 * Shared test fixtures for vitest + @testing-library tests of the CRM
 * "订单与付款" components.
 *
 * This is NOT a test file: it contains no describe/it blocks. It only exports
 * constants, factory helpers and a small fetch-stubbing utility so individual
 * test files stay short and consistent.
 */

import { vi } from 'vitest'
import type {
  BookingView,
  BookingWarning,
  BookingWarningCode,
  MilestoneView,
  NudgeRow,
} from '@/lib/crm/booking-types'

export const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export const CONTACT = 'c1a1a1a1-0000-4000-8000-000000000001'
export const BOOKING_ID = '30000000-0000-4000-8000-0000000000a1'
export const TOUR_ID = '10000000-0000-4000-8000-0000000000a1'
export const DEP_ID = '20000000-0000-4000-8000-0000000000a1'

export const BOOKING_UPDATED_AT = '2026-10-01T00:00:00.000000+00:00'
export const DEPOSIT_UPDATED_AT = '2026-10-02T00:00:00.000000+00:00'
export const BALANCE_UPDATED_AT = '2026-10-03T00:00:00.000000+00:00'

export function makeMilestone(
  kind: 'deposit' | 'balance',
  over: Partial<MilestoneView> = {},
): MilestoneView {
  return {
    kind,
    label: kind === 'deposit' ? '定金' : '尾款',
    state: 'unpaid',
    paidOn: null,
    autoByEmail: false,
    dueOn: '2026-12-12',
    dueNote: null,
    dueOverrideOn: null,
    dueInDays: 61,
    overdue: false,
    remindAfter: null,
    quiet: false,
    updatedAt: kind === 'deposit' ? DEPOSIT_UPDATED_AT : BALANCE_UPDATED_AT,
    ...over,
  }
}

export function makeBooking(over: Partial<BookingView> = {}): BookingView {
  return {
    id: BOOKING_ID,
    tourId: TOUR_ID,
    tourName: '新西兰南北岛',
    departureId: DEP_ID,
    departOn: '2027-03-12',
    departureStatus: 'open',
    bookedOn: '2026-10-12',
    partySize: null,
    isCruise: false,
    status: 'active',
    cancelNote: null,
    note: null,
    updatedAt: BOOKING_UPDATED_AT,
    payInFull: false,
    milestones: [makeMilestone('deposit'), makeMilestone('balance')],
    warnings: [],
    ...over,
  }
}

export function makeWarning(
  code: BookingWarningCode,
  text: string,
  over: Partial<BookingWarning> = {},
): BookingWarning {
  return { code, text, needsConfirm: false, kind: null, ...over }
}

export function makeNudgeRow(i: number, over: Partial<NudgeRow> = {}): NudgeRow {
  const suffix = String(i).padStart(2, '0')
  return {
    bookingId: `30000000-0000-4000-8000-0000000001${suffix}`,
    contactId: `c1a1a1a1-0000-4000-8000-0000000002${suffix}`,
    contactName: `客人${i}`,
    tourName: '新西兰南北岛',
    departOn: '2027-03-12',
    kind: 'deposit',
    label: '定金',
    dueOn: '2026-10-20',
    dueInDays: 8,
    bucket: 'within_14',
    note: null,
    milestoneUpdatedAt: '2026-10-02T00:00:00.000000+00:00',
    warningCodes: [],
    ...over,
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export interface FetchCall {
  url: string
  method: string
  body: Record<string, unknown> | null
}

export interface FetchRoute {
  match: (url: string, method: string) => boolean
  respond: (call: FetchCall) => Response | Promise<Response>
}

function parseBody(init?: RequestInit): Record<string, unknown> | null {
  if (!init || typeof init.body !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(init.body)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

export function installFetch(routes: FetchRoute[]): { calls: FetchCall[] } {
  const calls: FetchCall[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit): Promise<Response> => {
      const call: FetchCall = {
        url: input,
        method: init?.method ?? 'GET',
        body: parseBody(init),
      }
      calls.push(call)
      const found = routes.find((r) => r.match(call.url, call.method))
      if (!found) return jsonResponse({ error: 'no_route' }, 500)
      return found.respond(call)
    }),
  )
  return { calls }
}

export const FORBIDDEN_WORDS = /节点|里程碑|班期|departure|milestone|booking id|订单号/i

export function route(
  method: string,
  urlPart: string,
  respond: FetchRoute['respond'],
): FetchRoute {
  return {
    match: (url, m) => m === method && url.includes(urlPart),
    respond,
  }
}
