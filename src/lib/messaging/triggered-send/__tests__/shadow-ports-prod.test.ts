import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { ManualSendDncGate } from '@/lib/crm/manual-send-dnc-gate'
import type { AudienceIdRead } from '@/lib/mailchimp/audience-config'
import type { FindMemberResult } from '@/lib/mailchimp/tags'
import type { MailchimpCampaign } from '@/lib/mailchimp/client'
import type { MailchimpPort } from '@/lib/crm/email-templates/frequency-sources-prod'
import type {
  FrequencySources,
  FrequencyVerdict,
  OutboundItem,
} from '@/lib/crm/email-templates/gates/types'

import type { TriggeredSendRule } from '../rule'
import type { ShadowContact } from '../types'
import { createShadowGatePorts, type ShadowPortsDeps } from '../shadow-ports-prod'

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────────────

const RULE: TriggeredSendRule = {
  gate_contract_version: 1,
  audience: { sources: ['meta_lead_form'], max_age_days: 7, min_age: 'previous_local_day' },
  schedule: { timezone: 'Europe/Berlin' },
  frequency_cap: { max: 2, window_days: 14 },
  consent: { accepted_bases: ['marketing'] },
  legacy: { mailchimp_campaign_title_prefix: 'Welcome Batch' },
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

function makeMailchimpPort(overrides: Partial<MailchimpPort> = {}): MailchimpPort {
  return {
    apiKey: () => 'test-key',
    readAudience: async (): Promise<AudienceIdRead> => ({ ok: true, audienceId: 'aud-1' }),
    listSentCampaigns: async (): Promise<MailchimpCampaign[]> => [],
    getCampaignRecipientStatus: async () => 'not_recipient',
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
    checkDnc: async (): Promise<ManualSendDncGate> => ({ blocked: false }),
    mailchimp: makeMailchimpPort(),
    findMember: async (): Promise<FindMemberResult> => ({ status: 'not_in_audience' }),
    evaluate: async (): Promise<FrequencyVerdict> => ({ ok: true, count: 0, items: [] }),
    ...overrides,
  }
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
    const { ports } = createShadowGatePorts(
      makeDeps({ db: db as never }),
    )
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
    const { ports } = createShadowGatePorts(
      makeDeps({ db: db as never }),
    )
    expect(await ports.consent('c-1')).toEqual({ ok: true, bases: [], sourceRef: null })
  })

  it('returns null sourceRef when the first row has no usable source_ref', async () => {
    const db = makeFakeDb({
      data: [{ source_ref: '', metadata: { consent_basis: 'marketing' }, occurred_at: 't1' }],
      error: null,
    })
    const { ports } = createShadowGatePorts(
      makeDeps({ db: db as never }),
    )
    expect(await ports.consent('c-1')).toEqual({
      ok: true,
      bases: ['marketing'],
      sourceRef: null,
    })
  })

  it('turns a query error into ok:false', async () => {
    const db = makeFakeDb({ data: null, error: { message: 'boom' } })
    const { ports } = createShadowGatePorts(
      makeDeps({ db: db as never }),
    )
    expect(await ports.consent('c-1')).toEqual({ ok: false, error: 'boom' })
  })

  it('turns a thrown error into ok:false', async () => {
    const db = {
      from: vi.fn(() => {
        throw new Error('kaboom')
      }),
    }
    const { ports } = createShadowGatePorts(
      makeDeps({ db: db as never }),
    )
    expect(await ports.consent('c-1')).toEqual({ ok: false, error: 'kaboom' })
  })
})

// ── dnc ────────────────────────────────────────────────────────────────────────────────────────────────

describe('dnc port', () => {
  it('maps not blocked', async () => {
    const { ports } = createShadowGatePorts(
      makeDeps({ checkDnc: async () => ({ blocked: false }) }),
    )
    expect(await ports.dnc('c-1')).toEqual({ ok: true, blocked: false })
  })

  it('maps do_not_contact to blocked', async () => {
    const { ports } = createShadowGatePorts(
      makeDeps({
        checkDnc: async () => ({
          blocked: true,
          status: 403,
          reason: 'do_not_contact',
          error: 'on the list',
        }),
      }),
    )
    expect(await ports.dnc('c-1')).toEqual({ ok: true, blocked: true })
  })

  it('maps dnc_check_failed to ok:false', async () => {
    const { ports } = createShadowGatePorts(
      makeDeps({
        checkDnc: async () => ({
          blocked: true,
          status: 503,
          reason: 'dnc_check_failed',
          error: 'lookup failed',
        }),
      }),
    )
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

// ── member ────────────────────────────────────────────────────────────────────────────────────────────

describe('member port', () => {
  it('reads the audience only once for two calls', async () => {
    const readAudience = vi.fn(
      async (): Promise<AudienceIdRead> => ({ ok: true, audienceId: 'aud-1' }),
    )
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
    expect(await ports.member('lead@example.org')).toEqual({ ok: true, state: 'suppressed' })
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
    expect(await ports.member('lead@example.org')).toEqual({ ok: true, state: 'active' })
  })

  it('maps not_in_audience', async () => {
    const { ports } = createShadowGatePorts(
      makeDeps({ findMember: async () => ({ status: 'not_in_audience' }) }),
    )
    expect(await ports.member('lead@example.org')).toEqual({
      ok: true,
      state: 'not_in_audience',
    })
  })

  it('maps a findMember error to ok:false with the reason', async () => {
    const { ports } = createShadowGatePorts(
      makeDeps({
        findMember: async () => ({ status: 'error', reason: 'rate limited', retryable: true }),
      }),
    )
    expect(await ports.member('lead@example.org')).toEqual({ ok: false, error: 'rate limited' })
  })

  it('returns not_applicable when the client has no audience', async () => {
    const { ports } = createShadowGatePorts(
      makeDeps({
        mailchimp: makeMailchimpPort({
          readAudience: async () => ({ ok: true, audienceId: '' }),
        }),
      }),
    )
    expect(await ports.member('lead@example.org')).toEqual({
      ok: true,
      state: 'not_applicable',
    })
  })

  it('returns ok:false when the audience read fails', async () => {
    const { ports } = createShadowGatePorts(
      makeDeps({
        mailchimp: makeMailchimpPort({
          readAudience: async () => ({ ok: false, message: 'no config' }),
        }),
      }),
    )
    expect(await ports.member('lead@example.org')).toEqual({
      ok: false,
      error: 'audience: no config',
    })
  })

  it('returns ok:false when the API key is missing', async () => {
    const { ports } = createShadowGatePorts(
      makeDeps({ mailchimp: makeMailchimpPort({ apiKey: () => undefined }) }),
    )
    expect(await ports.member('lead@example.org')).toEqual({
      ok: false,
      error: 'MAILCHIMP_API_KEY is not set',
    })
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

  it('passes the unreachable cap, addresses, contactId and now to evaluate', async () => {
    const evaluate = vi.fn(
      async (_args: {
        cap: { max: number; windowDays: number }
        now: Date
        addresses: readonly string[]
        contactId: string
      }): Promise<FrequencyVerdict> => ({ ok: true, count: 0, items: [] }),
    )
    const { ports } = createShadowGatePorts(makeDeps({ evaluate: evaluate as never }))
    await ports.evidence(CONTACT)
    expect(evaluate).toHaveBeenCalledTimes(1)
    const arg = evaluate.mock.calls[0][0]
    expect(arg.cap).toEqual({ max: Number.MAX_SAFE_INTEGER, windowDays: RULE.frequency_cap.window_days })
    expect(arg.addresses).toEqual(CONTACT.addresses)
    expect(arg.contactId).toBe(CONTACT.contactId)
    expect(arg.now).toBe(NOW)
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
      async (): Promise<FrequencyVerdict> => ({
        ok: false,
        reason: 'frequency_unverifiable',
        error: 'graph down',
      }),
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

  it('classifies legacy batch items by campaign id', async () => {
    const batchCampaignId = 'camp-batch'
    const otherCampaignId = 'camp-other'
    const items: OutboundItem[] = [
      item({ source: 'mailchimp', id: `mc:${batchCampaignId}:lead@example.org` }),
      item({ source: 'mailchimp', id: `mc:${otherCampaignId}:lead@example.org` }),
      item({ source: 'sent_items', id: `mc:${batchCampaignId}:lead@example.org` }),
    ]
    // evaluate calls the wrapped listSentCampaigns so the batch campaign is remembered
    const evaluate = vi.fn(
      async (args: {
        sources: FrequencySources
      }): Promise<FrequencyVerdict> => {
        await args.sources.mailchimp(['lead@example.org'], '2026-10-26T00:00:00.000Z')
        return { ok: true, count: items.length, items }
      },
    )
    const listSentCampaigns = vi.fn(
      async (): Promise<MailchimpCampaign[]> => [
        {
          id: batchCampaignId,
          title: 'Welcome Batch 2026-10-15',
          subject: 'welcome',
          sentAt: '2026-10-15T09:00:00.000Z',
          emailsSent: 100,
          opens: 0,
          uniqueOpens: 0,
          clicks: 0,
          openRate: 0,
          clickRate: 0,
        },
        {
          id: otherCampaignId,
          title: 'Newsletter',
          subject: 'news',
          sentAt: '2026-10-20T09:00:00.000Z',
          emailsSent: 200,
          opens: 0,
          uniqueOpens: 0,
          clicks: 0,
          openRate: 0,
          clickRate: 0,
        },
      ],
    )
    const { ports } = createShadowGatePorts(
      makeDeps({
        evaluate: evaluate as never,
        mailchimp: makeMailchimpPort({ listSentCampaigns }),
      }),
    )
    const read = await ports.evidence(CONTACT)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.isLegacyBatchItem(items[0])).toBe(true)
    expect(read.isLegacyBatchItem(items[1])).toBe(false)
    expect(read.isLegacyBatchItem(items[2])).toBe(false)
  })

  it('memoises listSentCampaigns and retries after a rejection', async () => {
    let calls = 0
    const listSentCampaigns = vi.fn(async (): Promise<MailchimpCampaign[]> => {
      calls += 1
      if (calls === 1) throw new Error('transient')
      return []
    })
    // Like the real evaluateFrequency: a failing source makes the whole verdict unverifiable.
    const evaluate = vi.fn(
      async (args: { sources: FrequencySources }): Promise<FrequencyVerdict> => {
        const res = await args.sources.mailchimp(['lead@example.org'], '2026-10-26T00:00:00.000Z')
        if (!res.ok) return { ok: false, reason: 'frequency_unverifiable', error: res.error }
        return { ok: true, count: 0, items: [] }
      },
    )
    const { ports } = createShadowGatePorts(
      makeDeps({
        evaluate: evaluate as never,
        mailchimp: makeMailchimpPort({ listSentCampaigns }),
      }),
    )
    // first call rejects
    await expect(ports.evidence(CONTACT)).resolves.toEqual({ ok: false, error: 'transient' })
    // second call retries and succeeds
    await expect(ports.evidence(CONTACT)).resolves.toEqual({
      ok: true,
      items: [],
      isLegacyBatchItem: expect.any(Function),
    })
    // third call is memoised
    await ports.evidence(CONTACT)
    expect(listSentCampaigns).toHaveBeenCalledTimes(2)
  })

  it('legacyBatches lists only title-prefix campaigns, sorted by sentAt then id', async () => {
    const listSentCampaigns = vi.fn(
      async (): Promise<MailchimpCampaign[]> => [
        {
          id: 'b-late',
          title: 'Welcome Batch 2026-10-20',
          subject: 'w',
          sentAt: '2026-10-20T09:00:00.000Z',
          emailsSent: 10,
          opens: 0,
          uniqueOpens: 0,
          clicks: 0,
          openRate: 0,
          clickRate: 0,
        },
        {
          id: 'b-null',
          title: 'Welcome Batch (unsent)',
          subject: 'w',
          sentAt: null,
          emailsSent: 0,
          opens: 0,
          uniqueOpens: 0,
          clicks: 0,
          openRate: 0,
          clickRate: 0,
        },
        {
          id: 'b-early',
          title: 'Welcome Batch 2026-10-10',
          subject: 'w',
          sentAt: '2026-10-10T09:00:00.000Z',
          emailsSent: 5,
          opens: 0,
          uniqueOpens: 0,
          clicks: 0,
          openRate: 0,
          clickRate: 0,
        },
        {
          id: 'n-1',
          title: 'Newsletter',
          subject: 'n',
          sentAt: '2026-10-01T09:00:00.000Z',
          emailsSent: 1,
          opens: 0,
          uniqueOpens: 0,
          clicks: 0,
          openRate: 0,
          clickRate: 0,
        },
      ],
    )
    const evaluate = vi.fn(
      async (args: { sources: FrequencySources }): Promise<FrequencyVerdict> => {
        await args.sources.mailchimp(['lead@example.org'], '2026-10-26T00:00:00.000Z')
        return { ok: true, count: 0, items: [] }
      },
    )
    const { ports, legacyBatches } = createShadowGatePorts(
      makeDeps({
        evaluate: evaluate as never,
        mailchimp: makeMailchimpPort({ listSentCampaigns }),
      }),
    )
    await ports.evidence(CONTACT)
    expect(legacyBatches()).toEqual([
      {
        campaignId: 'b-early',
        title: 'Welcome Batch 2026-10-10',
        sentAt: '2026-10-10T09:00:00.000Z',
        emailsSent: 5,
      },
      {
        campaignId: 'b-late',
        title: 'Welcome Batch 2026-10-20',
        sentAt: '2026-10-20T09:00:00.000Z',
        emailsSent: 10,
      },
      {
        campaignId: 'b-null',
        title: 'Welcome Batch (unsent)',
        sentAt: null,
        emailsSent: 0,
      },
    ])
  })
})

describe('added after the mutation probe', () => {
  it('does not treat a mailchimp item without the mc: id prefix as a batch item', async () => {
    const items: OutboundItem[] = [item({ source: 'mailchimp', id: 'foocamp-batch:lead@example.org' })]
    const evaluate = vi.fn(async (args: { sources: FrequencySources }): Promise<FrequencyVerdict> => {
      await args.sources.mailchimp(['lead@example.org'], '2026-10-26T00:00:00.000Z')
      return { ok: true, count: 1, items }
    })
    const listSentCampaigns = vi.fn(
      async (): Promise<MailchimpCampaign[]> => [
        {
          id: 'camp-batch',
          title: 'Welcome Batch 2026-10-15',
          subject: 's',
          sentAt: '2026-10-15T09:00:00.000Z',
          emailsSent: 1,
          opens: 0,
          uniqueOpens: 0,
          clicks: 0,
          openRate: 0,
          clickRate: 0,
        },
      ],
    )
    const { ports } = createShadowGatePorts(
      makeDeps({ evaluate: evaluate as never, mailchimp: makeMailchimpPort({ listSentCampaigns }) }),
    )
    const read = await ports.evidence(CONTACT)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.isLegacyBatchItem(items[0])).toBe(false)
  })

  it('treats an empty API key like a missing one', async () => {
    const { ports } = createShadowGatePorts(
      makeDeps({ mailchimp: makeMailchimpPort({ apiKey: () => '' }) }),
    )
    expect(await ports.member('lead@example.org')).toEqual({
      ok: false,
      error: 'MAILCHIMP_API_KEY is not set',
    })
  })
})

describe('mailbox pages are read once per ports object', () => {
  function sentItemsEvaluate() {
    // Like the real evaluateFrequency: it asks the sent-items source of every contact with the same window.
    return vi.fn(async (args: { sources: FrequencySources; addresses: readonly string[] }): Promise<FrequencyVerdict> => {
      const res = await args.sources.sentItems(args.addresses, '2026-10-26T00:00:00.000Z')
      if (!res.ok) return { ok: false, reason: 'frequency_unverifiable', error: res.error }
      return { ok: true, count: res.items.length, items: res.items }
    })
  }
  const page = { ok: true as const, json: { value: [] } }
  const boxes = async () => [{ connectionId: 'conn-1', account: 'sales@example.com' }]

  it('reads the same page once for two contacts', async () => {
    const graphGetPage = vi.fn(async () => page)
    const { ports } = createShadowGatePorts(
      makeDeps({ evaluate: sentItemsEvaluate() as never, listActiveMailboxes: boxes, graphGetPage }),
    )
    expect((await ports.evidence(CONTACT)).ok).toBe(true)
    expect((await ports.evidence({ ...CONTACT, contactId: 'c-2' })).ok).toBe(true)
    expect(graphGetPage).toHaveBeenCalledTimes(1)
  })

  it('does not keep a failed read: the next contact tries the page again', async () => {
    const graphGetPage = vi
      .fn()
      .mockResolvedValueOnce({ ok: false as const, error: 'graph down' })
      .mockResolvedValue(page)
    const { ports } = createShadowGatePorts(
      makeDeps({ evaluate: sentItemsEvaluate() as never, listActiveMailboxes: boxes, graphGetPage }),
    )
    expect(await ports.evidence(CONTACT)).toMatchObject({ ok: false })
    expect((await ports.evidence({ ...CONTACT, contactId: 'c-2' })).ok).toBe(true)
    expect(graphGetPage).toHaveBeenCalledTimes(2)
  })

  it('does not keep a rejected read either', async () => {
    const graphGetPage = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(page)
    const { ports } = createShadowGatePorts(
      makeDeps({ evaluate: sentItemsEvaluate() as never, listActiveMailboxes: boxes, graphGetPage }),
    )
    expect(await ports.evidence(CONTACT)).toMatchObject({ ok: false })
    expect((await ports.evidence({ ...CONTACT, contactId: 'c-2' })).ok).toBe(true)
    expect(graphGetPage).toHaveBeenCalledTimes(2)
  })
})
