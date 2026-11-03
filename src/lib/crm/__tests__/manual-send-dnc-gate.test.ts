import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/messenger-agent/optout', () => ({ isConversationOptedOut: vi.fn() }))

import {
  checkManualSendDnc,
  DO_NOT_CONTACT_MESSAGE,
  DNC_CHECK_FAILED_MESSAGE,
} from '../manual-send-dnc-gate'

interface FakeResult {
  data: unknown
  error: { message: string } | null
}

interface FakeSupabase {
  client: SupabaseClient
  tables: string[]
  eqCalls: Array<[string, unknown]>
}

function fakeSupabase(result: FakeResult): FakeSupabase {
  const tables: string[] = []
  const eqCalls: Array<[string, unknown]> = []

  const chain = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      eqCalls.push([col, val])
      return chain
    },
    maybeSingle: () => Promise.resolve(result),
  }

  const client = {
    from: (table: string) => {
      tables.push(table)
      return chain
    },
  }

  return { client: client as unknown as SupabaseClient, tables, eqCalls }
}

const CLIENT_ID = 'client-1'
const CONVO_ID = 'convo-1'

describe('checkManualSendDnc', () => {
  it('allows the send when the conversation belongs to the client and is not opted out', async () => {
    const fake = fakeSupabase({ data: { id: CONVO_ID }, error: null })
    const isOptedOut = vi.fn().mockResolvedValue(false)

    const result = await checkManualSendDnc(CLIENT_ID, CONVO_ID, {
      supabase: fake.client,
      isOptedOut,
    })

    expect(result).toEqual({ blocked: false })
    expect(fake.tables).toContain('conversations')
    expect(fake.eqCalls).toContainEqual(['id', CONVO_ID])
    expect(fake.eqCalls).toContainEqual(['client_id', CLIENT_ID])
    expect(isOptedOut).toHaveBeenCalledWith(CONVO_ID)
  })

  it('blocks with 403 when the customer is opted out', async () => {
    const fake = fakeSupabase({ data: { id: CONVO_ID }, error: null })
    const isOptedOut = vi.fn().mockResolvedValue(true)

    const result = await checkManualSendDnc(CLIENT_ID, CONVO_ID, {
      supabase: fake.client,
      isOptedOut,
    })

    expect(result).toEqual({
      blocked: true,
      status: 403,
      reason: 'do_not_contact',
      error: DO_NOT_CONTACT_MESSAGE,
    })
  })

  it('allows the send without checking DNC when the conversation is not found for this client', async () => {
    const fake = fakeSupabase({ data: null, error: null })
    const isOptedOut = vi.fn().mockResolvedValue(true)

    const result = await checkManualSendDnc(CLIENT_ID, CONVO_ID, {
      supabase: fake.client,
      isOptedOut,
    })

    expect(result).toEqual({ blocked: false })
    expect(isOptedOut).not.toHaveBeenCalled()
  })

  it('fails closed with 503 when the ownership lookup errors', async () => {
    const fake = fakeSupabase({ data: null, error: { message: 'boom' } })
    const isOptedOut = vi.fn().mockResolvedValue(false)

    const result = await checkManualSendDnc(CLIENT_ID, CONVO_ID, {
      supabase: fake.client,
      isOptedOut,
    })

    expect(result).toEqual({
      blocked: true,
      status: 503,
      reason: 'dnc_check_failed',
      error: DNC_CHECK_FAILED_MESSAGE,
    })
    expect(isOptedOut).not.toHaveBeenCalled()
  })

  it('fails closed with 503 when the DNC check throws', async () => {
    const fake = fakeSupabase({ data: { id: CONVO_ID }, error: null })
    const isOptedOut = vi.fn().mockRejectedValue(new Error('network down'))

    const result = await checkManualSendDnc(CLIENT_ID, CONVO_ID, {
      supabase: fake.client,
      isOptedOut,
    })

    expect(result).toEqual({
      blocked: true,
      status: 503,
      reason: 'dnc_check_failed',
      error: DNC_CHECK_FAILED_MESSAGE,
    })
  })
})

describe('checkManualSendDncForContact', () => {
  it('allows when the contact is not opted out', async () => {
    const { checkManualSendDncForContact } = await import('../manual-send-dnc-gate')
    expect(await checkManualSendDncForContact('k', 'c', { isOptedOut: async () => false })).toEqual({ blocked: false })
  })
  it('blocks 403 when opted out', async () => {
    const { checkManualSendDncForContact } = await import('../manual-send-dnc-gate')
    const r = await checkManualSendDncForContact('k', 'c', { isOptedOut: async () => true })
    expect(r).toMatchObject({ blocked: true, status: 403, reason: 'do_not_contact' })
  })
  it('fails closed (503) when the check throws', async () => {
    const { checkManualSendDncForContact } = await import('../manual-send-dnc-gate')
    const r = await checkManualSendDncForContact('k', 'c', { isOptedOut: async () => { throw new Error('db down') } })
    expect(r).toMatchObject({ blocked: true, status: 503, reason: 'dnc_check_failed' })
  })
})
