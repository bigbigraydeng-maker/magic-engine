/**
 * 读往来喂给模型时，机器发的出站（Mailchimp 欢迎信 / 群发）不算「我们跟他聊过」。
 * 不排除的话：「对方一句没回 + 我们发过 + 已过两周」会把只收过欢迎信的人永久写成「无下文」。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))

import { loadTranscriptLines } from '../stage-infer'

type Touch = {
  channel: string
  direction: 'inbound' | 'outbound'
  occurred_at: string
  raw: string | null
  summary: string | null
  source: string | null
  metadata: Record<string, unknown> | null
}

function stubDb(touches: Touch[]) {
  mocks.from.mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    for (const m of ['select', 'eq', 'neq', 'order', 'in']) chain[m] = self
    if (table === 'conversations') {
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res)
    } else if (table === 'contact_touchpoints') {
      chain.limit = () => Promise.resolve({ data: touches, error: null })
    } else throw new Error(`unexpected table ${table}`)
    return chain
  })
}

const base = { channel: 'email', occurred_at: '2026-10-20T00:00:00Z', raw: null, metadata: null }

beforeEach(() => {
  mocks.from.mockReset()
})

describe('loadTranscriptLines · machine-sent outbound', () => {
  it('drops mailchimp outbound and automated outbound, keeps a human reply and the customer message', async () => {
    stubDb([
      { ...base, direction: 'outbound', summary: '发出《Welcome》', source: 'mailchimp' },
      { ...base, direction: 'outbound', summary: 'auto flagged', source: 'microsoft_mail', metadata: { automated: true } },
      { ...base, direction: 'outbound', summary: 'Hi Sue, here is the itinerary', source: 'microsoft_mail' },
      { ...base, direction: 'inbound', summary: 'Price for 2 pax please?', source: 'microsoft_mail' },
    ])
    const lines = await loadTranscriptLines('client-1', 'contact-1')
    expect(lines.map((l) => l.body).sort()).toEqual(['Hi Sue, here is the itinerary', 'Price for 2 pax please?'])
  })

  it('keeps an AI outbound call (automated, but its raw is the call summary)', async () => {
    stubDb([
      { ...base, channel: 'phone', direction: 'outbound', raw: 'Customer said they want March, 2 pax', summary: 'ai call', source: 'voice', metadata: { automated: true } },
    ])
    const lines = await loadTranscriptLines('client-1', 'contact-1')
    expect(lines.map((l) => l.body)).toEqual(['Customer said they want March, 2 pax'])
  })

  it('keeps inbound mailchimp rows (opens/clicks are the customer’s own actions)', async () => {
    stubDb([{ ...base, direction: 'inbound', summary: '打开了《Welcome》', source: 'mailchimp' }])
    expect(await loadTranscriptLines('client-1', 'contact-1')).toHaveLength(1)
  })
})
