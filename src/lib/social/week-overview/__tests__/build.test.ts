import { describe, expect, it } from 'vitest'

import { InMemoryLiteStore } from '../../story-lite/in-memory-store'
import type { LiteServicePorts } from '../../story-lite/service'
import type { LiteActor, NewLiteItem } from '../../story-lite/types'
import { buildWeekOverview, readPublishingQuota } from '../build'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const OTHER = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
const NOW = new Date('2026-10-13T00:00:00Z')
const ADMIN: LiteActor = { id: 'u1', email: 'admin@example.com', allowedClientId: null }
const OFF = { live: false, clientIds: [] as string[] }

function item(id: string, slot: string): NewLiteItem {
  return {
    item_id: id, channel: 'facebook_story', slot_at: slot, media_kind: 'image', media_url: 'https://example.com/a.png',
    media_sha256: 'a'.repeat(64), text_line: `line ${id}`, account_id: '1234567890', source_ref: 'https://example.com/p',
  }
}

function ports(store: InMemoryLiteStore): LiteServicePorts {
  return { store, adminEmails: { has: (e: string) => e === 'admin@example.com' }, checkFile: async () => 'OK', sendEvent: async () => {} }
}

type Row = Record<string, unknown>
/** A fake client that records every filter, so a test can prove the query was limited to one client. */
function fakeDb(rows: Row[], options: { fail?: boolean } = {}) {
  const calls: Array<[string, unknown[]]> = []
  const chain = {
    select: (...a: unknown[]) => { calls.push(['select', a]); return chain },
    eq: (...a: unknown[]) => { calls.push(['eq', a]); return chain },
    not: (...a: unknown[]) => { calls.push(['not', a]); return chain },
    or: (...a: unknown[]) => { calls.push(['or', a]); return chain },
    order: (...a: unknown[]) => { calls.push(['order', a]); return chain },
    limit: async (...a: unknown[]) => {
      calls.push(['limit', a])
      const clientFilter = calls.find(([n, args]) => n === 'eq' && args[0] === 'client_id')
      const filtered = clientFilter ? rows.filter((r) => r.client_id === clientFilter[1][1]) : rows
      return options.fail ? { data: null, error: { message: 'db down' } } : { data: filtered, error: null }
    },
  }
  return { db: { from: (t: string) => { calls.push(['from', [t]]); return chain } } as never, calls }
}

const reelRow = (id: string, client: string, status: string, video: string | null): Row => ({
  id, client_id: client, status, angle: 'angle ' + id, created_at: '2026-10-12T00:00:00Z', video_path: video, published_ref: null,
})

describe('buildWeekOverview', () => {
  it('shows the live Story pack and only THIS client\'s Reels, queried by client id', async () => {
    const store = new InMemoryLiteStore()
    await store.insertPack({ id: 'p1', client_id: CLIENT, title: 'week', now: new Date('2026-10-12T00:00:00Z') }, [item('i1', '2026-10-13T19:30:00Z'), item('i2', '2026-10-14T00:00:00Z')])
    await store.insertPack({ id: 'p2', client_id: OTHER, title: 'other client', now: new Date('2026-10-12T00:00:00Z') }, [item('i3', '2026-10-13T19:30:00Z')])
    const { db, calls } = fakeDb([reelRow('r1', CLIENT, 'in_review', 'v/1.mp4'), reelRow('r2', OTHER, 'in_review', 'v/2.mp4'), reelRow('r3', CLIENT, 'approved', null)])
    const result = await buildWeekOverview({ ports: ports(store), db, clientId: CLIENT, actor: ADMIN, switches: OFF, now: NOW })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.story?.title).toBe('week')
    expect(result.value.story?.items.map((i) => i.item_id)).toEqual(['i1', 'i2'])
    expect(result.value.reels.map((r) => r.id)).toEqual(['r1'])
    expect(calls).toContainEqual(['eq', ['client_id', CLIENT]])
    expect(result.value.live).toBe(false)
    expect(result.value.post).toEqual({ connected: false })
  })

  it('a stopped or expired pack is not shown as in play', async () => {
    const store = new InMemoryLiteStore()
    await store.insertPack({ id: 'p1', client_id: CLIENT, title: 'stopped', now: new Date('2026-10-12T00:00:00Z') }, [item('i1', '2026-10-13T19:30:00Z')])
    await store.revokePack({ packId: 'p1', clientId: CLIENT, byEmail: 'a@b.c', reason: 'x', now: NOW })
    const { db } = fakeDb([])
    const result = await buildWeekOverview({ ports: ports(store), db, clientId: CLIENT, actor: ADMIN, switches: OFF, now: NOW })
    expect(result.ok && result.value.story).toBeNull()
  })

  it('a failed Reel read says so and does not hide the Stories (and vice versa)', async () => {
    const store = new InMemoryLiteStore()
    await store.insertPack({ id: 'p1', client_id: CLIENT, title: 'week', now: new Date('2026-10-12T00:00:00Z') }, [item('i1', '2026-10-13T19:30:00Z')])
    const bad = fakeDb([], { fail: true })
    const result = await buildWeekOverview({ ports: ports(store), db: bad.db, clientId: CLIENT, actor: ADMIN, switches: OFF, now: NOW })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.reels_error).not.toBeNull()
    expect(result.value.story?.items).toHaveLength(1)
    expect(result.value.story_error).toBeNull()
  })

  it('is global-admin only', async () => {
    const { db } = fakeDb([])
    const store = new InMemoryLiteStore()
    const stranger = await buildWeekOverview({ ports: ports(store), db, clientId: CLIENT, actor: { id: 'u', email: 'x@example.com', allowedClientId: null }, switches: OFF, now: NOW })
    expect(stranger.ok).toBe(false)
    const limited = await buildWeekOverview({ ports: ports(store), db, clientId: CLIENT, actor: { ...ADMIN, allowedClientId: CLIENT }, switches: OFF, now: NOW })
    expect(limited.ok).toBe(false)
  })

  it('live only when the global switch and this client are both on', async () => {
    const { db } = fakeDb([])
    const store = new InMemoryLiteStore()
    const on = await buildWeekOverview({ ports: ports(store), db, clientId: CLIENT, actor: ADMIN, switches: { live: true, clientIds: [CLIENT] }, now: NOW })
    expect(on.ok && on.value.live).toBe(true)
    const other = await buildWeekOverview({ ports: ports(store), db, clientId: CLIENT, actor: ADMIN, switches: { live: true, clientIds: [OTHER] }, now: NOW })
    expect(other.ok && other.value.live).toBe(false)
  })

  it('an authorised pack is never hidden behind a newer draft', async () => {
    const store = new InMemoryLiteStore()
    await store.insertPack({ id: 'old', client_id: CLIENT, title: 'authorised week', now: new Date('2026-10-10T00:00:00Z') }, [item('i1', '2026-10-14T19:30:00Z')])
    await store.authorizePack({ packId: 'old', clientId: CLIENT, byEmail: 'a@b.c', byUserId: 'u', now: new Date('2026-10-12T00:00:00Z'), expiresAt: new Date('2026-10-20T00:00:00Z'), contentHash: 'c'.repeat(64), fingerprints: { i1: 'f'.repeat(64) } })
    await store.insertPack({ id: 'new', client_id: CLIENT, title: 'newer draft', now: new Date('2026-10-12T12:00:00Z') }, [item('i2', '2026-10-15T19:30:00Z')])
    const { db } = fakeDb([])
    const result = await buildWeekOverview({ ports: ports(store), db, clientId: CLIENT, actor: ADMIN, switches: OFF, now: NOW })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.story?.title).toBe('authorised week')
    expect(result.value.story?.state).toBe('AUTHORIZED')
    expect(result.value.story?.newer_draft_title).toBe('newer draft')
  })

  it('a failed Story read says so and still shows the Reels', async () => {
    const store = new InMemoryLiteStore()
    store.listPacksForClient = async () => { throw new Error('db down') }
    const { db } = fakeDb([reelRow('r1', CLIENT, 'in_review', 'v/1.mp4')])
    const result = await buildWeekOverview({ ports: ports(store), db, clientId: CLIENT, actor: ADMIN, switches: OFF, now: NOW })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.story_error).not.toBeNull()
    expect(result.value.story).toBeNull()
    expect(result.value.reels).toHaveLength(1)
  })
})

describe('readPublishingQuota', () => {
  function quotaDb(result: { data: unknown; error: { code?: string; message: string } | null }) {
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => result }
    return { from: () => chain } as never
  }
  it('reads the client\'s own numbers and treats bad values as not configured', async () => {
    const q = await readPublishingQuota(quotaDb({ data: { publishing_calendar_config: { quota: { post_per_day: 2, story_per_day: 3, reel_per_week: 'x' } } }, error: null }), CLIENT)
    expect(q).toEqual({ post_per_day: 2, story_per_day: 3, reel_per_week: null })
  })
  it('no config, empty config or a missing column is "not configured" (null), never zeros', async () => {
    expect(await readPublishingQuota(quotaDb({ data: { publishing_calendar_config: null }, error: null }), CLIENT)).toBeNull()
    expect(await readPublishingQuota(quotaDb({ data: { publishing_calendar_config: { quota: {} } }, error: null }), CLIENT)).toBeNull()
    expect(await readPublishingQuota(quotaDb({ data: null, error: { code: '42703', message: 'column clients.publishing_calendar_config does not exist' } }), CLIENT)).toBeNull()
  })
  it('any other database error is thrown, not hidden', async () => {
    await expect(readPublishingQuota(quotaDb({ data: null, error: { message: 'timeout' } }), CLIENT)).rejects.toThrow('timeout')
  })
})
