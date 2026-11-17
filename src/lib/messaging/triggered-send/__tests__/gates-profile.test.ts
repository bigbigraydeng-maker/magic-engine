/**
 * The switchable gates (`rule.gates`, design 2026-11-17 §4.2, §7.2): a follow-up letter does not judge "a salesperson
 * wrote", "the old batch welcomed" or "too old", and counts the old batch's mail toward the cap; the welcome letter
 * (no gates block) is judged exactly as before (its own tests are unchanged).
 */
import { describe, expect, it, vi } from 'vitest'
import type { MailchimpPort } from '@/lib/crm/email-templates/frequency-sources-prod'
import type { evaluateFrequency } from '@/lib/crm/email-templates/gates/frequency'
import type { FrequencyVerdict, OutboundItem } from '@/lib/crm/email-templates/gates/types'
import type { MailchimpCampaign } from '@/lib/mailchimp/client'
import type { RuleGates, TriggeredSendRule } from '../rule'
import { createShadowGatePorts, type ShadowPortsDeps } from '../shadow-ports-prod'
import { decideShadow, evidenceReason } from '../shadow-gates'
import type { EvidenceRead, ShadowContact, ShadowGatePorts } from '../types'

const FOLLOWUP: RuleGates = { sales_email: false, legacy_welcomed: false, stale: false, count_legacy_batch: true }

function rule(gates?: RuleGates): TriggeredSendRule {
  const base: TriggeredSendRule = {
    gate_contract_version: 1,
    audience: { sources: ['meta_lead_form'], max_age_days: 7, min_age: 'previous_local_day' },
    schedule: { timezone: 'Europe/Berlin' },
    frequency_cap: { max: 2, window_days: 14 },
    consent: { accepted_bases: ['marketing'] },
    legacy: { mailchimp_campaign_title_prefix: 'Welcome Batch', excluded_tags: [] },
    human_mail: { required_mailboxes: ['sales@example.org'] },
    recipient_allowlist: null,
  }
  return gates === undefined ? base : { ...base, gates }
}

const CONTACT: ShadowContact = { contactId: 'c-1', createdAt: '2026-11-01T10:00:00.000Z', primaryEmail: 'lead@example.org', addresses: ['lead@example.org'] }
const NOW = new Date('2026-11-02T08:00:00.000Z')

const staffMail: OutboundItem = { source: 'sent_items', id: 's1', at: '2026-11-01T12:00:00.000Z', subject: 'Re: your trip', address: 'lead@example.org' }

function ports(evidence: EvidenceRead): ShadowGatePorts {
  return {
    consent: async () => ({ ok: true, bases: ['marketing'], sourceRef: 'lead-1' }),
    dnc: async () => ({ ok: true, blocked: false }),
    member: async () => ({ ok: true, state: 'active', tags: [] }),
    evidence: async () => evidence,
    unsubscribed: async () => ({ ok: true, unsubscribed: false }),
    addressHistory: async () => ({ ok: true, complained: false, hardBounced: false }),
  }
}

describe('evidenceReason by the rule\'s gates', () => {
  it('🔴 sales_email off: a salesperson\'s e-mail is not a reason, but it is COUNTED toward the cap', () => {
    expect(evidenceReason(CONTACT, rule(), [staffMail])).toBe('sales_email_exists')
    expect(evidenceReason(CONTACT, rule(FOLLOWUP), [staffMail])).toBeNull()
    expect(evidenceReason(CONTACT, rule(FOLLOWUP), [staffMail, { ...staffMail, id: 's2' }])).toBe('frequency_full')
  })
})

describe('decideShadow by the rule\'s gates (mode send)', () => {
  const welcomed: EvidenceRead = { ok: true, items: [], legacy: { welcomed: true, batchSeen: true, campaignIds: ['c1'] } }

  it('🔴 legacy_welcomed off: the old batch having welcomed the guest is not judged', async () => {
    expect(await decideShadow({ contact: CONTACT, rule: rule(), ports: ports(welcomed), mode: 'send' })).toMatchObject({ status: 'skipped', reasonCode: 'legacy_welcomed' })
    expect(await decideShadow({ contact: CONTACT, rule: rule(FOLLOWUP), ports: ports(welcomed), mode: 'send' })).toMatchObject({ status: 'shadow', reasonCode: null })
  })

  it('🔴 a salesperson\'s e-mail plus one more: the cap is full for a follow-up letter too', async () => {
    const two: EvidenceRead = { ok: true, items: [staffMail, { ...staffMail, id: 'mc:x', source: 'mailchimp' }], legacy: { welcomed: false, batchSeen: false, campaignIds: [] } }
    expect(await decideShadow({ contact: CONTACT, rule: rule(FOLLOWUP), ports: ports(two), mode: 'send' })).toMatchObject({ status: 'skipped', reasonCode: 'frequency_full' })
  })
})

// ── the evidence port ───────────────────────────────────────────────────────────────────────────────────

type EvaluateArgs = Parameters<typeof evaluateFrequency>[0]

function campaign(id: string, title: string, sentAt: string): MailchimpCampaign {
  return { id, title, subject: 's', sentAt, emailsSent: 10, opens: 0, uniqueOpens: 0, clicks: 0, openRate: 0, clickRate: 0 }
}

const BATCH = campaign('camp-batch', 'Welcome Batch 2026-11-02', '2026-11-02T06:00:00.000Z')

/** Like the real evaluate: what the Mailchimp source found, plus the salesperson's mail from the mailbox. */
function evaluateWithStaffMail() {
  return vi.fn(async (args: EvaluateArgs): Promise<FrequencyVerdict> => {
    const res = await args.sources.mailchimp(args.addresses, '2026-10-26T00:00:00.000Z')
    if (!res.ok) return { ok: false, reason: 'frequency_unverifiable', error: res.error }
    const items = [...res.items, staffMail]
    return { ok: true, count: items.length, items }
  })
}

function deps(r: TriggeredSendRule, getCampaignRecipientStatus = vi.fn(async () => 'sent' as const)): ShadowPortsDeps {
  const mailchimp: MailchimpPort = {
    apiKey: () => 'test-key',
    readAudience: async () => ({ ok: true, audienceId: 'aud-1' }),
    listSentCampaigns: async () => [BATCH],
    getCampaignRecipientStatus,
  }
  return {
    db: {} as never,
    clientId: 'client-1',
    rule: r,
    now: NOW,
    listActiveMailboxes: async () => [],
    graphGetPage: async () => ({ ok: true, json: {} }),
    checkDnc: async () => ({ ok: true, blocked: false }),
    mailchimp,
    findMember: async () => ({ status: 'not_in_audience' }),
    evaluate: evaluateWithStaffMail(),
  }
}

describe('the evidence port by the rule\'s gates', () => {
  it('🔴 count_legacy_batch on: the old batch\'s 1 mail + a salesperson\'s 1 mail = the cap of 2 is full', async () => {
    const followup = rule(FOLLOWUP)
    const read = await createShadowGatePorts(deps(followup)).ports.evidence(CONTACT)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.items.map((i) => i.id)).toEqual(['mc:camp-batch:lead@example.org', 's1'])
    expect(evidenceReason(CONTACT, followup, read.items)).toBe('frequency_full')
  })

  it('the welcome letter (no gates) still takes the old batch out before counting', async () => {
    const read = await createShadowGatePorts(deps(rule())).ports.evidence(CONTACT)
    expect(read.ok && read.items.map((i) => i.id)).toEqual(['s1'])
  })

  it('🔴 legacy_welcomed off: the old batch is not even asked who it mailed', async () => {
    // count_legacy_batch off too, so the only reason left to ask Mailchimp about the batch would be "did it welcome them".
    const recipientStatus = vi.fn(async () => 'sent' as const)
    const read = await createShadowGatePorts(deps(rule({ ...FOLLOWUP, count_legacy_batch: false }), recipientStatus)).ports.evidence(CONTACT)
    expect(read).toMatchObject({ ok: true, legacy: { welcomed: false, batchSeen: false, campaignIds: [] } })
    expect(recipientStatus).not.toHaveBeenCalled()
    const welcomeStatus = vi.fn(async () => 'sent' as const)
    expect(await createShadowGatePorts(deps(rule(), welcomeStatus)).ports.evidence(CONTACT)).toMatchObject({ ok: true, legacy: { welcomed: true } })
    expect(welcomeStatus).toHaveBeenCalled()
  })
})
