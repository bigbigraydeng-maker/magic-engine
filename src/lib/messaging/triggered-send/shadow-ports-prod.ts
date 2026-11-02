/**
 * The production wiring of the four READ-ONLY gate ports of the shadow run (consent, do-not-contact, Mailchimp member,
 * e-mail evidence). Nothing in here sends or changes anything: every call is a read (database select, Graph GET,
 * Mailchimp GET).
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §5 and §16.5.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import type { DncTouch } from '@/lib/crm/dnc'
import { needsSuppression } from '@/lib/mailchimp/suppression-sync'
import { readAudienceId, type AudienceIdRead } from '@/lib/mailchimp/audience-config'
import { findMemberByEmail, type FindMemberResult } from '@/lib/mailchimp/tags'
import {
  listSentCampaigns,
  getCampaignRecipientStatus,
  type MailchimpCampaign,
} from '@/lib/mailchimp/client'
import {
  createFrequencySources,
  type FrequencySourceDeps,
  type MailchimpPort,
} from '@/lib/crm/email-templates/frequency-sources-prod'
import { evaluateFrequency } from '@/lib/crm/email-templates/gates/frequency'

import { localDay } from './candidates'
import type { TriggeredSendRule } from './rule'
import type {
  ConsentRead,
  DncRead,
  EvidenceRead,
  LegacyBatchSeen,
  LegacyEvidence,
  MemberRead,
  ShadowContact,
  ShadowGatePorts,
} from './types'

export interface ShadowPortsDeps {
  db: SupabaseClient
  clientId: string
  rule: TriggeredSendRule
  now: Date
  listActiveMailboxes: FrequencySourceDeps['listActiveMailboxes']
  graphGetPage: FrequencySourceDeps['graphGetPage']
  // test seams, each defaults to the real implementation:
  checkDnc?: (clientId: string, contactId: string) => Promise<DncRead>
  mailchimp?: MailchimpPort
  findMember?: typeof findMemberByEmail
  evaluate?: typeof evaluateFrequency
}

const DEFAULT_MAILCHIMP_PORT: MailchimpPort = {
  apiKey: () => process.env.MAILCHIMP_API_KEY,
  readAudience: readAudienceId,
  listSentCampaigns,
  getCampaignRecipientStatus,
}

const SUPPRESSED_STATUSES = new Set(['unsubscribed', 'cleaned', 'archived'])

/** One contact's e-mail evidence may take this long. A chunk step holds a few contacts and the host cuts a request after ~2 min. */
const EVIDENCE_BUDGET_MS = 15_000

/** The batch check and the Mailchimp member lookup have no timeout of their own: bound them, so one slow answer cannot eat the whole chunk step. */
const LEGACY_BUDGET_MS = 10_000
const MEMBER_BUDGET_MS = 10_000

/** A batch campaign sent before the lead came in (minus a margin for clock differences) cannot have welcomed that lead. */
const BATCH_BEFORE_LEAD_MARGIN_MS = 10 * 60_000

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Rejects with `message` if `work` has not settled after `ms` (the work itself is not cancelled). */
function withDeadline<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

// ── consent ─────────────────────────────────────────────────────────────────────────────────────────────

interface TouchpointRow {
  source_ref: unknown
  metadata: unknown
  occurred_at: unknown
}

function readConsentBasis(metadata: unknown): string | null {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const basis = (metadata as Record<string, unknown>).consent_basis
  return typeof basis === 'string' && basis.length > 0 ? basis : null
}

async function readConsent(
  db: SupabaseClient,
  clientId: string,
  contactId: string,
): Promise<ConsentRead> {
  try {
    const { data, error } = await db
      .from('contact_touchpoints')
      .select('source_ref, metadata, occurred_at')
      .eq('client_id', clientId)
      .eq('contact_id', contactId)
      .eq('source', 'meta_lead_form')
      .order('occurred_at', { ascending: true })
      .limit(50)
    if (error) return { ok: false, error: error.message }
    const rows: TouchpointRow[] = data ?? []
    const bases: string[] = []
    const seen = new Set<string>()
    for (const row of rows) {
      const basis = readConsentBasis(row.metadata)
      if (basis !== null && !seen.has(basis)) {
        seen.add(basis)
        bases.push(basis)
      }
    }
    let sourceRef: string | null = null
    if (rows.length > 0) {
      const first = rows[0].source_ref
      if (typeof first === 'string' && first.length > 0) sourceRef = first
    }
    return { ok: true, bases, sourceRef }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

// ── do-not-contact ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Same question as `isContactOptedOutAnyChannel` (messenger-agent/optout.ts: the contact column, the touchpoint verdicts and
 * a conversation-level opt-out that was never linked to a contact), with two differences:
 *  - the judge is `needsSuppression` (do-not-contact OR "not interested"): exactly what puts the old batch's skip tag
 *    `suppressed_do_not_email` on a member (suppression-sync.ts), so ME skips the same people;
 *  - that function answers "blocked" when a read fails (right for sending, because it fails closed), which in the shadow
 *    run would freeze an innocent lead as "do not contact" forever. Here a failed read stays a failed read, and the contact
 *    is tried again later.
 * If `isContactOptedOutAnyChannel` gains a new signal, add it here too (it is copied on purpose: that file is not ours).
 */
async function readDncStrict(db: SupabaseClient, clientId: string, contactId: string): Promise<DncRead> {
  try {
    const [contactResult, touchResult, unlinkedResult] = await Promise.all([
      db.from('contacts').select('do_not_contact').eq('id', contactId).eq('client_id', clientId).maybeSingle(),
      db.from('contact_touchpoints').select('occurred_at, metadata').eq('contact_id', contactId).eq('client_id', clientId),
      db
        .from('conversations')
        .select('id')
        .eq('contact_id', contactId)
        .eq('client_id', clientId)
        .eq('optout_unlinked', true)
        .limit(1),
    ])
    if (contactResult.error) return { ok: false, error: `contacts: ${contactResult.error.message}` }
    if (touchResult.error) return { ok: false, error: `touchpoints: ${touchResult.error.message}` }
    if (unlinkedResult.error) return { ok: false, error: `conversations: ${unlinkedResult.error.message}` }
    if (!contactResult.data) return { ok: false, error: 'contact not found for this client' }

    const contactFlag = (contactResult.data as { do_not_contact?: unknown }).do_not_contact === true
    const rows = (touchResult.data ?? []) as Array<{ occurred_at: string; metadata: Record<string, unknown> | null }>
    const touches: DncTouch[] = rows.map((row) => {
      const meta = row.metadata ?? {}
      return {
        outcome: typeof meta.outcome === 'string' ? meta.outcome : null,
        flagged: meta.do_not_contact === true,
        occurredAt: row.occurred_at,
      }
    })
    const unlinkedOptOut = Array.isArray(unlinkedResult.data) && unlinkedResult.data.length > 0
    return { ok: true, blocked: unlinkedOptOut || needsSuppression({ doNotContactFlag: contactFlag, touches }) }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

async function readDnc(
  checkDnc: (clientId: string, contactId: string) => Promise<DncRead>,
  clientId: string,
  contactId: string,
): Promise<DncRead> {
  try {
    return await checkDnc(clientId, contactId)
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

// ── Mailchimp member ────────────────────────────────────────────────────────────────────────────────────

function mapMemberStatus(status: string): 'active' | 'suppressed' {
  return SUPPRESSED_STATUSES.has(status) ? 'suppressed' : 'active'
}

// ── evidence ────────────────────────────────────────────────────────────────────────────────────────────

function compareLegacyBatches(a: LegacyBatchSeen, b: LegacyBatchSeen): number {
  if (a.sentAt === b.sentAt) return a.campaignId < b.campaignId ? -1 : a.campaignId > b.campaignId ? 1 : 0
  if (a.sentAt === null) return 1
  if (b.sentAt === null) return -1
  return a.sentAt < b.sentAt ? -1 : a.sentAt > b.sentAt ? 1 : 0
}

export function createShadowGatePorts(deps: ShadowPortsDeps): {
  ports: ShadowGatePorts
  legacyBatches(): LegacyBatchSeen[]
} {
  const checkDnc = deps.checkDnc ?? ((clientId: string, contactId: string) => readDncStrict(deps.db, clientId, contactId))
  const findMember = deps.findMember ?? findMemberByEmail
  const evaluate = deps.evaluate ?? evaluateFrequency
  const baseMailchimp = deps.mailchimp ?? DEFAULT_MAILCHIMP_PORT

  // audience read is cached for the lifetime of the ports object
  let audiencePromise: Promise<AudienceIdRead> | null = null
  function readAudienceOnce(): Promise<AudienceIdRead> {
    if (audiencePromise === null) audiencePromise = baseMailchimp.readAudience(deps.clientId)
    return audiencePromise
  }

  // The old daily batch: its campaigns (found by title prefix) are taken OUT of what the e-mail evidence sees, BEFORE the
  // evidence de-duplicates and counts (a human e-mail within two minutes of the batch mail must not swallow it), and
  // are remembered here. What the batch did for a contact is read separately below.
  const prefix = deps.rule.legacy.mailchimp_campaign_title_prefix
  const legacyBatchById = new Map<string, LegacyBatchSeen>()
  const campaignCache = new Map<string, Promise<MailchimpCampaign[]>>()

  function isBatchCampaign(campaign: MailchimpCampaign): boolean {
    return typeof campaign.title === 'string' && campaign.title.startsWith(prefix)
  }

  const evidenceMailchimp: MailchimpPort = {
    apiKey: () => baseMailchimp.apiKey(),
    readAudience: (clientId) => baseMailchimp.readAudience(clientId),
    listSentCampaigns: (apiKey, opts) => {
      const key = `${opts.sinceSentAt}|${opts.listId}|${opts.count}`
      const cached = campaignCache.get(key)
      if (cached !== undefined) return cached
      const promise = baseMailchimp
        .listSentCampaigns(apiKey, opts)
        .then((campaigns) => {
          // The evidence source refuses a full page (there may be more campaigns than it saw). The old batch's own campaigns
          // are taken out below, so the page must be judged by what the API returned, not by what is left of it.
          if (campaigns.length >= opts.count) {
            throw new Error('too many Mailchimp campaigns in the window to check them all')
          }
          for (const campaign of campaigns) {
            if (!isBatchCampaign(campaign)) continue
            legacyBatchById.set(campaign.id, {
              campaignId: campaign.id,
              title: campaign.title,
              sentAt: campaign.sentAt,
              emailsSent: campaign.emailsSent,
            })
          }
          return campaigns.filter((campaign) => !isBatchCampaign(campaign))
        })
        .catch((err: unknown) => {
          campaignCache.delete(key)
          throw err
        })
      campaignCache.set(key, promise)
      return promise
    },
    getCampaignRecipientStatus: (apiKey, campaignId, email) =>
      baseMailchimp.getCampaignRecipientStatus(apiKey, campaignId, email),
  }

  // The mailbox sent-items pages are the same for every contact of this ports object (same window, same mailbox):
  // read each page once. The key includes the mailbox. A failed read is not kept, so the next contact tries again.
  type GraphPage = Awaited<ReturnType<FrequencySourceDeps['graphGetPage']>>
  const pageCache = new Map<string, Promise<GraphPage>>()
  const graphGetPage: FrequencySourceDeps['graphGetPage'] = (connectionId, pathOrUrl) => {
    const key = `${connectionId}|${pathOrUrl}`
    const cached = pageCache.get(key)
    if (cached !== undefined) return cached
    const promise = deps.graphGetPage(connectionId, pathOrUrl).then(
      (page) => {
        if (!page.ok) pageCache.delete(key)
        return page
      },
      (err: unknown) => {
        pageCache.delete(key)
        throw err
      },
    )
    pageCache.set(key, promise)
    return promise
  }

  // "No human e-mail yet" is only trustworthy if EVERY required mailbox is still readable. The sent-items source reads
  // whatever mailboxes are active right now; if a required one dropped out meanwhile, say so instead of reading less.
  const listRequiredMailboxes: FrequencySourceDeps['listActiveMailboxes'] = async (clientId) => {
    const boxes = await deps.listActiveMailboxes(clientId)
    const active = new Set(boxes.map((box) => box.account.trim().toLowerCase()))
    if (deps.rule.human_mail.required_mailboxes.some((mailbox) => !active.has(mailbox.trim().toLowerCase()))) {
      throw new Error('a required mailbox is no longer connected')
    }
    return boxes
  }

  const sources = createFrequencySources({
    db: deps.db,
    clientId: deps.clientId,
    listActiveMailboxes: listRequiredMailboxes,
    graphGetPage,
    mailchimp: evidenceMailchimp,
  })

  /** What the old batch did for this contact: which of its campaigns (sent after the lead came in) mailed one of the addresses. */
  async function readLegacy(contact: ShadowContact): Promise<LegacyEvidence> {
    const batches = [...legacyBatchById.values()].sort(compareLegacyBatches)
    const nowMs = deps.now.getTime()
    // "The old batch has run" = one of its campaigns went out today (in the rule's time zone) and not in the future.
    // A sweep before the batch's usual time, or on a day it did not run, cannot say "not welcomed".
    const timeZone = deps.rule.schedule.timezone
    const sweepDay = localDay(deps.now, timeZone)
    const batchSeen =
      sweepDay !== null &&
      batches.some((batch) => {
        if (batch.sentAt === null) return false
        const sentMs = Date.parse(batch.sentAt)
        return !Number.isNaN(sentMs) && sentMs <= nowMs && localDay(batch.sentAt, timeZone) === sweepDay
      })

    const leadMs = Date.parse(contact.createdAt)
    const relevant = batches.filter((batch) => {
      if (batch.sentAt === null) return false
      const sentMs = Date.parse(batch.sentAt)
      return Number.isNaN(leadMs) || sentMs >= leadMs - BATCH_BEFORE_LEAD_MARGIN_MS
    })
    if (relevant.length === 0 || contact.addresses.length === 0) return { welcomed: false, batchSeen, campaignIds: [] }

    const apiKey = baseMailchimp.apiKey()
    if (typeof apiKey !== 'string' || apiKey.length === 0) throw new Error('MAILCHIMP_API_KEY is not set')
    const campaignIds: string[] = []
    for (const batch of relevant) {
      for (const address of contact.addresses) {
        const status = await baseMailchimp.getCampaignRecipientStatus(apiKey, batch.campaignId, address)
        if (status === 'sent' || status === 'soft') {
          campaignIds.push(batch.campaignId)
          break
        }
      }
    }
    return { welcomed: campaignIds.length > 0, batchSeen, campaignIds }
  }

  async function readMember(email: string): Promise<MemberRead> {
    try {
      const audience = await readAudienceOnce()
      if (!audience.ok) return { ok: false, error: `audience: ${audience.message}` }
      if (audience.audienceId === '') return { ok: true, state: 'not_applicable', tags: [] }
      const apiKey = baseMailchimp.apiKey()
      if (typeof apiKey !== 'string' || apiKey.length === 0) {
        return { ok: false, error: 'MAILCHIMP_API_KEY is not set' }
      }
      const result: FindMemberResult = await findMember(
        { apiKey, audienceId: audience.audienceId },
        email,
      )
      if (result.status === 'error') return { ok: false, error: result.reason }
      if (result.status === 'not_in_audience') return { ok: true, state: 'not_in_audience', tags: [] }
      return { ok: true, state: mapMemberStatus(result.member.status), tags: [...result.member.tags] }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  }

  async function readEvidence(contact: ShadowContact): Promise<EvidenceRead> {
    try {
      const verdict = await evaluate({
        cap: { max: Number.MAX_SAFE_INTEGER, windowDays: deps.rule.frequency_cap.window_days },
        now: deps.now,
        addresses: contact.addresses,
        contactId: contact.contactId,
        sources,
        budgetMs: EVIDENCE_BUDGET_MS,
      })
      if (!verdict.ok && verdict.reason === 'frequency_unverifiable') return { ok: false, error: verdict.error }
      // The cap is unreachable on purpose, so a verdict always carries the de-duplicated items.
      const legacy = await withDeadline(readLegacy(contact), LEGACY_BUDGET_MS, 'old-batch check timed out')
      return { ok: true, items: verdict.items, legacy }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  }

  const ports: ShadowGatePorts = {
    consent: (contactId) => readConsent(deps.db, deps.clientId, contactId),
    dnc: (contactId) => readDnc(checkDnc, deps.clientId, contactId),
    member: async (email) => {
      try {
        return await withDeadline(readMember(email), MEMBER_BUDGET_MS, 'Mailchimp member lookup timed out')
      } catch (err) {
        return { ok: false, error: errorMessage(err) }
      }
    },
    evidence: (contact) => readEvidence(contact),
  }

  return {
    ports,
    legacyBatches: () => [...legacyBatchById.values()].sort(compareLegacyBatches),
  }
}
