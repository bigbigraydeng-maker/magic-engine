/**
 * AD-SEC-4 — the REAL sync gate wired into the Messenger sync: a client whose
 * bound Page is not verified as theirs never has that inbox read, even though a
 * token that can read it exists. (sync.test.ts mocks the gate; this does not.)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeBindingFakeDb, type FakeDb } from '@/lib/meta/__tests__/binding-fake-db'

const state: { db: FakeDb } = { db: {} }
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: (t: string) => makeBindingFakeDb(state.db).from(t) },
}))
vi.mock('@/lib/meta/page-posts', () => ({ getPageAccessToken: vi.fn() }))
vi.mock('@/lib/meta/conversations', () => ({ fetchPageConversations: vi.fn() }))
vi.mock('@/lib/platform-oauth/vocabulary', () => ({ decryptToken: (e: string) => e }))
vi.mock('@/lib/messenger/link-contacts', () => ({ linkMessengerConversation: vi.fn(), loadIdentityIndex: vi.fn() }))
vi.mock('@/lib/messenger/backfill', () => ({ backfillUnlinkedConversations: vi.fn().mockResolvedValue({ created: 0, remaining: 0 }) }))
vi.mock('@/lib/messenger/lead-intro-backfill', () => ({ backfillLeadIntroDetails: vi.fn().mockResolvedValue({ scanned: 0 }) }))

import { syncClientMessenger } from '../sync'
import { getPageAccessToken } from '@/lib/meta/page-posts'
import { fetchPageConversations } from '@/lib/meta/conversations'

const mockPageToken = vi.mocked(getPageAccessToken)
const mockFetch = vi.mocked(fetchPageConversations)

const ATTACKER = { id: 'client-attacker', name: 'Attacker', facebook_page_id: '1616575215312482' }
const TOUCHED = ['META_SYSTEM_USER_TOKEN'] as const
let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]))
  // The shared token CAN read the victim's Page — that is the whole risk.
  process.env.META_SYSTEM_USER_TOKEN = 'shared-sees-everyone'
  mockPageToken.mockResolvedValue('victim-page-token')
  mockFetch.mockResolvedValue([])
  state.db = {
    clients: [{ ...ATTACKER, domain: null, created_at: '2026-01-01T00:00:00Z', source: 'fde' }],
    client_binding_audit: [],
    platform_oauth_connections: [],
    conversations: [],
  }
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('Messenger sync never runs against a Page not verified for this client', () => {
  it('Page set without verification, only the shared token → inbox never read', async () => {
    const res = await syncClientMessenger(ATTACKER)

    expect(res.skipped).toBe('page_not_verified')
    expect(res.error).toContain('unverified_shared_token')
    expect(mockPageToken).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('same Page also bound to its real owner → inbox never read', async () => {
    state.db.clients.push({ id: 'client-victim', name: 'Victim', facebook_page_id: ATTACKER.facebook_page_id, domain: null, created_at: '2025-01-01T00:00:00Z', source: 'fde' })
    state.db.client_binding_audit.push({ client_id: ATTACKER.id, binding_kind: 'facebook_page', action: 'bind', outcome: 'applied', requested_value: ATTACKER.facebook_page_id, created_at: '2026-09-17T00:00:00Z' })

    const res = await syncClientMessenger(ATTACKER)

    expect(res.skipped).toBe('page_not_verified')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('once staff have verified the binding, the same client syncs', async () => {
    state.db.client_binding_audit.push({ client_id: ATTACKER.id, binding_kind: 'facebook_page', action: 'bind', outcome: 'applied', requested_value: ATTACKER.facebook_page_id, created_at: '2026-09-17T00:00:00Z' })

    const res = await syncClientMessenger(ATTACKER)

    expect(res.skipped).toBeUndefined()
    expect(mockFetch).toHaveBeenCalledWith(ATTACKER.facebook_page_id, 'victim-page-token', undefined)
  })
})
