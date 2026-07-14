/**
 * OutboundGate — the ONLY sanctioned entry point for placing an outbound call
 * (魏征 #4 / 板桥 #7). Throws VoiceError('OUTBOUND_BLOCKED') on any failure so a
 * caller can never accidentally proceed by ignoring a boolean return.
 *
 * P0 posture: OUTBOUND_CALLING_ENABLED defaults false → only sandbox test numbers
 * may be dialled, and even then only via the mock provider. Dialling a non-test
 * number is REJECTED (板桥 #7 acceptance test).
 */
import { getVoiceConfig } from './config'
import { VoiceError, isValidE164 } from './domain'
import type { VoiceStore, ContactRow } from './store/types'

export interface OutboundGateInput {
  tenantId: string
  toNumber: string
  timezone: string
  contact?: ContactRow | null
  /** allowed local-time window; defaults 09:00–20:00 (spec §14 quiet hours) */
  quietHours?: { startHour: number; endHour: number }
  /** max calls to the same number in the trailing 24h (frequency cap) */
  maxPerDay?: number
  /** override "now" for tests */
  now?: Date
}

export function isTestNumber(toNumber: string): boolean {
  const cfg = getVoiceConfig()
  return cfg.testNumbers.includes(toNumber)
}

function localHour(date: Date, timeZone: string): number {
  try {
    const s = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hour12: false }).format(date)
    const h = parseInt(s, 10)
    return Number.isFinite(h) ? h % 24 : date.getUTCHours()
  } catch {
    return date.getUTCHours()
  }
}

/**
 * Throws if the outbound call is not permitted. Returns the resolved mode so the
 * caller knows whether to use the real or mock provider.
 */
export async function assertOutboundAllowed(
  store: VoiceStore,
  input: OutboundGateInput,
): Promise<{ mode: 'real' | 'mock' }> {
  const cfg = getVoiceConfig()
  const { tenantId, toNumber, timezone } = input

  if (!isValidE164(toNumber)) {
    throw new VoiceError('OUTBOUND_BLOCKED', `invalid destination number: ${toNumber}`)
  }

  // Consent / do-not-call
  if (input.contact?.do_not_call) {
    throw new VoiceError('OUTBOUND_BLOCKED', 'contact is marked do_not_call')
  }
  if (input.contact && (input.contact.consent_status === 'denied' || input.contact.consent_status === 'withdrawn')) {
    throw new VoiceError('OUTBOUND_BLOCKED', `contact consent_status=${input.contact.consent_status}`)
  }

  // Suppression list (hard consent rule — always enforced)
  if (await store.isSuppressed(tenantId, toNumber)) {
    throw new VoiceError('OUTBOUND_BLOCKED', 'number is on the suppression list')
  }

  // Sandbox gate: real dialling only when explicitly enabled. Sandbox self-tests to
  // whitelisted test numbers skip quiet-hours/frequency (they are not real calls to
  // real people); consent/do-not-call/suppression above are still enforced.
  if (!cfg.outboundEnabled) {
    if (!isTestNumber(toNumber)) {
      throw new VoiceError(
        'OUTBOUND_BLOCKED',
        'OUTBOUND_CALLING_ENABLED is false and destination is not a sandbox test number — refusing to dial',
      )
    }
    return { mode: 'mock' }
  }

  // ── Real dialling from here: enforce quiet hours + frequency (板桥 #7 real-call rules) ──
  const now = input.now ?? new Date()
  const win = input.quietHours ?? { startHour: 9, endHour: 20 }
  const hour = localHour(now, timezone)
  if (hour < win.startHour || hour >= win.endHour) {
    throw new VoiceError('OUTBOUND_BLOCKED', `outside allowed calling hours (${hour}h local, window ${win.startHour}-${win.endHour})`)
  }

  const maxPerDay = input.maxPerDay ?? 3
  const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString()
  const recent = await store.countRecentCallsTo(tenantId, toNumber, since)
  if (recent >= maxPerDay) {
    throw new VoiceError('OUTBOUND_BLOCKED', `frequency cap reached (${recent}/${maxPerDay} in 24h)`)
  }

  return { mode: 'real' }
}
