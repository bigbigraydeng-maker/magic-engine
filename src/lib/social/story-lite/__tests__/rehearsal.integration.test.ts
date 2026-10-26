/**
 * End-to-end rehearsal of Story "lite" against a REAL Postgres (through PostgREST): the same
 * SupabaseLiteStore, the same service and the same sweep the production wiring uses. Only two things
 * are fake: the clock (fixed) and Facebook (a stub that records calls). Skipped unless both
 * STORY_REST_URL and STORY_REST_KEY are set (see the PR for how the throwaway database is built).
 *
 * It is one ordered scenario on purpose: each `it` builds on the previous one.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'

import { PagePublishError } from '@/lib/meta/page-posts'

import { computeItemFingerprint } from '../fingerprint'
import { runStorySweep, DEFAULT_SWEEP_CONFIG, type SenderDeps } from '../sender'
import { authorizeLitePack, buildLitePreview, revokeLitePack, type LiteServicePorts } from '../service'
import { SupabaseLiteStore } from '../supabase-store'
import type { LiteActor, NewLiteItem } from '../types'

const REST_URL = process.env.STORY_REST_URL
const REST_KEY = process.env.STORY_REST_KEY

function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} missing`)
  return value
}

/** A fresh hash per run (pure data; nothing is downloaded: the file check is stubbed). */
function freshSha(): string {
  return (randomUUID() + randomUUID()).replace(/-/g, '').slice(0, 64)
}

const T0 = new Date('2026-10-12T00:00:00.000Z') // "now" for creating and authorising
const SLOT_1 = '2026-10-13T08:30:00.000Z'
const SLOT_2 = '2026-10-13T13:00:00.000Z'
const SLOT_3 = '2026-10-13T20:00:00.000Z'
const SLOT_4 = '2026-10-14T08:30:00.000Z'
/** What a sweep did to one pack's items that were actually due (not-yet-due items are only noted). */
function dueOutcomes(summary: { records: Array<{ pack_id: string; outcome: string; reason_code: string | null }> }, pack: string) {
  return summary.records.filter((r) => r.pack_id === pack && r.outcome !== 'SKIPPED_NOT_DUE')
}

const ADMIN: LiteActor = { id: randomUUID(), email: 'pm@example.com', allowedClientId: null }
const PAGE = '1234567890'

describe.skipIf(!REST_URL || !REST_KEY)('Story lite — rehearsal against a real database', () => {
  let db: SupabaseClient
  let store: SupabaseLiteStore
  let ports: LiteServicePorts
  let clientId: string
  let packId: string
  let itemIds: string[]
  let previewHash = ''
  const publishCalls: string[] = []
  const events: Array<{ name: string; data: Record<string, unknown> }> = []

  function newItem(slot: string): NewLiteItem {
    return {
      item_id: randomUUID(),
      channel: 'facebook_story',
      slot_at: slot,
      media_kind: 'image',
      media_url: 'https://cdn.example.com/story.png',
      media_sha256: freshSha(),
      text_line: 'A line that carries no price',
      account_id: PAGE,
      source_ref: 'https://example.com/tour',
    }
  }

  function senderDeps(now: Date, live: boolean, publish?: SenderDeps['publish']): SenderDeps {
    return {
      now,
      store,
      switches: { live, clientIds: live ? [clientId] : [] },
      config: DEFAULT_SWEEP_CONFIG,
      checkFile: async () => 'OK',
      getPageToken: async () => 'stub-token',
      publish:
        publish ??
        (async ({ item }) => {
          publishCalls.push(item.item_id)
          return { postId: `${PAGE}_${item.item_id.slice(0, 8)}` }
        }),
      emit: async (event) => {
        events.push({ name: event.name, data: event.data })
      },
    }
  }

  beforeAll(async () => {
    db = createClient(env('STORY_REST_URL'), env('STORY_REST_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    store = new SupabaseLiteStore(db)
    ports = {
      store,
      adminEmails: new Set(['pm@example.com']),
      checkFile: async () => 'OK',
      sendEvent: async (event) => {
        events.push({ name: event.name, data: event.data })
      },
    }
    clientId = randomUUID()
    packId = randomUUID()
    const clientInsert = await db.from('clients').insert({ id: clientId, facebook_page_id: PAGE, client_status: 'active' })
    if (clientInsert.error) throw clientInsert.error
    const items = [newItem(SLOT_1), newItem(SLOT_2), newItem(SLOT_3), newItem(SLOT_4)]
    itemIds = items.map((i) => i.item_id)
    await store.insertPack({ id: packId, client_id: clientId, title: 'Week of 13 Oct (rehearsal)', now: T0 }, items)
  })

  it('reads the pack back with canonical timestamps and everything PENDING', async () => {
    const items = await store.getItems(packId, clientId)
    expect(items).toHaveLength(4)
    expect(items.every((i) => i.status === 'PENDING' && i.authorized_fingerprint === null)).toBe(true)
    expect(items[0].slot_at).toBe(SLOT_1)
    const pack = await store.getPack(packId, clientId)
    expect(pack?.authorized_at).toBeNull()
    expect(await store.getPack(packId, randomUUID())).toBeNull()
  })

  it('lists the client\'s packs with their item counts (page list)', async () => {
    const rows = await store.listPacksForClient(clientId, 10)
    expect(rows.map((r) => [r.pack.id, r.item_count])).toEqual([[packId, 4]])
    expect(await store.listPacksForClient(randomUUID(), 10)).toEqual([])
  })

  it('previews: nothing blocks, a stable hash is returned', async () => {
    const preview = await buildLitePreview({ ports, packId, clientId, actor: ADMIN, now: T0 })
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    expect(preview.value.state).toBe('DRAFT')
    expect(preview.value.can_authorize).toBe(true)
    expect(preview.value.content_hash).toMatch(/^[0-9a-f]{64}$/)
    previewHash = preview.value.content_hash
  })

  it('refuses a confirmation with a stale hash and writes nothing', async () => {
    const result = await authorizeLitePack({
      ports, packId, clientId, actor: ADMIN, confirm: true, expectedContentHash: 'f'.repeat(64), now: T0,
    })
    expect(result.ok).toBe(false)
    expect((await store.getPack(packId, clientId))?.authorized_at).toBeNull()
    expect(events.filter((e) => e.name === 'story.pack.authorized')).toHaveLength(0)
  })

  it('authorises once: pack stamped, every item fingerprint stored, one event', async () => {
    const result = await authorizeLitePack({
      ports, packId, clientId, actor: ADMIN, confirm: true, expectedContentHash: previewHash, now: T0,
    })
    expect(result.ok).toBe(true)
    if (!result.ok || result.value.mode !== 'AUTHORIZED') return
    expect(result.value.provider_impact).toBe('NONE')

    const pack = await store.getPack(packId, clientId)
    expect(pack?.authorized_at).not.toBeNull()
    expect(pack?.authorized_content_hash).toBe(previewHash)
    const items = await store.getItems(packId, clientId)
    for (const item of items) expect(item.authorized_fingerprint).toBe(computeItemFingerprint(item))
    expect(events.filter((e) => e.name === 'story.pack.authorized')).toHaveLength(1)

    const again = await authorizeLitePack({
      ports, packId, clientId, actor: ADMIN, confirm: true, expectedContentHash: previewHash, now: T0,
    })
    expect(again.ok).toBe(false)
    if (again.ok) return
    expect(again.status).toBe(409)
  })

  it('rehearsal sweep (default): checks everything, sends NOTHING, leaves items PENDING', async () => {
    const summary = await runStorySweep(senderDeps(new Date(SLOT_1), false))
    expect(dueOutcomes(summary, packId).map((r) => r.outcome)).toEqual(['DRY_RUN'])
    expect(publishCalls).toHaveLength(0)
    const items = await store.getItems(packId, clientId)
    expect(items.every((i) => i.status === 'PENDING')).toBe(true)
    expect(items[0].last_check_result).toBe('OK')
    expect(items[0].last_check_at).not.toBeNull()
  })

  it('live sweep sends the due story exactly once and records the receipt', async () => {
    const first = await runStorySweep(senderDeps(new Date(SLOT_1), true))
    expect(dueOutcomes(first, packId).map((r) => r.outcome)).toEqual(['SENT'])
    expect(publishCalls).toEqual([itemIds[0]])

    const again = await runStorySweep(senderDeps(new Date(SLOT_1), true))
    expect(dueOutcomes(again, packId)).toEqual([]) // a SENT story is never touched again
    expect(publishCalls).toHaveLength(1)

    const item = (await store.getItems(packId, clientId))[0]
    expect(item.status).toBe('SENT')
    expect(item.provider_receipt).toBe(`${PAGE}_${itemIds[0].slice(0, 8)}`)
    expect(item.attempt_count).toBe(1)
    const attempted = events.filter((e) => e.name === 'story.item.attempted')
    expect(attempted.some((e) => e.data.status === 'SENT' && e.data.provider_impact === 'STORY_PUBLISHED')).toBe(true)
  })

  it('two sweeps racing for one item send it once (the second loses the claim)', async () => {
    const when = new Date(SLOT_2)
    const [a, b] = await Promise.all([
      runStorySweep(senderDeps(when, true)),
      runStorySweep(senderDeps(when, true)),
    ])
    const outcomes = [...a.records, ...b.records].map((r) => r.outcome).sort()
    expect(outcomes.filter((o) => o === 'SENT')).toHaveLength(1)
    expect(publishCalls.filter((id) => id === itemIds[1])).toHaveLength(1)
  })

  it('an unreadable outcome is NEVER retried; a refusal is final; both are recorded', async () => {
    const unknown = await runStorySweep(
      senderDeps(new Date(SLOT_3), true, async () => {
        throw new PagePublishError('timeout', { certainty: 'unknown' })
      }),
    )
    expect(dueOutcomes(unknown, packId).map((r) => r.outcome)).toEqual(['UNKNOWN_OUTCOME'])
    const retry = await runStorySweep(senderDeps(new Date(SLOT_3), true))
    expect(dueOutcomes(retry, packId)).toEqual([])

    const refused = await runStorySweep(
      senderDeps(new Date(SLOT_4), true, async () => {
        throw new PagePublishError('bad', { certainty: 'rejected' })
      }),
    )
    expect(dueOutcomes(refused, packId).map((r) => r.outcome)).toEqual(['FAILED'])
    const items = await store.getItems(packId, clientId)
    expect(items.map((i) => i.status)).toEqual(['SENT', 'SENT', 'UNKNOWN_OUTCOME', 'FAILED'])
  })

  it('the database refuses a SENT story without a receipt and a receipt on anything else', async () => {
    const noReceipt = await db.from('story_items').update({ status: 'SENT' }).eq('item_id', itemIds[3])
    expect(noReceipt.error).not.toBeNull()
    const stray = await db.from('story_items').update({ provider_receipt: 'x' }).eq('item_id', itemIds[3])
    expect(stray.error).not.toBeNull()
  })

  it('an item edited after authorisation is BLOCKED, never sent', async () => {
    const pack2 = randomUUID()
    const items = [newItem('2026-10-15T08:30:00.000Z')]
    await store.insertPack({ id: pack2, client_id: clientId, title: 'edit test', now: T0 }, items)
    const preview = await buildLitePreview({ ports, packId: pack2, clientId, actor: ADMIN, now: T0 })
    if (!preview.ok) throw new Error('preview failed')
    const auth = await authorizeLitePack({
      ports, packId: pack2, clientId, actor: ADMIN, confirm: true, expectedContentHash: preview.value.content_hash, now: T0,
    })
    expect(auth.ok).toBe(true)

    const edit = await db.from('story_items').update({ text_line: 'A changed line' }).eq('item_id', items[0].item_id)
    expect(edit.error).toBeNull()
    const before = publishCalls.length
    const summary = await runStorySweep(senderDeps(new Date('2026-10-15T08:30:00.000Z'), true))
    expect(dueOutcomes(summary, pack2).map((r) => [r.outcome, r.reason_code])).toEqual([['BLOCKED', 'FINGERPRINT_CHANGED']])
    expect(publishCalls.length).toBe(before)
  })

  it('a revoked pack stops: its remaining stories are never sent; the response lists what went out', async () => {
    const pack3 = randomUUID()
    const items = [newItem('2026-10-16T08:30:00.000Z'), newItem('2026-10-16T13:00:00.000Z')]
    await store.insertPack({ id: pack3, client_id: clientId, title: 'revoke test', now: T0 }, items)
    const preview = await buildLitePreview({ ports, packId: pack3, clientId, actor: ADMIN, now: T0 })
    if (!preview.ok) throw new Error('preview failed')
    const auth = await authorizeLitePack({
      ports, packId: pack3, clientId, actor: ADMIN, confirm: true, expectedContentHash: preview.value.content_hash, now: T0,
    })
    expect(auth.ok).toBe(true)

    await runStorySweep(senderDeps(new Date('2026-10-16T08:30:00.000Z'), true))
    const revoked = await revokeLitePack({ ports, packId: pack3, clientId, actor: ADMIN, reason: 'rehearsal stop', now: new Date('2026-10-16T09:00:00.000Z') })
    expect(revoked.ok).toBe(true)
    if (!revoked.ok) return
    expect(revoked.value.sent.map((s) => s.item_id)).toEqual([items[0].item_id])
    expect(revoked.value.note).toContain('NOT removed')

    const before = publishCalls.length
    const later = await runStorySweep(senderDeps(new Date('2026-10-16T13:00:00.000Z'), true))
    expect(dueOutcomes(later, pack3)).toEqual([])
    expect(publishCalls.length).toBe(before)

    const second = await revokeLitePack({ ports, packId: pack3, clientId, actor: ADMIN, reason: 'again', now: new Date('2026-10-16T09:05:00.000Z') })
    expect(second.ok).toBe(false)
  })

  it('🔴 a stop pressed after the claim but before the send still stops it (real database)', async () => {
    const pack5 = randomUUID()
    const items = [newItem('2026-10-18T08:30:00.000Z')]
    await store.insertPack({ id: pack5, client_id: clientId, title: 'stop in the gap', now: T0 }, items)
    const preview = await buildLitePreview({ ports, packId: pack5, clientId, actor: ADMIN, now: T0 })
    if (!preview.ok) throw new Error('preview failed')
    const auth = await authorizeLitePack({
      ports, packId: pack5, clientId, actor: ADMIN, confirm: true, expectedContentHash: preview.value.content_hash, now: T0,
    })
    expect(auth.ok).toBe(true)

    const before = publishCalls.length
    const deps = senderDeps(new Date('2026-10-18T08:30:00.000Z'), true)
    // the token lookup takes network time: the PM presses "stop" while it runs
    deps.getPageToken = async () => {
      await store.revokePack({ packId: pack5, clientId, byEmail: 'pm@example.com', reason: 'stop', now: new Date('2026-10-18T08:30:01.000Z') })
      return 'stub-token'
    }
    const summary = await runStorySweep(deps)
    expect(dueOutcomes(summary, pack5).map((r) => [r.outcome, r.reason_code])).toEqual([['RETRY_LATER', 'PACK_NOT_LIVE']])
    expect(publishCalls.length).toBe(before)
    expect((await store.getItems(pack5, clientId))[0].status).toBe('PENDING')
  })

  it('a sweep that died after claiming is turned into UNKNOWN_OUTCOME by the NEXT sweep, never resent', async () => {
    const pack6 = randomUUID()
    const items = [newItem('2026-10-19T08:30:00.000Z')]
    await store.insertPack({ id: pack6, client_id: clientId, title: 'stale via sweep', now: T0 }, items)
    const claimed = await store.claimItem(items[0].item_id, new Date('2026-10-19T08:30:00.000Z'))
    expect(claimed?.status).toBe('CLAIMED')

    const before = publishCalls.length
    const summary = await runStorySweep(senderDeps(new Date('2026-10-19T09:00:00.000Z'), true))
    expect(summary.staleExpired).toContain(items[0].item_id)
    expect(publishCalls.length).toBe(before)
    expect((await store.getItems(pack6, clientId))[0].status).toBe('UNKNOWN_OUTCOME')
  })

  it('a sweep that died after claiming is turned into UNKNOWN_OUTCOME, not resent', async () => {
    const pack4 = randomUUID()
    const items = [newItem('2026-10-17T08:30:00.000Z')]
    await store.insertPack({ id: pack4, client_id: clientId, title: 'stale claim', now: T0 }, items)
    const claimed = await store.claimItem(items[0].item_id, new Date('2026-10-17T08:30:00.000Z'))
    expect(claimed?.status).toBe('CLAIMED')
    const expired = await store.expireStaleClaims(new Date('2026-10-17T09:00:00.000Z'), 15 * 60_000)
    expect(expired).toEqual([items[0].item_id])
    const row = (await store.getItems(pack4, clientId))[0]
    expect(row.status).toBe('UNKNOWN_OUTCOME')
    expect(row.reason_code).toBe('STALE_CLAIM')
  })
})
