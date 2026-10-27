/**
 * 坏主页令牌：本地补档案照跑，Graph 不再打，连接标成不健康。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeBindingFakeDb, type FakeDb } from '@/lib/meta/__tests__/binding-fake-db'

const state: { db: FakeDb } = { db: {} }

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: (table: string) => makeBindingFakeDb(state.db).from(table) },
}))
vi.mock('@/lib/meta/page-sync-authorization', () => ({ authorizePageSync: vi.fn() }))
vi.mock('@/lib/meta/conversations', () => ({ fetchPageConversations: vi.fn() }))
vi.mock('@/lib/messenger/link-contacts', () => ({
  linkMessengerConversation: vi.fn(),
  loadIdentityIndex: vi.fn(),
}))
vi.mock('@/lib/messenger/backfill', () => ({
  backfillUnlinkedConversations: vi.fn(async () => ({ created: 0, remaining: 0 })),
}))
vi.mock('@/lib/messenger/lead-intro-backfill', () => ({
  backfillLeadIntroDetails: vi.fn(async () => ({ scanned: 4 })),
}))

import { syncClientMessenger } from '../sync'
import { authorizePageSync } from '@/lib/meta/page-sync-authorization'
import { fetchPageConversations } from '@/lib/meta/conversations'
import { backfillLeadIntroDetails } from '@/lib/messenger/lead-intro-backfill'

const mockAuth = vi.mocked(authorizePageSync)
const mockFetch = vi.mocked(fetchPageConversations)
const mockBackfill = vi.mocked(backfillLeadIntroDetails)

const CLIENT = { id: 'client-1', name: 'Sample', facebook_page_id: 'page-1' }

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ ok: true, pageToken: 'page-token', via: 'client_oauth' })
  mockFetch.mockResolvedValue([])
  state.db = { platform_oauth_connections: [], meta_page_sync_holds: [], conversations: [] }
})

describe('syncClientMessenger broken page token', () => {
  it('连接已经是 error → 不再打 Graph，本地补档案照跑', async () => {
    state.db.platform_oauth_connections = [
      { id: 'conn-1', client_id: CLIENT.id, provider: 'meta', account_id: CLIENT.facebook_page_id, status: 'error' },
    ]

    const res = await syncClientMessenger(CLIENT)

    expect(res.skipped).toBe('connection_unhealthy')
    expect(res.leadIntroScanned).toBe(4)
    expect(mockBackfill).toHaveBeenCalledWith(CLIENT.id)
    expect(mockAuth).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('Graph 190 → 连接标成 error，这一轮记成等重连，下一轮不再打', async () => {
    state.db.platform_oauth_connections = [
      { id: 'conn-1', client_id: CLIENT.id, provider: 'meta', account_id: CLIENT.facebook_page_id, status: 'active' },
    ]
    mockFetch.mockRejectedValue(new Error('fetchPageConversations failed: HTTP 400 code=190'))

    const first = await syncClientMessenger(CLIENT)
    expect(first.skipped).toBe('connection_unhealthy')
    expect(first.error).toContain('190')
    expect(state.db.platform_oauth_connections[0].status).toBe('error')

    mockFetch.mockClear()
    const second = await syncClientMessenger(CLIENT)
    expect(second.skipped).toBe('connection_unhealthy')
    expect(second.error).toBeUndefined()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('没有连接行时，190 记进暂停表，下一轮不再打', async () => {
    mockFetch.mockRejectedValue(new Error('(#190) session invalidated'))

    const first = await syncClientMessenger(CLIENT)
    expect(first.skipped).toBe('connection_unhealthy')
    expect(state.db.meta_page_sync_holds).toEqual([
      expect.objectContaining({ client_id: CLIENT.id, page_id: 'page-1', reason: 'graph_190' }),
    ])

    mockFetch.mockClear()
    await syncClientMessenger(CLIENT)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
