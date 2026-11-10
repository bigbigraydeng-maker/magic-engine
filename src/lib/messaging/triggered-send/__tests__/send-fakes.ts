/**
 * A fake world for real sending: an in-memory live ledger that keeps the claim function's answers (§3.3) and the
 * compare-and-set writes, a provider that answers what the test says, locks, timeline and receipt replay recorders.
 * Nothing leaves the process.
 */
import { vi } from 'vitest'
import type { ResendEmailRequest, ResendSendOutcome } from '@/lib/messaging/adapters/resend-email'
import type { EmailTemplateVersion } from '@/lib/crm/email-templates/types'
import type { AuthorizationRecord } from '../authorization-store'
import { ruleSha256, type SendableRule } from '../rule'
import type { ClaimInput, ClaimOutcome, LifetimeRow, SendContact, SendDeps, SendPlan } from '../send-types'
import type { AddressHistoryRead, EvidenceRead, ShadowGatePorts, UnsubscribeRead } from '../types'
import { templateContentSha256 } from '../welcome-template'
import { CLIENT, sendableRule, template } from './authorization-fakes'

export { CLIENT }
export const AUTH_ID = 'a0000000-0000-4000-8000-000000000001'
export const CONTACT = 'b0000000-0000-4000-8000-000000000001'
/** 2026-11-20 10:00 in Auckland (NZDT, +13): inside the 08:00–20:00 window. */
export const SEND_NOW = new Date('2026-11-19T21:00:00.000Z')

export const LIVE_ENV: Record<string, string> = {
  TRIGGERED_SEND_LIVE: 'true',
  TRIGGERED_SEND_CLIENTS: CLIENT,
  RESEND_API_KEY_CTS: `re_${'k'.repeat(30)}`,
  UNSUBSCRIBE_SIGNING_SECRET: 's'.repeat(40),
  APP_URL: 'https://app.example.com',
  TRIGGERED_SEND_TRIAL_DOMAINS: 'example.com',
}

export function authorizedRecord(rule: SendableRule = sendableRule(), t: EmailTemplateVersion = template(), over: Partial<AuthorizationRecord> = {}): AuthorizationRecord {
  return {
    id: AUTH_ID,
    requestId: 'r0000000-0000-4000-8000-000000000001',
    clientId: CLIENT,
    triggerKey: 'welcome',
    channel: 'email',
    account: 'cts',
    rule,
    ruleSha256: ruleSha256(rule),
    templateVersion: t.version,
    templateSha256: templateContentSha256(t),
    dailyCap: 20,
    proposedByEmail: 'fde@example.com',
    proposedAt: '2026-11-15T00:00:00.000Z',
    authorizedByEmail: 'pm@example.com',
    authorizedAt: '2026-11-16T00:00:00.000Z',
    liveFrom: '2026-11-16T00:00:00.000Z',
    expiresAt: '2027-02-01T00:00:00.000Z',
    activatedAt: '2026-11-16T00:00:01.000Z',
    revokedAt: null,
    revokedBy: null,
    revokedReason: null,
    ...over,
  }
}

export function guest(over: Partial<SendContact> = {}): SendContact {
  return { contactId: CONTACT, createdAt: '2026-11-19T01:00:00.000Z', primaryEmail: 'lead@example.org', addresses: ['lead@example.org'], displayName: 'Jane Lee', ...over }
}

export const NOT_WELCOMED: EvidenceRead = { ok: true, items: [], legacy: { welcomed: false, batchSeen: true, campaignIds: [] } }

export function plan(over: Partial<SendPlan> = {}): SendPlan {
  return { clientId: CLIENT, authorizationId: AUTH_ID, sweepDay: '2026-11-20', contactIds: [CONTACT], staleIds: [], createdAt: SEND_NOW.toISOString(), ...over }
}

let tick = 0
const stamp = (): string => new Date(Date.UTC(2026, 10, 19, 21, 0, 0, ++tick)).toISOString()

/** The live ledger, keeping the claim function's answers that matter here. */
export class FakeLedger {
  rows = new Map<string, LifetimeRow>()
  claims: ClaimInput[] = []
  /** Answer the next claims with these outcomes instead of computing one (in order). */
  forced: ClaimOutcome[] = []
  fail: { claim?: boolean; markSent?: boolean; decision?: boolean } = {}
  decisions: Array<{ contactId: string; status: string; reasonCode: string }> = []
  notes: Array<{ id: string; reasonCode: string }> = []
  private n = 0

  seed(over: Partial<LifetimeRow>): LifetimeRow {
    const row: LifetimeRow = {
      id: `e0000000-0000-4000-8000-00000000000${++this.n}`, contactId: CONTACT, status: 'blocked', reasonCode: null, authorizationId: AUTH_ID,
      idempotencyKey: null, renderedSha256: null, toAddressSha256: null, firstAttemptAt: null, providerMessageId: null, updatedAt: stamp(), ...over,
    }
    this.rows.set(row.id, row)
    return row
  }

  byContact(contactId: string): LifetimeRow | undefined {
    return [...this.rows.values()].find((r) => r.contactId === contactId)
  }

  port(): SendDeps['ledger'] {
    return {
      rowsFor: async (_clientId, ids) => ({ ok: true, rows: [...this.rows.values()].filter((r) => ids.includes(r.contactId)).map((r) => ({ ...r })) }),
      rowById: async (_clientId, id) => ({ ok: true, row: this.rows.has(id) ? { ...(this.rows.get(id) as LifetimeRow) } : null }),
      recordDecision: async (d) => {
        if (this.fail.decision) return { ok: false, error: 'down' }
        this.decisions.push({ contactId: d.contactId, status: d.status, reasonCode: d.reasonCode })
        const existing = d.existing === null ? undefined : this.rows.get(d.existing.id)
        if (existing !== undefined) Object.assign(existing, { status: d.status, reasonCode: d.reasonCode, updatedAt: stamp() })
        else this.seed({ contactId: d.contactId, status: d.status, reasonCode: d.reasonCode })
        return { ok: true }
      },
      noteBlock: async (row, reasonCode) => {
        this.notes.push({ id: row.id, reasonCode })
        return { ok: true }
      },
      claim: async (input) => this.claim(input),
      markSent: async (row, input) => this.cas(row, () => ({ status: 'sent', providerMessageId: input.messageId }), this.fail.markSent),
      markFailed: async (row, input) => this.cas(row, () => ({ status: 'failed', reasonCode: input.reasonCode })),
    }
  }

  private cas(row: LifetimeRow, patch: () => Partial<LifetimeRow>, fails = false) {
    if (fails) return Promise.resolve({ ok: false as const, error: 'down' })
    const current = this.rows.get(row.id)
    if (current === undefined || current.status !== 'pending' || current.updatedAt !== row.updatedAt) return Promise.resolve({ ok: true as const, result: 'changed' as const })
    Object.assign(current, patch(), { updatedAt: stamp() })
    return Promise.resolve({ ok: true as const, result: 'updated' as const })
  }

  private async claim(input: ClaimInput) {
    this.claims.push(input)
    if (this.fail.claim) return { ok: false as const, error: 'claim: 08006' }
    const forced = this.forced.shift()
    const existing = this.byContact(input.contactId)
    if (forced !== undefined) return { ok: true as const, outcome: forced, sendId: existing?.id ?? null, idempotencyKey: existing?.idempotencyKey ?? null }
    if (existing?.status === 'pending') {
      if (existing.authorizationId !== input.authorizationId || existing.renderedSha256 !== input.renderedSha256) return { ok: true as const, outcome: 'in_flight' as const, sendId: existing.id, idempotencyKey: existing.idempotencyKey }
      existing.updatedAt = stamp()
      return { ok: true as const, outcome: 'takeover' as const, sendId: existing.id, idempotencyKey: existing.idempotencyKey }
    }
    const fields = { status: 'pending', authorizationId: input.authorizationId, idempotencyKey: input.idempotencyKey, renderedSha256: input.renderedSha256, toAddressSha256: input.toAddressSha256, firstAttemptAt: '2026-11-19T21:00:00.000Z', updatedAt: stamp() }
    const row = existing ?? this.seed({ contactId: input.contactId })
    Object.assign(row, fields)
    return { ok: true as const, outcome: 'claimed' as const, sendId: row.id, idempotencyKey: input.idempotencyKey }
  }
}

export interface SendWorld {
  deps: SendDeps
  ledger: FakeLedger
  sent: ResendEmailRequest[]
  /** What the provider answers next (default: accepted with a fresh id). */
  answers: ResendSendOutcome[]
  timeline: { writes: string[]; cancels: string[]; failWrite: boolean }
  locks: { taken: number; released: number; busy: boolean; throws: boolean }
  replays: string[]
  revokes: string[]
  env: Record<string, string>
  set: {
    record(r: AuthorizationRecord | null): void
    template(t: EmailTemplateVersion | null | 'unreadable'): void
    contact(c: SendContact | null): void
    evidence(e: EvidenceRead, insideLocks?: EvidenceRead): void
    ports(over: Partial<ShadowGatePorts>): void
  }
  exemptSeen: Array<string | undefined>
}

export function sendWorld(): SendWorld {
  const ledger = new FakeLedger()
  const env: Record<string, string> = { ...LIVE_ENV }
  let record: AuthorizationRecord | null = authorizedRecord()
  let tmpl: EmailTemplateVersion | null | 'unreadable' = template()
  let contact: SendContact | null = guest()
  let evidenceOutside: EvidenceRead = NOT_WELCOMED
  let evidenceInside: EvidenceRead | null = null
  let overrides: Partial<ShadowGatePorts> = {}
  const w: SendWorld = {
    deps: null as never,
    ledger,
    sent: [],
    answers: [],
    timeline: { writes: [], cancels: [], failWrite: false },
    locks: { taken: 0, released: 0, busy: false, throws: false },
    replays: [],
    revokes: [],
    env,
    exemptSeen: [],
    set: {
      record: (r) => { record = r },
      template: (t) => { tmpl = t },
      contact: (c) => { contact = c },
      evidence: (e, inside) => { evidenceOutside = e; evidenceInside = inside ?? null },
      ports: (o) => { overrides = o },
    },
  }
  let msg = 0
  let evidenceCalls = 0
  const ports = (): ShadowGatePorts => ({
    consent: async () => ({ ok: true, bases: ['form_disclosure_attested'], sourceRef: 'lead-1' }),
    dnc: async () => ({ ok: true, blocked: false }),
    member: async () => ({ ok: true, state: 'active', tags: [] }),
    evidence: async (_c, opts) => {
      w.exemptSeen.push(opts?.exemptSendId)
      evidenceCalls += 1
      return evidenceCalls > 1 && evidenceInside !== null ? evidenceInside : evidenceOutside
    },
    unsubscribed: async (): Promise<UnsubscribeRead> => ({ ok: true, unsubscribed: false }),
    addressHistory: async (): Promise<AddressHistoryRead> => ({ ok: true, complained: false, hardBounced: false }),
    ...overrides,
  })
  w.deps = {
    now: () => SEND_NOW,
    env: (name) => env[name],
    loadAuthorization: async () => ({ ok: true, record }),
    loadTemplate: async () => (tmpl === 'unreadable' ? { ok: false } : { ok: true, template: tmpl }),
    revokeAsSystem: async (_r, code) => {
      w.revokes.push(code)
      return 'revoked'
    },
    loadContacts: async () => ({ ok: true, contacts: contact === null ? [] : [contact] }),
    loadContact: async () => ({ ok: true, contact }),
    checkMailboxes: async () => ({ ok: true }),
    createPorts: () => {
      evidenceCalls = 0
      return ports()
    },
    createLocks: () => ({
      take: async () => {
        if (w.locks.throws) return { ok: false, error: 'lock: Error' }
        if (w.locks.busy) return { ok: true, held: false }
        w.locks.taken += 1
        return { ok: true, held: true }
      },
      release: async () => {
        w.locks.released += 1
      },
    }),
    ledger: ledger.port(),
    resend: {
      send: vi.fn(async (request: ResendEmailRequest): Promise<ResendSendOutcome> => {
        w.sent.push(request)
        return w.answers.shift() ?? { kind: 'sent', messageId: `msg-${++msg}` }
      }),
    },
    writeTouchpoint: async (input) => {
      if (w.timeline.failWrite) return { ok: false, error: 'down' }
      w.timeline.writes.push(input.triggeredSendId)
      return { ok: true }
    },
    cancelTouchpoint: async (_clientId, sendId) => {
      w.timeline.cancels.push(sendId)
      return { ok: true, updated: 1 }
    },
    replayReceipts: async (messageId) => {
      w.replays.push(messageId)
      return { applied: 0, error: null }
    },
    newIdempotencyKey: () => 'triggered-send:welcome:key-1',
  }
  return w
}
