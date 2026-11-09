import { describe, expect, it } from 'vitest'

import { InMemoryLiteStore } from '../in-memory-store'
import { listLitePacks } from '../list'
import { isLiveFor } from '../types'
import type { LiteServicePorts } from '../service'
import type { LiteActor, NewLiteItem } from '../types'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const OTHER = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
const NOW = new Date('2026-10-13T00:00:00Z')
const ADMIN: LiteActor = { id: 'u1', email: 'admin@example.com', allowedClientId: null }

function item(id: string): NewLiteItem {
  return {
    item_id: id,
    channel: 'facebook_story',
    slot_at: '2026-10-14T00:00:00Z',
    media_kind: 'image',
    media_url: 'https://example.com/a.jpg',
    media_sha256: 'a'.repeat(64),
    text_line: 'hello',
    account_id: '1234567890',
    source_ref: 'https://example.com/p',
  }
}

function ports(store: InMemoryLiteStore): LiteServicePorts {
  return {
    store,
    adminEmails: { has: (e: string) => e === 'admin@example.com' },
    checkFile: async () => 'OK',
    sendEvent: async () => undefined,
  }
}

describe('listLitePacks', () => {
  it('lists only this client, newest first, with item counts and states', async () => {
    const store = new InMemoryLiteStore()
    await store.insertPack({ id: 'p1', client_id: CLIENT, title: 'old', now: new Date('2026-10-01T00:00:00Z') }, [item('i1')])
    await store.insertPack({ id: 'p2', client_id: CLIENT, title: 'new', now: new Date('2026-10-10T00:00:00Z') }, [item('i2'), item('i3')])
    await store.insertPack({ id: 'p3', client_id: OTHER, title: 'other', now: new Date('2026-10-11T00:00:00Z') }, [item('i4')])
    const result = await listLitePacks({ ports: ports(store), clientId: CLIENT, actor: ADMIN, switches: { live: false, clientIds: [] }, now: NOW })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.packs.map((p) => [p.pack_id, p.item_count, p.state])).toEqual([
      ['p2', 2, 'DRAFT'],
      ['p1', 1, 'DRAFT'],
    ])
  })

  it('refuses a non-admin and a client-limited account', async () => {
    const store = new InMemoryLiteStore()
    const base = { ports: ports(store), clientId: CLIENT, switches: { live: false, clientIds: [] }, now: NOW }
    const stranger = await listLitePacks({ ...base, actor: { id: 'u2', email: 'x@example.com', allowedClientId: null } })
    expect(stranger.ok).toBe(false)
    const limited = await listLitePacks({ ...base, actor: { ...ADMIN, allowedClientId: CLIENT } })
    expect(limited.ok).toBe(false)
  })

  it('live is true only when the global switch AND this client are both on', () => {
    expect(isLiveFor({ live: true, clientIds: [CLIENT] }, CLIENT)).toBe(true)
    expect(isLiveFor({ live: true, clientIds: [OTHER] }, CLIENT)).toBe(false)
    expect(isLiveFor({ live: false, clientIds: [CLIENT] }, CLIENT)).toBe(false)
    expect(isLiveFor({ live: true, clientIds: [] }, CLIENT)).toBe(false)
  })
})
