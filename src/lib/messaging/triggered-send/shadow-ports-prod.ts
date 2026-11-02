import type { SupabaseClient } from '@supabase/supabase-js'

import {
  checkManualSendDncForContact,
  type ManualSendDncGate,
} from '@/lib/crm/manual-send-dnc-gate'
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
import type { OutboundItem } from '@/lib/crm/email-templates/gates/types'

import type { TriggeredSendRule } from './rule'
import type {
  ConsentRead,
  DncRead,
  EvidenceRead,
  LegacyBatchSeen,
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
  checkDnc?: (clientId: string, contactId: string) => Promise<ManualSendDncGate>
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
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

// ── dnc ─────────────────────────────────────────────────────────────────────────────────────────────────

async function readDnc(
  checkDnc: (clientId: string, contactId: string) => Promise<ManualSendDncGate>,
  clientId: string,
  contactId: string,
): Promise<DncRead> {
  try {
    const gate = await checkDnc(clientId, contactId)
    if (!gate.blocked) return { ok: true, blocked: false }
    if (gate.reason === 'do_not_contact') return { ok: true, blocked: true }
    return { ok: false, error: gate.error }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

// ── member ──────────────────────────────────────────────────────────────────────────────────────────────

function mapMemberStatus(status: string): 'active' | 'suppressed' {
  return SUPPRESSED_STATUSES.has(status) ? 'suppressed' : 'active'
}

// ── evidence ────────────────────────────────────────────────────────────────────────────────────────────

function campaignIdOf(item: OutboundItem): string | null {
  if (item.source !== 'mailchimp') return null
  if (typeof item.id !== 'string') return null
  if (!item.id.startsWith('mc:')) return null
  const rest = item.id.slice(3)
  const sep = rest.indexOf(':')
  if (sep <= 0) return null
  return rest.slice(0, sep)
}

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
  const checkDnc = deps.checkDnc ?? checkManualSendDncForContact
  const findMember = deps.findMember ?? findMemberByEmail
  const evaluate = deps.evaluate ?? evaluateFrequency
  const baseMailchimp = deps.mailchimp ?? DEFAULT_MAILCHIMP_PORT

  // audience read is cached for the lifetime of the ports object
  let audiencePromise: Promise<AudienceIdRead> | null = null
  function readAudienceOnce(): Promise<AudienceIdRead> {
    if (audiencePromise === null) audiencePromise = baseMailchimp.readAudience(deps.clientId)
    return audiencePromise
  }

  // memoised listSentCampaigns + legacy-batch bookkeeping
  const campaignCache = new Map<string, Promise<MailchimpCampaign[]>>()
  const legacyBatchIds = new Set<string>()
  const legacyBatchById = new Map<string, LegacyBatchSeen>()
  const prefix = deps.rule.legacy.mailchimp_campaign_title_prefix

  function rememberCampaigns(campaigns: MailchimpCampaign[]): void {
    for (const c of campaigns) {
      if (typeof c.title === 'string' && c.title.startsWith(prefix)) {
        legacyBatchIds.add(c.id)
        legacyBatchById.set(c.id, {
          campaignId: c.id,
          title: c.title,
          sentAt: c.sentAt,
          emailsSent: c.emailsSent,
        })
      }
    }
  }

  const wrappedMailchimp: MailchimpPort = {
    apiKey: () => baseMailchimp.apiKey(),
    readAudience: (clientId) => baseMailchimp.readAudience(clientId),
    listSentCampaigns: (apiKey, opts) => {
      const key = `${opts.sinceSentAt}|${opts.listId}|${opts.count}`
      const cached = campaignCache.get(key)
      if (cached !== undefined) return cached
      const promise = baseMailchimp
        .listSentCampaigns(apiKey, opts)
        .then((campaigns) => {
          rememberCampaigns(campaigns)
          return campaigns
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

  const sources = createFrequencySources({
    db: deps.db,
    clientId: deps.clientId,
    listActiveMailboxes: deps.listActiveMailboxes,
    graphGetPage: deps.graphGetPage,
    mailchimp: wrappedMailchimp,
  })

  function isLegacyBatchItem(item: OutboundItem): boolean {
    const campaignId = campaignIdOf(item)
    return campaignId !== null && legacyBatchIds.has(campaignId)
  }

  async function readMember(email: string): Promise<MemberRead> {
    try {
      const audience = await readAudienceOnce()
      if (!audience.ok) return { ok: false, error: `audience: ${audience.message}` }
      if (audience.audienceId === '') return { ok: true, state: 'not_applicable' }
      const apiKey = baseMailchimp.apiKey()
      if (typeof apiKey !== 'string' || apiKey.length === 0) {
        return { ok: false, error: 'MAILCHIMP_API_KEY is not set' }
      }
      const result: FindMemberResult = await findMember(
        { apiKey, audienceId: audience.audienceId },
        email,
      )
      if (result.status === 'error') return { ok: false, error: result.reason }
      if (result.status === 'not_in_audience') return { ok: true, state: 'not_in_audience' }
      return { ok: true, state: mapMemberStatus(result.member.status) }
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
      })
      if (verdict.ok) return { ok: true, items: verdict.items, isLegacyBatchItem }
      if (verdict.reason === 'frequency_cap') {
        return { ok: true, items: verdict.items, isLegacyBatchItem }
      }
      return { ok: false, error: verdict.error }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  }

  const ports: ShadowGatePorts = {
    consent: (contactId) => readConsent(deps.db, deps.clientId, contactId),
    dnc: (contactId) => readDnc(checkDnc, deps.clientId, contactId),
    member: (email) => readMember(email),
    evidence: (contact) => readEvidence(contact),
  }

  function legacyBatches(): LegacyBatchSeen[] {
    return Array.from(legacyBatchById.values()).sort(compareLegacyBatches)
  }

  return { ports, legacyBatches }
}
