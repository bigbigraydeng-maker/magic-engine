/**
 * Story "lite" — sweep tests (draft). Exercises `runStorySweep` against the in-memory store with
 * injected ports. Covers rehearsal, live, every pre-send check, timing, races, and error mapping.
 */
import { describe, expect, it, vi } from 'vitest'

import { PagePublishError } from '@/lib/meta/page-posts'

import { computeItemFingerprint } from '../fingerprint'
import { InMemoryLiteStore } from '../in-memory-store'
import { DEFAULT_SWEEP_CONFIG, readLiteSwitches, runStorySweep, type SenderDeps, type SweepConfig } from '../sender'
import type { LiteItem, LitePack, LiteSwitches, NewLiteItem } from '../types'

const NOW = new Date('2026-10-12T12:00:00.000Z')
const CLIENT = 'client-1'
const PAGE = '1234567890'
const PACK = 'pack-1'

function makeItem(overrides: Partial<NewLiteItem> = {}): NewLiteItem {
  return {
    item_id: 'item-1',
    channel: 'facebook_story',
    slot_at: NOW.toISOString(),
    media_kind: 'image',
    media_url: 'https://cdn.example.com/a.jpg',
    media_sha256: 'a'.repeat(64),
    text_line: 'Hello world',
    account_id: PAGE,
    source_ref: 'https://example.com/source',
    ...overrides,
  }
}

async function seedAuthorizedPack(
  store: InMemoryLiteStore,
  items: NewLiteItem[] = [makeItem()],
  opts: { clientStatus?: string | null; pageId?: string | null } = {},
): Promise<void> {
  store.seedClient(CLIENT, {
    facebook_page_id: opts.pageId === undefined ? PAGE : opts.pageId,
    client_status: opts.clientStatus === undefined ? 'active' : opts.clientStatus,
  })
  await store.insertPack({ id: PACK, client_id: CLIENT, title: 'Pack', now: NOW }, items)
  const stored = await store.getItems(PACK, CLIENT)
  const fingerprints: Record<string, string> = {}
  for (const item of stored) fingerprints[item.item_id] = computeItemFingerprint(item)
  await store.authorizePack({
    packId: PACK,
    clientId: CLIENT,
    byEmail: 'admin@example.com',
    byUserId: 'admin-1',
    now: NOW,
    expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
    contentHash: 'c'.repeat(64),
    fingerprints,
  })
}

function makeDeps(
  store: InMemoryLiteStore,
  overrides: Partial<SenderDeps> = {},
  switches: LiteSwitches = { live: false, clientIds: [] },
  config: SweepConfig = DEFAULT_SWEEP_CONFIG,
): SenderDeps {
  return {
    now: NOW,
    store,
    switches,
    config,
    checkFile: vi.fn(async () => 'OK' as const),
    getPageToken: vi.fn(async () => 'token-1'),
    publish: vi.fn(async () => ({ postId: 'story-1' })),
    emit: vi.fn(async () => undefined),
    ...overrides,
  }
}

const LIVE: LiteSwitches = { live: true, clientIds: [CLIENT] }

describe('readLiteSwitches', () => {
  it('is live only for the exact string "true"', () => {
    expect(readLiteSwitches({ STORY_AUTO_PUBLISH_LIVE: 'true' }).live).toBe(true)
    expect(readLiteSwitches({ STORY_AUTO_PUBLISH_LIVE: 'TRUE' }).live).toBe(false)
    expect(readLiteSwitches({ STORY_AUTO_PUBLISH_LIVE: '1' }).live).toBe(false)
    expect(readLiteSwitches({ STORY_AUTO_PUBLISH_LIVE: ' true' }).live).toBe(false)
    expect(readLiteSwitches({}).live).toBe(false)
  })

  it('parses the client list: trimmed, lowercased, non-empty', () => {
    expect(readLiteSwitches({ STORY_AUTO_PUBLISH_CLIENTS: ' A , b ,, C ' }).clientIds).toEqual(['a', 'b', 'c'])
    expect(readLiteSwitches({}).clientIds).toEqual([])
  })
})

describe('runStorySweep — rehearsal', () => {
  it('records DRY_RUN, never publishes, leaves items PENDING, records the check', async () => {
    const store = new InMemoryLiteStore()
    await seedAuthorizedPack(store)
    const deps = makeDeps(store)

    const summary = await runStorySweep(deps)

    expect(summary.counts.DRY_RUN).toBe(1)
    expect(deps.publish).not.toHaveBeenCalled()
    expect(deps.getPageToken).not.toHaveBeenCalled()
    const items = await store.getItems(PACK, CLIENT)
    expect(items[0].status).toBe('PENDING')
    expect(items[0].last_check_result).toBe('OK')
  })

  it('reports each failure reason in rehearsal', async () => {
    const store = new InMemoryLiteStore()
    await seedAuthorizedPack(store, [makeItem()], { clientStatus: 'paused' })
    const deps = makeDeps(store)

    const summary = await runStorySweep(deps)

    expect(summary.records[0].outcome).toBe('DRY_RUN')
    expect(summary.records[0].reason_code).toBe('CLIENT_NOT_ACTIVE')
    const items = await store.getItems(PACK, CLIENT)
    expect(items[0].last_check_result).toBe('CLIENT_NOT_ACTIVE')
  })
})

describe('runStorySweep — timing', () => {
  it('skips an item that is not due yet', async () => {
    const store = new InMemoryLiteStore()
    const slot = new Date(NOW.getTime() + 60 * 60 * 1000).toISOString()
    await seedAuthorizedPack(store, [makeItem({ slot_at: slot })])
    const deps = makeDeps(store)

    const summary = await runStorySweep(deps)

    expect(summary.counts.SKIPPED_NOT_DUE).toBe(1)
    expect(deps.publish).not.toHaveBeenCalled()
  })

  it('marks a too-late item MISSED and never sends it', async () => {
    const store = new InMemoryLiteStore()
    const slot = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString()
    await seedAuthorizedPack(store, [makeItem({ slot_at: slot })])
    const deps = makeDeps(store, {}, LIVE)

    const summary = await runStorySweep(deps)

    expect(summary.counts.MISSED).toBe(1)
    expect(deps.publish).not.toHaveBeenCalled()
    const items = await store.getItems(PACK, CLIENT)
    expect(items[0].status).toBe('MISSED')
  })

  it('blocks an unreadable slot', async () => {
    const store = new InMemoryLiteStore()
    await seedAuthorizedPack(store, [makeItem({ slot_at: 'not-a-date' })])
    const deps = makeDeps(store, {}, LIVE)

    const summary = await runStorySweep(deps)

    expect(summary.counts.BLOCKED).toBe(1)
    expect(summary.records[0].reason_code).toBe('BAD_SLOT')
    expect(deps.publish).not.toHaveBeenCalled()
  })
})

describe('runStorySweep — live', () => {
  it('sends a due item and records the receipt', async () => {
    const store = new InMemoryLiteStore()
    await seedAuthorizedPack(store)
    const deps = makeDeps(store, {}, LIVE)

    const summary = await runStorySweep(deps)

    expect(summary.counts.SENT).toBe(1)
    expect(deps.publish).toHaveBeenCalledTimes(1)
    const items = await store.getItems(PACK, CLIENT)
    expect(items[0].status).toBe('SENT')
    expect(items[0].provider_receipt).toBe('story-1')
    const emit = deps.emit as unknown as ReturnType<typeof vi.fn>
    const sentEvent = emit.mock.calls.find((call) => (call[0] as { data: { status: string } }).data.status === 'SENT')
    expect(sentEvent).toBeDefined()
    expect((sentEvent![0] as { data: { provider_impact: string } }).data.provider_impact).toBe('STORY_PUBLISHED')
  })

  it('treats a client not in the list as rehearsal', async () => {
    const store = new InMemoryLiteStore()
    await seedAuthorizedPack(store)
    const deps = makeDeps(store, {}, { live: true, clientIds: ['someone-else'] })

    const summary = await runStorySweep(deps)

    expect(summary.counts.DRY_RUN).toBe(1)
    expect(deps.publish).not.toHaveBeenCalled()
  })
})

describe('runStorySweep — pre-send checks', () => {
  it('blocks when the client is paused', async () => {
    const store = new InMemoryLiteStore()
    await seedAuthorizedPack(store, [makeItem()], { clientStatus: 'paused' })
    const deps = makeDeps(store, {}, LIVE)

    const summary = await runStorySweep(deps)

    expect(summary.counts.BLOCKED).toBe(1)
    expect(summary.records[0].reason_code).toBe('CLIENT_NOT_ACTIVE')
    expect(deps.publish).not.toHaveBeenCalled()
  })

  it('blocks on a page mismatch', async () => {
    const store = new InMemoryLiteStore()
    await seedAuthorizedPack(store, [makeItem()], { pageId: '9999999999' })
    const deps = makeDeps(store, {}, LIVE)

    const summary = await runStorySweep(deps)

    expect(summary.counts.BLOCKED).toBe(1)
    expect(summary.records[0].reason_code).toBe('ACCOUNT_MISMATCH')
  })

  it('blocks an unsupported channel', async () => {
    const store = new InMemoryLiteStore()
    await seedAuthorizedPack(store, [makeItem({ channel: 'instagram_story' })])
    const deps = makeDeps(store, {}, LIVE)

    const summary = await runStorySweep(deps)

    expect(summary.counts.BLOCKED).toBe(1)
    expect(summary.records[0].reason_code).toBe('CHANNEL_NOT_SUPPORTED')
  })

  it('blocks when the text changed after authorisation', async () => {
    const store = new InMemoryLiteStore()
    await seedAuthorizedPack(store)
    // Mutate the stored row so the fingerprint no longer matches.
    const items = await store.getItems(PACK, CLIENT)
    const mutated: LiteItem = { ...items[0], text_line: 'Changed after authorisation' }
    ;(store as unknown as { items: Map<string, LiteItem> }).items.set(mutated.item_id, mutated)
    const deps = makeDeps(store, {}, LIVE)

    const summary = await runStorySweep(deps)

    expect(summary.counts.BLOCKED).toBe(1)
    expect(summary.records[0].reason_code).toBe('FINGERPRINT_CHANGED')
  })

  it('blocks when the file changed', async () => {
    const store = new InMemoryLiteStore()
    await seedAuthorizedPack(store)
    const deps = makeDeps(store, { checkFile: vi.fn(async () => 'CHANGED' as const) }, LIVE)

    const summary = await runStorySweep(deps)

    expect(summary.counts.BLOCKED).toBe(1)
    expect(summary.records[0].reason_code).toBe('FILE_CHANGED')
  })

  it('returns an unreachable file to PENDING for the next sweep', async () => {
    const store = new InMemoryLiteStore()
    await seedAuthorizedPack(store)
    const deps = makeDeps(store, { checkFile: vi.fn(async () => 'UNREACHABLE' as const) }, LIVE)

    const summary = await runStorySweep(deps)

    expect(summary.counts.RETRY_LATER).toBe(1)
    expect(summary.records[0].reason_code).toBe('FILE_UNREACHABLE')
    const items = await store.getItems(PACK, CLIENT)
    expect(items[0].status).toBe('PENDING')
    expect(deps.publish).not.toHaveBeenCalled()
  })

  it('treats a throwing checkFile as UNREACHABLE', async () => {
    const store = new InMemoryLiteStore()
    await seedAuthorizedPack(store)
    const deps = makeDeps(
      store,
      {
        checkFile: vi.fn(async () => {
          throw new Error('network down')
        }),
      },
      LIVE,
    )

    const summary = await runStorySweep(deps)

    expect(summary.counts.RETRY_LATER).toBe(1)
    expect(summary.records[0].reason_code).toBe('FILE_UNREACHABLE')
  })

  it('blocks when no page token can be found', async () => {
    const store = new InMemoryLiteStore()
    await seedAuthorizedPack(store)
    const deps = makeDeps(store, { getPageToken: vi.fn(async () => null) }, LIVE)

    const summary = await runStorySweep(deps)

    expect(summary.counts.BLOCKED).toBe(1)
    expect(summary.records[0].reason_code).toBe('NO_PAGE_TOKEN')
    expect(deps.publish).not.toHaveBeenCalled()
  })
})

describe('runStorySweep — pack state', () => {
  it('does nothing for a revoked pack', async () => {
    const store = new InMemoryLiteStore()
    await seedAuthorizedPack(store)
    await store.revokePack({ packId: PACK, clientId: CLIENT, byEmail: 'a@b.c', reason: 'stop', now: NOW })
    const deps = makeDeps(store, {}, LIVE)

    const summary = await runStorySweep(deps)

    expect(summary.records).toHaveLength(0)
    expect(deps.publish).not.toHaveBeenCalled()
  })

  it('does nothing for an expired pack', async () => {
    const store = new InMemoryLiteStore()
    await seedAuthorizedPack(store)
    const later = new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000)
    const deps = makeDeps(store, { now: later }, LIVE)

    const summary = await runStorySweep(deps)

    expect(summary.records).toHaveLength(0)
    expect(deps.publish).not.toHaveBeenCalled()
  })

  it('does nothing for an unauthorised pack', async () => {
    const store = new InMemoryLiteStore()
    store.seedClient(CLIENT, { facebook_page_id: PAGE, client_status: 'active' })
    await store.insertPack({ id: PACK, client_id: CLIENT, title: 'Pack', now: NOW }, [makeItem()])
    const deps = makeDeps(store, {}, LIVE)

    const summary = await runStorySweep(deps)

    expect(summary.records).toHaveLength(0)
    expect(deps.publish).not.toHaveBeenCalled()
  })

  it('retries later when the pack is revoked between listing and claim', async () => {
    const store = new InMemoryLiteStore()
    await seedAuthorizedPack(store)
    // A wrapper whose getPack returns a revoked copy: simulates a revoke racing the sweep.
    const revoked: LitePack = {
      ...(await store.getPack(PACK, CLIENT))!,
      revoked_at: NOW.toISOString(),
      revoked_by_email: 'admin@example.com',
      revoked_reason: 'race',
    }
    const wrapper = Object.create(store) as InMemoryLiteStore
    wrapper.getPack = async () => revoked
    const deps = makeDeps(wrapper, {}, LIVE)

    const summary = await runStorySweep(deps)

    expect(summary.counts.RETRY_LATER).toBe(1)
    expect(summary.records[0].reason_code).toBe('PACK_NOT_LIVE')
    expect(deps.publish).not.toHaveBeenCalled()
    const items = await store.getItems(PACK, CLIENT)
    expect(items[0].status).toBe('PENDING')
  })
})

describe('runStorySweep — races and provider errors', () => {
  it('never sends twice when two sweeps run over the same store', async () => {
    const store = new InMemoryLiteStore()
    await seedAuthorizedPack(store)
    const deps = makeDeps(store, {}, LIVE)

    await runStorySweep(deps)
    await runStorySweep(deps)

    expect(deps.publish).toHaveBeenCalledTimes(1)
  })

  it('maps a rejected publish to FAILED', async () => {
    const store = new InMemoryLiteStore()
    await seedAuthorizedPack(store)
    const deps = makeDeps(
      store,
      {
        publish: vi.fn(async () => {
          throw new PagePublishError('rejected', { certainty: 'rejected' })
        }),
      },
      LIVE,
    )

    const summary = await runStorySweep(deps)

    expect(summary.counts.FAILED).toBe(1)
    expect(summary.records[0].reason_code).toBe('PROVIDER_REJECTED')
    const items = await store.getItems(PACK, CLIENT)
    expect(items[0].status).toBe('FAILED')
  })

  it('returns a rate-limited publish to PENDING', async () => {
    const store = new InMemoryLiteStore()
    await seedAuthorizedPack(store)
    const deps = makeDeps(
      store,
      {
        publish: vi.fn(async () => {
          throw new PagePublishError('rate limited', { certainty: 'rate_limited' })
        }),
      },
      LIVE,
    )

    const summary = await runStorySweep(deps)

    expect(summary.counts.RETRY_LATER).toBe(1)
    expect(summary.records[0].reason_code).toBe('RATE_LIMITED')
    const items = await store.getItems(PACK, CLIENT)
    expect(items[0].status).toBe('PENDING')
  })

  it('maps an unknown publish error to UNKNOWN_OUTCOME and never retries it', async () => {
    const store = new InMemoryLiteStore()
    await seedAuthorizedPack(store)
    const deps = makeDeps(
      store,
      {
        publish: vi.fn(async () => {
          throw new PagePublishError('boom', { certainty: 'unknown' })
        }),
      },
      LIVE,
    )

    const first = await runStorySweep(deps)
    expect(first.counts.UNKNOWN_OUTCOME).toBe(1)
    const items = await store.getItems(PACK, CLIENT)
    expect(items[0].status).toBe('UNKNOWN_OUTCOME')

    const second = await runStorySweep(deps)
    expect(second.records).toHaveLength(0)
    expect(deps.publish).toHaveBeenCalledTimes(1)
  })

  it('expires a stale claim to UNKNOWN_OUTCOME and never sends it', async () => {
    const store = new InMemoryLiteStore()
    await seedAuthorizedPack(store)
    // Claim the item, then move the clock past the stale threshold.
    await store.claimItem('item-1', new Date(NOW.getTime() - 60 * 60 * 1000))
    const deps = makeDeps(store, {}, LIVE)

    const summary = await runStorySweep(deps)

    expect(summary.staleExpired).toEqual(['item-1'])
    const items = await store.getItems(PACK, CLIENT)
    expect(items[0].status).toBe('UNKNOWN_OUTCOME')
    expect(deps.publish).not.toHaveBeenCalled()
  })

  it('does not change outcomes when emit fails', async () => {
    const store = new InMemoryLiteStore()
    await seedAuthorizedPack(store)
    const deps = makeDeps(
      store,
      {
        emit: vi.fn(async () => {
          throw new Error('event bus down')
        }),
      },
      LIVE,
    )

    const summary = await runStorySweep(deps)

    expect(summary.counts.SENT).toBe(1)
    const items = await store.getItems(PACK, CLIENT)
    expect(items[0].status).toBe('SENT')
  })
})
