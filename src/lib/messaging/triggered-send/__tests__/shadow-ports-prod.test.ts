import { describe, it, expect, vi } from 'vitest'

import type { AudienceIdRead } from '@/lib/mailchimp/audience-config'
import type { FindMemberResult } from '@/lib/mailchimp/tags'
import type { MailchimpCampaign } from '@/lib/mailchimp/client'
import type { MailchimpPort } from '@/lib/crm/email-templates/frequency-sources-prod'
import type { evaluateFrequency } from '@/lib/crm/email-templates/gates/frequency'
import type { FrequencyVerdict, OutboundItem } from '@/lib/crm/email-templates/gates/types'

import type { TriggeredSendRule } from '../rule'
import type { DncRead, ShadowContact } from '../types'
import { createShadowGatePorts, type ShadowPortsDeps } from '../shadow-ports-prod'

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────────────

const RULE: TriggeredSendRule = {
  gate_contract_version: 1,
  audience: { sources: ['meta_lead_form'], max_age_days: 7, min_age: 'previous_local_day' },
  schedule: { timezone: 'Europe/Berlin' },
  frequency_cap: { max: 2, window_days: 14 },
  consent: { accepted_bases: ['marketing'] },
  legacy: { mailchimp_campaign_title_prefix: 'Welcome Batch', excluded_tags: ['sales_active'] },
  human_mail: { required_mailboxes: ['sales@example.org'] },
  recipient_allowlist: null,
}

const NOW = new Date('2026-11-02T08:00:00.000Z')

const CONTACT: ShadowContact = {
  contactId: 'c-1',
  createdAt: '2026-11-01T10:00:00.000Z',
  primaryEmail: 'lead@example.org',
  addresses: ['lead@example.org'],
}

type EvaluateArgs = Parameters<typeof evaluateFrequency>[0]

interface FakeQuery {
  select: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  order: ReturnType<typeof vi.fn>
  limit: ReturnType<typeof vi.fn>
  then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => void
}

interface FakeDb {
  from: ReturnType<typeof vi.fn>
  query: FakeQuery
}

function makeFakeDb(result: { data: unknown[] | null; error: { message: string } | null }): FakeDb {
  const query: FakeQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  query.order.mockReturnValue(query)
  query.limit.mockReturnValue(query)
  const from = vi.fn().mockReturnValue(query)
  return { from, query }
}

interface TableResult {
  data: unknown
  error: { message: string } | null
}

/** A fake database that answers per table and remembers every `.eq()` filter of every query. */
function makeTableDb(results: Record<string, TableResult>) {
  const queries: Array<{ table: string; eq: Array<[string, unknown]> }> = []
  const from = vi.fn((table: string) => {
    const entry = { table, eq: [] as Array<[string, unknown]> }
    queries.push(entry)
    const result = results[table] ?? { data: [], error: null }
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn((column: string, value: unknown) => {
        entry.eq.push([column, value])
        return query
      }),
      order: vi.fn(() => query),
      limit: vi.fn(() => query),
      maybeSingle: vi.fn(() => Promise.resolve(result)),
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => Promise.resolve(result).then(resolve, reject),
    }
    return query
  })
  return { from, queries }
}

function makeMailchimpPort(overrides: Partial<MailchimpPort> = {}): MailchimpPort {
  return {
    apiKey: () => 'test-key',
    readAudience: async (): Promise<AudienceIdRead> => ({ ok: true, audienceId: 'aud-1' }),
    listSentCampaigns: async (): Promise<MailchimpCampaign[]> => [],
    getCampaignRecipientStatus: async () => 'not_recipient',
    ...overrides,
  }
}

function campaign(overrides: Partial<MailchimpCampaign> & { id: string; title: string }): MailchimpCampaign {
  return {
    subject: 'subject',
    sentAt: '2026-11-02T06:00:00.000Z',
    emailsSent: 10,
    opens: 0,
    uniqueOpens: 0,
    clicks: 0,
    openRate: 0,
    clickRate: 0,
    ...overrides,
  }
}

function makeDeps(overrides: Partial<ShadowPortsDeps> = {}): ShadowPortsDeps {
  const db = makeFakeDb({ data: [], error: null })
  return {
    db: db as never,
    clientId: 'client-1',
    rule: RULE,
    now: NOW,
    listActiveMailboxes: async () => [],
    graphGetPage: async () => ({ ok: true, json: {} }),
    checkDnc: async (): Promise<DncRead> => ({ ok: true, blocked: false }),
    mailchimp: makeMailchimpPort(),
    findMember: async (): Promise<FindMemberResult> => ({ status: 'not_in_audience' }),
    evaluate: async (): Promise<FrequencyVerdict> => ({ ok: true, count: 0, items: [] }),
    ...overrides,
  }
}

function item(overrides: Partial<OutboundItem>): OutboundItem {
  return {
    source: 'sent_items',
    id: 'x',
    at: '2026-10-30T10:00:00.000Z',
    subject: 'hi',
    address: 'lead@example.org',
    ...overrides,
  }
}

/** An evaluate that, like the real one, asks the Mailchimp source and returns what it found. */
function mailchimpEvaluate() {
  return vi.fn(async (args: EvaluateArgs): Promise<FrequencyVerdict> => {
    const res = await args.sources.mailchimp(args.addresses, '2026-10-26T00:00:00.000Z')
    if (!res.ok) return { ok: false, reason: 'frequency_unverifiable', error: res.error }
    return { ok: true, count: res.items.length, items: res.items }
  })
}

/** An evaluate that, like the real one, asks the sent-items source (the mailbox). */
function sentItemsEvaluate() {
  return vi.fn(async (args: EvaluateArgs): Promise<FrequencyVerdict> => {
    const res = await args.sources.sentItems(args.addresses, '2026-10-26T00:00:00.000Z')
    if (!res.ok) return { ok: false, reason: 'frequency_unverifiable', error: res.error }
    return { ok: true, count: res.items.length, items: res.items }
  })
}

// ── consent ────────────────────────────────────────────────────────────────────────────────────────────

describe('consent port', () => {
  it('runs the exact query and collects unique non-empty bases in row order', async () => {
    const db = makeFakeDb({
      data: [
        { source_ref: 'ref-1', metadata: { consent_basis: 'marketing' }, occurred_at: 't1' },
        { source_ref: 'ref-2', metadata: { consent_basis: 'marketing' }, occurred_at: 't2' },
        { source_ref: 'ref-3', metadata: { consent_basis: 'transactional' }, occurred_at: 't3' },
        { source_ref: 'ref-4', metadata: { consent_basis: '' }, occurred_at: 't4' },
        { source_ref: 'ref-5', metadata: { consent_basis: 42 }, occurred_at: 't5' },
        { source_ref: 'ref-6', metadata: null, occurred_at: 't6' },
        { source_ref: 'ref-7', metadata: 'not-an-object', occurred_at: 't7' },
      ],
      error: null,
    })
    const { ports } = createShadowGatePorts(makeDeps({ db: db as never }))
    const read = await ports.consent('c-1')
    expect(read).toEqual({ ok: true, bases: ['marketing', 'transactional'], sourceRef: 'ref-1' })
    expect(db.from).toHaveBeenCalledWith('contact_touchpoints')
    expect(db.query.select).toHaveBeenCalledWith('source_ref, metadata, occurred_at')
    expect(db.query.eq).toHaveBeenCalledWith('client_id', 'client-1')
    expect(db.query.eq).toHaveBeenCalledWith('contact_id', 'c-1')
    expect(db.query.eq).toHaveBeenCalledWith('source', 'meta_lead_form')
    expect(db.query.order).toHaveBeenCalledWith('occurred_at', { ascending: true })
    expect(db.query.limit).toHaveBeenCalledWith(50)
  })

  it('returns empty bases and null sourceRef when there are no rows', async () => {
    const db = makeFakeDb({ data: [], error: null })
    const { ports } = createShadowGatePorts(makeDeps({ db: db as never }))
    expect(await ports.consent('c-1')).toEqual({ ok: true, bases: [], sourceRef: null })
  })

  it('returns null sourceRef when the first row has no usable source_ref', async () => {
    const db = makeFakeDb({
      data: [{ source_ref: '', metadata: { consent_basis: 'marketing' }, occurred_at: 't1' }],
      error: null,
    })
    const { ports } = createShadowGatePorts(makeDeps({ db: db as never }))
    expect(await ports.consent('c-1')).toEqual({ ok: true, bases: ['marketing'], sourceRef: null })
  })

  it('turns a query error into ok:false', async () => {
    const db = makeFakeDb({ data: null, error: { message: 'boom' } })
    const { ports } = createShadowGatePorts(makeDeps({ db: db as never }))
    expect(await ports.consent('c-1')).toEqual({ ok: false, error: 'boom' })
  })

  it('turns a thrown error into ok:false', async () => {
    const db = {
      from: vi.fn(() => {
        throw new Error('kaboom')
      }),
    }
    const { ports } = createShadowGatePorts(makeDeps({ db: db as never }))
    expect(await ports.consent('c-1')).toEqual({ ok: false, error: 'kaboom' })
  })
})

// ── dnc ────────────────────────────────────────────────────────────────────────────────────────────────

describe('dnc port — the injected checker', () => {
  it('passes a not-blocked answer through', async () => {
    const checkDnc = vi.fn(async (): Promise<DncRead> => ({ ok: true, blocked: false }))
    const { ports } = createShadowGatePorts(makeDeps({ checkDnc }))
    expect(await ports.dnc('c-1')).toEqual({ ok: true, blocked: false })
    expect(checkDnc).toHaveBeenCalledWith('client-1', 'c-1')
  })

  it('passes a blocked answer through', async () => {
    const { ports } = createShadowGatePorts(makeDeps({ checkDnc: async () => ({ ok: true, blocked: true }) }))
    expect(await ports.dnc('c-1')).toEqual({ ok: true, blocked: true })
  })

  it('passes a failed lookup through as ok:false', async () => {
    const { ports } = createShadowGatePorts(makeDeps({ checkDnc: async () => ({ ok: false, error: 'lookup failed' }) }))
    expect(await ports.dnc('c-1')).toEqual({ ok: false, error: 'lookup failed' })
  })

  it('turns a thrown error into ok:false', async () => {
    const { ports } = createShadowGatePorts(
      makeDeps({
        checkDnc: async () => {
          throw new Error('network down')
        },
      }),
    )
    expect(await ports.dnc('c-1')).toEqual({ ok: false, error: 'network down' })
  })
})

describe('dnc port — the strict default reader', () => {
  const clean = {
    contacts: { data: { do_not_contact: false }, error: null },
    contact_touchpoints: { data: [], error: null },
    conversations: { data: [], error: null },
  }
  function portsFor(results: Record<string, TableResult>) {
    const db = makeTableDb({ ...clean, ...results })
    const deps = makeDeps({ db: db as never })
    delete deps.checkDnc
    return { ports: createShadowGatePorts(deps).ports, db }
  }

  it('is not blocked for a clean contact', async () => {
    const { ports } = portsFor({})
    expect(await ports.dnc('c-1')).toEqual({ ok: true, blocked: false })
  })

  it('is blocked by the contact flag', async () => {
    const { ports } = portsFor({ contacts: { data: { do_not_contact: true }, error: null } })
    expect(await ports.dnc('c-1')).toEqual({ ok: true, blocked: true })
  })

  it('is blocked by a touchpoint whose outcome is do_not_contact', async () => {
    const { ports } = portsFor({
      contact_touchpoints: {
        data: [{ occurred_at: '2026-10-01T00:00:00.000Z', metadata: { outcome: 'do_not_contact' } }],
        error: null,
      },
    })
    expect(await ports.dnc('c-1')).toEqual({ ok: true, blocked: true })
  })

  it('is blocked by a touchpoint that carries the do_not_contact flag', async () => {
    const { ports } = portsFor({
      contact_touchpoints: {
        data: [{ occurred_at: '2026-10-01T00:00:00.000Z', metadata: { do_not_contact: true } }],
        error: null,
      },
    })
    expect(await ports.dnc('c-1')).toEqual({ ok: true, blocked: true })
  })

  it('is not blocked when a person cleared the verdict afterwards, even if the contact flag is still set', async () => {
    const { ports } = portsFor({
      contacts: { data: { do_not_contact: true }, error: null },
      contact_touchpoints: {
        data: [
          { occurred_at: '2026-10-01T00:00:00.000Z', metadata: { outcome: 'do_not_contact' } },
          { occurred_at: '2026-10-02T00:00:00.000Z', metadata: { outcome: 'dnc_cleared' } },
        ],
        error: null,
      },
    })
    expect(await ports.dnc('c-1')).toEqual({ ok: true, blocked: false })
  })

  // The old batch skips members carrying `suppressed_do_not_email`, which the CRM puts on "do not contact" AND "not interested".
  it('is blocked by a touchpoint whose outcome is not_interested', async () => {
    const { ports } = portsFor({
      contact_touchpoints: {
        data: [{ occurred_at: '2026-10-01T00:00:00.000Z', metadata: { outcome: 'not_interested' } }],
        error: null,
      },
    })
    expect(await ports.dnc('c-1')).toEqual({ ok: true, blocked: true })
  })

  it('a later "do-not-contact cleared" verdict does not clear "not interested"', async () => {
    const { ports } = portsFor({
      contact_touchpoints: {
        data: [
          { occurred_at: '2026-10-01T00:00:00.000Z', metadata: { outcome: 'not_interested' } },
          { occurred_at: '2026-10-02T00:00:00.000Z', metadata: { outcome: 'dnc_cleared' } },
        ],
        error: null,
      },
    })
    expect(await ports.dnc('c-1')).toEqual({ ok: true, blocked: true })
  })

  it('is blocked by a conversation-level opt-out that was never linked to the contact', async () => {
    const { ports } = portsFor({ conversations: { data: [{ id: 'conv-1' }], error: null } })
    expect(await ports.dnc('c-1')).toEqual({ ok: true, blocked: true })
  })

  it('reads a missing metadata as no verdict', async () => {
    const { ports } = portsFor({
      contact_touchpoints: { data: [{ occurred_at: '2026-10-01T00:00:00.000Z', metadata: null }], error: null },
    })
    expect(await ports.dnc('c-1')).toEqual({ ok: true, blocked: false })
  })

  // The old check answered "blocked" on any read error, which would freeze an innocent lead as do-not-contact for good.
  it.each([
    ['contacts', { contacts: { data: null, error: { message: 'statement timeout' } } }],
    ['touchpoints', { contact_touchpoints: { data: null, error: { message: 'statement timeout' } } }],
    ['conversations', { conversations: { data: null, error: { message: 'statement timeout' } } }],
  ])('a failed %s read stays a failed read (never "blocked")', async (label, results) => {
    const { ports } = portsFor(results)
    expect(await ports.dnc('c-1')).toEqual({ ok: false, error: `${label}: statement timeout` })
  })

  it('a contact that is not found for this client is a failed read, not "blocked" and not "clear"', async () => {
    const { ports } = portsFor({ contacts: { data: null, error: null } })
    expect(await ports.dnc('c-1')).toEqual({ ok: false, error: 'contact not found for this client' })
  })

  it('scopes every query to the client and the contact', async () => {
    const { ports, db } = portsFor({})
    await ports.dnc('c-1')
    const byTable = (table: string) => db.queries.find((q) => q.table === table)?.eq ?? []
    expect(byTable('contacts')).toEqual(
      expect.arrayContaining([
        ['id', 'c-1'],
        ['client_id', 'client-1'],
      ]),
    )
    expect(byTable('contact_touchpoints')).toEqual(
      expect.arrayContaining([
        ['contact_id', 'c-1'],
        ['client_id', 'client-1'],
      ]),
    )
    expect(byTable('conversations')).toEqual(
      expect.arrayContaining([
        ['contact_id', 'c-1'],
        ['client_id', 'client-1'],
        ['optout_unlinked', true],
      ]),
    )
  })

  it('turns a thrown error into ok:false', async () => {
    const db = {
      from: vi.fn(() => {
        throw new Error('kaboom')
      }),
    }
    const deps = makeDeps({ db: db as never })
    delete deps.checkDnc
    expect(await createShadowGatePorts(deps).ports.dnc('c-1')).toEqual({ ok: false, error: 'kaboom' })
  })
})

// ── member ────────────────────────────────────────────────────────────────────────────────────────────

describe('member port', () => {
  it('reads the audience only once for two calls', async () => {
    const readAudience = vi.fn(async (): Promise<AudienceIdRead> => ({ ok: true, audienceId: 'aud-1' }))
    const { ports } = createShadowGatePorts(
      makeDeps({
        mailchimp: makeMailchimpPort({ readAudience }),
        findMember: async () => ({ status: 'not_in_audience' }),
      }),
    )
    await ports.member('a@example.org')
    await ports.member('b@example.org')
    expect(readAudience).toHaveBeenCalledTimes(1)
  })

  it.each(['unsubscribed', 'cleaned', 'archived'])('maps %s to suppressed', async (status) => {
    const { ports } = createShadowGatePorts(
      makeDeps({
        findMember: async () => ({
          status: 'found',
          member: { email: 'lead@example.org', status, tags: [] },
        }),
      }),
    )
    expect(await ports.member('lead@example.org')).toEqual({ ok: true, state: 'suppressed', tags: [] })
  })

  it.each(['subscribed', 'pending', 'transactional'])('maps %s to active', async (status) => {
    const { ports } = createShadowGatePorts(
      makeDeps({
        findMember: async () => ({
          status: 'found',
          member: { email: 'lead@example.org', status, tags: [] },
        }),
      }),
    )
    expect(await ports.member('lead@example.org')).toEqual({ ok: true, state: 'active', tags: [] })
  })

  it('passes the member tags through (a copy)', async () => {
    const tags = ['fb_lead', 'sales_active']
    const { ports } = createShadowGatePorts(
      makeDeps({
        findMember: async () => ({ status: 'found', member: { email: 'lead@example.org', status: 'subscribed', tags } }),
      }),
    )
    const read = await ports.member('lead@example.org')
    expect(read).toEqual({ ok: true, state: 'active', tags: ['fb_lead', 'sales_active'] })
    expect(read.ok && read.tags).not.toBe(tags)
  })

  it('keeps the tags of a suppressed member too', async () => {
    const { ports } = createShadowGatePorts(
      makeDeps({
        findMember: async () => ({
          status: 'found',
          member: { email: 'lead@example.org', status: 'unsubscribed', tags: ['nurture_2027'] },
        }),
      }),
    )
    expect(await ports.member('lead@example.org')).toEqual({ ok: true, state: 'suppressed', tags: ['nurture_2027'] })
  })

  it('maps not_in_audience', async () => {
    const { ports } = createShadowGatePorts(makeDeps({ findMember: async () => ({ status: 'not_in_audience' }) }))
    expect(await ports.member('lead@example.org')).toEqual({ ok: true, state: 'not_in_audience', tags: [] })
  })

  it('maps a findMember error to ok:false with the reason', async () => {
    const { ports } = createShadowGatePorts(
      makeDeps({ findMember: async () => ({ status: 'error', reason: 'rate limited', retryable: true }) }),
    )
    expect(await ports.member('lead@example.org')).toEqual({ ok: false, error: 'rate limited' })
  })

  it('returns not_applicable when the client has no audience', async () => {
    const { ports } = createShadowGatePorts(
      makeDeps({ mailchimp: makeMailchimpPort({ readAudience: async () => ({ ok: true, audienceId: '' }) }) }),
    )
    expect(await ports.member('lead@example.org')).toEqual({ ok: true, state: 'not_applicable', tags: [] })
  })

  it('returns ok:false when the audience read fails', async () => {
    const { ports } = createShadowGatePorts(
      makeDeps({ mailchimp: makeMailchimpPort({ readAudience: async () => ({ ok: false, message: 'no config' }) }) }),
    )
    expect(await ports.member('lead@example.org')).toEqual({ ok: false, error: 'audience: no config' })
  })

  it('returns ok:false when the API key is missing', async () => {
    const { ports } = createShadowGatePorts(makeDeps({ mailchimp: makeMailchimpPort({ apiKey: () => undefined }) }))
    expect(await ports.member('lead@example.org')).toEqual({ ok: false, error: 'MAILCHIMP_API_KEY is not set' })
  })

  it('treats an empty API key like a missing one', async () => {
    const { ports } = createShadowGatePorts(makeDeps({ mailchimp: makeMailchimpPort({ apiKey: () => '' }) }))
    expect(await ports.member('lead@example.org')).toEqual({ ok: false, error: 'MAILCHIMP_API_KEY is not set' })
  })

  it('turns a thrown error into ok:false', async () => {
    const { ports } = createShadowGatePorts(
      makeDeps({
        findMember: async () => {
          throw new Error('boom')
        },
      }),
    )
    expect(await ports.member('lead@example.org')).toEqual({ ok: false, error: 'boom' })
  })
})

// ── evidence ──────────────────────────────────────────────────────────────────────────────────────────

describe('evidence port', () => {
  it('returns the items from evaluate as given', async () => {
    const items: OutboundItem[] = [
      item({ source: 'sent_items', id: 's1' }),
      item({ source: 'mailchimp', id: 'mc:camp-1:lead@example.org' }),
    ]
    const evaluate = vi.fn(async (): Promise<FrequencyVerdict> => ({ ok: true, count: 2, items }))
    const { ports } = createShadowGatePorts(makeDeps({ evaluate }))
    const read = await ports.evidence(CONTACT)
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.items).toEqual(items)
  })

  it('passes the unreachable cap, the window, addresses, contactId, now and a time budget to evaluate', async () => {
    const evaluate = vi.fn(async (_args: EvaluateArgs): Promise<FrequencyVerdict> => ({ ok: true, count: 0, items: [] }))
    const { ports } = createShadowGatePorts(makeDeps({ evaluate }))
    // every address of the contact is asked about, not only the primary one
    const contact: ShadowContact = { ...CONTACT, addresses: ['lead@example.org', 'second@example.org'] }
    await ports.evidence(contact)
    expect(evaluate).toHaveBeenCalledTimes(1)
    const arg = evaluate.mock.calls[0][0]
    expect(arg.cap).toEqual({ max: Number.MAX_SAFE_INTEGER, windowDays: RULE.frequency_cap.window_days })
    expect(arg.addresses).toEqual(['lead@example.org', 'second@example.org'])
    expect(arg.contactId).toBe(CONTACT.contactId)
    expect(arg.now).toBe(NOW)
    // 4 contacts per chunk step x this budget must stay well inside the host's ~2 minute request limit.
    expect(arg.budgetMs).toBe(15_000)
  })

  it('treats frequency_cap as ok:true (items still returned)', async () => {
    const items: OutboundItem[] = [item({ source: 'sent_items', id: 's1' })]
    const evaluate = vi.fn(
      async (): Promise<FrequencyVerdict> => ({
        ok: false,
        reason: 'frequency_cap',
        count: 5,
        items,
        nextAllowedAt: '2026-11-10T00:00:00.000Z',
      }),
    )
    const { ports } = createShadowGatePorts(makeDeps({ evaluate }))
    const read = await ports.evidence(CONTACT)
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.items).toEqual(items)
  })

  it('maps frequency_unverifiable to ok:false', async () => {
    const evaluate = vi.fn(
      async (): Promise<FrequencyVerdict> => ({ ok: false, reason: 'frequency_unverifiable', error: 'graph down' }),
    )
    const { ports } = createShadowGatePorts(makeDeps({ evaluate }))
    expect(await ports.evidence(CONTACT)).toEqual({ ok: false, error: 'graph down' })
  })

  it('turns a thrown error into ok:false', async () => {
    const evaluate = vi.fn(async (): Promise<FrequencyVerdict> => {
      throw new Error('kaboom')
    })
    const { ports } = createShadowGatePorts(makeDeps({ evaluate }))
    expect(await ports.evidence(CONTACT)).toEqual({ ok: false, error: 'kaboom' })
  })

  it('with no old-batch campaign in sight, the contact is not welcomed and the batch is not seen', async () => {
    const { ports } = createShadowGatePorts(makeDeps())
    const read = await ports.evidence(CONTACT)
    expect(read).toEqual({ ok: true, items: [], legacy: { welcomed: false, batchSeen: false, campaignIds: [] } })
  })

  it('memoises listSentCampaigns and retries after a rejection', async () => {
    let calls = 0
    const listSentCampaigns = vi.fn(async (): Promise<MailchimpCampaign[]> => {
      calls += 1
      if (calls === 1) throw new Error('transient')
      return []
    })
    const { ports } = createShadowGatePorts(
      makeDeps({ evaluate: mailchimpEvaluate(), mailchimp: makeMailchimpPort({ listSentCampaigns }) }),
    )
    // first call rejects
    await expect(ports.evidence(CONTACT)).resolves.toEqual({ ok: false, error: 'transient' })
    // second call retries and succeeds
    await expect(ports.evidence(CONTACT)).resolves.toMatchObject({ ok: true, items: [] })
    // third call is memoised
    await ports.evidence(CONTACT)
    expect(listSentCampaigns).toHaveBeenCalledTimes(2)
  })
})

describe('the old daily batch', () => {
  const BATCH = campaign({ id: 'camp-batch', title: 'Welcome Batch 2026-11-02', sentAt: '2026-11-02T06:00:00.000Z' })
  const OTHER = campaign({ id: 'camp-other', title: 'Newsletter', sentAt: '2026-11-01T06:00:00.000Z' })

  it('takes the batch campaigns out of what the e-mail evidence sees, before anything is counted', async () => {
    const getCampaignRecipientStatus = vi.fn(async () => 'sent' as const)
    const { ports } = createShadowGatePorts(
      makeDeps({
        evaluate: mailchimpEvaluate(),
        mailchimp: makeMailchimpPort({ listSentCampaigns: async () => [BATCH, OTHER], getCampaignRecipientStatus }),
      }),
    )
    const read = await ports.evidence(CONTACT)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.items.map((i) => i.id)).toEqual(['mc:camp-other:lead@example.org'])
  })

  it('reads whether the batch e-mailed the contact itself, from the batch campaigns', async () => {
    const getCampaignRecipientStatus = vi.fn(async (_key: string, campaignId: string) =>
      campaignId === 'camp-batch' ? ('sent' as const) : ('not_recipient' as const),
    )
    const { ports } = createShadowGatePorts(
      makeDeps({
        evaluate: mailchimpEvaluate(),
        mailchimp: makeMailchimpPort({ listSentCampaigns: async () => [BATCH, OTHER], getCampaignRecipientStatus }),
      }),
    )
    const read = await ports.evidence(CONTACT)
    expect(read).toMatchObject({ ok: true, legacy: { welcomed: true, batchSeen: true, campaignIds: ['camp-batch'] } })
    expect(getCampaignRecipientStatus).toHaveBeenCalledWith('test-key', 'camp-batch', 'lead@example.org')
  })

  it.each([
    ['sent', true],
    ['soft', true],
    ['hard', false],
    ['not_recipient', false],
  ] as const)('a recipient status of %s means welcomed=%s', async (status, welcomed) => {
    const { ports } = createShadowGatePorts(
      makeDeps({
        evaluate: mailchimpEvaluate(),
        mailchimp: makeMailchimpPort({
          listSentCampaigns: async () => [BATCH],
          getCampaignRecipientStatus: async () => status,
        }),
      }),
    )
    const read = await ports.evidence(CONTACT)
    expect(read).toMatchObject({ ok: true, legacy: { welcomed, batchSeen: true } })
  })

  it('checks every address of the contact and names the campaign once', async () => {
    const contact: ShadowContact = { ...CONTACT, addresses: ['a@example.org', 'b@example.org'] }
    const getCampaignRecipientStatus = vi.fn(async (_key: string, _campaign: string, email: string) =>
      email === 'b@example.org' ? ('sent' as const) : ('not_recipient' as const),
    )
    const { ports } = createShadowGatePorts(
      makeDeps({
        evaluate: mailchimpEvaluate(),
        mailchimp: makeMailchimpPort({ listSentCampaigns: async () => [BATCH], getCampaignRecipientStatus }),
      }),
    )
    const read = await ports.evidence(contact)
    expect(read).toMatchObject({ ok: true, legacy: { welcomed: true, campaignIds: ['camp-batch'] } })
  })

  it('names the campaign once even when the batch mailed several of the contact addresses', async () => {
    const contact: ShadowContact = { ...CONTACT, addresses: ['a@example.org', 'b@example.org'] }
    const getCampaignRecipientStatus = vi.fn(async () => 'sent' as const)
    const { ports } = createShadowGatePorts(
      makeDeps({
        evaluate: mailchimpEvaluate(),
        mailchimp: makeMailchimpPort({ listSentCampaigns: async () => [BATCH], getCampaignRecipientStatus }),
      }),
    )
    const read = await ports.evidence(contact)
    expect(read).toMatchObject({ ok: true, legacy: { welcomed: true, campaignIds: ['camp-batch'] } })
    // once a campaign is known to have mailed the contact, its other addresses are not asked about
    expect(getCampaignRecipientStatus.mock.calls.filter((call) => (call as unknown[])[1] === 'camp-batch')).toHaveLength(1)
  })

  it('needs no API key when there is no batch campaign to check', async () => {
    const { ports } = createShadowGatePorts(
      makeDeps({ mailchimp: makeMailchimpPort({ apiKey: () => undefined }) }),
    )
    expect(await ports.evidence(CONTACT)).toMatchObject({ ok: true, legacy: { welcomed: false } })
  })

  it('asks nothing about a contact without any address, key or not', async () => {
    const getCampaignRecipientStatus = vi.fn(async () => 'sent' as const)
    let keyCalls = 0
    const { ports } = createShadowGatePorts(
      makeDeps({
        evaluate: mailchimpEvaluate(),
        mailchimp: makeMailchimpPort({
          apiKey: () => {
            keyCalls += 1
            return keyCalls === 1 ? 'test-key' : undefined
          },
          listSentCampaigns: async () => [BATCH],
          getCampaignRecipientStatus,
        }),
      }),
    )
    const read = await ports.evidence({ ...CONTACT, primaryEmail: null, addresses: [] })
    expect(read).toMatchObject({ ok: true, legacy: { welcomed: false, batchSeen: true } })
    expect(getCampaignRecipientStatus).not.toHaveBeenCalled()
  })

  it('ignores a batch campaign that went out before the lead came in', async () => {
    const early = campaign({ id: 'camp-early', title: 'Welcome Batch 2026-10-30', sentAt: '2026-10-31T06:00:00.000Z' })
    const getCampaignRecipientStatus = vi.fn(async () => 'sent' as const)
    const { ports } = createShadowGatePorts(
      makeDeps({
        evaluate: mailchimpEvaluate(),
        mailchimp: makeMailchimpPort({ listSentCampaigns: async () => [early], getCampaignRecipientStatus }),
      }),
    )
    const read = await ports.evidence(CONTACT)
    expect(read).toMatchObject({ ok: true, legacy: { welcomed: false, campaignIds: [] } })
    expect(getCampaignRecipientStatus).not.toHaveBeenCalled()
  })

  it('allows ten minutes of clock difference before the lead time, not a millisecond more', async () => {
    const calls: string[] = []
    const status = async (_key: string, campaignId: string) => {
      calls.push(campaignId)
      return 'not_recipient' as const
    }
    const onTime = campaign({ id: 'camp-edge', title: 'Welcome Batch edge', sentAt: '2026-11-01T09:50:00.000Z' })
    const tooEarly = campaign({ id: 'camp-too-early', title: 'Welcome Batch early', sentAt: '2026-11-01T09:49:59.999Z' })
    const { ports } = createShadowGatePorts(
      makeDeps({
        evaluate: mailchimpEvaluate(),
        mailchimp: makeMailchimpPort({ listSentCampaigns: async () => [onTime, tooEarly], getCampaignRecipientStatus: status }),
      }),
    )
    await ports.evidence(CONTACT)
    expect(calls).toEqual(['camp-edge'])
  })

  async function batchSeenFor(sentAt: string, rule: TriggeredSendRule = RULE): Promise<boolean | undefined> {
    const { ports } = createShadowGatePorts(
      makeDeps({
        rule,
        evaluate: mailchimpEvaluate(),
        mailchimp: makeMailchimpPort({
          listSentCampaigns: async () => [campaign({ id: 'camp-t', title: 'Welcome Batch t', sentAt })],
        }),
      }),
    )
    const read = await ports.evidence(CONTACT)
    return read.ok ? read.legacy.batchSeen : undefined
  }

  // The rule's zone is Europe/Berlin (UTC+1 on 2026-11-02): local midnight of that day is 2026-11-01T23:00:00Z.
  it('"the batch has run" means one of its campaigns went out TODAY in the rule time zone, and not in the future', async () => {
    expect(await batchSeenFor('2026-11-01T23:00:00.000Z')).toBe(true) // the first moment of today
    expect(await batchSeenFor('2026-11-01T22:59:59.999Z')).toBe(false) // the last moment of yesterday
    expect(await batchSeenFor('2026-11-02T08:00:00.000Z')).toBe(true) // sent at this very moment
    expect(await batchSeenFor('2026-11-02T08:00:00.001Z')).toBe(false) // dated in the future: not trusted
  })

  it('judges "today" in the rule time zone, not in UTC', async () => {
    const auckland: TriggeredSendRule = { ...RULE, schedule: { timezone: 'Pacific/Auckland' } }
    // NOW is 21:00 on 2026-11-02 in Auckland (UTC+13); that day began at 2026-11-01T11:00:00Z
    expect(await batchSeenFor('2026-11-01T11:00:00.000Z', auckland)).toBe(true)
    expect(await batchSeenFor('2026-11-01T10:59:59.999Z', auckland)).toBe(false)
  })

  it('an unusable time zone means the batch can never be called seen', async () => {
    const broken: TriggeredSendRule = { ...RULE, schedule: { timezone: 'Not/AZone' } }
    expect(await batchSeenFor('2026-11-02T06:00:00.000Z', broken)).toBe(false)
  })

  it('does not trip over a campaign with an unreadable send time', async () => {
    const odd = campaign({ id: 'camp-odd', title: 'Welcome Batch odd', sentAt: 'not-a-date' })
    const none = campaign({ id: 'camp-none', title: 'Welcome Batch none', sentAt: null })
    const getCampaignRecipientStatus = vi.fn(async () => 'sent' as const)
    const { ports } = createShadowGatePorts(
      makeDeps({
        evaluate: mailchimpEvaluate(),
        mailchimp: makeMailchimpPort({ listSentCampaigns: async () => [odd, none], getCampaignRecipientStatus }),
      }),
    )
    const read = await ports.evidence(CONTACT)
    expect(read).toMatchObject({ ok: true, legacy: { welcomed: false, batchSeen: false } })
    expect(getCampaignRecipientStatus).not.toHaveBeenCalled()
  })

  it('a campaign whose title merely CONTAINS the prefix is not the batch', async () => {
    const lookalike = campaign({ id: 'camp-like', title: 'Our Welcome Batch story', sentAt: '2026-11-02T06:00:00.000Z' })
    const { ports } = createShadowGatePorts(
      makeDeps({
        evaluate: mailchimpEvaluate(),
        mailchimp: makeMailchimpPort({
          listSentCampaigns: async () => [lookalike],
          getCampaignRecipientStatus: async () => 'sent',
        }),
      }),
    )
    const read = await ports.evidence(CONTACT)
    expect(read).toMatchObject({ ok: true, legacy: { welcomed: false, batchSeen: false } })
    if (read.ok) expect(read.items.map((i) => i.id)).toEqual(['mc:camp-like:lead@example.org'])
  })

  it('still refuses a full page of campaigns, counted before the batch ones are taken out', async () => {
    const page = (batchCount: number, total: number): MailchimpCampaign[] =>
      Array.from({ length: total }, (_, i) =>
        campaign({
          id: `camp-${i}`,
          title: i < batchCount ? `Welcome Batch ${i}` : `Newsletter ${i}`,
          sentAt: '2026-11-01T06:00:00.000Z',
        }),
      )
    async function readWith(campaigns: MailchimpCampaign[]) {
      const { ports } = createShadowGatePorts(
        makeDeps({
          evaluate: mailchimpEvaluate(),
          mailchimp: makeMailchimpPort({ listSentCampaigns: async () => campaigns }),
        }),
      )
      return ports.evidence(CONTACT)
    }
    // 100 returned (10 of them the batch): the API may have more that we did not see
    expect(await readWith(page(10, 100))).toEqual({
      ok: false,
      error: 'too many Mailchimp campaigns in the window to check them all',
    })
    // 99 returned: complete
    expect((await readWith(page(10, 99))).ok).toBe(true)
  })

  it('fails the read (does not guess) when the batch report cannot be read', async () => {
    const { ports } = createShadowGatePorts(
      makeDeps({
        evaluate: mailchimpEvaluate(),
        mailchimp: makeMailchimpPort({
          listSentCampaigns: async () => [BATCH],
          getCampaignRecipientStatus: async (_key, campaignId) => {
            if (campaignId === 'camp-batch') throw new Error('mailchimp 503')
            return 'not_recipient'
          },
        }),
      }),
    )
    expect(await ports.evidence(CONTACT)).toEqual({ ok: false, error: 'mailchimp 503' })
  })

  it('fails the read when there is a batch to check but no API key', async () => {
    let keyCalls = 0
    const { ports } = createShadowGatePorts(
      makeDeps({
        // the evidence source reads the key first (it must succeed to list the campaigns); the batch check reads it again
        evaluate: mailchimpEvaluate(),
        mailchimp: makeMailchimpPort({
          apiKey: () => {
            keyCalls += 1
            return keyCalls === 1 ? 'test-key' : undefined
          },
          listSentCampaigns: async () => [BATCH],
        }),
      }),
    )
    expect(await ports.evidence(CONTACT)).toEqual({ ok: false, error: 'MAILCHIMP_API_KEY is not set' })
  })

  it('legacyBatches lists only title-prefix campaigns, sorted by sentAt then id, nulls last', async () => {
    const listSentCampaigns = vi.fn(async (): Promise<MailchimpCampaign[]> => [
      campaign({ id: 'b-late', title: 'Welcome Batch 2026-10-20', sentAt: '2026-10-20T09:00:00.000Z', emailsSent: 10 }),
      campaign({ id: 'b-null', title: 'Welcome Batch (unsent)', sentAt: null, emailsSent: 0 }),
      campaign({ id: 'b-early', title: 'Welcome Batch 2026-10-10', sentAt: '2026-10-10T09:00:00.000Z', emailsSent: 5 }),
      campaign({ id: 'b-twin', title: 'Welcome Batch 2026-10-10 b', sentAt: '2026-10-10T09:00:00.000Z', emailsSent: 6 }),
      campaign({ id: 'n-1', title: 'Newsletter', sentAt: '2026-10-01T09:00:00.000Z', emailsSent: 1 }),
    ])
    const { ports, legacyBatches } = createShadowGatePorts(
      makeDeps({ evaluate: mailchimpEvaluate(), mailchimp: makeMailchimpPort({ listSentCampaigns }) }),
    )
    await ports.evidence(CONTACT)
    expect(legacyBatches()).toEqual([
      { campaignId: 'b-early', title: 'Welcome Batch 2026-10-10', sentAt: '2026-10-10T09:00:00.000Z', emailsSent: 5 },
      { campaignId: 'b-twin', title: 'Welcome Batch 2026-10-10 b', sentAt: '2026-10-10T09:00:00.000Z', emailsSent: 6 },
      { campaignId: 'b-late', title: 'Welcome Batch 2026-10-20', sentAt: '2026-10-20T09:00:00.000Z', emailsSent: 10 },
      { campaignId: 'b-null', title: 'Welcome Batch (unsent)', sentAt: null, emailsSent: 0 },
    ])
  })
})

// ── the mailbox ───────────────────────────────────────────────────────────────────────────────────────

describe('mailbox pages are read once per ports object', () => {
  const page = { ok: true as const, json: { value: [] } }
  const boxes = async () => [{ connectionId: 'conn-1', account: 'sales@example.org' }]

  it('reads the same page once for two contacts', async () => {
    const graphGetPage = vi.fn(async () => page)
    const { ports } = createShadowGatePorts(
      makeDeps({ evaluate: sentItemsEvaluate(), listActiveMailboxes: boxes, graphGetPage }),
    )
    expect((await ports.evidence(CONTACT)).ok).toBe(true)
    expect((await ports.evidence({ ...CONTACT, contactId: 'c-2' })).ok).toBe(true)
    expect(graphGetPage).toHaveBeenCalledTimes(1)
  })

  it('keeps the pages of two mailboxes apart', async () => {
    const graphGetPage = vi.fn(async (_connectionId: string, _path: string) => page)
    const twoBoxes = async () => [
      { connectionId: 'conn-1', account: 'sales@example.org' },
      { connectionId: 'conn-2', account: 'other@example.org' },
    ]
    const { ports } = createShadowGatePorts(
      makeDeps({ evaluate: sentItemsEvaluate(), listActiveMailboxes: twoBoxes, graphGetPage }),
    )
    expect((await ports.evidence(CONTACT)).ok).toBe(true)
    expect(graphGetPage.mock.calls.map((call) => call[0]).sort()).toEqual(['conn-1', 'conn-2'])
  })

  it('does not keep a failed read: the next contact tries the page again', async () => {
    const graphGetPage = vi
      .fn()
      .mockResolvedValueOnce({ ok: false as const, error: 'graph down' })
      .mockResolvedValue(page)
    const { ports } = createShadowGatePorts(
      makeDeps({ evaluate: sentItemsEvaluate(), listActiveMailboxes: boxes, graphGetPage }),
    )
    expect(await ports.evidence(CONTACT)).toMatchObject({ ok: false })
    expect((await ports.evidence({ ...CONTACT, contactId: 'c-2' })).ok).toBe(true)
    expect(graphGetPage).toHaveBeenCalledTimes(2)
  })

  it('does not keep a rejected read either', async () => {
    const graphGetPage = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(page)
    const { ports } = createShadowGatePorts(
      makeDeps({ evaluate: sentItemsEvaluate(), listActiveMailboxes: boxes, graphGetPage }),
    )
    expect(await ports.evidence(CONTACT)).toMatchObject({ ok: false })
    expect((await ports.evidence({ ...CONTACT, contactId: 'c-2' })).ok).toBe(true)
    expect(graphGetPage).toHaveBeenCalledTimes(2)
  })
})

describe('slow answers are cut off', () => {
  it('gives up on the Mailchimp member lookup after 10 seconds', async () => {
    vi.useFakeTimers()
    try {
      const { ports } = createShadowGatePorts(makeDeps({ findMember: () => new Promise(() => undefined) }))
      const read = ports.member('lead@example.org')
      await vi.advanceTimersByTimeAsync(9_999)
      let settled = false
      void read.then(() => {
        settled = true
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(2)
      expect(await read).toEqual({ ok: false, error: 'Mailchimp member lookup timed out' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives up on the old-batch check after 10 seconds', async () => {
    vi.useFakeTimers()
    try {
      const BATCH = campaign({ id: 'camp-batch', title: 'Welcome Batch 2026-11-02', sentAt: '2026-11-02T06:00:00.000Z' })
      const { ports } = createShadowGatePorts(
        makeDeps({
          evaluate: mailchimpEvaluate(),
          mailchimp: makeMailchimpPort({
            listSentCampaigns: async () => [BATCH],
            getCampaignRecipientStatus: () => new Promise(() => undefined),
          }),
        }),
      )
      const read = ports.evidence(CONTACT)
      await vi.advanceTimersByTimeAsync(9_999)
      let settled = false
      void read.then(() => {
        settled = true
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(2)
      expect(await read).toEqual({ ok: false, error: 'old-batch check timed out' })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the required mailbox must still be connected when the sent items are read', () => {
  const page = { ok: true as const, json: { value: [] } }

  it('fails the read (it does not read "less") when a required mailbox dropped out', async () => {
    const graphGetPage = vi.fn(async () => page)
    const { ports } = createShadowGatePorts(
      makeDeps({
        evaluate: sentItemsEvaluate(),
        listActiveMailboxes: async () => [{ connectionId: 'conn-9', account: 'someone-else@example.org' }],
        graphGetPage,
      }),
    )
    const read = await ports.evidence(CONTACT)
    expect(read.ok).toBe(false)
    if (!read.ok) {
      expect(read.error).toContain('required mailbox')
      expect(read.error).not.toContain('sales@example.org') // no mailbox address travels into plans and logs
    }
    expect(graphGetPage).not.toHaveBeenCalled()
  })

  it('compares the mailbox names ignoring case and spaces', async () => {
    const { ports } = createShadowGatePorts(
      makeDeps({
        evaluate: sentItemsEvaluate(),
        listActiveMailboxes: async () => [{ connectionId: 'conn-1', account: ' SALES@Example.org ' }],
        graphGetPage: async () => page,
      }),
    )
    expect((await ports.evidence(CONTACT)).ok).toBe(true)
  })
})
