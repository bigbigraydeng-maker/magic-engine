/**
 * Test fakes for the authorization commands: an in-memory authorization table that keeps the real table's rules
 * (one open proposal and one open authorization per client; lifecycle columns written once; the conditional writes
 * of the store), plus a sendable rule, a sendable template and a deps object to wire them.
 */
import type { EmailTemplateVersion } from '@/lib/crm/email-templates/types'
import type { AuthorizationChangedEvent } from '@/lib/inngest/triggered-send-events'
import type { AuthorizationStorePort, CommandDeps, SalesCapRead, TemplateRead } from '../authorization-core'
import type { StatusDeps } from '../authorization-status'
import type { AuthorizationRecord, NewProposal, OpenAuthorizations, StoreError } from '../authorization-store'
import type { RecentSendsRead } from '../recent-sends'
import type { RehearsalEvidence, RehearsalRead } from '../rehearsal-evidence'
import { ruleSha256, type SendableRule, type TriggeredSendRule } from '../rule'
import type { MailboxCheck } from '../types'
import { templateContentSha256 } from '../welcome-template'

export const CLIENT = 'c0000000-0000-0000-0000-000000000000'
export const OTHER_CLIENT = 'd0000000-0000-4000-8000-000000000000'
export const NOW = new Date('2026-11-20T00:00:00.000Z')
export const ACTOR = { email: 'pm@example.com', userId: 'e0000000-0000-4000-8000-000000000001' }

export function sendableRule(over: Partial<TriggeredSendRule> = {}): SendableRule {
  return {
    gate_contract_version: 1,
    audience: { sources: ['meta_lead_form'], max_age_days: 3, min_age: 'previous_local_day' },
    schedule: { timezone: 'Pacific/Auckland' },
    frequency_cap: { max: 2, window_days: 7 },
    consent: { accepted_bases: ['form_disclosure_attested'] },
    legacy: { mailchimp_campaign_title_prefix: 'legacy_batch_', excluded_tags: [] },
    human_mail: { required_mailboxes: ['sales@example.com'] },
    recipient_allowlist: null,
    send: {
      identity: { from: 'Example <news@news.example.com>', reply_to: 'info@example.com' },
      template: { key: 'auto-welcome' },
      send_window: { start: '08:00', end: '20:00' },
      health_breaker: { window_days: 30, bounce_min_sent: 50, bounce_min_count: 3, bounce_rate_pct: 4, complaint_max: 2, provider_reject_streak: 3 },
    },
    ...over,
  } as SendableRule
}

export function template(over: Partial<EmailTemplateVersion> = {}): EmailTemplateVersion {
  return {
    id: 't1',
    clientId: CLIENT,
    templateKey: 'auto-welcome',
    version: 3,
    name: 'Welcome',
    subject: 'Welcome, {{ first_name }}',
    body: 'Hi {{first_name}},\nThanks for your enquiry.',
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

export function evidence(consecutiveDays: number, over: Partial<RehearsalEvidence> = {}): RehearsalEvidence {
  return {
    requiredDays: 5,
    consecutiveDays,
    runFrom: consecutiveDays > 0 ? '2026-11-14' : null,
    runTo: consecutiveDays > 0 ? '2026-11-18' : null,
    calendar: [],
    undatedRows: 0,
    switchToday: false,
    batches: [],
    batchGap: 0,
    rowsCounted: consecutiveDays * 10,
    proposalsCounted: 1,
    ...over,
  }
}

let seq = 0
function nextId(): string {
  seq += 1
  return `f0000000-0000-4000-8000-${String(seq).padStart(12, '0')}`
}

export class FakeStore implements AuthorizationStorePort {
  rows: AuthorizationRecord[] = []
  /** Make the next call of a method answer this error code. */
  fail: Partial<Record<keyof AuthorizationStorePort, string>> = {}
  calls: string[] = []

  private failed<K extends keyof AuthorizationStorePort>(method: K): StoreError | null {
    this.calls.push(method)
    const code = this.fail[method]
    if (code === undefined) return null
    delete this.fail[method]
    return { ok: false, code }
  }

  seed(over: Partial<AuthorizationRecord> = {}): AuthorizationRecord {
    const rule = sendableRule()
    const t = template()
    const row: AuthorizationRecord = {
      id: nextId(),
      requestId: nextId(),
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
      proposedAt: '2026-11-19T00:00:00.000Z',
      authorizedByEmail: null,
      authorizedAt: null,
      liveFrom: null,
      expiresAt: null,
      activatedAt: null,
      revokedAt: null,
      revokedBy: null,
      revokedReason: null,
      ...over,
    }
    this.rows.push(row)
    return row
  }

  async loadOpen(clientId: string): Promise<{ ok: true; open: OpenAuthorizations } | StoreError> {
    const f = this.failed('loadOpen')
    if (f) return f
    const mine = this.rows.filter((r) => r.clientId === clientId && r.revokedAt === null)
    return { ok: true, open: { proposal: mine.find((r) => r.authorizedAt === null) ?? null, authorized: mine.find((r) => r.authorizedAt !== null) ?? null } }
  }

  async load(id: string): Promise<{ ok: true; record: AuthorizationRecord | null } | StoreError> {
    const f = this.failed('load')
    if (f) return f
    const row = this.rows.find((r) => r.id === id)
    return { ok: true, record: row === undefined ? null : { ...row } }
  }

  async insertProposal(p: NewProposal): Promise<{ ok: true; id: string } | StoreError> {
    const f = this.failed('insertProposal')
    if (f) return f
    const open = this.rows.some((r) => r.clientId === p.clientId && r.authorizedAt === null && r.revokedAt === null)
    if (open || this.rows.some((r) => r.requestId === p.requestId)) return { ok: false, code: 'proposal_conflict' }
    const row = this.seed({
      requestId: p.requestId,
      clientId: p.clientId,
      account: p.account,
      rule: p.rule,
      ruleSha256: p.ruleSha256,
      templateVersion: p.templateVersion,
      templateSha256: p.templateSha256,
      dailyCap: p.dailyCap,
      proposedByEmail: p.proposedByEmail,
      proposedAt: NOW.toISOString(),
    })
    return { ok: true, id: row.id }
  }

  async revoke(input: { id: string; by: string; reason: string }): Promise<{ ok: true; record: AuthorizationRecord } | StoreError> {
    const f = this.failed('revoke')
    if (f) return f
    const row = this.rows.find((r) => r.id === input.id && r.revokedAt === null)
    if (row === undefined) return { ok: false, code: 'not_open' }
    Object.assign(row, { revokedAt: NOW.toISOString(), revokedBy: input.by, revokedReason: input.reason })
    return { ok: true, record: { ...row } }
  }

  async authorize(input: { id: string; byEmail: string; byUserId: string; liveFrom: string; expiresAt: string }): Promise<
    { ok: true; record: AuthorizationRecord } | StoreError
  > {
    const f = this.failed('authorize')
    if (f) return f
    const row = this.rows.find((r) => r.id === input.id && r.authorizedAt === null && r.revokedAt === null)
    if (row === undefined) return { ok: false, code: 'not_open' }
    if (this.rows.some((r) => r.clientId === row.clientId && r.authorizedAt !== null && r.revokedAt === null)) {
      return { ok: false, code: 'authorized_exists' }
    }
    Object.assign(row, { authorizedByEmail: input.byEmail, authorizedAt: NOW.toISOString(), liveFrom: input.liveFrom, expiresAt: input.expiresAt })
    return { ok: true, record: { ...row } }
  }

  async activate(id: string): Promise<{ ok: true; record: AuthorizationRecord } | StoreError> {
    const f = this.failed('activate')
    if (f) return f
    const row = this.rows.find((r) => r.id === id && r.authorizedAt !== null && r.activatedAt === null && r.revokedAt === null)
    if (row === undefined) return { ok: false, code: 'not_open' }
    row.activatedAt = NOW.toISOString()
    return { ok: true, record: { ...row } }
  }
}

export interface FakeWorld {
  deps: CommandDeps
  /** The command ports plus the page's 「最近发送」 (an empty list unless set). */
  statusDeps: StatusDeps
  store: FakeStore
  events: AuthorizationChangedEvent[]
  set: {
    template(read: TemplateRead): void
    salesCap(read: SalesCapRead): void
    rehearsal(read: RehearsalRead): void
    emitFails(change?: string): void
    canEmit(value: boolean): void
    mailboxes(check: MailboxCheck): void
    env(values: Record<string, string>): void
    recentSends(read: RecentSendsRead | 'throw'): void
  }
}

export function fakeWorld(): FakeWorld {
  const store = new FakeStore()
  const events: AuthorizationChangedEvent[] = []
  let templateRead: TemplateRead = { ok: true, template: template() }
  let salesCapRead: SalesCapRead = { kind: 'cap', cap: { max: 2, windowDays: 7 } }
  let rehearsalRead: RehearsalRead = { ok: true, evidence: evidence(5) }
  let failingChange: string | null = null
  let emitConfigured = true
  let mailboxCheck: MailboxCheck = { ok: true }
  let envValues: Record<string, string> = { TRIGGERED_SEND_TRIAL_DOMAINS: 'example.com' }
  let recentRead: RecentSendsRead | 'throw' = { ok: true, rows: [] }
  const deps: CommandDeps = {
    store,
    loadTemplate: async () => templateRead,
    loadSalesFrequencyCap: async () => salesCapRead,
    loadRehearsal: async () => rehearsalRead,
    emit: async (event) => {
      if (failingChange !== null && (failingChange === '*' || failingChange === event.data.change)) throw new Error('inngest down')
      events.push(event)
    },
    canEmit: () => emitConfigured,
    checkMailboxes: async () => mailboxCheck,
    env: (name) => envValues[name],
    now: () => NOW,
    newRequestId: () => nextId(),
  }
  const statusDeps: StatusDeps = {
    ...deps,
    loadRecentSends: async () => {
      if (recentRead === 'throw') throw new Error('db down')
      return recentRead
    },
  }
  return {
    deps,
    statusDeps,
    store,
    events,
    set: {
      template: (read) => (templateRead = read),
      salesCap: (read) => (salesCapRead = read),
      rehearsal: (read) => (rehearsalRead = read),
      emitFails: (change = '*') => (failingChange = change),
      canEmit: (value) => (emitConfigured = value),
      mailboxes: (check) => (mailboxCheck = check),
      env: (values) => (envValues = values),
      recentSends: (read) => (recentRead = read),
    },
  }
}
