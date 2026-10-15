/**
 * Story "lite" — service draft tests. Uses the in-memory store; no network, no database.
 */
import { describe, expect, it, vi } from 'vitest'

import { InMemoryLiteStore } from '../in-memory-store'
import {
  authorizeLitePack,
  buildLitePreview,
  requireGlobalAdmin,
  revokeLitePack,
  type LiteServicePorts,
} from '../service'
import type { LiteActor, LiteItem, NewLiteItem } from '../types'
import { computeItemFingerprint } from '../fingerprint'

const NOW = new Date('2026-10-12T00:00:00.000Z')
const CLIENT_ID = 'client-1'
const PAGE_ID = '1234567890'
const PACK_ID = 'pack-1'

const ADMIN: LiteActor = { id: 'user-admin', email: 'pm@example.com', allowedClientId: null }
const LIMITED: LiteActor = { id: 'user-limited', email: 'pm@example.com', allowedClientId: CLIENT_ID }
const NON_ADMIN: LiteActor = { id: 'user-other', email: 'other@example.com', allowedClientId: null }

function daysFromNow(days: number): string {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
}

function makeItem(index: number, overrides: Partial<NewLiteItem> = {}): NewLiteItem {
  return {
    item_id: `item-${index}`,
    channel: 'facebook_story',
    slot_at: daysFromNow(index),
    media_kind: 'image',
    media_url: `https://cdn.example.com/${index}.jpg`,
    media_sha256: 'a'.repeat(64),
    text_line: `Story ${index}`,
    account_id: PAGE_ID,
    source_ref: 'https://example.com/source',
    ...overrides,
  }
}

interface Harness {
  store: InMemoryLiteStore
  ports: LiteServicePorts
  sendEvent: ReturnType<typeof vi.fn>
  checkFile: ReturnType<typeof vi.fn>
}

async function makeHarness(options: {
  items?: NewLiteItem[]
  clientStatus?: string | null
  pageId?: string | null
  checkFileResult?: 'OK' | 'CHANGED' | 'UNREACHABLE' | 'BAD_VIDEO'
  checkFileThrows?: boolean
  sendEventThrows?: boolean
} = {}): Promise<Harness> {
  const store = new InMemoryLiteStore()
  store.seedClient(CLIENT_ID, {
    facebook_page_id: options.pageId === undefined ? PAGE_ID : options.pageId,
    client_status: options.clientStatus === undefined ? 'active' : options.clientStatus,
  })

  const items = options.items ?? [makeItem(1), makeItem(2), makeItem(3)]
  await store.insertPack({ id: PACK_ID, client_id: CLIENT_ID, title: 'Weekly pack', now: NOW }, items)

  const sendEvent = vi.fn(async () => {
    if (options.sendEventThrows) throw new Error('event down')
  })
  const checkFile = vi.fn(async () => {
    if (options.checkFileThrows) throw new Error('network down')
    return options.checkFileResult ?? 'OK'
  })

  const ports: LiteServicePorts = {
    store,
    adminEmails: { has: (email: string) => email === 'pm@example.com' },
    checkFile,
    sendEvent,
  }
  return { store, ports, sendEvent, checkFile }
}

function previewInput(ports: LiteServicePorts, overrides: Partial<Parameters<typeof buildLitePreview>[0]> = {}) {
  return {
    ports,
    packId: PACK_ID,
    clientId: CLIENT_ID,
    actor: ADMIN,
    now: NOW,
    ...overrides,
  }
}

function authorizeInput(
  ports: LiteServicePorts,
  overrides: Partial<Parameters<typeof authorizeLitePack>[0]> = {},
) {
  return {
    ports,
    packId: PACK_ID,
    clientId: CLIENT_ID,
    actor: ADMIN,
    confirm: true,
    now: NOW,
    ...overrides,
  }
}

function revokeInput(ports: LiteServicePorts, overrides: Partial<Parameters<typeof revokeLitePack>[0]> = {}) {
  return {
    ports,
    packId: PACK_ID,
    clientId: CLIENT_ID,
    actor: ADMIN,
    reason: 'changed my mind',
    now: NOW,
    ...overrides,
  }
}

describe('requireGlobalAdmin', () => {
  it('accepts a global admin', async () => {
    const { ports } = await makeHarness()
    expect(requireGlobalAdmin(ports, ADMIN)).toEqual({ ok: true, value: true })
  })

  it('rejects a client-limited actor', async () => {
    const { ports } = await makeHarness()
    expect(requireGlobalAdmin(ports, LIMITED)).toEqual({ ok: false, status: 403, error: 'GLOBAL_ADMIN_REQUIRED' })
  })

  it('rejects an unknown email', async () => {
    const { ports } = await makeHarness()
    expect(requireGlobalAdmin(ports, NON_ADMIN)).toEqual({ ok: false, status: 403, error: 'GLOBAL_ADMIN_REQUIRED' })
  })

  it('normalises the email before checking', async () => {
    const { ports } = await makeHarness()
    const actor: LiteActor = { id: 'x', email: '  PM@Example.com ', allowedClientId: null }
    expect(requireGlobalAdmin(ports, actor)).toEqual({ ok: true, value: true })
  })
})

describe('buildLitePreview', () => {
  it('rejects a non-admin with 403', async () => {
    const { ports } = await makeHarness()
    const result = await buildLitePreview(previewInput(ports, { actor: NON_ADMIN }))
    expect(result).toEqual({ ok: false, status: 403, error: 'GLOBAL_ADMIN_REQUIRED' })
  })

  it('rejects a client-limited admin with 403', async () => {
    const { ports } = await makeHarness()
    const result = await buildLitePreview(previewInput(ports, { actor: LIMITED }))
    expect(result).toEqual({ ok: false, status: 403, error: 'GLOBAL_ADMIN_REQUIRED' })
  })

  it.each([0, 15, 1.5])('rejects lifetime %s with BAD_EXPIRY', async (lifetimeDays) => {
    const { ports } = await makeHarness()
    const result = await buildLitePreview(previewInput(ports, { lifetimeDays }))
    expect(result).toEqual({ ok: false, status: 400, error: 'BAD_EXPIRY' })
  })

  it('returns PACK_NOT_FOUND for an unknown pack', async () => {
    const { ports } = await makeHarness()
    const result = await buildLitePreview(previewInput(ports, { packId: 'nope' }))
    expect(result).toEqual({ ok: false, status: 404, error: 'PACK_NOT_FOUND' })
  })

  it('returns PACK_NOT_FOUND for a pack with no items', async () => {
    const { ports } = await makeHarness({ items: [] })
    const result = await buildLitePreview(previewInput(ports))
    expect(result).toEqual({ ok: false, status: 404, error: 'PACK_NOT_FOUND' })
  })

  it('builds a clean preview for a healthy pack', async () => {
    const { ports } = await makeHarness()
    const result = await buildLitePreview(previewInput(ports))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.state).toBe('DRAFT')
    expect(result.value.lifetime_days).toBe(7)
    expect(result.value.can_authorize).toBe(true)
    expect(result.value.blocking).toEqual([])
    expect(result.value.items).toHaveLength(3)
    expect(result.value.items.every((item) => item.problems.length === 0)).toBe(true)
    expect(result.value.expires_at_if_authorized).toBe(daysFromNow(7))
  })

  it('flags NOT_PENDING when an item is not pending', async () => {
    const { store, ports } = await makeHarness()
    await store.claimItem('item-1', NOW)
    const result = await buildLitePreview(previewInput(ports))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const item = result.value.items.find((i) => i.item_id === 'item-1')
    expect(item?.problems).toContain('NOT_PENDING')
    expect(result.value.can_authorize).toBe(false)
  })

  it('flags CHANNEL_NOT_SUPPORTED for a non-facebook channel', async () => {
    const { ports } = await makeHarness({
      items: [makeItem(1, { channel: 'instagram_story' }), makeItem(2), makeItem(3)],
    })
    const result = await buildLitePreview(previewInput(ports))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const item = result.value.items.find((i) => i.item_id === 'item-1')
    expect(item?.problems).toContain('CHANNEL_NOT_SUPPORTED')
  })

  it('flags SLOT_IN_PAST for a slot in the past', async () => {
    const { ports } = await makeHarness({
      items: [makeItem(1, { slot_at: '2026-10-11T00:00:00.000Z' }), makeItem(2), makeItem(3)],
    })
    const result = await buildLitePreview(previewInput(ports))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const item = result.value.items.find((i) => i.item_id === 'item-1')
    expect(item?.problems).toContain('SLOT_IN_PAST')
  })

  it('flags SLOT_IN_PAST for an unreadable slot', async () => {
    const { ports } = await makeHarness({
      items: [makeItem(1, { slot_at: 'not-a-date' }), makeItem(2), makeItem(3)],
    })
    const result = await buildLitePreview(previewInput(ports))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const item = result.value.items.find((i) => i.item_id === 'item-1')
    expect(item?.problems).toContain('SLOT_IN_PAST')
  })

  it('flags SLOT_AFTER_EXPIRY for a slot beyond the lifetime', async () => {
    const { ports } = await makeHarness({
      items: [makeItem(1, { slot_at: daysFromNow(10) }), makeItem(2), makeItem(3)],
    })
    const result = await buildLitePreview(previewInput(ports, { lifetimeDays: 7 }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const item = result.value.items.find((i) => i.item_id === 'item-1')
    expect(item?.problems).toContain('SLOT_AFTER_EXPIRY')
  })

  it('flags ACCOUNT_MISMATCH when the page id differs', async () => {
    const { ports } = await makeHarness({
      items: [makeItem(1, { account_id: '9999999999' }), makeItem(2), makeItem(3)],
    })
    const result = await buildLitePreview(previewInput(ports))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const item = result.value.items.find((i) => i.item_id === 'item-1')
    expect(item?.problems).toContain('ACCOUNT_MISMATCH')
  })

  it('flags ACCOUNT_MISMATCH when the client has no page', async () => {
    const { ports } = await makeHarness({ pageId: null })
    const result = await buildLitePreview(previewInput(ports))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.items.every((item) => item.problems.includes('ACCOUNT_MISMATCH'))).toBe(true)
  })

  it('flags PRICE_IN_TEXT for a price in the text', async () => {
    const { ports } = await makeHarness({
      items: [makeItem(1, { text_line: 'Only $5 today' }), makeItem(2), makeItem(3)],
    })
    const result = await buildLitePreview(previewInput(ports))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const item = result.value.items.find((i) => i.item_id === 'item-1')
    expect(item?.problems).toContain('PRICE_IN_TEXT')
  })

  it('flags FILE_CHANGED when the file hash differs', async () => {
    const { ports } = await makeHarness({ checkFileResult: 'CHANGED' })
    const result = await buildLitePreview(previewInput(ports))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.items.every((item) => item.problems.includes('FILE_CHANGED'))).toBe(true)
  })

  it('flags VIDEO_NOT_ACCEPTABLE (and blocks authorising) when the video is the wrong length / shape', async () => {
    const { ports } = await makeHarness({ checkFileResult: 'BAD_VIDEO' })
    const result = await buildLitePreview(previewInput(ports))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.items.every((item) => item.problems.includes('VIDEO_NOT_ACCEPTABLE'))).toBe(true)
    expect(result.value.can_authorize).toBe(false)
  })

  it('flags FILE_UNREACHABLE when the file cannot be read', async () => {
    const { ports } = await makeHarness({ checkFileResult: 'UNREACHABLE' })
    const result = await buildLitePreview(previewInput(ports))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.items.every((item) => item.problems.includes('FILE_UNREACHABLE'))).toBe(true)
  })

  it('flags FILE_UNREACHABLE when the file check throws', async () => {
    const { ports } = await makeHarness({ checkFileThrows: true })
    const result = await buildLitePreview(previewInput(ports))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.items.every((item) => item.problems.includes('FILE_UNREACHABLE'))).toBe(true)
  })

  it('blocks with CLIENT_NOT_ACTIVE when the client is paused', async () => {
    const { ports } = await makeHarness({ clientStatus: 'paused' })
    const result = await buildLitePreview(previewInput(ports))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.blocking).toContain('CLIENT_NOT_ACTIVE')
    expect(result.value.can_authorize).toBe(false)
  })

  it('blocks with PACK_NOT_DRAFT when the pack is already authorised', async () => {
    const { store, ports } = await makeHarness()
    const preview = await buildLitePreview(previewInput(ports))
    if (!preview.ok) throw new Error('preview failed')
    await store.authorizePack({
      packId: PACK_ID,
      clientId: CLIENT_ID,
      byEmail: 'pm@example.com',
      byUserId: 'user-admin',
      now: NOW,
      expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
      contentHash: preview.value.content_hash,
      fingerprints: Object.fromEntries(preview.value.items.map((i) => [i.item_id, 'x'.repeat(64)])),
    })
    const result = await buildLitePreview(previewInput(ports))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.state).toBe('AUTHORIZED')
    expect(result.value.blocking).toContain('PACK_NOT_DRAFT')
  })

  it('reports EXPIRED when the pack expired', async () => {
    const { store, ports } = await makeHarness()
    const preview = await buildLitePreview(previewInput(ports))
    if (!preview.ok) throw new Error('preview failed')
    await store.authorizePack({
      packId: PACK_ID,
      clientId: CLIENT_ID,
      byEmail: 'pm@example.com',
      byUserId: 'user-admin',
      now: new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000),
      expiresAt: new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000),
      contentHash: preview.value.content_hash,
      fingerprints: Object.fromEntries(preview.value.items.map((i) => [i.item_id, 'x'.repeat(64)])),
    })
    const result = await buildLitePreview(previewInput(ports))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.state).toBe('EXPIRED')
    expect(result.value.blocking).toContain('PACK_NOT_DRAFT')
  })

  it('reports REVOKED when the pack was revoked', async () => {
    const { store, ports } = await makeHarness()
    await store.revokePack({ packId: PACK_ID, clientId: CLIENT_ID, byEmail: 'pm@example.com', reason: 'x', now: NOW })
    const result = await buildLitePreview(previewInput(ports))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.state).toBe('REVOKED')
    expect(result.value.blocking).toContain('PACK_NOT_DRAFT')
  })

  it('keeps the content hash stable and changes it when an item changes', async () => {
    const { ports } = await makeHarness()
    const first = await buildLitePreview(previewInput(ports))
    const second = await buildLitePreview(previewInput(ports))
    if (!first.ok || !second.ok) throw new Error('preview failed')
    expect(first.value.content_hash).toBe(second.value.content_hash)

    const changed = await makeHarness({
      items: [makeItem(1, { text_line: 'Different' }), makeItem(2), makeItem(3)],
    })
    const third = await buildLitePreview(previewInput(changed.ports))
    if (!third.ok) throw new Error('preview failed')
    expect(third.value.content_hash).not.toBe(first.value.content_hash)
  })

  it('changes the content hash when the lifetime changes', async () => {
    const { ports } = await makeHarness()
    const seven = await buildLitePreview(previewInput(ports, { lifetimeDays: 7 }))
    const ten = await buildLitePreview(previewInput(ports, { lifetimeDays: 10 }))
    if (!seven.ok || !ten.ok) throw new Error('preview failed')
    expect(seven.value.content_hash).not.toBe(ten.value.content_hash)
  })
})

describe('authorizeLitePack — pictures are always re-checked', () => {
  it('a changed picture blocks authorisation even when the hash came from a fast (unchecked) preview', async () => {
    // the fast first look the page uses reports every file as OK; its content hash is the same as the full one
    const quick = await makeHarness({ checkFileResult: 'OK' })
    const quickPreview = await buildLitePreview(previewInput(quick.ports))
    expect(quickPreview.ok).toBe(true)
    if (!quickPreview.ok) return
    // authorising runs its own full check against the real file state, which has changed
    const real = await makeHarness({ checkFileResult: 'CHANGED' })
    const result = await authorizeLitePack(authorizeInput(real.ports, { expectedContentHash: quickPreview.value.content_hash }))
    expect(result.ok).toBe(false)
    const pack = await real.store.getPack(PACK_ID, CLIENT_ID)
    expect(pack?.authorized_at).toBeNull()
  })
})

describe('authorizeLitePack', () => {
  it('rejects a non-admin with 403', async () => {
    const { ports } = await makeHarness()
    const result = await authorizeLitePack(authorizeInput(ports, { actor: NON_ADMIN }))
    expect(result).toEqual({ ok: false, status: 403, error: 'GLOBAL_ADMIN_REQUIRED' })
  })

  it('rejects a client-limited admin with 403', async () => {
    const { ports } = await makeHarness()
    const result = await authorizeLitePack(authorizeInput(ports, { actor: LIMITED }))
    expect(result).toEqual({ ok: false, status: 403, error: 'GLOBAL_ADMIN_REQUIRED' })
  })

  it('rejects a bad lifetime with BAD_EXPIRY', async () => {
    const { ports } = await makeHarness()
    const result = await authorizeLitePack(authorizeInput(ports, { lifetimeDays: 0 }))
    expect(result).toEqual({ ok: false, status: 400, error: 'BAD_EXPIRY' })
  })

  it('returns PACK_NOT_FOUND for an unknown pack', async () => {
    const { ports } = await makeHarness()
    const result = await authorizeLitePack(authorizeInput(ports, { packId: 'nope' }))
    expect(result).toEqual({ ok: false, status: 404, error: 'PACK_NOT_FOUND' })
  })

  it('returns the preview when confirm is false and writes nothing', async () => {
    const { store, ports, sendEvent } = await makeHarness()
    const result = await authorizeLitePack(authorizeInput(ports, { confirm: false }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.mode).toBe('PREVIEW')
    const pack = await store.getPack(PACK_ID, CLIENT_ID)
    expect(pack?.authorized_at).toBeNull()
    expect(sendEvent).not.toHaveBeenCalled()
  })

  it('requires a content hash when confirming', async () => {
    const { store, ports } = await makeHarness()
    const result = await authorizeLitePack(authorizeInput(ports))
    expect(result).toEqual({ ok: false, status: 400, error: 'CONTENT_HASH_REQUIRED' })
    const pack = await store.getPack(PACK_ID, CLIENT_ID)
    expect(pack?.authorized_at).toBeNull()
  })

  it('rejects a malformed content hash', async () => {
    const { ports } = await makeHarness()
    const result = await authorizeLitePack(authorizeInput(ports, { expectedContentHash: 'NOT-HEX' }))
    expect(result).toEqual({ ok: false, status: 400, error: 'CONTENT_HASH_REQUIRED' })
  })

  it('rejects a stale content hash with 409', async () => {
    const { store, ports } = await makeHarness()
    const result = await authorizeLitePack(authorizeInput(ports, { expectedContentHash: 'a'.repeat(64) }))
    expect(result).toEqual({ ok: false, status: 409, error: 'PACK_CHANGED_SINCE_PREVIEW' })
    const pack = await store.getPack(PACK_ID, CLIENT_ID)
    expect(pack?.authorized_at).toBeNull()
  })

  it('🔴 refuses when an item changes between the preview and the write (the file checks take time)', async () => {
    const { store, ports } = await makeHarness()
    const preview = await buildLitePreview(previewInput(ports))
    if (!preview.ok) throw new Error('preview failed')

    const original = store.getItems.bind(store)
    let reads = 0
    store.getItems = async (packId, clientId) => {
      reads += 1
      const items = await original(packId, clientId)
      // read 1 is authorizeLitePack's own preview; read 2 is the write: somebody edited a line in between
      return reads >= 2 ? items.map((item, index) => (index === 0 ? { ...item, text_line: 'Edited after the preview' } : item)) : items
    }

    const result = await authorizeLitePack(authorizeInput(ports, { expectedContentHash: preview.value.content_hash }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(409)
    expect(result.error).toBe('PACK_CHANGED_SINCE_PREVIEW')
    expect((await store.getPack(PACK_ID, CLIENT_ID))?.authorized_at).toBeNull()
  })

  it('authorises a healthy pack and stores fingerprints', async () => {
    const { store, ports, sendEvent } = await makeHarness()
    const preview = await buildLitePreview(previewInput(ports))
    if (!preview.ok) throw new Error('preview failed')

    const result = await authorizeLitePack(
      authorizeInput(ports, { expectedContentHash: preview.value.content_hash }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.mode).toBe('AUTHORIZED')
    if (result.value.mode !== 'AUTHORIZED') return
    expect(result.value.provider_impact).toBe('NONE')
    expect(result.value.item_count).toBe(3)

    const pack = await store.getPack(PACK_ID, CLIENT_ID)
    expect(pack?.authorized_at).toBe(NOW.toISOString())
    expect(pack?.authorized_by_email).toBe('pm@example.com')

    const items = await store.getItems(PACK_ID, CLIENT_ID)
    for (const item of items) {
      expect(item.authorized_fingerprint).toBe(computeItemFingerprint(item))
    }

    expect(sendEvent).toHaveBeenCalledTimes(1)
    const event = sendEvent.mock.calls[0][0]
    expect(event.name).toBe('story.pack.authorized')
    expect(event.data.provider_impact).toBe('NONE')
  })

  it('rejects a second authorise with 409 ALREADY_AUTHORIZED', async () => {
    const { ports } = await makeHarness()
    const preview = await buildLitePreview(previewInput(ports))
    if (!preview.ok) throw new Error('preview failed')
    const first = await authorizeLitePack(
      authorizeInput(ports, { expectedContentHash: preview.value.content_hash }),
    )
    expect(first.ok).toBe(true)
    const second = await authorizeLitePack(
      authorizeInput(ports, { expectedContentHash: preview.value.content_hash }),
    )
    expect(second).toEqual({ ok: false, status: 409, error: 'ALREADY_AUTHORIZED' })
  })

  it('rejects a revoked pack with 409 PACK_REVOKED', async () => {
    const { store, ports } = await makeHarness()
    const preview = await buildLitePreview(previewInput(ports))
    if (!preview.ok) throw new Error('preview failed')
    await store.revokePack({ packId: PACK_ID, clientId: CLIENT_ID, byEmail: 'pm@example.com', reason: 'x', now: NOW })
    const result = await authorizeLitePack(
      authorizeInput(ports, { expectedContentHash: preview.value.content_hash }),
    )
    expect(result).toEqual({ ok: false, status: 409, error: 'PACK_REVOKED' })
  })

  it('rejects a pack with blocking problems with 422', async () => {
    const { ports } = await makeHarness({ clientStatus: 'paused' })
    const preview = await buildLitePreview(previewInput(ports))
    if (!preview.ok) throw new Error('preview failed')
    const result = await authorizeLitePack(
      authorizeInput(ports, { expectedContentHash: preview.value.content_hash }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(422)
    expect(result.error).toBe('PACK_NOT_AUTHORIZABLE')
  })

  it('does not fail the authorise when the event fails', async () => {
    const { store, ports } = await makeHarness({ sendEventThrows: true })
    const preview = await buildLitePreview(previewInput(ports))
    if (!preview.ok) throw new Error('preview failed')
    const result = await authorizeLitePack(
      authorizeInput(ports, { expectedContentHash: preview.value.content_hash }),
    )
    expect(result.ok).toBe(true)
    const pack = await store.getPack(PACK_ID, CLIENT_ID)
    expect(pack?.authorized_at).toBe(NOW.toISOString())
  })
})

describe('revokeLitePack', () => {
  it('rejects a non-admin with 403', async () => {
    const { ports } = await makeHarness()
    const result = await revokeLitePack(revokeInput(ports, { actor: NON_ADMIN }))
    expect(result).toEqual({ ok: false, status: 403, error: 'GLOBAL_ADMIN_REQUIRED' })
  })

  it('rejects a client-limited admin with 403', async () => {
    const { ports } = await makeHarness()
    const result = await revokeLitePack(revokeInput(ports, { actor: LIMITED }))
    expect(result).toEqual({ ok: false, status: 403, error: 'GLOBAL_ADMIN_REQUIRED' })
  })

  it.each(['', '   '])('rejects an empty reason %j with BAD_REASON', async (reason) => {
    const { ports } = await makeHarness()
    const result = await revokeLitePack(revokeInput(ports, { reason }))
    expect(result).toEqual({ ok: false, status: 400, error: 'BAD_REASON' })
  })

  it('rejects a reason longer than 300 characters', async () => {
    const { ports } = await makeHarness()
    const result = await revokeLitePack(revokeInput(ports, { reason: 'x'.repeat(301) }))
    expect(result).toEqual({ ok: false, status: 400, error: 'BAD_REASON' })
  })

  it('returns NOTHING_TO_REVOKE for an unknown pack', async () => {
    const { ports } = await makeHarness()
    const result = await revokeLitePack(revokeInput(ports, { packId: 'nope' }))
    expect(result).toEqual({ ok: false, status: 404, error: 'NOTHING_TO_REVOKE' })
  })

  it('returns NOTHING_TO_REVOKE when revoked twice', async () => {
    const { ports } = await makeHarness()
    const first = await revokeLitePack(revokeInput(ports))
    expect(first.ok).toBe(true)
    const second = await revokeLitePack(revokeInput(ports))
    expect(second).toEqual({ ok: false, status: 404, error: 'NOTHING_TO_REVOKE' })
  })

  it('lists sent and in-flight items after a revoke', async () => {
    const { store, ports } = await makeHarness()
    await store.claimItem('item-1', NOW)
    await store.settleItem({ itemId: 'item-1', to: 'SENT', reasonCode: null, providerReceipt: 'fb-1', now: NOW })
    await store.claimItem('item-2', NOW)

    const result = await revokeLitePack(revokeInput(ports))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sent).toEqual([{ item_id: 'item-1', provider_receipt: 'fb-1' }])
    expect(result.value.in_flight).toEqual([{ item_id: 'item-2', status: 'CLAIMED' }])
  })

  it('does not undo the revoke when the event fails', async () => {
    const { store, ports } = await makeHarness({ sendEventThrows: true })
    const result = await revokeLitePack(revokeInput(ports))
    expect(result.ok).toBe(true)
    const pack = await store.getPack(PACK_ID, CLIENT_ID)
    expect(pack?.revoked_at).toBe(NOW.toISOString())
  })

  it('still succeeds with empty lists when the item read fails', async () => {
    const { store, ports } = await makeHarness()
    const original = store.getItems.bind(store)
    vi.spyOn(store, 'getItems').mockImplementation(async (packId: string, clientId: string) => {
      const pack = await store.getPack(packId, clientId)
      if (pack?.revoked_at !== null) throw new Error('read down')
      return original(packId, clientId)
    })
    const result = await revokeLitePack(revokeInput(ports))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sent).toEqual([])
    expect(result.value.in_flight).toEqual([])
    // and it says the summary is unavailable instead of pretending nothing was sent
    expect(result.value.summary_available).toBe(false)
  })

  it('a readable summary is marked available', async () => {
    const { ports } = await makeHarness()
    const result = await revokeLitePack(revokeInput(ports))
    expect(result.ok && result.value.summary_available).toBe(true)
  })
})
