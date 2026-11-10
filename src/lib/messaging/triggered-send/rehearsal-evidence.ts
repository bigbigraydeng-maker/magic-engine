/**
 * The rehearsal's evidence for one rule (§5.4): counting back from the latest day that had new leads, on how many days
 * in a row did what ME WOULD have done agree with what the old daily batch DID?
 *
 * Only rows decided under the same decisions count (contract ④, §16.7): the row's proposal must carry the same rule
 * apart from its `send` block (that block says how and when to send, never who), and the row itself must have been
 * decided by the same gate contract version. A proposal that changes who would be welcomed starts the count again.
 * The per-day verdicts are the existing pure functions of `compare.ts`; nothing here judges a lead itself.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §5.4, §16.7 (plan: §17).
 */

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { listAuthorizationRules } from './authorization-store'
import { compareShadowRows, consecutiveConsistentDays, type CompareDay, type ShadowRowForCompare } from './compare'
import { canonicalJson, parseRule, type TriggeredSendRule } from './rule'

/** §5.4: five consistent days with new leads before a rule may be authorized for real leads. */
export const REHEARSAL_REQUIRED_DAYS = 5
/** How many of the latest days the evidence lists (the count itself looks at every day). */
export const REHEARSAL_DAYS_SHOWN = 14
const PAGE_SIZE = 1000
const MAX_ROWS = 5000

export interface RehearsalEvidence {
  requiredDays: number
  consecutiveDays: number
  /** The latest days, oldest first. */
  days: CompareDay[]
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

/** Pure: the evidence from the shadow rows of the matching proposals. Rows of another gate version are left out. */
export function summarizeRehearsal(
  rows: readonly ShadowRowForCompare[],
  gateContractVersion: number,
  proposalsCounted: number,
): RehearsalEvidence {
  const counted = rows.filter((row) => row.annotations.gate_contract_version === gateContractVersion)
  const days = compareShadowRows(counted)
  return {
    requiredDays: REHEARSAL_REQUIRED_DAYS,
    consecutiveDays: consecutiveConsistentDays(days),
    days: days.slice(-REHEARSAL_DAYS_SHOWN),
    rowsCounted: counted.length,
    proposalsCounted,
  }
}

interface ShadowDbRow {
  contact_id: string
  status: string
  reason_code: string | null
  annotations: Record<string, unknown> | null
}

async function readShadowRows(
  db: SupabaseClient,
  clientId: string,
  proposalIds: string[],
): Promise<{ ok: true; rows: ShadowRowForCompare[] } | { ok: false; code: string }> {
  const rows: ShadowRowForCompare[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from('triggered_sends')
      .select('contact_id, status, reason_code, annotations')
      .eq('client_id', clientId)
      .eq('trigger_key', 'welcome')
      .eq('channel', 'email')
      .eq('dedupe_scope', 'shadow')
      .in('authorization_id', proposalIds)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) return { ok: false, code: 'shadow_rows_unreadable' }
    const page = (data as ShadowDbRow[] | null) ?? []
    for (const r of page) {
      rows.push({ contactId: r.contact_id, status: r.status, reasonCode: r.reason_code, annotations: r.annotations ?? {} })
    }
    if (rows.length > MAX_ROWS) return { ok: false, code: 'too_many_rows' }
    if (page.length < PAGE_SIZE) return { ok: true, rows }
  }
}

/** Reads the evidence for `rule` of one client. Any read failure is a failure, never "no evidence". */
export async function loadRehearsalEvidence(db: SupabaseClient, clientId: string, rule: TriggeredSendRule): Promise<RehearsalRead> {
  const listed = await listAuthorizationRules(db, { clientId, triggerKey: 'welcome', channel: 'email' })
  if (!listed.ok) return { ok: false, code: 'proposals_unreadable' }
  const ids = matchingProposalIds(listed.rows, rule)
  if (ids.length === 0) return { ok: true, evidence: summarizeRehearsal([], rule.gate_contract_version, 0) }
  const read = await readShadowRows(db, clientId, ids)
  if (!read.ok) return read
  return { ok: true, evidence: summarizeRehearsal(read.rows, rule.gate_contract_version, ids.length) }
}
