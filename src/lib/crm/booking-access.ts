/**
 * The gate for every CRM booking-tracker route and page.
 *
 * Rule (design §11 of docs/specs/2026-10-12-crm-booking-payment-tracker-design-v0.2.md):
 *   - `me_admin` = Magic Engine global admin (admin role with no client restriction);
 *   - `member`   = anyone else who passes the paid-client gate AND whose lower-cased
 *                  email is on `crm_booking_members` for this client. The list is empty
 *                  by default, so by default nobody is a member.
 * `manage_members` is admin-only. Every capability except `manage_members` additionally
 * requires the client's `booking_schedule` config to be present and enabled: we FAIL
 * CLOSED, so a missing / disabled / invalid config is a 404 rather than a silent default.
 *
 * The acting identity is ALWAYS the lower-cased session email; nothing from the request
 * body is read here.
 */

import { NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { isUuid } from '@/lib/validation-utils'
import { readBookingScheduleConfig } from './booking-config'
import type { TravelBookingRule } from './industry/travel-booking-rule'
import type { BookingCapability, BookingRole } from './booking-types'

export type BookingAccess =
  | { ok: true; actor: string; role: BookingRole; rule: TravelBookingRule | null }
  | { ok: false; response: NextResponse }

/**
 * The one place that says who may do what in the booking tracker.
 * Exhaustive on purpose: adding a capability or a role without filling this in
 * fails the type check.
 */
export const BOOKING_CAPABILITIES: Record<BookingCapability, Record<BookingRole, boolean>> = {
  view: { me_admin: true, member: true },
  edit: { me_admin: true, member: true },
  manage_members: { me_admin: true, member: false },
}

function deny(status: number, error: string): BookingAccess {
  return { ok: false, response: NextResponse.json({ error }, { status }) }
}

type MemberLookup = 'member' | 'not_member' | 'lookup_failed'

/** Exact match on (client, lower-cased email). Any failure is reported as a failure, never as "member". */
async function lookupBookingMember(clientId: string, email: string): Promise<MemberLookup> {
  try {
    const res = await supabaseAdmin
      .from('crm_booking_members')
      .select('email')
      .eq('client_id', clientId)
      .eq('email', email)
      .limit(1)
    if (res.error) {
      console.error('[crm booking access] member lookup failed:', res.error.message)
      return 'lookup_failed'
    }
    const rows: unknown = res.data
    return Array.isArray(rows) && rows.length > 0 ? 'member' : 'not_member'
  } catch (err) {
    console.error('[crm booking access] member lookup threw:', err)
    return 'lookup_failed'
  }
}

type ConfigLoad =
  | { ok: true; rule: TravelBookingRule }
  | { ok: false; response: NextResponse }

/**
 * Load and validate the client's booking schedule config.
 *
 * Fails closed: a query error is a 500, and any config state other than 'ready'
 * (missing / disabled / invalid / no client row) is a 404 `booking_tracker_not_enabled`.
 */
async function loadBookingRule(clientId: string): Promise<ConfigLoad> {
  let leadsConfig: unknown
  try {
    const res = await supabaseAdmin
      .from('clients')
      .select('leads_config')
      .eq('id', clientId)
      .maybeSingle()
    if (res.error) {
      console.error('[crm booking access] config lookup failed:', res.error.message)
      return { ok: false, response: NextResponse.json({ error: 'Authorization check failed' }, { status: 500 }) }
    }
    leadsConfig = res.data?.leads_config
  } catch (err) {
    console.error('[crm booking access] config lookup threw:', err)
    return { ok: false, response: NextResponse.json({ error: 'Authorization check failed' }, { status: 500 }) }
  }

  const config = readBookingScheduleConfig(leadsConfig)
  if (config.state !== 'ready') {
    return { ok: false, response: NextResponse.json({ error: 'booking_tracker_not_enabled' }, { status: 404 }) }
  }
  return { ok: true, rule: config.rule }
}

/**
 * Resolve the caller's booking role, or a denial response.
 *
 * Global admin (admin role with no client restriction) is `me_admin`; everyone else
 * must be on `crm_booking_members` for this client to be a `member`.
 */
async function resolveRole(
  clientId: string,
  email: string,
  role: string,
  allowedClientId: string | null | undefined,
  /** Lets an independent read (the config load) run in the same tick as the member lookup. */
  whileLookingUp?: () => void,
): Promise<{ ok: true; role: BookingRole } | { ok: false; response: NextResponse }> {
  const unrestricted = allowedClientId === null || allowedClientId === undefined
  if (role === 'admin' && unrestricted) {
    return { ok: true, role: 'me_admin' }
  }

  const pending = lookupBookingMember(clientId, email)
  whileLookingUp?.()
  const membership = await pending
  if (membership === 'lookup_failed') {
    return { ok: false, response: NextResponse.json({ error: 'Authorization check failed' }, { status: 500 }) }
  }
  if (membership !== 'member') {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ok: true, role: 'member' }
}

/**
 * Gate for every booking-tracker route and page.
 *
 * Identity and client isolation are delegated to requirePaidClientAccess. On top of
 * that we resolve the booking role, check the capability, and (except for
 * `manage_members`) require the client's booking schedule config to be ready.
 */
export async function requireBookingAccess(
  clientId: string,
  capability: BookingCapability,
): Promise<BookingAccess> {
  if (!isUuid(clientId)) {
    return deny(400, 'invalid_id')
  }

  const result = await requirePaidClientAccess(clientId)
  if (!result.ok) {
    return deny(result.status, result.error)
  }

  const email = (result.user.email ?? '').trim().toLowerCase()
  if (email === '') {
    return deny(403, 'Forbidden')
  }

  // The config load does not depend on the role, so for non-admins it starts in the
  // same tick as the member lookup. The decisions below are applied in the original
  // order (member 500 / 403, capability 403, then config 500 / 404). loadBookingRule
  // never rejects, so an unused result cannot become an unhandled rejection.
  let rulePromise: Promise<ConfigLoad> | null = null
  const startRuleLoad = () => {
    if (capability !== 'manage_members' && rulePromise === null) {
      rulePromise = loadBookingRule(clientId)
    }
  }
  const resolved = await resolveRole(
    clientId,
    email,
    result.role,
    result.allowedClientId,
    startRuleLoad,
  )
  if (!resolved.ok) {
    return { ok: false, response: resolved.response }
  }
  const role = resolved.role

  if (BOOKING_CAPABILITIES[capability]?.[role] !== true) {
    return deny(403, 'Forbidden')
  }

  if (capability === 'manage_members') {
    return { ok: true, actor: email, role, rule: null }
  }

  startRuleLoad()
  const loaded = await (rulePromise as Promise<ConfigLoad> | null ?? loadBookingRule(clientId))
  if (!loaded.ok) {
    return { ok: false, response: loaded.response }
  }

  return { ok: true, actor: email, role, rule: loaded.rule }
}
