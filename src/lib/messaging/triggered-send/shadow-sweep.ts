/**
 * The shadow sweep of ONE client: loads the open authorization, its rule, the candidate contacts and decides
 * per contact whether the welcome e-mail WOULD be sent. Nothing is ever sent; the decisions are frozen as
 * shadow rows. Pure and fully dependency-injected: it never throws.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §5.
 */

import type {
  AuthorizationRead,
  ContactsRead,
  LegacyBatchSeen,
  MailboxCheck,
  ShadowContact,
  ShadowDecision,
  ShadowGatePorts,
  ShadowRowsRead,
  SweepReceipt,
} from './types'
import { GATE_CONTRACT_VERSION, parseRule, ruleSha256, type TriggeredSendRule } from './rule'
import { classifyContactAge, localDay } from './candidates'
import { decideShadow, isPlausibleEmail, staleDecision } from './shadow-gates'
import { addressSha256, type ShadowRowInput } from './shadow-store'

export interface SweepDeps {
  now(): Date
  loadAuthorization(clientId: string): Promise<AuthorizationRead>
  loadContacts(args: { clientId: string; sinceIso: string; sources: readonly string[] }): Promise<ContactsRead>
  findContactsWithShadowRows(clientId: string, contactIds: readonly string[]): Promise<ShadowRowsRead>
  checkMailboxes(clientId: string, required: readonly string[]): Promise<MailboxCheck>
  createPorts(args: { clientId: string; rule: TriggeredSendRule; now: Date }): {
    ports: ShadowGatePorts
    legacyBatches(): LegacyBatchSeen[]
  }
  insertShadowRows(rows: readonly ShadowRowInput[]): Promise<{ ok: true; inserted: number } | { ok: false; error: string }>
}

const DAY_MS = 86_400_000

/** A decision paired with the contact it belongs to. */
interface ContactDecision {
  contact: ShadowContact
  decision: ShadowDecision
}

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

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1
}

export async function runShadowSweep(args: {
  clientId: string
  dryRun: boolean
  deps: SweepDeps
}): Promise<SweepReceipt> {
  const { clientId, dryRun, deps } = args
  const now = deps.now()
  const receipt = emptyReceipt(clientId, dryRun, now.toISOString())

  try {
    // 1. The open authorization.
    const authRead = await deps.loadAuthorization(clientId)
    if (!authRead.ok) {
      receipt.status = 'read_failed'
      receipt.error = authRead.error
      return receipt
    }
    if (authRead.row === null) {
      receipt.status = 'no_open_proposal'
      return receipt
    }
    const row = authRead.row
    receipt.authorization_id = row.id

    // 2. The rule: parse, verify the sha, verify the gate contract, compute the sweep day.
    const parsed = parseRule(row.rule)
    if (!parsed.ok) {
      receipt.status = 'rule_invalid'
      receipt.error = parsed.error
      return receipt
    }
    const rule = parsed.rule
    if (ruleSha256(rule) !== row.ruleSha256) {
      receipt.status = 'rule_invalid'
      receipt.error = 'rule_sha256 does not match the stored rule'
      return receipt
    }
    if (rule.gate_contract_version !== GATE_CONTRACT_VERSION) {
      receipt.status = 'gate_changed'
      receipt.error = `rule has gate_contract_version ${rule.gate_contract_version} but the code is ${GATE_CONTRACT_VERSION}`
      return receipt
    }
    const sweepDay = localDay(now, rule.schedule.timezone)
    if (sweepDay === null) {
      receipt.status = 'rule_invalid'
      receipt.error = 'cannot compute the local day'
      return receipt
    }
    const proposedAtMs = Date.parse(row.proposedAt)
    if (Number.isNaN(proposedAtMs)) {
      receipt.status = 'read_failed'
      receipt.error = 'invalid proposed_at'
      return receipt
    }

    // 3. Load the contacts since the proposal (or the cap window, whichever is later).
    const sinceMs = Math.max(proposedAtMs, now.getTime() - (rule.audience.max_age_days + 4) * DAY_MS)
    const contactsRead = await deps.loadContacts({
      clientId,
      sinceIso: new Date(sinceMs).toISOString(),
      sources: rule.audience.sources,
    })
    if (!contactsRead.ok) {
      receipt.status = 'read_failed'
      receipt.error = contactsRead.error
      return receipt
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
        return receipt
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
    const candidates: ShadowContact[] = []
    const stale: ShadowContact[] = []
    for (const contact of fresh) {
      const age = classifyContactAge({
        createdAt: contact.createdAt,
        proposedAt: row.proposedAt,
        now,
        timeZone: rule.schedule.timezone,
        maxAgeDays: rule.audience.max_age_days,
      })
      if (age === 'candidate') {
        candidates.push(contact)
      } else if (age === 'stale') {
        stale.push(contact)
      } else {
        receipt.ignored += 1
      }
    }
    receipt.to_decide = candidates.length + stale.length

    // 6. Decisions: stale first (no ports needed), then candidates one by one.
    const decisions: ContactDecision[] = []
    for (const contact of stale) {
      decisions.push({ contact, decision: staleDecision({ contact, rule }) })
    }

    // The ports learn about the old batch campaigns while they read the evidence, so ask for the totals AFTER deciding.
    let createdPorts: { legacyBatches(): LegacyBatchSeen[] } | null = null
    if (candidates.length > 0) {
      const mailbox = await deps.checkMailboxes(clientId, rule.human_mail.required_mailboxes)
      if (!mailbox.ok) {
        receipt.status = 'mailbox_unreadable'
        receipt.error = mailbox.detail
        receipt.deferred += candidates.length
        receipt.deferred_by_reason['mailbox_unreadable'] = candidates.length
      } else {
        const created = deps.createPorts({ clientId, rule, now })
        createdPorts = created
        for (const contact of candidates) {
          const decision = await decideShadow({ contact, rule, ports: created.ports })
          decisions.push({ contact, decision })
        }
      }
    }

    // 7. Turn the decisions into counters and rows.
    const rows: ShadowRowInput[] = []
    for (const { contact, decision } of decisions) {
      if (decision.kind === 'defer') {
        receipt.deferred += 1
        bump(receipt.deferred_by_reason, decision.reasonCode)
        continue
      }
      receipt.decided += 1
      if (decision.status === 'shadow') {
        receipt.would_send += 1
      } else if (decision.reasonCode !== null) {
        bump(receipt.skipped_by_reason, decision.reasonCode)
      }
      const email = contact.primaryEmail
      rows.push({
        clientId,
        authorizationId: row.id,
        contactId: contact.contactId,
        status: decision.status,
        reasonCode: decision.reasonCode,
        annotations: { ...decision.annotations },
        consentBasis: decision.consentBasis,
        sourceRef: decision.sourceRef,
        toAddressSha256: email !== null && isPlausibleEmail(email) ? addressSha256(email) : null,
        localDay: sweepDay,
      })
    }

    // 8. The legacy batch totals seen by the ports.
    receipt.legacy_batches = createdPorts === null ? [] : createdPorts.legacyBatches()

    // 9. Write the rows (never in a dry run).
    if (!dryRun && rows.length > 0) {
      const written = await deps.insertShadowRows(rows)
      if (!written.ok) {
        receipt.status = 'write_failed'
        receipt.error = written.error
        return receipt
      }
      receipt.inserted = written.inserted
    }

    return receipt
  } catch (err) {
    receipt.status = 'read_failed'
    receipt.error = `unexpected: ${err instanceof Error ? err.message : String(err)}`
    return receipt
  }
}
