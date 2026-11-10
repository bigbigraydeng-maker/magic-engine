import { describe, it, expect, vi } from 'vitest'
import type { OutboundItem } from '@/lib/crm/email-templates/gates/types'
import type { TriggeredSendRule } from '../rule'
import type {
  ConsentRead,
  DncRead,
  EvidenceRead,
  MemberRead,
  ShadowContact,
  ShadowGatePorts,
} from '../types'
import { decideShadow, isPlausibleEmail, isSystemAddress, staleDecision } from '../shadow-gates'

// What the old batch did for a contact it did NOT mail (and it had run recently, so that can be trusted).
const NOT_WELCOMED = { welcomed: false, batchSeen: true, campaignIds: [] as string[] }

function makeRule(overrides: Partial<TriggeredSendRule> = {}): TriggeredSendRule {
  const base: TriggeredSendRule = {
    gate_contract_version: 1,
    audience: { sources: ['meta_lead_form'], max_age_days: 3, min_age: 'previous_local_day' },
    schedule: { timezone: 'Pacific/Auckland' },
    frequency_cap: { max: 2, window_days: 7 },
    consent: { accepted_bases: ['form_disclosure_attested'] },
    // mixed case on purpose: tags are compared ignoring case
    legacy: { mailchimp_campaign_title_prefix: 'legacy_batch_', excluded_tags: ['sales_active', 'Nurture_2027'] },
    human_mail: { required_mailboxes: ['sales@example.com'] },
    recipient_allowlist: null,
  }
  return { ...base, ...overrides }
}

function makeContact(overrides: Partial<ShadowContact> = {}): ShadowContact {
  const base: ShadowContact = {
    contactId: 'c1',
    createdAt: '2026-11-01T20:00:00Z',
    primaryEmail: 'lead@example.org',
    addresses: ['lead@example.org'],
  }
  return { ...base, ...overrides }
}

function makeItem(overrides: Partial<OutboundItem> = {}): OutboundItem {
  const base: OutboundItem = {
    source: 'sent_items',
    id: 'i1',
    at: '2026-11-02T00:00:00Z',
    subject: 'hello',
    address: 'lead@example.org',
  }
  return { ...base, ...overrides }
}

interface PortsOptions {
  consent?: ConsentRead
  dnc?: DncRead
  member?: MemberRead
  evidence?: EvidenceRead
}

function makePorts(opts: PortsOptions = {}): {
  ports: ShadowGatePorts
  consent: ReturnType<typeof vi.fn>
  dnc: ReturnType<typeof vi.fn>
  member: ReturnType<typeof vi.fn>
  evidence: ReturnType<typeof vi.fn>
} {
  const consent = vi.fn(async (): Promise<ConsentRead> =>
    opts.consent ?? { ok: true, bases: ['form_disclosure_attested'], sourceRef: 'lead-1' },
  )
  const dnc = vi.fn(async (): Promise<DncRead> => opts.dnc ?? { ok: true, blocked: false })
  const member = vi.fn(async (): Promise<MemberRead> => opts.member ?? { ok: true, state: 'active', tags: [] })
  const evidence = vi.fn(
    async (): Promise<EvidenceRead> =>
      opts.evidence ?? { ok: true, items: [], legacy: NOT_WELCOMED },
  )
  const ports: ShadowGatePorts = { consent, dnc, member, evidence }
  return { ports, consent, dnc, member, evidence }
}

describe('isPlausibleEmail', () => {
  it('accepts a normal address', () => {
    expect(isPlausibleEmail('lead@example.org')).toBe(true)
  })
  it('rejects malformed addresses', () => {
    expect(isPlausibleEmail('not-an-email')).toBe(false)
    expect(isPlausibleEmail('a@b')).toBe(false)
    expect(isPlausibleEmail('a b@c.d')).toBe(false)
  })
  it('rejects addresses longer than 254 chars', () => {
    const local = 'a'.repeat(250)
    expect(isPlausibleEmail(`${local}@x.io`)).toBe(false)
  })
})

describe('isSystemAddress', () => {
  it('flags known system local parts', () => {
    for (const local of [
      'noreply',
      'no-reply',
      'donotreply',
      'do-not-reply',
      'mailer-daemon',
      'postmaster',
      'bounce',
      'bounces',
      'notification',
      'notifications',
    ]) {
      expect(isSystemAddress(`${local}@example.org`)).toBe(true)
    }
  })
  it('is case-insensitive on the local part', () => {
    expect(isSystemAddress('NoReply@example.org')).toBe(true)
  })
  it('does not flag normal addresses', () => {
    expect(isSystemAddress('lead@example.org')).toBe(false)
    expect(isSystemAddress('sales@example.org')).toBe(false)
  })
})

describe('staleDecision', () => {
  it('returns the exact skipped/stale decision', () => {
    const decision = staleDecision({ contact: makeContact(), rule: makeRule() })
    expect(decision).toEqual({
      kind: 'write',
      status: 'skipped',
      reasonCode: 'stale',
      annotations: {
        gate_contract_version: 1,
        would_send: false,
        legacy_welcomed: null,
        legacy_batch_seen: null,
        legacy_campaign_ids: null,
        sales_email: null,
        frequency_count: null,
        lead_local_day: '2026-11-02',
      },
      consentBasis: null,
      sourceRef: null,
    })
  })
})

describe('decideShadow', () => {
  it('happy path: would send', async () => {
    const { ports } = makePorts()
    const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
    expect(decision).toEqual({
      kind: 'write',
      status: 'shadow',
      reasonCode: null,
      annotations: {
        gate_contract_version: 1,
        would_send: true,
        legacy_welcomed: false,
        legacy_batch_seen: true,
        legacy_campaign_ids: [],
        sales_email: false,
        frequency_count: 0,
        lead_local_day: '2026-11-02',
      },
      consentBasis: 'form_disclosure_attested',
      sourceRef: 'lead-1',
    })
  })

  it('reason 1: bad_email with null primaryEmail and no addresses (no member/evidence calls)', async () => {
    const { ports, member, evidence } = makePorts()
    const decision = await decideShadow({
      contact: makeContact({ primaryEmail: null, addresses: [] }),
      rule: makeRule(),
      ports,
    })
    expect(decision.kind).toBe('write')
    if (decision.kind !== 'write') return
    expect(decision.status).toBe('skipped')
    expect(decision.reasonCode).toBe('bad_email')
    expect(decision.annotations.would_send).toBe(false)
    // no address at all: the old batch could not have mailed this contact, and there is nothing to count
    expect(decision.annotations.legacy_welcomed).toBe(false)
    expect(decision.annotations.legacy_batch_seen).toBe(true)
    expect(decision.annotations.sales_email).toBe(false)
    expect(decision.annotations.frequency_count).toBe(0)
    expect(member).not.toHaveBeenCalled()
    expect(evidence).not.toHaveBeenCalled()
  })

  it('reason 1: bad_email with implausible primaryEmail (evidence called, member not)', async () => {
    const { ports, member, evidence } = makePorts()
    const decision = await decideShadow({
      contact: makeContact({ primaryEmail: 'not-an-email', addresses: ['not-an-email'] }),
      rule: makeRule(),
      ports,
    })
    expect(decision.kind).toBe('write')
    if (decision.kind !== 'write') return
    expect(decision.reasonCode).toBe('bad_email')
    expect(decision.annotations.would_send).toBe(false)
    expect(member).not.toHaveBeenCalled()
    expect(evidence).toHaveBeenCalledTimes(1)
  })

  it('reason 2: system_address', async () => {
    const { ports } = makePorts()
    const decision = await decideShadow({
      contact: makeContact({ primaryEmail: 'noreply@example.org', addresses: ['noreply@example.org'] }),
      rule: makeRule(),
      ports,
    })
    expect(decision.kind).toBe('write')
    if (decision.kind !== 'write') return
    expect(decision.status).toBe('skipped')
    expect(decision.reasonCode).toBe('system_address')
    expect(decision.annotations.would_send).toBe(false)
  })

  it('reason 3: not_in_allowlist', async () => {
    const { ports } = makePorts()
    const decision = await decideShadow({
      contact: makeContact(),
      rule: makeRule({ recipient_allowlist: ['other@example.org'] }),
      ports,
    })
    expect(decision.kind).toBe('write')
    if (decision.kind !== 'write') return
    expect(decision.status).toBe('skipped')
    expect(decision.reasonCode).toBe('not_in_allowlist')
    expect(decision.annotations.would_send).toBe(false)
  })

  it('reason 4: dnc', async () => {
    const { ports } = makePorts({ dnc: { ok: true, blocked: true } })
    const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
    expect(decision.kind).toBe('write')
    if (decision.kind !== 'write') return
    expect(decision.status).toBe('skipped')
    expect(decision.reasonCode).toBe('dnc')
    expect(decision.annotations.would_send).toBe(false)
  })

  it('reason 5: mailchimp_suppressed', async () => {
    const { ports } = makePorts({ member: { ok: true, state: 'suppressed', tags: [] } })
    const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
    expect(decision.kind).toBe('write')
    if (decision.kind !== 'write') return
    expect(decision.status).toBe('skipped')
    expect(decision.reasonCode).toBe('mailchimp_suppressed')
    expect(decision.annotations.would_send).toBe(false)
  })

  it('reason 5b: excluded_tag (a tag the old batch skips)', async () => {
    const { ports } = makePorts({ member: { ok: true, state: 'active', tags: ['fb_lead', 'sales_active'] } })
    const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
    expect(decision.kind).toBe('write')
    if (decision.kind !== 'write') return
    expect(decision.status).toBe('skipped')
    expect(decision.reasonCode).toBe('excluded_tag')
    expect(decision.annotations.would_send).toBe(false)
  })

  it('matches the tags ignoring case, on both sides', async () => {
    for (const tag of ['SALES_ACTIVE', 'nurture_2027']) {
      const { ports } = makePorts({ member: { ok: true, state: 'active', tags: [tag] } })
      const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
      expect(decision.kind === 'write' && decision.reasonCode).toBe('excluded_tag')
    }
  })

  it('does not skip for a tag that is not on the list, or when the list is empty', async () => {
    const other = makePorts({ member: { ok: true, state: 'active', tags: ['fb_lead', 'paid_customer'] } })
    const d1 = await decideShadow({ contact: makeContact(), rule: makeRule(), ports: other.ports })
    expect(d1.kind === 'write' && d1.reasonCode).toBeNull()

    const none = makePorts({ member: { ok: true, state: 'active', tags: ['sales_active'] } })
    const noTags = makeRule({
      legacy: { mailchimp_campaign_title_prefix: 'legacy_batch_', excluded_tags: [] },
    })
    const d2 = await decideShadow({ contact: makeContact(), rule: noTags, ports: none.ports })
    expect(d2.kind === 'write' && d2.reasonCode).toBeNull()
  })

  it('reason 6: no_consent_basis', async () => {
    const { ports } = makePorts({ consent: { ok: true, bases: [], sourceRef: null } })
    const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
    expect(decision.kind).toBe('write')
    if (decision.kind !== 'write') return
    expect(decision.status).toBe('skipped')
    expect(decision.reasonCode).toBe('no_consent_basis')
    expect(decision.annotations.would_send).toBe(false)
  })

  it('reason 7: sales_email_exists', async () => {
    const { ports } = makePorts({
      evidence: {
        ok: true,
        items: [makeItem({ source: 'sent_items', at: '2026-11-02T00:00:00Z' })],
        legacy: NOT_WELCOMED,
      },
    })
    const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
    expect(decision.kind).toBe('write')
    if (decision.kind !== 'write') return
    expect(decision.status).toBe('skipped')
    expect(decision.reasonCode).toBe('sales_email_exists')
    expect(decision.annotations.would_send).toBe(false)
    expect(decision.annotations.sales_email).toBe(true)
  })

  it("ME's own automated letter is not a sales e-mail, but it does count toward the cap", async () => {
    const fields = { source: 'touchpoint' as const, id: 'send-1', at: '2026-11-02T00:00:00Z', subject: 'me_send:welcome', address: '' }
    const meLetter = makeItem({ ...fields, automated: true })
    const { ports } = makePorts({ evidence: { ok: true, items: [meLetter], legacy: NOT_WELCOMED } })
    const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
    expect(decision.kind).toBe('write')
    if (decision.kind !== 'write') return
    expect(decision.reasonCode).not.toBe('sales_email_exists')
    expect(decision.annotations.sales_email).toBe(false)
    expect(decision.annotations.frequency_count).toBe(1)

    // the same item without the machine mark IS read as a sales e-mail: the mark is what makes the difference
    const { ports: humanPorts } = makePorts({ evidence: { ok: true, items: [makeItem(fields)], legacy: NOT_WELCOMED } })
    const human = await decideShadow({ contact: makeContact(), rule: makeRule(), ports: humanPorts })
    expect(human.kind === 'write' && human.reasonCode).toBe('sales_email_exists')
  })

  it('reason 8: frequency_full', async () => {
    const { ports } = makePorts({
      evidence: {
        ok: true,
        items: [
          makeItem({ id: 'a', source: 'audit', at: '2026-10-01T00:00:00Z' }),
          makeItem({ id: 'b', source: 'audit', at: '2026-10-02T00:00:00Z' }),
        ],
        legacy: NOT_WELCOMED,
      },
    })
    const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
    expect(decision.kind).toBe('write')
    if (decision.kind !== 'write') return
    expect(decision.status).toBe('skipped')
    expect(decision.reasonCode).toBe('frequency_full')
    expect(decision.annotations.would_send).toBe(false)
    expect(decision.annotations.frequency_count).toBe(2)
  })

  describe('precedence', () => {
    it('dnc beats no_consent_basis', async () => {
      const { ports } = makePorts({
        dnc: { ok: true, blocked: true },
        consent: { ok: true, bases: [], sourceRef: null },
      })
      const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
      expect(decision.kind).toBe('write')
      if (decision.kind !== 'write') return
      expect(decision.reasonCode).toBe('dnc')
    })

    it('bad_email beats dnc', async () => {
      const { ports } = makePorts({ dnc: { ok: true, blocked: true } })
      const decision = await decideShadow({
        contact: makeContact({ primaryEmail: null, addresses: [] }),
        rule: makeRule(),
        ports,
      })
      expect(decision.kind).toBe('write')
      if (decision.kind !== 'write') return
      expect(decision.reasonCode).toBe('bad_email')
    })

    it('sales_email_exists beats frequency_full', async () => {
      const { ports } = makePorts({
        evidence: {
          ok: true,
          items: [
            makeItem({ id: 'a', source: 'sent_items', at: '2026-11-02T00:00:00Z' }),
            makeItem({ id: 'b', source: 'audit', at: '2026-10-01T00:00:00Z' }),
          ],
          legacy: NOT_WELCOMED,
        },
      })
      const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
      expect(decision.kind).toBe('write')
      if (decision.kind !== 'write') return
      expect(decision.reasonCode).toBe('sales_email_exists')
    })

    it('mailchimp_suppressed beats excluded_tag, and excluded_tag beats no_consent_basis, sales_email_exists and frequency_full', async () => {
      const both = makePorts({ member: { ok: true, state: 'suppressed', tags: ['sales_active'] } })
      const d1 = await decideShadow({ contact: makeContact(), rule: makeRule(), ports: both.ports })
      expect(d1.kind === 'write' && d1.reasonCode).toBe('mailchimp_suppressed')

      const crowded = makePorts({
        member: { ok: true, state: 'active', tags: ['sales_active'] },
        consent: { ok: true, bases: [], sourceRef: null },
        evidence: {
          ok: true,
          items: [
            makeItem({ id: 'a', source: 'sent_items', at: '2026-11-02T00:00:00Z' }),
            makeItem({ id: 'b', source: 'audit', at: '2026-11-02T01:00:00Z' }),
          ],
          legacy: NOT_WELCOMED,
        },
      })
      const d2 = await decideShadow({ contact: makeContact(), rule: makeRule(), ports: crowded.ports })
      expect(d2.kind === 'write' && d2.reasonCode).toBe('excluded_tag')
    })

    it('mailchimp_suppressed beats no_consent_basis', async () => {
      const { ports } = makePorts({
        member: { ok: true, state: 'suppressed', tags: [] },
        consent: { ok: true, bases: [], sourceRef: null },
      })
      const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
      expect(decision.kind).toBe('write')
      if (decision.kind !== 'write') return
      expect(decision.reasonCode).toBe('mailchimp_suppressed')
    })
  })

  describe('allowlist', () => {
    it('allowlisted contact passes without any consent basis', async () => {
      const { ports } = makePorts({ consent: { ok: true, bases: [], sourceRef: null } })
      const decision = await decideShadow({
        contact: makeContact(),
        rule: makeRule({ recipient_allowlist: ['lead@example.org'] }),
        ports,
      })
      expect(decision.kind).toBe('write')
      if (decision.kind !== 'write') return
      expect(decision.status).toBe('shadow')
      expect(decision.reasonCode).toBeNull()
      expect(decision.annotations.would_send).toBe(true)
      expect(decision.consentBasis).toBeNull()
    })

    it('non-allowlisted contact is skipped with not_in_allowlist', async () => {
      const { ports } = makePorts()
      const decision = await decideShadow({
        contact: makeContact(),
        rule: makeRule({ recipient_allowlist: ['other@example.org'] }),
        ports,
      })
      expect(decision.kind).toBe('write')
      if (decision.kind !== 'write') return
      expect(decision.reasonCode).toBe('not_in_allowlist')
    })
  })

  describe('evidence handling', () => {
    it('mailchimp item is not a sales e-mail but counts toward frequency', async () => {
      const { ports } = makePorts({
        evidence: {
          ok: true,
          items: [makeItem({ source: 'mailchimp', at: '2026-11-02T00:00:00Z' })],
          legacy: NOT_WELCOMED,
        },
      })
      const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
      expect(decision.kind).toBe('write')
      if (decision.kind !== 'write') return
      expect(decision.reasonCode).toBeNull()
      expect(decision.annotations.sales_email).toBe(false)
      expect(decision.annotations.frequency_count).toBe(1)
      expect(decision.annotations.legacy_welcomed).toBe(false)
    })

    it('an old-batch welcome is reported as legacy_welcomed with its campaign ids and is never counted toward the cap', async () => {
      const { ports } = makePorts({
        evidence: { ok: true, items: [], legacy: { welcomed: true, batchSeen: true, campaignIds: ['camp-1', 'camp-2'] } },
      })
      // cap of 1: if the batch mail were counted, this lead could not be welcomed
      const decision = await decideShadow({
        contact: makeContact(),
        rule: makeRule({ frequency_cap: { max: 1, window_days: 7 } }),
        ports,
      })
      expect(decision.kind).toBe('write')
      if (decision.kind !== 'write') return
      expect(decision.reasonCode).toBeNull()
      expect(decision.annotations.legacy_welcomed).toBe(true)
      expect(decision.annotations.legacy_batch_seen).toBe(true)
      expect(decision.annotations.legacy_campaign_ids).toEqual(['camp-1', 'camp-2'])
      expect(decision.annotations.frequency_count).toBe(0)
      expect(decision.annotations.sales_email).toBe(false)
    })

    it('records that the old batch had not run when it did not (so "not welcomed" cannot be trusted)', async () => {
      const { ports } = makePorts({
        evidence: { ok: true, items: [], legacy: { welcomed: false, batchSeen: false, campaignIds: [] } },
      })
      const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
      expect(decision.kind).toBe('write')
      if (decision.kind !== 'write') return
      expect(decision.annotations.legacy_welcomed).toBe(false)
      expect(decision.annotations.legacy_batch_seen).toBe(false)
    })

    it('sent_items before createdAt does not set sales_email but counts toward frequency', async () => {
      const { ports } = makePorts({
        evidence: {
          ok: true,
          items: [makeItem({ source: 'sent_items', at: '2026-10-01T00:00:00Z' })],
          legacy: NOT_WELCOMED,
        },
      })
      const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
      expect(decision.kind).toBe('write')
      if (decision.kind !== 'write') return
      expect(decision.reasonCode).toBeNull()
      expect(decision.annotations.sales_email).toBe(false)
      expect(decision.annotations.frequency_count).toBe(1)
    })

    it('sent_items after createdAt sets sales_email', async () => {
      const { ports } = makePorts({
        evidence: {
          ok: true,
          items: [makeItem({ source: 'sent_items', at: '2026-11-02T00:00:00Z' })],
          legacy: NOT_WELCOMED,
        },
      })
      const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
      expect(decision.kind).toBe('write')
      if (decision.kind !== 'write') return
      expect(decision.reasonCode).toBe('sales_email_exists')
      expect(decision.annotations.sales_email).toBe(true)
    })

    it('an e-mail sent at the very moment the lead came in counts as a sales e-mail (boundary included)', async () => {
      const { ports } = makePorts({
        evidence: {
          ok: true,
          items: [makeItem({ source: 'sent_items', at: makeContact().createdAt })],
          legacy: NOT_WELCOMED,
        },
      })
      const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
      expect(decision.kind).toBe('write')
      if (decision.kind !== 'write') return
      expect(decision.reasonCode).toBe('sales_email_exists')
      expect(decision.annotations.sales_email).toBe(true)
    })

    it('unparsable timestamp counts as a sales e-mail', async () => {
      const { ports } = makePorts({
        evidence: {
          ok: true,
          items: [makeItem({ source: 'sent_items', at: 'not-a-date' })],
          legacy: NOT_WELCOMED,
        },
      })
      const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
      expect(decision.kind).toBe('write')
      if (decision.kind !== 'write') return
      expect(decision.reasonCode).toBe('sales_email_exists')
      expect(decision.annotations.sales_email).toBe(true)
    })

    it('frequency boundary: one counted item sends, two is full', async () => {
      const one = makePorts({
        evidence: {
          ok: true,
          items: [makeItem({ id: 'a', source: 'audit', at: '2026-10-01T00:00:00Z' })],
          legacy: NOT_WELCOMED,
        },
      })
      const d1 = await decideShadow({ contact: makeContact(), rule: makeRule(), ports: one.ports })
      expect(d1.kind).toBe('write')
      if (d1.kind !== 'write') return
      expect(d1.reasonCode).toBeNull()
      expect(d1.annotations.frequency_count).toBe(1)

      const two = makePorts({
        evidence: {
          ok: true,
          items: [
            makeItem({ id: 'a', source: 'audit', at: '2026-10-01T00:00:00Z' }),
            makeItem({ id: 'b', source: 'audit', at: '2026-10-02T00:00:00Z' }),
          ],
          legacy: NOT_WELCOMED,
        },
      })
      const d2 = await decideShadow({ contact: makeContact(), rule: makeRule(), ports: two.ports })
      expect(d2.kind).toBe('write')
      if (d2.kind !== 'write') return
      expect(d2.reasonCode).toBe('frequency_full')
    })
  })

  describe('defers', () => {
    it('dnc failure defers with dnc_unverifiable', async () => {
      const { ports } = makePorts({ dnc: { ok: false, error: 'boom' } })
      const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
      expect(decision).toEqual({ kind: 'defer', reasonCode: 'dnc_unverifiable', detail: 'boom' })
    })

    it('consent failure defers with consent_unreadable', async () => {
      const { ports } = makePorts({ consent: { ok: false, error: 'boom' } })
      const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
      expect(decision).toEqual({ kind: 'defer', reasonCode: 'consent_unreadable', detail: 'boom' })
    })

    it('member failure defers with legacy_unverifiable', async () => {
      const { ports } = makePorts({ member: { ok: false, error: 'boom' } })
      const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
      expect(decision).toEqual({ kind: 'defer', reasonCode: 'legacy_unverifiable', detail: 'boom' })
    })

    it('evidence failure defers with evidence_unverifiable', async () => {
      const { ports } = makePorts({ evidence: { ok: false, error: 'boom' } })
      const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
      expect(decision).toEqual({ kind: 'defer', reasonCode: 'evidence_unverifiable', detail: 'boom' })
    })

    it('thrown/rejected ports also defer', async () => {
      const { ports } = makePorts()
      ports.dnc = vi.fn(async () => {
        throw new Error('network')
      })
      const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
      expect(decision).toEqual({ kind: 'defer', reasonCode: 'dnc_unverifiable', detail: 'network' })
    })

    it('priority: dnc beats consent beats member beats evidence', async () => {
      const all = makePorts({
        dnc: { ok: false, error: 'x' },
        consent: { ok: false, error: 'x' },
        member: { ok: false, error: 'x' },
        evidence: { ok: false, error: 'x' },
      })
      const d1 = await decideShadow({ contact: makeContact(), rule: makeRule(), ports: all.ports })
      expect(d1).toEqual({ kind: 'defer', reasonCode: 'dnc_unverifiable', detail: 'x' })

      const noDnc = makePorts({
        consent: { ok: false, error: 'x' },
        member: { ok: false, error: 'x' },
        evidence: { ok: false, error: 'x' },
      })
      const d2 = await decideShadow({ contact: makeContact(), rule: makeRule(), ports: noDnc.ports })
      expect(d2).toEqual({ kind: 'defer', reasonCode: 'consent_unreadable', detail: 'x' })

      const noConsent = makePorts({
        member: { ok: false, error: 'x' },
        evidence: { ok: false, error: 'x' },
      })
      const d3 = await decideShadow({ contact: makeContact(), rule: makeRule(), ports: noConsent.ports })
      expect(d3).toEqual({ kind: 'defer', reasonCode: 'legacy_unverifiable', detail: 'x' })

      const noMember = makePorts({ evidence: { ok: false, error: 'x' } })
      const d4 = await decideShadow({ contact: makeContact(), rule: makeRule(), ports: noMember.ports })
      expect(d4).toEqual({ kind: 'defer', reasonCode: 'evidence_unverifiable', detail: 'x' })
    })

    it('never returns a write decision when a read failed', async () => {
      const { ports } = makePorts({ consent: { ok: false, error: 'x' } })
      const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
      expect(decision.kind).toBe('defer')
    })
  })

  it('never throws even if a port throws synchronously', async () => {
    const { ports } = makePorts()
    ports.consent = vi.fn(() => {
      throw new Error('sync boom')
    }) as unknown as ShadowGatePorts['consent']
    const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
    expect(decision).toEqual({ kind: 'defer', reasonCode: 'consent_unreadable', detail: 'sync boom' })
  })
})

describe('decideShadow · precedence and consent basis (added after the mutation probe)', () => {
  it('reports dnc before mailchimp_suppressed when both apply', async () => {
    const { ports } = makePorts({
      dnc: { ok: true, blocked: true },
      member: { ok: true, state: 'suppressed', tags: [] },
    })
    const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
    expect(decision).toMatchObject({ kind: 'write', status: 'skipped', reasonCode: 'dnc' })
  })

  it('treats a consent basis the rule does not accept as no consent basis', async () => {
    const { ports } = makePorts({
      consent: { ok: true, bases: ['some_other_basis'], sourceRef: 'lead-1' },
    })
    const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
    expect(decision).toMatchObject({
      kind: 'write',
      status: 'skipped',
      reasonCode: 'no_consent_basis',
      consentBasis: null,
    })
  })

  it('picks the accepted basis even when an unaccepted one comes first', async () => {
    const { ports } = makePorts({
      consent: { ok: true, bases: ['some_other_basis', 'form_disclosure_attested'], sourceRef: 'lead-1' },
    })
    const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
    expect(decision).toMatchObject({
      kind: 'write',
      status: 'shadow',
      reasonCode: null,
      consentBasis: 'form_disclosure_attested',
    })
  })
})

describe('decideShadow - behaviours the mutation probe found unpinned', () => {
  it('a lead that is not in the Mailchimp audience yet is NOT suppressed', async () => {
    const { ports } = makePorts({ member: { ok: true, state: 'not_in_audience', tags: [] } })
    const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
    expect(decision).toMatchObject({ kind: 'write', status: 'shadow', reasonCode: null })
  })

  it('a client without a Mailchimp audience is not suppressed either', async () => {
    const { ports } = makePorts({ member: { ok: true, state: 'not_applicable', tags: [] } })
    const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
    expect(decision).toMatchObject({ kind: 'write', status: 'shadow', reasonCode: null })
  })

  it.each(['audit', 'touchpoint'] as const)('a %s item after the lead came in is a human e-mail', async (source) => {
    const { ports } = makePorts({
      evidence: { ok: true, items: [makeItem({ source, at: '2026-11-02T05:00:00Z' })], legacy: NOT_WELCOMED },
    })
    const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
    expect(decision).toMatchObject({ kind: 'write', status: 'skipped', reasonCode: 'sales_email_exists' })
  })

  it('a human e-mail 30 minutes after the lead came in counts (no blind spot right after creation)', async () => {
    const { ports } = makePorts({
      evidence: { ok: true, items: [makeItem({ source: 'sent_items', at: '2026-11-01T20:30:00Z' })], legacy: NOT_WELCOMED },
    })
    const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
    expect(decision).toMatchObject({ reasonCode: 'sales_email_exists' })
  })

  it('the allowlist is matched against the PRIMARY address only', async () => {
    const { ports } = makePorts()
    const decision = await decideShadow({
      contact: makeContact({ addresses: ['lead@example.org', 'other@example.org'] }),
      rule: makeRule({ recipient_allowlist: ['other@example.org'] }),
      ports,
    })
    expect(decision).toMatchObject({ kind: 'write', reasonCode: 'not_in_allowlist' })
  })
})
