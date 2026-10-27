import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

import {
  createFrequencySources,
  messageIdOfAudit,
  type FrequencySourceDeps,
  type MailchimpPort,
} from '@/lib/crm/email-templates/frequency-sources-prod'
import { createQueryStub, fail, ok } from './query-stub'

const CLIENT = 'client-1'
const SINCE = '2026-10-21T00:00:00.000Z'

function graphPage(
  messages: Array<{ id: string; at: string; to?: string[]; cc?: string[]; bcc?: string[]; subject?: string }>,
  next?: string,
): unknown {
  const wrap = (list: string[] = []) => list.map((address) => ({ emailAddress: { address } }))
  return {
    value: messages.map((m) => ({
      id: m.id,
      sentDateTime: m.at,
      subject: m.subject ?? 'Following up',
      toRecipients: wrap(m.to),
      ccRecipients: wrap(m.cc),
      bccRecipients: wrap(m.bcc),
    })),
    ...(next ? { '@odata.nextLink': next } : {}),
  }
}

function deps(over: Partial<FrequencySourceDeps> & { tables?: Parameters<typeof createQueryStub>[0] } = {}) {
  const stub = createQueryStub(over.tables ?? {})
  const value: FrequencySourceDeps = {
    db: stub.db,
    clientId: CLIENT,
    listActiveMailboxes: async () => [],
    graphGetPage: async () => ({ ok: true, json: graphPage([]) }),
    ...over,
  }
  return { stub, value }
}

describe('messageIdOfAudit', () => {
  it('reads the Graph id out of the audit marker', () => {
    expect(messageIdOfAudit('req:abc|msg:AAMk123=')).toBe('AAMk123=')
    expect(messageIdOfAudit('req:abc|draft:DRAFT9')).toBe('DRAFT9')
  })
  it('is null when the row has no Graph id yet', () => {
    expect(messageIdOfAudit('req:abc')).toBeNull()
    expect(messageIdOfAudit(null)).toBeNull()
  })
})

describe('sent-items source', () => {
  it('fails closed when no mailbox is connected', async () => {
    const { value } = deps()
    const res = await createFrequencySources(value).sentItems(['guest@example.com'], SINCE)
    expect(res.ok).toBe(false)
  })

  it('unions the matching messages of every connected mailbox', async () => {
    const seen: string[] = []
    const { value } = deps({
      listActiveMailboxes: async () => [
        { connectionId: 'conn-a', account: 'a@cts.example' },
        { connectionId: 'conn-b', account: 'b@cts.example' },
      ],
      graphGetPage: async (connectionId) => {
        seen.push(connectionId)
        const id = connectionId === 'conn-a' ? 'MSG-A' : 'MSG-B'
        return { ok: true, json: graphPage([{ id, at: '2026-10-25T01:00:00Z', cc: ['Guest@Example.com'] }]) }
      },
    })
    const res = await createFrequencySources(value).sentItems(['guest@example.com'], SINCE)
    expect(seen).toEqual(['conn-a', 'conn-b'])
    expect(res.ok && res.items.map((i) => i.id)).toEqual(['MSG-A', 'MSG-B'])
  })

  it('fails closed (naming the mailbox) when one mailbox cannot be read', async () => {
    const { value } = deps({
      listActiveMailboxes: async () => [
        { connectionId: 'conn-a', account: 'a@cts.example' },
        { connectionId: 'conn-b', account: 'b@cts.example' },
      ],
      graphGetPage: async (connectionId) =>
        connectionId === 'conn-a' ? { ok: true, json: graphPage([]) } : { ok: false, error: 'HTTP 503' },
    })
    const res = await createFrequencySources(value).sentItems(['guest@example.com'], SINCE)
    expect(res.ok).toBe(false)
    expect(!res.ok && res.error).toContain('b@cts.example')
  })

  it('turns a thrown error into a failed source, never into zero', async () => {
    const { value } = deps({
      listActiveMailboxes: async () => {
        throw new Error('db down')
      },
    })
    const res = await createFrequencySources(value).sentItems(['guest@example.com'], SINCE)
    expect(res).toEqual({ ok: false, error: 'db down' })
  })
})

describe('audit source', () => {
  it('fails closed when the conversations cannot be read', async () => {
    const { value } = deps({ tables: { conversations: fail('boom') } })
    const res = await createFrequencySources(value).audit('contact-1', SINCE)
    expect(res.ok).toBe(false)
    expect(!res.ok && res.error).toContain('conversations')
  })

  it('answers zero without touching the log when the contact has no email conversation', async () => {
    const { stub, value } = deps({ tables: { conversations: ok([]) } })
    const res = await createFrequencySources(value).audit('contact-1', SINCE)
    expect(res).toEqual({ ok: true, items: [] })
    expect(stub.touched('conversation_outbound_log')).toBe(false)
  })

  it('maps pending and sent audit rows into contact-scoped items', async () => {
    const { stub, value } = deps({
      tables: {
        conversations: ok([{ id: 'conv-1' }, { id: 'conv-2' }]),
        conversation_outbound_log: ok([
          { id: 'a1', meta_message_id: 'req:r1|msg:AAMk1', created_at: '2026-10-25T02:00:00Z' },
          { id: 'a2', meta_message_id: 'req:r2', created_at: '2026-10-26T02:00:00Z' },
        ]),
      },
    })
    const res = await createFrequencySources(value).audit('contact-1', SINCE)
    expect(res.ok && res.items).toEqual([
      { source: 'audit', id: 'AAMk1', at: '2026-10-25T02:00:00Z', subject: null, address: '' },
      { source: 'audit', id: null, at: '2026-10-26T02:00:00Z', subject: null, address: '' },
    ])
    const convos = stub.of('conversations')
    expect(convos).toContainEqual({ table: 'conversations', method: 'eq', args: ['client_id', CLIENT] })
    expect(convos).toContainEqual({ table: 'conversations', method: 'eq', args: ['contact_id', 'contact-1'] })
    expect(convos).toContainEqual({ table: 'conversations', method: 'eq', args: ['channel', 'email'] })
    const log = stub.of('conversation_outbound_log')
    expect(log).toContainEqual({ table: 'conversation_outbound_log', method: 'eq', args: ['client_id', CLIENT] })
    expect(log).toContainEqual({ table: 'conversation_outbound_log', method: 'in', args: ['conversation_id', ['conv-1', 'conv-2']] })
    expect(log).toContainEqual({ table: 'conversation_outbound_log', method: 'in', args: ['status', ['pending', 'sent']] })
    expect(log).toContainEqual({ table: 'conversation_outbound_log', method: 'gte', args: ['created_at', SINCE] })
  })

  it('fails closed when the log cannot be read', async () => {
    const { value } = deps({ tables: { conversations: ok([{ id: 'conv-1' }]), conversation_outbound_log: fail('timeout') } })
    const res = await createFrequencySources(value).audit('contact-1', SINCE)
    expect(res.ok).toBe(false)
  })
})

describe('touchpoint source', () => {
  it('fails closed when the touchpoints cannot be read', async () => {
    const { value } = deps({ tables: { contact_touchpoints: fail('boom') } })
    const res = await createFrequencySources(value).touchpoints('contact-1', SINCE)
    expect(res.ok).toBe(false)
  })

  it('counts outbound email touchpoints but not automated replies', async () => {
    const { stub, value } = deps({
      tables: {
        contact_touchpoints: ok([
          { source_ref: 'M1', occurred_at: '2026-10-25T03:00:00Z', metadata: {} },
          { source_ref: 'M2', occurred_at: '2026-10-25T04:00:00Z', metadata: { automated: true } },
          { source_ref: null, occurred_at: '2026-10-26T04:00:00Z', metadata: null },
        ]),
      },
    })
    const res = await createFrequencySources(value).touchpoints('contact-1', SINCE)
    expect(res.ok && res.items.map((i) => i.id)).toEqual(['M1', null])
    const calls = stub.of('contact_touchpoints')
    expect(calls).toContainEqual({ table: 'contact_touchpoints', method: 'eq', args: ['channel', 'email'] })
    expect(calls).toContainEqual({ table: 'contact_touchpoints', method: 'eq', args: ['direction', 'outbound'] })
    expect(calls).toContainEqual({ table: 'contact_touchpoints', method: 'eq', args: ['client_id', CLIENT] })
  })
})

describe('mailchimp source', () => {
  function port(over: Partial<MailchimpPort> = {}): MailchimpPort {
    return {
      apiKey: () => 'key-us1',
      readAudience: async () => ({ ok: true, audienceId: 'aud-1' }),
      listSentCampaigns: async () => [],
      getCampaignRecipientStatus: async () => 'not_recipient',
      ...over,
    }
  }
  const campaign = (id: string, sentAt: string | null) => ({
    id,
    title: id,
    subject: `Subject ${id}`,
    sentAt,
    emailsSent: 1,
    opens: 0,
    uniqueOpens: 0,
    clicks: 0,
    openRate: 0,
    clickRate: 0,
  })

  it('fails closed when the audience setting cannot be read', async () => {
    const { value } = deps({ mailchimp: port({ readAudience: async () => ({ ok: false, message: 'no row' }) }) })
    const res = await createFrequencySources(value).mailchimp(['guest@example.com'], SINCE)
    expect(res.ok).toBe(false)
    expect(!res.ok && res.error).toContain('no row')
  })

  it('is not applicable (and calls nothing) when the client has no audience', async () => {
    const listSentCampaigns = vi.fn(async () => [])
    const { value } = deps({ mailchimp: port({ readAudience: async () => ({ ok: true, audienceId: '' }), listSentCampaigns }) })
    const res = await createFrequencySources(value).mailchimp(['guest@example.com'], SINCE)
    expect(res).toEqual({ ok: true, items: [], applicable: false })
    expect(listSentCampaigns).not.toHaveBeenCalled()
  })

  it('fails closed when the API key is missing', async () => {
    const { value } = deps({ mailchimp: port({ apiKey: () => undefined }) })
    const res = await createFrequencySources(value).mailchimp(['guest@example.com'], SINCE)
    expect(res.ok).toBe(false)
  })

  it('counts sent and soft-bounced deliveries only, inside the window', async () => {
    const statuses: Record<string, 'sent' | 'soft' | 'hard' | 'not_recipient'> = {
      c1: 'sent',
      c2: 'not_recipient',
      c3: 'soft',
      c4: 'hard',
      c5: 'sent',
    }
    const getCampaignRecipientStatus = vi.fn(async (_key: string, campaignId: string) => statuses[campaignId])
    const { value } = deps({
      mailchimp: port({
        listSentCampaigns: async () => [
          campaign('c1', '2026-10-25T00:00:00Z'),
          campaign('c2', '2026-10-25T00:00:00Z'),
          campaign('c3', '2026-10-26T00:00:00Z'),
          campaign('c4', '2026-10-26T00:00:00Z'),
          campaign('c5', '2026-10-01T00:00:00Z'), // before the window
          campaign('c6', null), // never sent
        ],
        getCampaignRecipientStatus,
      }),
    })
    const res = await createFrequencySources(value).mailchimp(['Guest@Example.com'], SINCE)
    expect(res.ok && res.items.map((i) => i.id)).toEqual(['mc:c1:guest@example.com', 'mc:c3:guest@example.com'])
    expect(getCampaignRecipientStatus).toHaveBeenCalledTimes(4) // c5 and c6 are never asked about
  })

  it('turns a provider error into a failed source', async () => {
    const { value } = deps({
      mailchimp: port({
        listSentCampaigns: async () => {
          throw new Error('mailchimp 500')
        },
      }),
    })
    const res = await createFrequencySources(value).mailchimp(['guest@example.com'], SINCE)
    expect(res).toEqual({ ok: false, error: 'mailchimp 500' })
  })
})
