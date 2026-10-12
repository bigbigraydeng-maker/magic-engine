import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  ingestStoryAssets,
  type StoryAssetPorts,
  type StoryManifestEntry,
} from '../pack-ingest'
import type { StoryChannel, StoryMediaKind } from '../types'

/** Build a fake ports object with sensible defaults; override per test. */
function makePorts(overrides: Partial<StoryAssetPorts> = {}): StoryAssetPorts {
  return {
    readFile: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
    probe: vi.fn(async () => ({ width: 1080, height: 1920, durationSec: null })),
    putIfAbsent: vi.fn(async (objectPath: string) => ({
      publicUrl: `https://cdn.example.com/${objectPath}`,
      created: true,
    })),
    ...overrides,
  }
}

/** Build a manifest entry with sensible defaults; override per test. */
function makeEntry(overrides: Partial<StoryManifestEntry> = {}): StoryManifestEntry {
  return {
    item_id: 'item-1',
    channel: 'facebook_story' as StoryChannel,
    file: '2026-10-13_01_tale.png',
    slot_at: '2026-10-13T09:00:00.000Z',
    media_kind: 'image' as StoryMediaKind,
    text_line: 'A short line',
    source_record_ids: ['rec-1'],
    website_ref: 'https://example.com/about',
    website_checked_on: '2026-10-12',
    has_reply_cta: false,
    ...overrides,
  }
}

const ACCOUNTS: Record<StoryChannel, string> = {
  facebook_story: 'page-123',
  instagram_story: 'ig-456',
}

function baseInput(entries: StoryManifestEntry[], ports: StoryAssetPorts) {
  return {
    clientId: 'client-1',
    clientSlug: 'acme-tours',
    packId: 'pack-1',
    accountIds: ACCOUNTS,
    entries,
    ports,
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('ingestStoryAssets — happy path', () => {
  it('ingests a png image with correct hash, path and fields', async () => {
    const bytes = new Uint8Array([10, 20, 30, 40, 50])
    const ports = makePorts({ readFile: vi.fn(async () => bytes) })
    const entry = makeEntry()

    const result = await ingestStoryAssets(baseInput([entry], ports))

    expect(result.rejected).toEqual([])
    expect(result.items).toHaveLength(1)

    const expectedHash = sha256Hex(bytes)
    const expectedPath = `story-assets/acme-tours/pack-1/${expectedHash}.png`

    expect(result.items[0]).toEqual({
      item_id: 'item-1',
      pack_id: 'pack-1',
      client_id: 'client-1',
      channel: 'facebook_story',
      slot_at: '2026-10-13T09:00:00.000Z',
      media_kind: 'image',
      media_url: `https://cdn.example.com/${expectedPath}`,
      media_sha256: expectedHash,
      text_line: 'A short line',
      account_id: 'page-123',
      source_record_ids: ['rec-1'],
      website_ref: 'https://example.com/about',
      website_checked_on: '2026-10-12',
      has_reply_cta: false,
    })

    expect(ports.putIfAbsent).toHaveBeenCalledTimes(1)
    const call = vi.mocked(ports.putIfAbsent).mock.calls[0]
    expect(call[0]).toBe(expectedPath)
    expect(call[1]).toBe(bytes)
    expect(call[2]).toBe('image/png')
  })

  it('ingests an mp4 video with correct hash, path and content type', async () => {
    const bytes = new Uint8Array([9, 8, 7, 6])
    const ports = makePorts({
      readFile: vi.fn(async () => bytes),
      probe: vi.fn(async () => ({ width: 1080, height: 1920, durationSec: 12 })),
    })
    const entry = makeEntry({
      item_id: 'vid-1',
      channel: 'instagram_story',
      file: 'clip.mp4',
      media_kind: 'video',
    })

    const result = await ingestStoryAssets(baseInput([entry], ports))

    expect(result.rejected).toEqual([])
    const expectedHash = sha256Hex(bytes)
    const expectedPath = `story-assets/acme-tours/pack-1/${expectedHash}.mp4`
    expect(result.items[0].media_sha256).toBe(expectedHash)
    expect(result.items[0].media_url).toBe(`https://cdn.example.com/${expectedPath}`)
    expect(result.items[0].account_id).toBe('ig-456')

    const call = vi.mocked(ports.putIfAbsent).mock.calls[0]
    expect(call[0]).toBe(expectedPath)
    expect(call[2]).toBe('video/mp4')
  })

  it('normalises .jpeg to a .jpg object path and image/jpeg content type', async () => {
    const bytes = new Uint8Array([1, 1, 1])
    const ports = makePorts({ readFile: vi.fn(async () => bytes) })
    const entry = makeEntry({ file: 'photo.jpeg' })

    const result = await ingestStoryAssets(baseInput([entry], ports))

    expect(result.rejected).toEqual([])
    const expectedHash = sha256Hex(bytes)
    const expectedPath = `story-assets/acme-tours/pack-1/${expectedHash}.jpg`
    const call = vi.mocked(ports.putIfAbsent).mock.calls[0]
    expect(call[0]).toBe(expectedPath)
    expect(call[2]).toBe('image/jpeg')
  })

  it('succeeds when putIfAbsent reports created=false (already uploaded)', async () => {
    const bytes = new Uint8Array([5, 5, 5])
    const ports = makePorts({
      readFile: vi.fn(async () => bytes),
      putIfAbsent: vi.fn(async (objectPath: string) => ({
        publicUrl: `https://cdn.example.com/${objectPath}`,
        created: false,
      })),
    })

    const result = await ingestStoryAssets(baseInput([makeEntry()], ports))

    expect(result.rejected).toEqual([])
    expect(result.items).toHaveLength(1)
  })
})

describe('ingestStoryAssets — rejections', () => {
  it('rejects BAD_PATH for empty, absolute, traversal, backslash and NUL paths', async () => {
    const badFiles = ['', '/etc/x.png', '../x.png', 'a/../../x.png', 'a\\b.png', 'a\0b.png']
    const ports = makePorts()
    const entries = badFiles.map((file, i) => makeEntry({ item_id: `bad-${i}`, file }))

    const result = await ingestStoryAssets(baseInput(entries, ports))

    expect(result.items).toEqual([])
    expect(result.rejected.map((r) => r.reason_code)).toEqual(
      badFiles.map(() => 'BAD_PATH'),
    )
    expect(ports.readFile).not.toHaveBeenCalled()
  })

  it('never calls readFile for path traversal attempts', async () => {
    const ports = makePorts()
    const entries = [
      makeEntry({ item_id: 't1', file: '../x.png' }),
      makeEntry({ item_id: 't2', file: 'a/../../x.png' }),
      makeEntry({ item_id: 't3', file: '/etc/x.png' }),
    ]

    const result = await ingestStoryAssets(baseInput(entries, ports))

    expect(result.rejected).toHaveLength(3)
    expect(ports.readFile).not.toHaveBeenCalled()
  })

  it('rejects BAD_EXTENSION for wrong or missing extensions', async () => {
    const ports = makePorts()
    const entries = [
      makeEntry({ item_id: 'e1', file: 'a.gif' }),
      makeEntry({ item_id: 'e2', file: 'noext' }),
      makeEntry({ item_id: 'e3', file: 'a.mp4', media_kind: 'image' }),
      makeEntry({ item_id: 'e4', file: 'a.png', media_kind: 'video' }),
    ]

    const result = await ingestStoryAssets(baseInput(entries, ports))

    expect(result.rejected.map((r) => r.reason_code)).toEqual([
      'BAD_EXTENSION',
      'BAD_EXTENSION',
      'BAD_EXTENSION',
      'BAD_EXTENSION',
    ])
    expect(ports.readFile).not.toHaveBeenCalled()
  })

  it('rejects READ_FAILED when readFile throws', async () => {
    const ports = makePorts({
      readFile: vi.fn(async () => {
        throw new Error('boom')
      }),
    })

    const result = await ingestStoryAssets(baseInput([makeEntry()], ports))

    expect(result.rejected).toEqual([
      { item_id: 'item-1', channel: 'facebook_story', reason_code: 'READ_FAILED' },
    ])
  })

  it('rejects EMPTY_FILE for zero-length bytes', async () => {
    const ports = makePorts({ readFile: vi.fn(async () => new Uint8Array(0)) })

    const result = await ingestStoryAssets(baseInput([makeEntry()], ports))

    expect(result.rejected[0].reason_code).toBe('EMPTY_FILE')
  })

  it('rejects PROBE_FAILED when probe throws', async () => {
    const ports = makePorts({
      probe: vi.fn(async () => {
        throw new Error('probe boom')
      }),
    })

    const result = await ingestStoryAssets(baseInput([makeEntry()], ports))

    expect(result.rejected[0].reason_code).toBe('PROBE_FAILED')
  })

  it('rejects BAD_ASPECT for wrong ratio or too-small width', async () => {
    const ports = makePorts({
      probe: vi.fn(async () => ({ width: 1080, height: 1080, durationSec: null })),
    })
    const smallPorts = makePorts({
      probe: vi.fn(async () => ({ width: 500, height: 888, durationSec: null })),
    })

    const r1 = await ingestStoryAssets(baseInput([makeEntry()], ports))
    const r2 = await ingestStoryAssets(baseInput([makeEntry()], smallPorts))

    expect(r1.rejected[0].reason_code).toBe('BAD_ASPECT')
    expect(r2.rejected[0].reason_code).toBe('BAD_ASPECT')
  })

  it('rejects BAD_DURATION for missing or too-long video duration', async () => {
    const missing = makePorts({
      probe: vi.fn(async () => ({ width: 1080, height: 1920, durationSec: null })),
    })
    const tooLong = makePorts({
      probe: vi.fn(async () => ({ width: 1080, height: 1920, durationSec: 30 })),
    })
    const entry = makeEntry({ file: 'clip.mp4', media_kind: 'video' })

    const r1 = await ingestStoryAssets(baseInput([entry], missing))
    const r2 = await ingestStoryAssets(baseInput([entry], tooLong))

    expect(r1.rejected[0].reason_code).toBe('BAD_DURATION')
    expect(r2.rejected[0].reason_code).toBe('BAD_DURATION')
  })

  it('honours a custom maxVideoSeconds', async () => {
    const ports = makePorts({
      probe: vi.fn(async () => ({ width: 1080, height: 1920, durationSec: 20 })),
    })
    const entry = makeEntry({ file: 'clip.mp4', media_kind: 'video' })

    const result = await ingestStoryAssets({
      ...baseInput([entry], ports),
      maxVideoSeconds: 30,
    })

    expect(result.rejected).toEqual([])
    expect(result.items).toHaveLength(1)
  })

  it('rejects UPLOAD_FAILED when putIfAbsent throws', async () => {
    const ports = makePorts({
      putIfAbsent: vi.fn(async () => {
        throw new Error('upload boom')
      }),
    })

    const result = await ingestStoryAssets(baseInput([makeEntry()], ports))

    expect(result.rejected[0].reason_code).toBe('UPLOAD_FAILED')
  })

  it('rejects URL_NOT_HTTPS when publicUrl is not https', async () => {
    const ports = makePorts({
      putIfAbsent: vi.fn(async () => ({
        publicUrl: 'http://cdn.example.com/x.png',
        created: true,
      })),
    })

    const result = await ingestStoryAssets(baseInput([makeEntry()], ports))

    expect(result.rejected[0].reason_code).toBe('URL_NOT_HTTPS')
  })

  it('rejects NO_ACCOUNT when the channel account id is missing', async () => {
    const ports = makePorts()
    const entry = makeEntry({ channel: 'instagram_story' })
    const input = {
      ...baseInput([entry], ports),
      accountIds: { facebook_story: 'page-123', instagram_story: '' },
    }

    const result = await ingestStoryAssets(input)

    expect(result.rejected[0].reason_code).toBe('NO_ACCOUNT')
    expect(ports.readFile).not.toHaveBeenCalled()
  })
})

describe('ingestStoryAssets — sequencing and duplicates', () => {
  it('continues past a bad entry to the next good entry', async () => {
    const bytes = new Uint8Array([7, 7, 7])
    const ports = makePorts({ readFile: vi.fn(async () => bytes) })
    const entries = [
      makeEntry({ item_id: 'bad', file: 'a.gif' }),
      makeEntry({ item_id: 'good', file: 'b.png' }),
    ]

    const result = await ingestStoryAssets(baseInput(entries, ports))

    expect(result.rejected.map((r) => r.item_id)).toEqual(['bad'])
    expect(result.items.map((i) => i.item_id)).toEqual(['good'])
  })

  it('rejects DUPLICATE_ITEM for the same (item_id, channel) and keeps the first', async () => {
    const bytes = new Uint8Array([3, 3, 3])
    const ports = makePorts({ readFile: vi.fn(async () => bytes) })
    const entries = [
      makeEntry({ item_id: 'dup', file: 'first.png' }),
      makeEntry({ item_id: 'dup', file: 'second.png' }),
    ]

    const result = await ingestStoryAssets(baseInput(entries, ports))

    expect(result.items).toHaveLength(1)
    expect(result.rejected).toEqual([
      { item_id: 'dup', channel: 'facebook_story', reason_code: 'DUPLICATE_ITEM' },
    ])
    expect(ports.readFile).toHaveBeenCalledTimes(1)
  })

  it('allows the same item_id on different channels', async () => {
    const bytes = new Uint8Array([4, 4, 4])
    const ports = makePorts({ readFile: vi.fn(async () => bytes) })
    const entries = [
      makeEntry({ item_id: 'shared', channel: 'facebook_story' }),
      makeEntry({ item_id: 'shared', channel: 'instagram_story' }),
    ]

    const result = await ingestStoryAssets(baseInput(entries, ports))

    expect(result.items).toHaveLength(2)
    expect(result.rejected).toEqual([])
  })
})

describe('ingestStoryAssets — clientSlug validation', () => {
  it('throws for an invalid clientSlug', async () => {
    const ports = makePorts()
    const input = { ...baseInput([makeEntry()], ports), clientSlug: 'Bad Slug!' }

    await expect(ingestStoryAssets(input)).rejects.toThrow(/Invalid clientSlug/)
  })

  it('throws for an empty clientSlug', async () => {
    const ports = makePorts()
    const input = { ...baseInput([makeEntry()], ports), clientSlug: '' }

    await expect(ingestStoryAssets(input)).rejects.toThrow(/Invalid clientSlug/)
  })
})
