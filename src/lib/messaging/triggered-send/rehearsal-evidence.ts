/**
 * The rehearsal's evidence for one rule (§5.4): on how many CALENDAR days in a row, ending yesterday (or the day before,
 * when this morning's sweep has not run yet), did what ME WOULD have done agree with what the old daily batch DID?
 *
 * A day counts only when it is fully covered by the same decisions (contract ④, §16.7):
 *  - the rows come from proposals whose rule is the same apart from its `send` block (that block says how and when to
 *    send, never who), decided by the same gate version;
 *  - a day with rows of a proposal that decides differently (a trial, say) breaks the run; so does the day a proposal
 *    of these decisions was submitted after midnight (the sweep only judges leads that came after the proposal, so that
 *    day is only partly compared), and so does any row whose lead day cannot be read;
 *  - a day without rows is skipped only when the next morning's sweep ran under these decisions with nothing set aside
 *    (then the day truly had no new leads); otherwise nobody compared it and the run breaks there.
 * The window is the last 35 days. The batch totals (the old batch's own recipient count against the leads ME matched to
 * it) come from the sweeps' receipts in `cron_run_logs`; only campaigns sent after the first proposal of these decisions
 * count (contract ④). A gap is shown, it does not block (§16.6: explained before authorizing, not an automatic fail).
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §5.4, §16.6, §16.7 (plan: §17.2).
 */

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { listAuthorizationRules } from './authorization-store'
import { localDay } from './candidates'
import {
  compareShadowRows,
  isConsistentDay,
  reconcileBatches,
  type BatchForReconcile,
  type BatchReconciliation,
  type CompareDay,
  type ShadowRowForCompare,
} from './compare'
import { canonicalJson, parseRule, type TriggeredSendRule } from './rule'

/** §5.4: five consistent days before a rule may be authorized for real leads. */
export const REHEARSAL_REQUIRED_DAYS = 5
export const REHEARSAL_WINDOW_DAYS = 35
/** How many calendar days (ending yesterday) the evidence lists. */
export const REHEARSAL_DAYS_SHOWN = 14
const SWEEP_JOB = 'triggered-send-welcome-sweep'
const PAGE_SIZE = 1000
const MAX_ROWS = 5000
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export type RehearsalDayKind = 'consistent' | 'inconsistent' | 'no_leads' | 'not_compared' | 'other_rule' | 'switch_day'

export interface RehearsalCalendarDay {
  day: string
  kind: RehearsalDayKind
  stats: CompareDay | null
}

export interface RehearsalEvidence {
  requiredDays: number
  consecutiveDays: number
  /** The counted run, oldest and newest day (null when nothing counts). */
  runFrom: string | null
  runTo: string | null
  /** The latest calendar days ending yesterday, oldest first. */
  calendar: RehearsalCalendarDay[]
  undatedRows: number
  batches: BatchReconciliation[]
  /** Recipients of the old batch ME did not match, summed over the batches (0 = none). */
  batchGap: number
  rowsCounted: number
  proposalsCounted: number
}

export type RehearsalRead = { ok: true; evidence: RehearsalEvidence } | { ok: false; code: string }

/** SHA-256 of the rule without its send block: equal fingerprints decide every lead the same way. */
export function decisionFingerprint(rule: TriggeredSendRule): string {
  const decisions: Record<string, unknown> = { ...rule }
  delete decisions.send
  return createHash('sha256').update(canonicalJson(decisions), 'utf8').digest('hex')
}

/** The proposals (any state) whose rule decides like `rule`. A stored rule that no longer parses never counts. */
export function matchingProposalIds(rows: ReadonlyArray<{ id: string; rule: unknown }>, rule: TriggeredSendRule): string[] {
  const target = decisionFingerprint(rule)
  const ids: string[] = []
  for (const row of rows) {
    const parsed = parseRule(row.rule)
    if (parsed.ok && decisionFingerprint(parsed.rule) === target) ids.push(row.id)
  }
  return ids
}

export function shiftDay(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10)
}

export interface RehearsalInput {
  /** Today in the rule's time zone (YYYY-MM-DD). */
  today: string
  gateContractVersion: number
  /** Shadow rows of the proposals with these decisions. */
  rows: readonly ShadowRowForCompare[]
  /** Lead days holding rows of proposals that decide differently. */
  otherRuleDays: ReadonlySet<string>
  /** Days a proposal with these decisions was submitted after local midnight. */
  switchDays: ReadonlySet<string>
  /** Local days on which a sweep ran under these decisions and set nothing aside. */
  sweptDays: ReadonlySet<string>
  batches: readonly BatchForReconcile[]
  proposalsCounted: number
}

function dayKind(day: string, input: RehearsalInput, byDay: ReadonlyMap<string, CompareDay>): RehearsalDayKind {
  if (input.otherRuleDays.has(day)) return 'other_rule'
  if (input.switchDays.has(day)) return 'switch_day'
  const stats = byDay.get(day)
  if (stats !== undefined) return isConsistentDay(stats) ? 'consistent' : 'inconsistent'
  return input.sweptDays.has(shiftDay(day, 1)) ? 'no_leads' : 'not_compared'
}

function walkRun(input: RehearsalInput, byDay: ReadonlyMap<string, CompareDay>): { count: number; from: string | null; to: string | null } {
  const windowStart = shiftDay(input.today, -REHEARSAL_WINDOW_DAYS)
  // Before this morning's sweep has run, yesterday has not been compared yet: start one day earlier then.
  let day = shiftDay(input.today, -1)
  if (dayKind(day, input, byDay) === 'not_compared') day = shiftDay(day, -1)
  let count = 0
  let from: string | null = null
  let to: string | null = null
  for (; day >= windowStart; day = shiftDay(day, -1)) {
    const kind = dayKind(day, input, byDay)
    if (kind === 'no_leads') continue
    if (kind !== 'consistent') break
    count += 1
    from = day
    to = to ?? day
  }
  return { count, from, to }
}

/** Pure: the evidence for one rule. */
export function summarizeRehearsal(input: RehearsalInput): RehearsalEvidence {
  const counted = input.rows.filter((row) => row.annotations.gate_contract_version === input.gateContractVersion)
  const undatedRows = counted.filter((row) => {
    const day = row.annotations.lead_local_day
    return typeof day !== 'string' || !DAY_RE.test(day)
  }).length
  const byDay = new Map(compareShadowRows(counted).map((d) => [d.leadLocalDay, d]))
  const run = undatedRows > 0 ? { count: 0, from: null, to: null } : walkRun(input, byDay)
  const calendar: RehearsalCalendarDay[] = []
  for (let i = REHEARSAL_DAYS_SHOWN; i >= 1; i -= 1) {
    const day = shiftDay(input.today, -i)
    calendar.push({ day, kind: dayKind(day, input, byDay), stats: byDay.get(day) ?? null })
  }
  const batches = reconcileBatches(input.batches, counted).sort((a, b) => ((a.sentAt ?? '') < (b.sentAt ?? '') ? 1 : -1))
  return {
    requiredDays: REHEARSAL_REQUIRED_DAYS,
    consecutiveDays: run.count,
    runFrom: run.from,
    runTo: run.to,
    calendar,
    undatedRows,
    batches,
    batchGap: batches.reduce((sum, b) => sum + Math.max(0, b.gap), 0),
    rowsCounted: counted.length,
    proposalsCounted: input.proposalsCounted,
  }
}

// ── production reads ────────────────────────────────────────────────────────────────────────────────────

interface ShadowDbRow {
  contact_id: string
  status: string
  reason_code: string | null
  annotations: Record<string, unknown> | null
  authorization_id: string | null
}

async function readShadowRows(db: SupabaseClient, clientId: string, sinceIso: string): Promise<ShadowDbRow[] | null> {
  const rows: ShadowDbRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from('triggered_sends')
      .select('contact_id, status, reason_code, annotations, authorization_id')
      .eq('client_id', clientId)
      .eq('trigger_key', 'welcome')
      .eq('channel', 'email')
      .eq('dedupe_scope', 'shadow')
      .gte('created_at', sinceIso)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) return null
    const page = (data as ShadowDbRow[] | null) ?? []
    rows.push(...page)
    if (rows.length > MAX_ROWS) return null
    if (page.length < PAGE_SIZE) return rows
  }
}

export interface SweepReceiptLite {
  startedAt: string
  status: string
  authorizationId: string | null
  deferred: number
  legacyBatches: BatchForReconcile[]
}

function parseBatch(raw: unknown): BatchForReconcile | null {
  if (typeof raw !== 'object' || raw === null) return null
  const b = raw as Record<string, unknown>
  if (typeof b.campaignId !== 'string' || typeof b.title !== 'string' || typeof b.emailsSent !== 'number') return null
  return { campaignId: b.campaignId, title: b.title, sentAt: typeof b.sentAt === 'string' ? b.sentAt : null, emailsSent: b.emailsSent }
}

export function parseSweepReceipt(startedAt: unknown, summary: unknown): SweepReceiptLite | null {
  if (typeof startedAt !== 'string' || typeof summary !== 'object' || summary === null) return null
  const s = summary as Record<string, unknown>
  const batches = Array.isArray(s.legacy_batches) ? s.legacy_batches.map(parseBatch).filter((b): b is BatchForReconcile => b !== null) : []
  return {
    startedAt,
    status: typeof s.status === 'string' ? s.status : '',
    authorizationId: typeof s.authorization_id === 'string' ? s.authorization_id : null,
    deferred: typeof s.deferred === 'number' ? s.deferred : -1,
    legacyBatches: batches,
  }
}

async function readSweepReceipts(db: SupabaseClient, clientId: string, sinceIso: string): Promise<SweepReceiptLite[] | null> {
  const { data, error } = await db
    .from('cron_run_logs')
    .select('started_at, summary')
    .eq('job_name', SWEEP_JOB)
    .eq('summary->>client_id', clientId)
    .gte('started_at', sinceIso)
    .order('started_at', { ascending: true })
    .limit(500)
  if (error) return null
  const rows = (data as Array<{ started_at: unknown; summary: unknown }> | null) ?? []
  return rows.map((r) => parseSweepReceipt(r.started_at, r.summary)).filter((r): r is SweepReceiptLite => r !== null)
}

/** Days a proposal of these decisions was submitted after local midnight (that day is only partly compared). */
export function switchDaysOf(proposals: ReadonlyArray<{ proposedAt: string }>, timeZone: string): Set<string> {
  const days = new Set<string>()
  for (const p of proposals) {
    const day = localDay(p.proposedAt, timeZone)
    const justBefore = localDay(new Date(Date.parse(p.proposedAt) - 1), timeZone)
    if (day !== null && justBefore === day) days.add(day)
  }
  return days
}

/** What the sweeps under these decisions say: the days with a clean sweep, and the batches after the first proposal. */
export function receiptFacts(
  receipts: readonly SweepReceiptLite[],
  matchingIds: ReadonlySet<string>,
  firstProposalAt: string | null,
  timeZone: string,
): { sweptDays: Set<string>; batches: BatchForReconcile[] } {
  const sweptDays = new Set<string>()
  const latest = new Map<string, BatchForReconcile>()
  for (const r of receipts) {
    if (r.authorizationId === null || !matchingIds.has(r.authorizationId)) continue
    const day = localDay(r.startedAt, timeZone)
    if (r.status === 'swept' && r.deferred === 0 && day !== null) sweptDays.add(day)
    for (const b of r.legacyBatches) {
      if (firstProposalAt !== null && (b.sentAt === null || b.sentAt < firstProposalAt)) continue
      latest.set(b.campaignId, b)
    }
  }
  return { sweptDays, batches: [...latest.values()] }
}

function splitRows(rows: readonly ShadowDbRow[], matchingIds: ReadonlySet<string>): { matching: ShadowRowForCompare[]; otherRuleDays: Set<string> } {
  const matching: ShadowRowForCompare[] = []
  const otherRuleDays = new Set<string>()
  for (const r of rows) {
    const annotations = r.annotations ?? {}
    if (r.authorization_id !== null && matchingIds.has(r.authorization_id)) {
      matching.push({ contactId: r.contact_id, status: r.status, reasonCode: r.reason_code, annotations })
    } else if (typeof annotations.lead_local_day === 'string' && DAY_RE.test(annotations.lead_local_day)) {
      otherRuleDays.add(annotations.lead_local_day)
    }
  }
  return { matching, otherRuleDays }
}

/** Reads the evidence for `rule` of one client. Any read failure is a failure, never "no evidence". */
export async function loadRehearsalEvidence(db: SupabaseClient, clientId: string, rule: TriggeredSendRule, now: Date): Promise<RehearsalRead> {
  const tz = rule.schedule.timezone
  const today = localDay(now, tz)
  if (today === null) return { ok: false, code: 'time_zone_unreadable' }
  const listed = await listAuthorizationRules(db, { clientId, triggerKey: 'welcome', channel: 'email' })
  if (!listed.ok) return { ok: false, code: 'proposals_unreadable' }
  const matchingIds = new Set(matchingProposalIds(listed.rows, rule))
  const matching = listed.rows.filter((r) => matchingIds.has(r.id))
  // One extra day before the window: a lead of the first day is decided the next morning.
  const sinceIso = new Date(now.getTime() - (REHEARSAL_WINDOW_DAYS + 2) * 86_400_000).toISOString()
  const [rows, receipts] = await Promise.all([readShadowRows(db, clientId, sinceIso), readSweepReceipts(db, clientId, sinceIso)])
  if (rows === null) return { ok: false, code: 'shadow_rows_unreadable' }
  if (receipts === null) return { ok: false, code: 'sweep_receipts_unreadable' }
  const firstProposalAt = matching.map((r) => r.proposedAt).sort()[0] ?? null
  const split = splitRows(rows, matchingIds)
  const facts = receiptFacts(receipts, matchingIds, firstProposalAt, tz)
  return {
    ok: true,
    evidence: summarizeRehearsal({
      today,
      gateContractVersion: rule.gate_contract_version,
      rows: split.matching,
      otherRuleDays: split.otherRuleDays,
      switchDays: switchDaysOf(matching, tz),
      sweptDays: facts.sweptDays,
      batches: facts.batches,
      proposalsCounted: matchingIds.size,
    }),
  }
}
