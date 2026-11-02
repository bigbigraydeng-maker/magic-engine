/**
 * The shadow sweep of ONE client: loads the open authorization, its rule, the candidate contacts and decides
 * per contact whether the welcome e-mail WOULD be sent. Nothing is ever sent; the decisions are frozen as
 * shadow rows. Pure and fully dependency-injected: none of the functions here throws.
 *
 * The sweep comes in three phases so that a host with a request time limit (Inngest on Render) can run each phase
 * as its own step and no single step runs long:
 *   prepareSweep   - read the rule and the contacts, classify, set the work aside (plain JSON, no personal data);
 *   decideChunk    - decide a few contacts and write each shadow row AS SOON AS it is decided (a killed step
 *                    loses nothing: rows already written are skipped by the retry);
 *   finalizeSweep  - add the chunk results up into the receipt.
 * `runShadowSweep` runs all three in one go (tests, local runs).
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §5.
 */

import type {
  AuthorizationRead,
  ChunkResult,
  ContactsRead,
  LegacyBatchSeen,
  MailboxCheck,
  PrepareResult,
  ShadowContact,
  ShadowDecision,
  ShadowGatePorts,
  ShadowRowsRead,
  SweepPlan,
  SweepReceipt,
} from './types'
import { GATE_CONTRACT_VERSION, parseRule, ruleSha256, type TriggeredSendRule } from './rule'
import { classifyContactAge, localDay } from './candidates'
import { decideShadow, isPlausibleEmail, staleDecision } from './shadow-gates'
import { addressSha256, type ShadowRowInput } from './shadow-store'

export interface SweepDeps {
  now(): Date
  loadAuthorization(clientId: string): Promise<AuthorizationRead>
  /** The audience members created since a time (the candidate window). */
  loadContacts(args: { clientId: string; sinceIso: string; sources: readonly string[] }): Promise<ContactsRead>
  /** Specific contacts again, inside a chunk step (so no e-mail address has to travel between steps). */
  loadContactsByIds(args: { clientId: string; contactIds: readonly string[] }): Promise<ContactsRead>
  findContactsWithShadowRows(clientId: string, contactIds: readonly string[]): Promise<ShadowRowsRead>
  checkMailboxes(clientId: string, required: readonly string[]): Promise<MailboxCheck>
  createPorts(args: { clientId: string; rule: TriggeredSendRule; now: Date }): {
    ports: ShadowGatePorts
    legacyBatches(): LegacyBatchSeen[]
  }
  insertShadowRows(rows: readonly ShadowRowInput[]): Promise<{ ok: true; inserted: number } | { ok: false; error: string }>
}

/** Contacts per chunk step: small enough that a chunk stays well inside the host's request time limit. */
export const CHUNK_SIZE = 4

const DAY_MS = 86_400_000

function emptyReceipt(clientId: string, dryRun: boolean, createdAt: string): SweepReceipt {
  return {
    status: 'swept',
    client_id: clientId,
    dry_run: dryRun,
    authorization_id: null,
    to_decide: 0,
    ignored: 0,
    decided: 0,
    deferred: 0,
    inserted: 0,
    would_send: 0,
    skipped_by_reason: {},
    deferred_by_reason: {},
    legacy_batches: [],
    no_send: true,
    provider_impact: 'NONE',
    error: null,
    created_at: createdAt,
  }
}

function bump(counts: Record<string, number>, key: string, by = 1): void {
  counts[key] = (counts[key] ?? 0) + by
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function chunkIds<T>(items: readonly T[], size: number = CHUNK_SIZE): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** The rule of an open authorization, checked the same way in every phase. */
function readRule(row: { rule: unknown; ruleSha256: string }): { ok: true; rule: TriggeredSendRule } | { ok: false; status: 'rule_invalid' | 'gate_changed'; error: string } {
  const parsed = parseRule(row.rule)
  if (!parsed.ok) return { ok: false, status: 'rule_invalid', error: parsed.error }
  if (ruleSha256(parsed.rule) !== row.ruleSha256) {
    return { ok: false, status: 'rule_invalid', error: 'rule_sha256 does not match the stored rule' }
  }
  if (parsed.rule.gate_contract_version !== GATE_CONTRACT_VERSION) {
    return {
      ok: false,
      status: 'gate_changed',
      error: `rule has gate_contract_version ${parsed.rule.gate_contract_version} but the code is ${GATE_CONTRACT_VERSION}`,
    }
  }
  return { ok: true, rule: parsed.rule }
}

/**
 * Phase 1: read the rule and the contacts, drop what is already decided, classify the rest.
 * Returns either a finished receipt (nothing to do / cannot go on) or a plan for the chunk steps.
 */
export async function prepareSweep(args: { clientId: string; dryRun: boolean; deps: SweepDeps }): Promise<PrepareResult> {
  const { clientId, dryRun, deps } = args
  const now = deps.now()
  const receipt = emptyReceipt(clientId, dryRun, now.toISOString())
  const done = (): PrepareResult => ({ kind: 'done', receipt })

  try {
    // 1. The open authorization.
    const authRead = await deps.loadAuthorization(clientId)
    if (!authRead.ok) {
      receipt.status = 'read_failed'
      receipt.error = authRead.error
      return done()
    }
    if (authRead.row === null) {
      receipt.status = 'no_open_proposal'
      return done()
    }
    const row = authRead.row
    receipt.authorization_id = row.id

    // 2. The rule: parse, verify the sha and the gate contract, compute the sweep day.
    const ruleRead = readRule(row)
    if (!ruleRead.ok) {
      receipt.status = ruleRead.status
      receipt.error = ruleRead.error
      return done()
    }
    const rule = ruleRead.rule
    const sweepDay = localDay(now, rule.schedule.timezone)
    if (sweepDay === null) {
      receipt.status = 'rule_invalid'
      receipt.error = 'cannot compute the local day'
      return done()
    }
    const proposedAtMs = Date.parse(row.proposedAt)
    if (Number.isNaN(proposedAtMs)) {
      receipt.status = 'read_failed'
      receipt.error = 'invalid proposed_at'
      return done()
    }

    // 3. Load the contacts since the proposal (or the age window, whichever is later).
    const sinceMs = Math.max(proposedAtMs, now.getTime() - (rule.audience.max_age_days + 4) * DAY_MS)
    const contactsRead = await deps.loadContacts({
      clientId,
      sinceIso: new Date(sinceMs).toISOString(),
      sources: rule.audience.sources,
    })
    if (!contactsRead.ok) {
      receipt.status = 'read_failed'
      receipt.error = contactsRead.error
      return done()
    }
    const contacts = contactsRead.contacts

    // 4. Drop the contacts that already hold a shadow row.
    let fresh: ShadowContact[] = contacts
    if (contacts.length > 0) {
      const rowsRead = await deps.findContactsWithShadowRows(
        clientId,
        contacts.map((c) => c.contactId),
      )
      if (!rowsRead.ok) {
        receipt.status = 'read_failed'
        receipt.error = rowsRead.error
        return done()
      }
      const already = rowsRead.contactIds
      fresh = contacts.filter((c) => {
        if (already.has(c.contactId)) {
          receipt.ignored += 1
          return false
        }
        return true
      })
    }

    // 5. Classify the remaining contacts by age.
    let candidateIds: string[] = []
    const staleIds: string[] = []
    for (const contact of fresh) {
      const age = classifyContactAge({
        createdAt: contact.createdAt,
        proposedAt: row.proposedAt,
        now,
        timeZone: rule.schedule.timezone,
        maxAgeDays: rule.audience.max_age_days,
      })
      if (age === 'candidate') {
        candidateIds.push(contact.contactId)
      } else if (age === 'stale') {
        staleIds.push(contact.contactId)
      } else {
        receipt.ignored += 1
      }
    }
    receipt.to_decide = candidateIds.length + staleIds.length

    // 6. The mailboxes people use to write to the lead must be readable, else "no human e-mail yet" cannot be trusted.
    let status: SweepPlan['status'] = 'swept'
    let error: string | null = null
    if (candidateIds.length > 0) {
      const mailbox = await deps.checkMailboxes(clientId, rule.human_mail.required_mailboxes)
      if (!mailbox.ok) {
        status = 'mailbox_unreadable'
        error = mailbox.detail
        receipt.deferred += candidateIds.length
        bump(receipt.deferred_by_reason, 'mailbox_unreadable', candidateIds.length)
        candidateIds = []
      }
    }

    return {
      kind: 'plan',
      plan: {
        clientId,
        dryRun,
        authorizationId: row.id,
        sweepDay,
        candidateIds,
        staleIds,
        to_decide: receipt.to_decide,
        ignored: receipt.ignored,
        deferred: receipt.deferred,
        deferred_by_reason: receipt.deferred_by_reason,
        status,
        error,
        createdAt: receipt.created_at,
      },
    }
  } catch (err) {
    receipt.status = 'read_failed'
    receipt.error = `unexpected: ${errorText(err)}`
    return done()
  }
}

function emptyChunk(): ChunkResult {
  return {
    decided: 0,
    deferred: 0,
    inserted: 0,
    would_send: 0,
    skipped_by_reason: {},
    deferred_by_reason: {},
    legacy_batches: [],
    error: null,
    error_status: null,
  }
}

/** Everything in the chunk is set aside for a later run (nothing was decided). */
function deferAll(contactIds: readonly string[], reason: string, error: string | null): ChunkResult {
  const result = emptyChunk()
  result.deferred = contactIds.length
  if (contactIds.length > 0) bump(result.deferred_by_reason, reason, contactIds.length)
  if (error !== null) {
    result.error = error
    result.error_status = 'read_failed'
  }
  return result
}

/**
 * Phase 2: decide a few contacts and write each shadow row the moment it is decided.
 * `kind` 'stale' needs no external read; 'candidates' runs the gates with freshly created ports.
 * Re-reads the rule and the contacts itself, so nothing personal travels between steps.
 */
export async function decideChunk(args: {
  plan: SweepPlan
  kind: 'candidates' | 'stale'
  contactIds: readonly string[]
  deps: SweepDeps
}): Promise<ChunkResult> {
  const { plan, kind, contactIds, deps } = args
  if (contactIds.length === 0) return emptyChunk()

  try {
    // The proposal may have been revoked or replaced since the plan was made: then this plan is void.
    const authRead = await deps.loadAuthorization(plan.clientId)
    if (!authRead.ok) return deferAll(contactIds, 'read_failed', authRead.error)
    if (authRead.row === null || authRead.row.id !== plan.authorizationId) {
      return deferAll(contactIds, 'proposal_changed', null)
    }
    const ruleRead = readRule(authRead.row)
    if (!ruleRead.ok) return deferAll(contactIds, 'rule_invalid', ruleRead.error)
    const rule = ruleRead.rule

    const contactsRead = await deps.loadContactsByIds({ clientId: plan.clientId, contactIds })
    if (!contactsRead.ok) return deferAll(contactIds, 'read_failed', contactsRead.error)
    const contacts = contactsRead.contacts
    const result = emptyChunk()
    // A contact that cannot be read any more (deleted) is simply not decided; it is not an error.
    const missing = contactIds.length - contacts.length
    if (missing > 0) bump(result.deferred_by_reason, 'contact_missing', missing)
    result.deferred += Math.max(missing, 0)

    const now = deps.now()
    const created = kind === 'candidates' ? deps.createPorts({ clientId: plan.clientId, rule, now }) : null

    for (let index = 0; index < contacts.length; index += 1) {
      const contact = contacts[index]
      let decision: ShadowDecision
      if (kind === 'stale') {
        decision = staleDecision({ contact, rule })
      } else if (created !== null) {
        decision = await decideShadow({ contact, rule, ports: created.ports })
      } else {
        continue
      }

      if (decision.kind === 'defer') {
        result.deferred += 1
        bump(result.deferred_by_reason, decision.reasonCode)
        continue
      }

      result.decided += 1
      if (decision.status === 'shadow') {
        result.would_send += 1
      } else if (decision.reasonCode !== null) {
        bump(result.skipped_by_reason, decision.reasonCode)
      }

      if (plan.dryRun) continue
      const email = contact.primaryEmail
      const written = await deps.insertShadowRows([
        {
          clientId: plan.clientId,
          authorizationId: plan.authorizationId,
          contactId: contact.contactId,
          status: decision.status,
          reasonCode: decision.reasonCode,
          annotations: { ...decision.annotations },
          consentBasis: decision.consentBasis,
          sourceRef: decision.sourceRef,
          toAddressSha256: email !== null && isPlausibleEmail(email) ? addressSha256(email) : null,
          localDay: plan.sweepDay,
        },
      ])
      if (!written.ok) {
        // Stop here: what is not written yet is decided again by the retry or the next run.
        result.error = written.error
        result.error_status = 'write_failed'
        const left = contacts.length - index - 1
        result.deferred += left
        if (left > 0) bump(result.deferred_by_reason, 'write_failed', left)
        break
      }
      result.inserted += written.inserted
    }

    if (created !== null) result.legacy_batches = created.legacyBatches()
    return result
  } catch (err) {
    return deferAll(contactIds, 'read_failed', `unexpected: ${errorText(err)}`)
  }
}

function mergeCounts(into: Record<string, number>, from: Record<string, number>): void {
  for (const [key, value] of Object.entries(from)) bump(into, key, value)
}

/** Phase 3: add the chunk results up into the receipt. */
export function finalizeSweep(plan: SweepPlan, results: readonly ChunkResult[]): SweepReceipt {
  const receipt = emptyReceipt(plan.clientId, plan.dryRun, plan.createdAt)
  receipt.status = plan.status
  receipt.error = plan.error
  receipt.authorization_id = plan.authorizationId
  receipt.to_decide = plan.to_decide
  receipt.ignored = plan.ignored
  receipt.deferred = plan.deferred
  mergeCounts(receipt.deferred_by_reason, plan.deferred_by_reason)

  const batches = new Map<string, LegacyBatchSeen>()
  for (const result of results) {
    receipt.decided += result.decided
    receipt.deferred += result.deferred
    receipt.inserted += result.inserted
    receipt.would_send += result.would_send
    mergeCounts(receipt.skipped_by_reason, result.skipped_by_reason)
    mergeCounts(receipt.deferred_by_reason, result.deferred_by_reason)
    for (const batch of result.legacy_batches) batches.set(batch.campaignId, batch)
  }
  // The first failing chunk names the failure; a plan-level problem (mailbox) that is already shown is kept.
  const failed = results.find((r) => r.error !== null && r.error_status !== null)
  if (failed !== undefined && failed.error !== null && failed.error_status !== null) {
    if (receipt.status === 'swept') receipt.status = failed.error_status
    receipt.error = receipt.error ?? failed.error
  }
  receipt.legacy_batches = [...batches.values()].sort((a, b) =>
    a.sentAt === b.sentAt
      ? a.campaignId < b.campaignId ? -1 : a.campaignId > b.campaignId ? 1 : 0
      : a.sentAt === null ? 1 : b.sentAt === null ? -1 : a.sentAt < b.sentAt ? -1 : 1,
  )
  return receipt
}

/** All three phases in one go (tests and local runs). The Inngest function runs them as separate steps. */
export async function runShadowSweep(args: { clientId: string; dryRun: boolean; deps: SweepDeps }): Promise<SweepReceipt> {
  const { clientId, dryRun, deps } = args
  try {
    const prepared = await prepareSweep({ clientId, dryRun, deps })
    if (prepared.kind === 'done') return prepared.receipt
    const plan = prepared.plan
    const results: ChunkResult[] = []
    for (const ids of chunkIds(plan.staleIds)) {
      results.push(await decideChunk({ plan, kind: 'stale', contactIds: ids, deps }))
    }
    for (const ids of chunkIds(plan.candidateIds)) {
      results.push(await decideChunk({ plan, kind: 'candidates', contactIds: ids, deps }))
    }
    return finalizeSweep(plan, results)
  } catch (err) {
    const receipt = emptyReceipt(clientId, dryRun, deps.now().toISOString())
    receipt.status = 'read_failed'
    receipt.error = `unexpected: ${errorText(err)}`
    return receipt
  }
}
