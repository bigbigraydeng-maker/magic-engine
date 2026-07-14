/**
 * Voice Agent domain — enums, types, call state machine, E.164 normalization,
 * SIP header route resolution, shared idempotency keys.
 *
 * 魏征 #3: 唯一性/幂等约束抽成共享领域函数，内存 store 和 supabase store 都调它，
 * PG unique index 只作第二道防线，保证两实现同源。
 */

// ── Enums ────────────────────────────────────────────────────────────────────
export type AgentRole = 'sales' | 'support' | 'hybrid'
export type CallDirection = 'inbound' | 'outbound'
export type CallChannel = 'pstn' | 'sip' | 'whatsapp_call'
export type ConsentStatus = 'unknown' | 'granted' | 'denied' | 'withdrawn'
export type IntentLevel = 'low' | 'medium' | 'high' | 'unknown'
export type Speaker = 'user' | 'assistant' | 'system' | 'human'
export type ProviderName = 'openai' | 'twilio' | 'telnyx' | 'mock'

export type CallStatus =
  | 'created'
  | 'ringing'
  | 'accepted'
  | 'in_progress'
  | 'transferring'
  | 'transferred'
  | 'completed'
  | 'rejected'
  | 'failed'

export type SummaryStatus = 'pending' | 'running' | 'done' | 'failed'

export const CALL_OUTCOMES = [
  'resolved',
  'qualified',
  'appointment_requested',
  'transferred',
  'follow_up_required',
  'not_interested',
  'wrong_number',
  'failed',
] as const
export type CallOutcome = (typeof CALL_OUTCOMES)[number]

// ── Call state machine ───────────────────────────────────────────────────────
// created → ringing → accepted → in_progress → transferring → transferred | completed | rejected | failed
const CALL_TRANSITIONS: Record<CallStatus, CallStatus[]> = {
  created: ['ringing', 'accepted', 'rejected', 'failed'],
  ringing: ['accepted', 'rejected', 'failed'],
  accepted: ['in_progress', 'failed', 'completed'],
  in_progress: ['transferring', 'completed', 'failed'],
  transferring: ['transferred', 'completed', 'failed'],
  transferred: ['completed', 'failed'],
  completed: [],
  rejected: [],
  failed: [],
}

export function canTransition(from: CallStatus, to: CallStatus): boolean {
  if (from === to) return true // idempotent no-op
  return CALL_TRANSITIONS[from]?.includes(to) ?? false
}

export function assertTransition(from: CallStatus, to: CallStatus): void {
  if (!canTransition(from, to)) {
    throw new VoiceError('CALL_INVALID_TRANSITION', `Illegal call state transition ${from} → ${to}`)
  }
}

export function isTerminal(status: CallStatus): boolean {
  return CALL_TRANSITIONS[status]?.length === 0
}

// ── Errors (spec §18 unified codes) ──────────────────────────────────────────
export type VoiceErrorCode =
  | 'ROUTE_NOT_FOUND'
  | 'WEBHOOK_SIGNATURE_INVALID'
  | 'WEBHOOK_REPLAYED'
  | 'OPENAI_ACCEPT_FAILED'
  | 'REALTIME_SOCKET_FAILED'
  | 'REALTIME_TOOL_INVALID_ARGS'
  | 'TOOL_TIMEOUT'
  | 'KNOWLEDGE_NOT_READY'
  | 'KNOWLEDGE_NO_RESULT'
  | 'TRANSFER_NOT_CONFIGURED'
  | 'TRANSFER_FAILED'
  | 'CALL_ALREADY_ENDED'
  | 'CALL_INVALID_TRANSITION'
  | 'SUMMARY_FAILED'
  | 'PROVIDER_UNAVAILABLE'
  | 'OUTBOUND_BLOCKED'
  | 'TENANT_SCOPE_MISSING'

export class VoiceError extends Error {
  code: VoiceErrorCode
  constructor(code: VoiceErrorCode, message: string) {
    super(message)
    this.name = 'VoiceError'
    this.code = code
  }
}

// ── E.164 normalization ──────────────────────────────────────────────────────
const COUNTRY_DIAL: Record<string, string> = {
  NZ: '64',
  AU: '61',
  US: '1',
  GB: '44',
}

/**
 * Normalize a raw phone string to E.164 (+<digits>). Returns null if unparseable.
 * Handles: already-E.164, 00 international prefix, national leading-0 numbers.
 */
export function normalizeE164(raw: string | null | undefined, defaultCountry = 'NZ'): string | null {
  if (!raw) return null
  let s = raw.trim()
  // strip a sip: / tel: scheme and any user-part params (e.g. tel:+64...;foo=bar)
  s = s.replace(/^(sip|sips|tel):/i, '')
  s = s.split(/[;@]/)[0]
  // extract leading + then digits, or pure digits
  const hasPlus = s.trimStart().startsWith('+')
  let digits = s.replace(/[^\d]/g, '')
  if (!digits) return null

  if (hasPlus) {
    return '+' + digits
  }
  // 00 international prefix
  if (digits.startsWith('00')) {
    return '+' + digits.slice(2)
  }
  const cc = COUNTRY_DIAL[defaultCountry.toUpperCase()]
  if (!cc) {
    // unknown default country: only accept if it already looks international-length
    return digits.length >= 11 ? '+' + digits : null
  }
  // already includes country code (e.g. 6421...)
  if (digits.startsWith(cc)) {
    return '+' + digits
  }
  // national format with leading trunk 0 → drop it, prepend cc
  if (digits.startsWith('0')) {
    digits = digits.slice(1)
  }
  return '+' + cc + digits
}

export function isValidE164(s: string | null | undefined): boolean {
  return typeof s === 'string' && /^\+[1-9]\d{6,14}$/.test(s)
}

// ── SIP header → called (To) number ──────────────────────────────────────────
export type SipHeaders = Record<string, string | undefined>

const CALLED_HEADER_PRIORITY = ['P-Called-Party-ID', 'Diversion', 'To']

/**
 * Extract the E.164 dialed (called) number from SIP headers. We do NOT rely on
 * custom X-Magic-* headers (spec §8.1) — parse standard headers in priority order.
 */
export function parseCalledNumber(headers: SipHeaders, defaultCountry = 'NZ'): string | null {
  const lower: SipHeaders = {}
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v
  for (const name of CALLED_HEADER_PRIORITY) {
    const raw = lower[name.toLowerCase()]
    if (!raw) continue
    // header may be like: "<sip:+6491234567@host>" or "tel:+6491234567"
    const m = raw.match(/[<]?(?:sips?|tel):([^@>;\s]+)/i) ?? raw.match(/(\+?\d[\d\s\-().]{5,})/)
    const candidate = m ? m[1] : raw
    const e164 = normalizeE164(candidate, defaultCountry)
    if (isValidE164(e164)) return e164
  }
  return null
}

export function parseCallerNumber(headers: SipHeaders, defaultCountry = 'NZ'): string | null {
  const lower: SipHeaders = {}
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v
  const raw = lower['from'] ?? lower['p-asserted-identity']
  if (!raw) return null
  const m = raw.match(/[<]?(?:sips?|tel):([^@>;\s]+)/i) ?? raw.match(/(\+?\d[\d\s\-().]{5,})/)
  const candidate = m ? m[1] : raw
  const e164 = normalizeE164(candidate, defaultCountry)
  return isValidE164(e164) ? e164 : null
}

// ── Route resolution ─────────────────────────────────────────────────────────
export interface RouteLike {
  id: string
  tenant_id: string
  agent_id: string
  provider: string
  phone_number_e164: string | null
  status: string
  priority: number
  direction?: string
  channel?: string
}

/**
 * Resolve the highest-priority active route whose number matches the called number.
 */
export function resolveRoute(routes: RouteLike[], calledNumber: string | null): RouteLike | null {
  if (!calledNumber) return null
  const matches = routes
    .filter((r) => r.status === 'active' && r.phone_number_e164 === calledNumber)
    .sort((a, b) => a.priority - b.priority)
  return matches[0] ?? null
}

// ── Shared idempotency keys (魏征 #3) ─────────────────────────────────────────
/** A lead is 1:1 with a call — the tool + finalize both upsert against this key. */
export function leadUpsertKeyForCall(callId: string): string {
  return `call:${callId}`
}

export function transcriptSegmentKey(callId: string, sequenceNo: number): string {
  return `${callId}:${sequenceNo}`
}
