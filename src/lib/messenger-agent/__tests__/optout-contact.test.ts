import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { isContactMarkedDoNotContact, isContactOptedOutAnyChannel } from '../optout'

interface Opts {
  contact?: { do_not_contact: boolean } | null
  contactError?: boolean
  touches?: Array<{ occurred_at: string; metadata: Record<string, unknown> | null }>
  touchError?: boolean
  convos?: Array<{ id: string }>
  convoError?: boolean
}

function fakeDb(o: Opts): SupabaseClient {
  const from = (table: string) => {
    if (table === 'contacts') {
      return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => (o.contactError ? { data: null, error: { message: 'x' } } : { data: o.contact ?? null, error: null }) }) }) }) }
    }
    if (table === 'contact_touchpoints') {
      return { select: () => ({ eq: () => ({ eq: async () => (o.touchError ? { data: null, error: { message: 'x' } } : { data: o.touches ?? [], error: null }) }) }) }
    }
    if (table === 'conversations') {
      return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ limit: async () => (o.convoError ? { data: null, error: { message: 'x' } } : { data: o.convos ?? [], error: null }) }) }) }) }) }
    }
    throw new Error(`unexpected table ${table}`)
  }
  return { from } as unknown as SupabaseClient
}

describe('isContactMarkedDoNotContact', () => {
  it('false for a clean contact', async () => {
    expect(await isContactMarkedDoNotContact('c', 'k', fakeDb({ contact: { do_not_contact: false } }))).toBe(false)
  })
  it('true when the contact column says so', async () => {
    expect(await isContactMarkedDoNotContact('c', 'k', fakeDb({ contact: { do_not_contact: true } }))).toBe(true)
  })
  it('true when a touchpoint carries the do_not_contact verdict', async () => {
    const db = fakeDb({ contact: { do_not_contact: false }, touches: [{ occurred_at: '2026-10-01T00:00:00Z', metadata: { outcome: 'do_not_contact' } }] })
    expect(await isContactMarkedDoNotContact('c', 'k', db)).toBe(true)
  })
  it('fail-closed: contact missing / contact query error / touch query error', async () => {
    expect(await isContactMarkedDoNotContact('c', 'k', fakeDb({ contact: null }))).toBe(true)
    expect(await isContactMarkedDoNotContact('c', 'k', fakeDb({ contactError: true }))).toBe(true)
    expect(await isContactMarkedDoNotContact('c', 'k', fakeDb({ contact: { do_not_contact: false }, touchError: true }))).toBe(true)
  })
})

describe('isContactOptedOutAnyChannel', () => {
  it('false when clean everywhere', async () => {
    expect(await isContactOptedOutAnyChannel('c', 'k', fakeDb({ contact: { do_not_contact: false } }))).toBe(false)
  })
  it('true when any of the contact conversations is optout_unlinked (said STOP elsewhere before being linked)', async () => {
    expect(await isContactOptedOutAnyChannel('c', 'k', fakeDb({ contact: { do_not_contact: false }, convos: [{ id: 'cv1' }] }))).toBe(true)
  })
  it('true when the contact level says do-not-contact (short-circuit)', async () => {
    expect(await isContactOptedOutAnyChannel('c', 'k', fakeDb({ contact: { do_not_contact: true } }))).toBe(true)
  })
  it('fail-closed when the conversations query errors', async () => {
    expect(await isContactOptedOutAnyChannel('c', 'k', fakeDb({ contact: { do_not_contact: false }, convoError: true }))).toBe(true)
  })
})
