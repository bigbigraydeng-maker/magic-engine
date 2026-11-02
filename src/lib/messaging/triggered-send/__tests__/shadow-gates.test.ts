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

function makeRule(overrides: Partial<TriggeredSendRule> = {}): TriggeredSendRule {
  const base: TriggeredSendRule = {
    gate_contract_version: 1,
    audience: { sources: ['meta_lead_form'], max_age_days: 3, min_age: 'previous_local_day' },
    schedule: { timezone: 'Pacific/Auckland' },
    frequency_cap: { max: 2, window_days: 7 },
    consent: { accepted_bases: ['form_disclosure_attested'] },
    legacy: { mailchimp_campaign_title_prefix: 'legacy_batch_' },
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
  const member = vi.fn(async (): Promise<MemberRead> => opts.member ?? { ok: true, state: 'active' })
  const evidence = vi.fn(
    async (): Promise<EvidenceRead> =>
      opts.evidence ?? { ok: true, items: [], isLegacyBatchItem: () => false },
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
    expect(decision.annotations.legacy_welcomed).toBeNull()
    expect(decision.annotations.sales_email).toBeNull()
    expect(decision.annotations.frequency_count).toBeNull()
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
    const { ports } = makePorts({ member: { ok: true, state: 'suppressed' } })
    const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
    expect(decision.kind).toBe('write')
    if (decision.kind !== 'write') return
    expect(decision.status).toBe('skipped')
    expect(decision.reasonCode).toBe('mailchimp_suppressed')
    expect(decision.annotations.would_send).toBe(false)
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
        isLegacyBatchItem: () => false,
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

  it('reason 8: frequency_full', async () => {
    const { ports } = makePorts({
      evidence: {
        ok: true,
        items: [
          makeItem({ id: 'a', source: 'audit', at: '2026-10-01T00:00:00Z' }),
          makeItem({ id: 'b', source: 'audit', at: '2026-10-02T00:00:00Z' }),
        ],
        isLegacyBatchItem: () => false,
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
          isLegacyBatchItem: () => false,
        },
      })
      const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
      expect(decision.kind).toBe('write')
      if (decision.kind !== 'write') return
      expect(decision.reasonCode).toBe('sales_email_exists')
    })

    it('mailchimp_suppressed beats no_consent_basis', async () => {
      const { ports } = makePorts({
        member: { ok: true, state: 'suppressed' },
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
          isLegacyBatchItem: () => false,
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

    it('legacy batch item sets legacy_welcomed and is not counted', async () => {
      const batchItem = makeItem({ source: 'mailchimp', at: '2026-11-02T00:00:00Z' })
      const { ports } = makePorts({
        evidence: {
          ok: true,
          items: [batchItem],
          isLegacyBatchItem: (item) => item === batchItem,
        },
      })
      const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
      expect(decision.kind).toBe('write')
      if (decision.kind !== 'write') return
      expect(decision.reasonCode).toBeNull()
      expect(decision.annotations.legacy_welcomed).toBe(true)
      expect(decision.annotations.frequency_count).toBe(0)
      expect(decision.annotations.sales_email).toBe(false)
    })

    it('sent_items before createdAt does not set sales_email but counts toward frequency', async () => {
      const { ports } = makePorts({
        evidence: {
          ok: true,
          items: [makeItem({ source: 'sent_items', at: '2026-10-01T00:00:00Z' })],
          isLegacyBatchItem: () => false,
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
          isLegacyBatchItem: () => false,
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
          isLegacyBatchItem: () => false,
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
          isLegacyBatchItem: () => false,
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
          isLegacyBatchItem: () => false,
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
      expect(decision).toEqual({ kind: 'defer', reasonCode: 'dnc_unverifiable' })
    })

    it('consent failure defers with consent_unreadable', async () => {
      const { ports } = makePorts({ consent: { ok: false, error: 'boom' } })
      const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
      expect(decision).toEqual({ kind: 'defer', reasonCode: 'consent_unreadable' })
    })

    it('member failure defers with legacy_unverifiable', async () => {
      const { ports } = makePorts({ member: { ok: false, error: 'boom' } })
      const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
      expect(decision).toEqual({ kind: 'defer', reasonCode: 'legacy_unverifiable' })
    })

    it('evidence failure defers with evidence_unverifiable', async () => {
      const { ports } = makePorts({ evidence: { ok: false, error: 'boom' } })
      const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
      expect(decision).toEqual({ kind: 'defer', reasonCode: 'evidence_unverifiable' })
    })

    it('thrown/rejected ports also defer', async () => {
      const { ports } = makePorts()
      ports.dnc = vi.fn(async () => {
        throw new Error('network')
      })
      const decision = await decideShadow({ contact: makeContact(), rule: makeRule(), ports })
      expect(decision).toEqual({ kind: 'defer', reasonCode: 'dnc_unverifiable' })
    })

    it('priority: dnc beats consent beats member beats evidence', async () => {
      const all = makePorts({
        dnc: { ok: false, error: 'x' },
        consent: { ok: false, error: 'x' },
        member: { ok: false, error: 'x' },
        evidence: { ok: false, error: 'x' },
      })
      const d1 = await decideShadow({ contact: makeContact(), rule: makeRule(), ports: all.ports })
      expect(d1).toEqual({ kind: 'defer', reasonCode: 'dnc_unverifiable' })

      const noDnc = makePorts({
        consent: { ok: false, error: 'x' },
        member: { ok: false, error: 'x' },
        evidence: { ok: false, error: 'x' },
      })
      const d2 = await decideShadow({ contact: makeContact(), rule: makeRule(), ports: noDnc.ports })
      expect(d2).toEqual({ kind: 'defer', reasonCode: 'consent_unreadable' })

      const noConsent = makePorts({
        member: { ok: false, error: 'x' },
        evidence: { ok: false, error: 'x' },
      })
      const d3 = await decideShadow({ contact: makeContact(), rule: makeRule(), ports: noConsent.ports })
      expect(d3).toEqual({ kind: 'defer', reasonCode: 'legacy_unverifiable' })

      const noMember = makePorts({ evidence: { ok: false, error: 'x' } })
      const d4 = await decideShadow({ contact: makeContact(), rule: makeRule(), ports: noMember.ports })
      expect(d4).toEqual({ kind: 'defer', reasonCode: 'evidence_unverifiable' })
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
    expect(decision).toEqual({ kind: 'defer', reasonCode: 'consent_unreadable' })
  })
})

describe('decideShadow · precedence and consent basis (added after the mutation probe)', () => {
  it('reports dnc before mailchimp_suppressed when both apply', async () => {
    const { ports } = makePorts({
      dnc: { ok: true, blocked: true },
      member: { ok: true, state: 'suppressed' },
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
