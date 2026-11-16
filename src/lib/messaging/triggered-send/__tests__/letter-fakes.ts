/**
 * A fake world for a named letter of a letter list (the AI follow-up letters): the welcome letter's send world, with
 * an authorization for a letter list, templates per key, an in-memory ledger of `letter:<key>` rows that keeps
 * `triggered_send_claim_letter`'s answers (20 hours, letter in the list, pinned template, takeover, terminal), and a
 * link-tracking port that tokens the first https link. Nothing leaves the process.
 */
import type { EmailTemplateVersion } from '@/lib/crm/email-templates/types'
import type { AuthorizationRecord } from '../authorization-store'
import { ruleSha256, type LetterEntry, type LetterRule } from '../rule'
import { lettersFingerprint } from '../send-rule'
import type { ClaimInput, ClaimOutcome, ClaimRead, LetterLedger, LetterRow, NamedLetterDeps, SendLocks } from '../send-types'
import { templateContentSha256 } from '../welcome-template'
import { CLIENT, sendableRule } from './authorization-fakes'
import { AUTH_ID, CONTACT, SEND_NOW, sendWorld, type SendWorld } from './send-fakes'

export { AUTH_ID, CLIENT, CONTACT, SEND_NOW }

export const CATALOGUE_URL = 'https://www.example.com/catalogue-2027'

export function letterTemplate(over: Partial<EmailTemplateVersion> = {}): EmailTemplateVersion {
  return {
    id: 't-cat',
    clientId: CLIENT,
    templateKey: 'auto-ai-catalogue',
    version: 2,
    name: 'Catalogue 2027',
    subject: 'Our 2027 tours, {{ first_name }}',
    body: 'Hi {{first_name}},\nHere is the 2027 catalogue: {{catalogue_url}}\nBaker',
    factSource: 'none',
    pickMode: 'none',
    pickFilter: {},
    status: 'active',
    changeNote: null,
    createdBy: 'pm@example.com',
    createdAt: '2026-11-10T00:00:00.000Z',
    ...over,
  }
}

export function followupTemplate(over: Partial<EmailTemplateVersion> = {}): EmailTemplateVersion {
  return letterTemplate({ id: 't-d7', templateKey: 'auto-ai-d7', version: 1, name: 'Day 7', subject: 'Still thinking about China, {{first_name}}?', body: 'Hi {{first_name}},\nJust checking in.\nBaker', ...over })
}

export function entryFor(letterKey: string, t: EmailTemplateVersion, context: Partial<LetterEntry['context']> = {}): LetterEntry {
  return {
    letter_key: letterKey,
    template_key: t.templateKey,
    template_version: t.version,
    template_sha256: templateContentSha256(t),
    context: { catalogue_url: null, catalogue_valid_until: null, ...context },
  }
}

export const FOLLOWUP_GATES = { sales_email: false, legacy_welcomed: false, stale: false, count_legacy_batch: true }

export function letterRule(over: { letters?: LetterEntry[]; allowlist?: string[] | null } = {}): LetterRule {
  const base = sendableRule()
  const letters = over.letters ?? [
    entryFor('catalogue_2027', letterTemplate(), { catalogue_url: CATALOGUE_URL, catalogue_valid_until: '2027-03-31' }),
    entryFor('followup_d7', followupTemplate()),
  ]
  return {
    ...base,
    audience: { ...base.audience, sources: [] },
    recipient_allowlist: over.allowlist === undefined ? ['lead@example.org'] : over.allowlist,
    gates: { ...FOLLOWUP_GATES },
    send: { identity: base.send.identity, letters, send_window: base.send.send_window, health_breaker: base.send.health_breaker },
  }
}

export function letterRecord(rule: LetterRule = letterRule(), over: Partial<AuthorizationRecord> = {}): AuthorizationRecord {
  return {
    id: AUTH_ID,
    requestId: 'r0000000-0000-4000-8000-000000000002',
    clientId: CLIENT,
    triggerKey: 'crm_ai_followup',
    channel: 'email',
    account: 'cts',
    rule,
    ruleSha256: ruleSha256(rule),
    templateVersion: 1,
    templateSha256: lettersFingerprint(rule.send.letters),
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

let tick = 0
const stamp = (): string => new Date(Date.UTC(2026, 10, 19, 21, 30, 0, ++tick)).toISOString()
const CLAIMED = new Set(['pending', 'unknown_outcome', 'sent', 'delivery_delayed', 'delivered', 'suppressed', 'bounced', 'complained'])
const TWENTY_HOURS_MS = 20 * 3_600_000

/** The live letter rows, keeping the letter claim function's answers that matter here. */
export class FakeLetterLedger {
  rows = new Map<string, LetterRow>()
  claims: Array<ClaimInput & { letterKey: string }> = []
  forced: ClaimOutcome[] = []
  decisions: Array<{ letterKey: string; status: string; reasonCode: string; annotations: Record<string, unknown> }> = []
  annotateFails = false
  /** How far the fake database's clock is from the caller's (the 20-hour check uses the database's). */
  dbClockOffsetMs = 0
  /** Every outcome the claim answered, in order. */
  answers: ClaimOutcome[] = []
  private n = 0

  constructor(private readonly world: { rule: () => LetterRule; now: () => Date }) {}

  seed(over: Partial<LetterRow>): LetterRow {
    const row: LetterRow = {
      id: `e1000000-0000-4000-8000-0000000000${String(++this.n).padStart(2, '0')}`, contactId: CONTACT, status: 'blocked', reasonCode: null, authorizationId: AUTH_ID,
      idempotencyKey: null, renderedSha256: null, toAddressSha256: null, firstAttemptAt: null, providerMessageId: null, attempts: 0, updatedAt: stamp(),
      letterKey: 'catalogue_2027', annotations: {}, templateKey: null, templateVersion: null, templateSha256: null, sentAt: null, ...over,
    }
    this.rows.set(row.id, row)
    return row
  }

  of(contactId: string, letterKey: string): LetterRow | undefined {
    return [...this.rows.values()].find((r) => r.contactId === contactId && r.letterKey === letterKey)
  }

  port(letterKey: string): LetterLedger {
    const mine = (r: LetterRow) => r.letterKey === letterKey
    return {
      rowsFor: async (_c, ids) => ({ ok: true, rows: [...this.rows.values()].filter((r) => mine(r) && ids.includes(r.contactId)).map((r) => ({ ...r })) }),
      rowById: async (_c, id) => {
        const r = this.rows.get(id)
        return { ok: true, row: r !== undefined && mine(r) ? { ...r } : null }
      },
      recordDecision: async (d) => {
        this.decisions.push({ letterKey, status: d.status, reasonCode: d.reasonCode, annotations: d.annotations })
        const existing = d.existing === null ? undefined : this.rows.get(d.existing.id)
        if (existing !== undefined) Object.assign(existing, { status: d.status, reasonCode: d.reasonCode, annotations: d.annotations, updatedAt: stamp() })
        else this.seed({ contactId: d.contactId, letterKey, status: d.status, reasonCode: d.reasonCode, annotations: d.annotations })
        return { ok: true }
      },
      noteBlock: async () => ({ ok: true }),
      claim: async (input) => this.claim(letterKey, input),
      markSent: async (row, input) => this.cas(row, { status: 'sent', providerMessageId: input.messageId, sentAt: input.sentAt }),
      markFailed: async (row, input) => this.cas(row, { status: 'failed', reasonCode: input.reasonCode }),
      markUnknown: async (row) => this.cas(row, {}),
      annotate: async (row, annotations) => (this.annotateFails ? { ok: false, error: 'down' } : this.cas(row, { annotations })),
    }
  }

  private cas(row: { id: string; updatedAt: string }, patch: Partial<LetterRow>) {
    const current = this.rows.get(row.id)
    if (current === undefined || current.status !== 'pending' || current.updatedAt !== row.updatedAt) return Promise.resolve({ ok: true as const, result: 'changed' as const })
    Object.assign(current, patch, { updatedAt: stamp() })
    return Promise.resolve({ ok: true as const, result: 'updated' as const })
  }

  private answer(outcome: ClaimOutcome, row: LetterRow | undefined): ClaimRead {
    this.answers.push(outcome)
    return { ok: true, outcome, sendId: row?.id ?? null, idempotencyKey: row?.idempotencyKey ?? null }
  }

  private async claim(letterKey: string, input: ClaimInput): Promise<ClaimRead> {
    this.claims.push({ ...input, letterKey })
    const existing = this.of(input.contactId, letterKey)
    const forced = this.forced.shift()
    if (forced !== undefined) return this.answer(forced, existing)
    if (existing?.status === 'pending' && existing.firstAttemptAt !== null && this.world.now().getTime() + this.dbClockOffsetMs - Date.parse(existing.firstAttemptAt) > TWENTY_HOURS_MS) {
      Object.assign(existing, { status: 'unknown_outcome', reasonCode: 'expired_20h', updatedAt: stamp() })
      return this.answer('expired_unknown', existing)
    }
    const listed = this.world.rule().send.letters.find((l) => l.letter_key === letterKey)
    if (listed === undefined) return this.answer('letter_not_authorized', existing)
    if (listed.template_key !== input.templateKey || listed.template_version !== input.templateVersion || listed.template_sha256 !== input.templateSha256) return this.answer('template_mismatch', existing)
    if (existing?.status === 'pending') return this.pendingClaim(existing, input)
    if (existing !== undefined && existing.status !== 'blocked') return this.answer('exists_terminal', existing)
    const row = existing ?? this.seed({ contactId: input.contactId, letterKey })
    Object.assign(row, {
      status: 'pending', authorizationId: input.authorizationId, idempotencyKey: input.idempotencyKey, renderedSha256: input.renderedSha256, toAddressSha256: input.toAddressSha256,
      templateKey: input.templateKey, templateVersion: input.templateVersion, templateSha256: input.templateSha256, firstAttemptAt: this.world.now().toISOString(), attempts: row.attempts + 1, updatedAt: stamp(),
    })
    this.answers.push('claimed')
    return { ok: true, outcome: 'claimed', sendId: row.id, idempotencyKey: input.idempotencyKey }
  }

  private pendingClaim(existing: LetterRow, input: ClaimInput): ClaimRead {
    if (existing.authorizationId !== input.authorizationId || existing.renderedSha256 !== input.renderedSha256) return this.answer('in_flight', existing)
    existing.attempts += 1
    existing.updatedAt = stamp()
    return this.answer('takeover', existing)
  }

  /** How many letters of this trigger were claimed (any letter). */
  claimedCount(): number {
    return [...this.rows.values()].filter((r) => CLAIMED.has(r.status)).length
  }
}

export interface LetterWorld {
  base: SendWorld
  deps: NamedLetterDeps
  ledger: FakeLetterLedger
  clock: { now: Date }
  tracking: { tags: number; retags: number; fail: boolean }
  templateReads: string[]
  set: {
    rule(rule: LetterRule): void
    record(r: AuthorizationRecord | null): void
    template(key: string, t: EmailTemplateVersion | null | 'unreadable'): void
  }
}

/** Tokens the first https link of a body (deterministic tokens), like the real tracker does for a tracked host. */
function tokenLink(body: string, token: string): string {
  return body.replace(/https:\/\/\S+/, (url) => `${url}?me=${token}`)
}

export function letterWorld(): LetterWorld {
  const base = sendWorld()
  let rule = letterRule()
  let record: AuthorizationRecord | null = letterRecord(rule)
  const templates = new Map<string, EmailTemplateVersion | null | 'unreadable'>([
    ['auto-ai-catalogue', letterTemplate()],
    ['auto-ai-d7', followupTemplate()],
  ])
  const clock = { now: SEND_NOW }
  const ledger = new FakeLetterLedger({ rule: () => rule, now: () => clock.now })
  const tracking = { tags: 0, retags: 0, fail: false }
  const w: LetterWorld = {
    base,
    deps: null as never,
    ledger,
    clock,
    tracking,
    templateReads: [],
    set: {
      rule: (r) => {
        rule = r
        record = letterRecord(r)
      },
      record: (r) => {
        record = r
      },
      template: (key, t) => {
        templates.set(key, t)
      },
    },
  }
  let keys = 0
  w.deps = {
    ...base.deps,
    now: () => clock.now,
    loadAuthorization: async () => ({ ok: true, record }),
    loadTemplate: async (_clientId, key) => {
      w.templateReads.push(key)
      const t = templates.get(key) ?? null
      return t === 'unreadable' ? { ok: false } : { ok: true, template: t }
    },
    newIdempotencyKey: () => `triggered-send:crm_ai_followup:key-${++keys}`,
    letters: (letterKey) => ledger.port(letterKey),
    letterRows: async (_clientId, contactId) => ({ ok: true, rows: [...ledger.rows.values()].filter((r) => r.contactId === contactId).map((r) => ({ ...r, annotations: { ...r.annotations } })) }),
    linkTracking: {
      tag: async ({ body }) => {
        tracking.tags += 1
        if (tracking.fail) return { body, tagged: 0, tokens: [], warning: 'link_tracking_failed' }
        if (!/https:\/\//.test(body)) return { body, tagged: 0, tokens: [], warning: null }
        const token = `Tok${String(tracking.tags).padStart(9, '0')}`
        return { body: tokenLink(body, token), tagged: 1, tokens: [token], warning: null }
      },
      retag: async ({ body, tokens }) => {
        tracking.retags += 1
        return tokens.length === 1 ? { ok: true, body: tokenLink(body, tokens[0]) } : { ok: false }
      },
    },
  }
  return w
}

/** Locks two worlds share: a guest held by one is busy for the other (the real store is one table). */
export function sharedLocks(): { create: () => SendLocks; held: Set<string> } {
  const held = new Set<string>()
  return {
    held,
    create: () => ({
      take: async (_clientId, contactId) => {
        if (held.has(contactId)) return { ok: true, held: false }
        held.add(contactId)
        return { ok: true, held: true }
      },
      release: async (_clientId, contactId) => {
        held.delete(contactId)
      },
    }),
  }
}
