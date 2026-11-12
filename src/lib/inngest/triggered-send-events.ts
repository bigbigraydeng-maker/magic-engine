/**
 * Events of the triggered send.
 * - SHADOW run (rehearsal): the daily dispatcher sends one `crm.triggered_send.sweep_requested` per client, the worker
 *   sweeps that client. Nothing is ever sent.
 * - Standing authorization: every proposal, authorization and revocation emits `crm.triggered_send.authorization_changed`
 *   (§8). It is the machine-readable receipt of the change; an authorization is armed only after its event went out.
 * The events carry no e-mail addresses and no personal data (who acted is on the authorization row itself).
 */

export const CRM_TRIGGERED_SEND_SWEEP_REQUESTED = 'crm.triggered_send.sweep_requested'
export const CRM_TRIGGERED_SEND_AUTHORIZATION_CHANGED = 'crm.triggered_send.authorization_changed'

export type AuthorizationChange = 'proposed' | 'authorized' | 'revoked'

// A type alias (not an interface): the event sender takes `Record<string, unknown>` data, which an interface is not.
export type TriggeredSendAuthorizationChangedData = {
  request_id: string
  authorization_id: string
  client_id: string
  trigger_key: 'welcome'
  channel: 'email'
  change: AuthorizationChange
  /** 'person' for the PM's own click, else the system code (`SUPERSEDED`, `AUTHORIZE_FAILED`, …). */
  actor: string
  rule_sha256: string
  template_version: number | null
  template_sha256: string | null
  daily_cap: number
  live_from: string | null
  expires_at: string | null
  no_send: true
  provider_impact: 'NONE'
  created_at: string
}

export interface AuthorizationChangedEvent {
  id: string
  name: typeof CRM_TRIGGERED_SEND_AUTHORIZATION_CHANGED
  data: TriggeredSendAuthorizationChangedData
}

/** One event per row and change: a row is proposed, authorized and revoked at most once, so the id never repeats. */
export function buildAuthorizationChangedEvent(
  args: Omit<TriggeredSendAuthorizationChangedData, 'trigger_key' | 'channel' | 'no_send' | 'provider_impact' | 'created_at'> & {
    now: Date
  },
): AuthorizationChangedEvent {
  const { now, ...rest } = args
  return {
    id: `triggered_send_authorization:${args.authorization_id}:${args.change}`,
    name: CRM_TRIGGERED_SEND_AUTHORIZATION_CHANGED,
    data: {
      ...rest,
      trigger_key: 'welcome',
      channel: 'email',
      no_send: true,
      provider_impact: 'NONE',
      created_at: now.toISOString(),
    },
  }
}

export interface TriggeredSendSweepRequestedData {
  client_id: string
  trigger_key: 'welcome'
  dry_run: boolean
  requested_by: 'cron' | 'manual'
  slot: string
}

export interface SweepEvent {
  id: string
  name: string
  data: TriggeredSendSweepRequestedData
}

/** Deterministic event id: one sweep per client per slot (Inngest de-duplicates it for 24 h). */
export function sweepEventId(clientId: string, slot: string): string {
  return `triggered_send_sweep:${clientId}:${slot}`
}

/**
 * The slot of a run: `${YYYY-MM-DD}T${HH}` in the given zone. Falls back to the UTC ISO prefix
 * when the zone is unknown or the formatter returns an unexpected shape.
 */
export function sweepSlot(now: Date, timeZone: string): string {
  try {
    const dayParts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now)
    const hourParts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now)
    const year = dayParts.find((p) => p.type === 'year')?.value
    const month = dayParts.find((p) => p.type === 'month')?.value
    const day = dayParts.find((p) => p.type === 'day')?.value
    const hour = hourParts.find((p) => p.type === 'hour')?.value
    if (!year || !month || !day || !hour) return now.toISOString().slice(0, 13)
    if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day) || !/^\d{2}$/.test(hour)) {
      return now.toISOString().slice(0, 13)
    }
    return `${year}-${month}-${day}T${hour}`
  } catch {
    return now.toISOString().slice(0, 13)
  }
}

/** The cron event for one client. */
export function buildSweepEvent(args: { clientId: string; slot: string }): SweepEvent {
  return {
    id: sweepEventId(args.clientId, args.slot),
    name: CRM_TRIGGERED_SEND_SWEEP_REQUESTED,
    data: {
      client_id: args.clientId,
      trigger_key: 'welcome',
      dry_run: false,
      requested_by: 'cron',
      slot: args.slot,
    },
  }
}

export type ParsedSweepRequest =
  | { ok: true; clientId: string; dryRun: boolean }
  | { ok: false; reason: string }

// Lower-case only: the worker's per-client concurrency key is the raw client_id text, so "ABC..." and "abc..." would
// be two different keys and two sweeps of one client could run side by side.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Strict parse of an event payload. Never throws. A manual event (no dry_run key) is dry by default. */
export function parseSweepRequest(data: unknown): ParsedSweepRequest {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, reason: 'payload is not an object' }
  }
  const record = data as Record<string, unknown>
  const clientId = record.client_id
  if (typeof clientId !== 'string' || !UUID_RE.test(clientId)) {
    return { ok: false, reason: 'client_id is not a lower-case uuid' }
  }
  if (record.trigger_key !== 'welcome') {
    return { ok: false, reason: 'trigger_key is not welcome' }
  }
  if (!('dry_run' in record)) {
    return { ok: true, clientId, dryRun: true }
  }
  if (typeof record.dry_run !== 'boolean') {
    return { ok: false, reason: 'dry_run is not a boolean' }
  }
  return { ok: true, clientId, dryRun: record.dry_run }
}
