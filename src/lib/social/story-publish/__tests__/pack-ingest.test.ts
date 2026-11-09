import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  ingestStoryAssets,
  type StoryAssetPorts,
  type StoryManifestEntry,
} from '../pack-ingest'
import type { StoryChannel, StoryMediaKind } from '../types'

const PUBLIC_BASE_URL = 'https://cdn.example.com/public/'

const CLIENT_ID = '11111111-1111-1111-1111-111111111111'
const PACK_ID = '22222222-2222-2222-2222-222222222222'
const ITEM_ID = '33333333-3333-3333-3333-333333333333'

const ACCOUNTS: Record<StoryChannel, string> = {
  facebook_story: '1234567890',
  instagram_story: '9876543210',
}

/** Build a fake ports object with sensible defaults; override per test. */
function makePorts(overrides: Partial<StoryAssetPorts> = {}): StoryAssetPorts {
  return {
    readFile: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
    probe: vi.fn(async () => ({
      width: 1080,
      height: 1920,
      durationSec: null,
      format: 'png' as const,
    })),
    putIfAbsent: vi.fn(async (objectPath: string) => ({
      publicUrl: `${PUBLIC_BASE_URL}${objectPath}`,
      created: true,
      existingSha256: null,
    })),
    ...overrides,
  }
}

/** Build a manifest entry with sensible defaults; override per test. */
function validEntry(overrides: Partial<StoryManifestEntry> = {}): StoryManifestEntry {
  return {
    item_id: ITEM_ID,
    channel: 'facebook_story' as StoryChannel,
    file: '2026-10-13_01_tale.png',
    slot_at: '2026-10-13T09:00:00.000Z',
    media_kind: 'image' as StoryMediaKind,
    text_line: 'A short line',
    source_record_ids: ['rec-1'],
    website_ref: 'https://example.com/about',
    website_checked_on: '2026-10-12',
    has_reply_cta: false,
    contains_price: false,
    names_place: false,
    ...overrides,
  }
}

function baseInput(entries: StoryManifestEntry[], ports: StoryAssetPorts) {
  return {
    clientId: CLIENT_ID,
    clientSlug: 'acme-tours',
    packId: PACK_ID,
    accountIds: ACCOUNTS,
    publicBaseUrl: PUBLIC_BASE_URL,
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
    const entry = validEntry()

    const result = await ingestStoryAssets(baseInput([entry], ports))

    expect(result.rejected).toEqual([])
    expect(result.items).toHaveLength(1)

    const expectedHash = sha256Hex(bytes)
    const expectedPath = `story-assets/acme-tours/${PACK_ID}/${expectedHash}.png`

    expect(result.items[0]).toEqual({
      item_id: ITEM_ID,
      pack_id: PACK_ID,
      client_id: CLIENT_ID,
      channel: 'facebook_story',
      slot_at: '2026-10-13T09:00:00.000Z',
      media_kind: 'image',
      media_url: `${PUBLIC_BASE_URL}${expectedPath}`,
      media_sha256: expectedHash,
      text_line: 'A short line',
      account_id: '1234567890',
      source_record_ids: ['rec-1'],
      website_ref: 'https://example.com/about',
      website_checked_on: '2026-10-12',
      has_reply_cta: false,
      contains_price: false,
      names_place: false,
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
      probe: vi.fn(async () => ({
        width: 1080,
        height: 1920,
        durationSec: 12,
        format: 'mp4' as const,
      })),
    })
    const entry = validEntry({
      item_id: '44444444-4444-4444-4444-444444444444',
      channel: 'instagram_story',
      file: 'clip.mp4',
      media_kind: 'video',
    })

    const result = await ingestStoryAssets(baseInput([entry], ports))

    expect(result.rejected).toEqual([])
    const expectedHash = sha256Hex(bytes)
    const expectedPath = `story-assets/acme-tours/${PACK_ID}/${expectedHash}.mp4`
    expect(result.items[0].media_sha256).toBe(expectedHash)
    expect(result.items[0].media_url).toBe(`${PUBLIC_BASE_URL}${expectedPath}`)
    expect(result.items[0].account_id).toBe('9876543210')

    const call = vi.mocked(ports.putIfAbsent).mock.calls[0]
    expect(call[0]).toBe(expectedPath)
    expect(call[2]).toBe('video/mp4')
  })

  it('normalises .jpeg to a .jpg object path and image/jpeg content type', async () => {
    const bytes = new Uint8Array([1, 1, 1])
    const ports = makePorts({
      readFile: vi.fn(async () => bytes),
      probe: vi.fn(async () => ({
        width: 1080,
        height: 1920,
        durationSec: null,
        format: 'jpeg' as const,
      })),
    })
    const entry = validEntry({ file: 'photo.jpeg' })

    const result = await ingestStoryAssets(baseInput([entry], ports))

    expect(result.rejected).toEqual([])
    const expectedHash = sha256Hex(bytes)
    const expectedPath = `story-assets/acme-tours/${PACK_ID}/${expectedHash}.jpg`
    const call = vi.mocked(ports.putIfAbsent).mock.calls[0]
    expect(call[0]).toBe(expectedPath)
    expect(call[2]).toBe('image/jpeg')
  })

  it('succeeds when putIfAbsent reports created=false with a matching hash', async () => {
    const bytes = new Uint8Array([5, 5, 5])
    const hash = sha256Hex(bytes)
    const ports = makePorts({
      readFile: vi.fn(async () => bytes),
      putIfAbsent: vi.fn(async (objectPath: string) => ({
        publicUrl: `${PUBLIC_BASE_URL}${objectPath}`,
        created: false,
        existingSha256: hash,
      })),
    })

    const result = await ingestStoryAssets(baseInput([validEntry()], ports))

    expect(result.rejected).toEqual([])
    expect(result.items).toHaveLength(1)
  })
})

describe('ingestStoryAssets — field validation', () => {
  it('rejects BAD_ITEM_ID for non-UUID ids and ids containing a colon', async () => {
    const ports = makePorts()
    const entries = [
      validEntry({ item_id: 'item-1' }),
      validEntry({ item_id: '33333333-3333-3333-3333-333333333333:facebook_story' }),
      validEntry({ item_id: '' }),
    ]

    const result = await ingestStoryAssets(baseInput(entries, ports))

    expect(result.items).toEqual([])
    expect(result.rejected.map((r) => r.reason_code)).toEqual([
      'BAD_ITEM_ID',
      'BAD_ITEM_ID',
      'BAD_ITEM_ID',
    ])
    expect(ports.readFile).not.toHaveBeenCalled()
  })

  it('rejects BAD_FIELDS for bad slot_at, text_line, source ids and website fields', async () => {
    const ports = makePorts()
    const entries = [
      validEntry({ item_id: 'a1111111-1111-1111-1111-111111111111', slot_at: 'not-a-date' }),
      validEntry({ item_id: 'a2222222-2222-2222-2222-222222222222', text_line: '' }),
      validEntry({ item_id: 'a3333333-3333-3333-3333-333333333333', text_line: '   ' }),
      validEntry({
        item_id: 'a4444444-4444-4444-4444-444444444444',
        text_line: 'x'.repeat(201),
      }),
      validEntry({
        item_id: 'a5555555-5555-5555-5555-555555555555',
        source_record_ids: [],
      }),
      validEntry({
        item_id: 'a6666666-6666-6666-6666-666666666666',
        source_record_ids: ['   '],
      }),
      validEntry({
        item_id: 'a7777777-7777-7777-7777-777777777777',
        website_ref: 'http://example.com/about',
      }),
      validEntry({
        item_id: 'a8888888-8888-8888-8888-888888888888',
        website_checked_on: '2026-13-01',
      }),
      validEntry({
        item_id: 'a9999999-9999-9999-9999-999999999999',
        website_checked_on: '2026-02-31',
      }),
    ]

    const result = await ingestStoryAssets(baseInput(entries, ports))

    expect(result.items).toEqual([])
    expect(result.rejected.map((r) => r.reason_code)).toEqual(entries.map(() => 'BAD_FIELDS'))
    expect(ports.readFile).not.toHaveBeenCalled()
  })

  it('accepts a 200-char text_line', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const ports = makePorts({ readFile: vi.fn(async () => bytes) })
    const entry = validEntry({ text_line: 'x'.repeat(200) })

    const result = await ingestStoryAssets(baseInput([entry], ports))

    expect(result.rejected).toEqual([])
    expect(result.items).toHaveLength(1)
  })
})

describe('ingestStoryAssets — path validation', () => {
  it('rejects BAD_PATH for each unsafe path and never reads the file', async () => {
    const badFiles = [
      '',
      '/etc/x.png',
      '../x.png',
      'a/../../x.png',
      'a\\b.png',
      './x.png',
      'a//b.png',
      'a/./b.png',
      'x%2e%2e.png',
      'C:x.png',
      'a:b.png',
      'x\0.png',
    ]
    const ports = makePorts()
    const entries = badFiles.map((file, i) =>
      validEntry({
        item_id: `b${String(i).padStart(7, '0')}-1111-1111-1111-111111111111`,
        file,
      }),
    )

    const result = await ingestStoryAssets(baseInput(entries, ports))

    expect(result.items).toEqual([])
    expect(result.rejected.map((r) => r.reason_code)).toEqual(badFiles.map(() => 'BAD_PATH'))
    expect(ports.readFile).not.toHaveBeenCalled()
  })
})

describe('ingestStoryAssets — extension validation', () => {
  it('rejects BAD_EXTENSION for wrong or missing extensions', async () => {
    const ports = makePorts()
    const entries = [
      validEntry({ item_id: 'c1111111-1111-1111-1111-111111111111', file: 'x.gif' }),
      validEntry({ item_id: 'c2222222-2222-2222-2222-222222222222', file: 'noext' }),
      validEntry({
        item_id: 'c3333333-3333-3333-3333-333333333333',
        file: 'x.mp4',
        media_kind: 'image',
      }),
      validEntry({
        item_id: 'c4444444-4444-4444-4444-444444444444',
        file: 'x.png',
        media_kind: 'video',
      }),
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

  it('accepts an uppercase .PNG extension', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const ports = makePorts({ readFile: vi.fn(async () => bytes) })
    const entry = validEntry({ file: 'PHOTO.PNG' })

    const result = await ingestStoryAssets(baseInput([entry], ports))

    expect(result.rejected).toEqual([])
    expect(result.items).toHaveLength(1)
    const call = vi.mocked(ports.putIfAbsent).mock.calls[0]
    expect(call[0].endsWith('.png')).toBe(true)
  })
})

describe('ingestStoryAssets — read and size', () => {
  it('rejects READ_FAILED when readFile throws', async () => {
    const ports = makePorts({
      readFile: vi.fn(async () => {
        throw new Error('boom')
      }),
    })

    const result = await ingestStoryAssets(baseInput([validEntry()], ports))

    expect(result.rejected).toEqual([
      { item_id: ITEM_ID, channel: 'facebook_story', reason_code: 'READ_FAILED' },
    ])
  })

  it('rejects EMPTY_FILE for zero-length bytes', async () => {
    const ports = makePorts({ readFile: vi.fn(async () => new Uint8Array(0)) })

    const result = await ingestStoryAssets(baseInput([validEntry()], ports))

    expect(result.rejected[0].reason_code).toBe('EMPTY_FILE')
  })

  it('rejects FILE_TOO_LARGE for an image over 10 MiB and accepts exactly 10 MiB', async () => {
    const tenMiB = 10 * 1024 * 1024
    const tooLarge = makePorts({
      readFile: vi.fn(async () => new Uint8Array(tenMiB + 1)),
    })
    const exactly = makePorts({
      readFile: vi.fn(async () => new Uint8Array(tenMiB)),
    })

    const r1 = await ingestStoryAssets(baseInput([validEntry()], tooLarge))
    const r2 = await ingestStoryAssets(baseInput([validEntry()], exactly))

    expect(r1.rejected[0].reason_code).toBe('FILE_TOO_LARGE')
    expect(tooLarge.probe).not.toHaveBeenCalled()
    expect(r2.rejected).toEqual([])
    expect(r2.items).toHaveLength(1)
  })

  it('honours a custom maxVideoBytes for video', async () => {
    const bytes = new Uint8Array(2048)
    const ports = makePorts({
      readFile: vi.fn(async () => bytes),
      probe: vi.fn(async () => ({
        width: 1080,
        height: 1920,
        durationSec: 5,
        format: 'mp4' as const,
      })),
    })
    const entry = validEntry({ file: 'clip.mp4', media_kind: 'video' })

    const result = await ingestStoryAssets({
      ...baseInput([entry], ports),
      maxVideoBytes: 1024,
    })

    expect(result.rejected[0].reason_code).toBe('FILE_TOO_LARGE')
    expect(ports.probe).not.toHaveBeenCalled()
  })
})

describe('ingestStoryAssets — probe and media checks', () => {
  it('rejects PROBE_FAILED when probe throws', async () => {
    const ports = makePorts({
      probe: vi.fn(async () => {
        throw new Error('probe boom')
      }),
    })

    const result = await ingestStoryAssets(baseInput([validEntry()], ports))

    expect(result.rejected[0].reason_code).toBe('PROBE_FAILED')
  })

  it('rejects FORMAT_MISMATCH when the probe format disagrees with the extension', async () => {
    const asJpeg = makePorts({
      probe: vi.fn(async () => ({
        width: 1080,
        height: 1920,
        durationSec: null,
        format: 'jpeg' as const,
      })),
    })
    const unknown = makePorts({
      probe: vi.fn(async () => ({
        width: 1080,
        height: 1920,
        durationSec: null,
        format: 'unknown' as const,
      })),
    })

    const r1 = await ingestStoryAssets(baseInput([validEntry()], asJpeg))
    const r2 = await ingestStoryAssets(baseInput([validEntry()], unknown))

    expect(r1.rejected[0].reason_code).toBe('FORMAT_MISMATCH')
    expect(r2.rejected[0].reason_code).toBe('FORMAT_MISMATCH')
  })

  it('rejects BAD_ASPECT for wrong ratio or too-small width', async () => {
    const wrongRatio = makePorts({
      probe: vi.fn(async () => ({
        width: 1080,
        height: 1921,
        durationSec: null,
        format: 'png' as const,
      })),
    })
    const tooSmall = makePorts({
      probe: vi.fn(async () => ({
        width: 270,
        height: 480,
        durationSec: null,
        format: 'png' as const,
      })),
    })

    const r1 = await ingestStoryAssets(baseInput([validEntry()], wrongRatio))
    const r2 = await ingestStoryAssets(baseInput([validEntry()], tooSmall))

    expect(r1.rejected[0].reason_code).toBe('BAD_ASPECT')
    expect(r2.rejected[0].reason_code).toBe('BAD_ASPECT')
  })

  it('accepts 1080x1920 and 540x960 aspect ratios', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const big = makePorts({
      readFile: vi.fn(async () => bytes),
      probe: vi.fn(async () => ({
        width: 1080,
        height: 1920,
        durationSec: null,
        format: 'png' as const,
      })),
    })
    const small = makePorts({
      readFile: vi.fn(async () => bytes),
      probe: vi.fn(async () => ({
        width: 540,
        height: 960,
        durationSec: null,
        format: 'png' as const,
      })),
    })

    const r1 = await ingestStoryAssets(baseInput([validEntry()], big))
    const r2 = await ingestStoryAssets(baseInput([validEntry()], small))

    expect(r1.rejected).toEqual([])
    expect(r2.rejected).toEqual([])
  })

  it('rejects BAD_DURATION for missing, zero, negative, NaN or too-long durations', async () => {
    const entry = validEntry({ file: 'clip.mp4', media_kind: 'video' })
    const durations: Array<number | null> = [null, 0, -1, Number.NaN, 16]

    for (const durationSec of durations) {
      const ports = makePorts({
        probe: vi.fn(async () => ({
          width: 1080,
          height: 1920,
          durationSec,
          format: 'mp4' as const,
        })),
      })
      const result = await ingestStoryAssets(baseInput([entry], ports))
      expect(result.rejected[0].reason_code).toBe('BAD_DURATION')
    }
  })

  it('accepts a 15-second video at the default cap', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const ports = makePorts({
      readFile: vi.fn(async () => bytes),
      probe: vi.fn(async () => ({
        width: 1080,
        height: 1920,
        durationSec: 15,
        format: 'mp4' as const,
      })),
    })
    const entry = validEntry({ file: 'clip.mp4', media_kind: 'video' })

    const result = await ingestStoryAssets(baseInput([entry], ports))

    expect(result.rejected).toEqual([])
    expect(result.items).toHaveLength(1)
  })

  it('honours a custom maxVideoSeconds', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const ports = makePorts({
      readFile: vi.fn(async () => bytes),
      probe: vi.fn(async () => ({
        width: 1080,
        height: 1920,
        durationSec: 20,
        format: 'mp4' as const,
      })),
    })
    const entry = validEntry({ file: 'clip.mp4', media_kind: 'video' })

    const result = await ingestStoryAssets({
      ...baseInput([entry], ports),
      maxVideoSeconds: 30,
    })

    expect(result.rejected).toEqual([])
    expect(result.items).toHaveLength(1)
  })
})

describe('ingestStoryAssets — upload', () => {
  it('rejects UPLOAD_FAILED when putIfAbsent throws', async () => {
    const ports = makePorts({
      putIfAbsent: vi.fn(async () => {
        throw new Error('upload boom')
      }),
    })

    const result = await ingestStoryAssets(baseInput([validEntry()], ports))

    expect(result.rejected[0].reason_code).toBe('UPLOAD_FAILED')
  })

  it('rejects URL_NOT_EXPECTED when publicUrl is from another host', async () => {
    const ports = makePorts({
      putIfAbsent: vi.fn(async () => ({
        publicUrl: 'https://other.example.com/public/x.png',
        created: true,
        existingSha256: null,
      })),
    })

    const result = await ingestStoryAssets(baseInput([validEntry()], ports))

    expect(result.rejected[0].reason_code).toBe('URL_NOT_EXPECTED')
  })

  it('rejects URL_NOT_EXPECTED when publicUrl is the same host but a different path', async () => {
    const ports = makePorts({
      putIfAbsent: vi.fn(async () => ({
        publicUrl: `${PUBLIC_BASE_URL}story-assets/other/pack/x.png`,
        created: true,
        existingSha256: null,
      })),
    })

    const result = await ingestStoryAssets(baseInput([validEntry()], ports))

    expect(result.rejected[0].reason_code).toBe('URL_NOT_EXPECTED')
  })

  it('rejects CANNOT_VERIFY_EXISTING when created=false and existingSha256 is null', async () => {
    const ports = makePorts({
      putIfAbsent: vi.fn(async (objectPath: string) => ({
        publicUrl: `${PUBLIC_BASE_URL}${objectPath}`,
        created: false,
        existingSha256: null,
      })),
    })

    const result = await ingestStoryAssets(baseInput([validEntry()], ports))

    expect(result.rejected[0].reason_code).toBe('CANNOT_VERIFY_EXISTING')
  })

  it('rejects OBJECT_CONTENT_MISMATCH when created=false and the hash differs', async () => {
    const ports = makePorts({
      putIfAbsent: vi.fn(async (objectPath: string) => ({
        publicUrl: `${PUBLIC_BASE_URL}${objectPath}`,
        created: false,
        existingSha256: 'deadbeef'.repeat(8),
      })),
    })

    const result = await ingestStoryAssets(baseInput([validEntry()], ports))

    expect(result.rejected[0].reason_code).toBe('OBJECT_CONTENT_MISMATCH')
  })
})

describe('ingestStoryAssets — account validation', () => {
  it('rejects NO_ACCOUNT for empty, non-digit, too-short and too-long account ids', async () => {
    const badAccounts = ['', 'abc', '1234', '1'.repeat(26)]
    for (const account of badAccounts) {
      const ports = makePorts()
      const input = {
        ...baseInput([validEntry()], ports),
        accountIds: { facebook_story: account, instagram_story: '9876543210' },
      }
      const result = await ingestStoryAssets(input)
      expect(result.rejected[0].reason_code).toBe('NO_ACCOUNT')
      expect(ports.readFile).not.toHaveBeenCalled()
    }
  })
})

describe('ingestStoryAssets — sequencing and duplicates', () => {
  it('continues past a bad entry to the next good entry', async () => {
    const bytes = new Uint8Array([7, 7, 7])
    const ports = makePorts({ readFile: vi.fn(async () => bytes) })
    const entries = [
      validEntry({ item_id: 'd1111111-1111-1111-1111-111111111111', file: 'a.gif' }),
      validEntry({ item_id: 'd2222222-2222-2222-2222-222222222222', file: 'b.png' }),
    ]

    const result = await ingestStoryAssets(baseInput(entries, ports))

    expect(result.rejected.map((r) => r.item_id)).toEqual([
      'd1111111-1111-1111-1111-111111111111',
    ])
    expect(result.items.map((i) => i.item_id)).toEqual([
      'd2222222-2222-2222-2222-222222222222',
    ])
  })

  it('rejects DUPLICATE_ITEM for the same (item_id, channel) and keeps the first', async () => {
    const bytes = new Uint8Array([3, 3, 3])
    const ports = makePorts({ readFile: vi.fn(async () => bytes) })
    const entries = [
      validEntry({ file: 'first.png' }),
      validEntry({ file: 'second.png' }),
    ]

    const result = await ingestStoryAssets(baseInput(entries, ports))

    expect(result.items).toHaveLength(1)
    expect(result.rejected).toEqual([
      { item_id: ITEM_ID, channel: 'facebook_story', reason_code: 'DUPLICATE_ITEM' },
    ])
    expect(ports.readFile).toHaveBeenCalledTimes(1)
  })

  it('allows the same item_id on different channels', async () => {
    const bytes = new Uint8Array([4, 4, 4])
    const ports = makePorts({ readFile: vi.fn(async () => bytes) })
    const entries = [
      validEntry({ channel: 'facebook_story' }),
      validEntry({ channel: 'instagram_story' }),
    ]

    const result = await ingestStoryAssets(baseInput(entries, ports))

    expect(result.items).toHaveLength(2)
    expect(result.rejected).toEqual([])
  })

  it('never returns bytes on the produced items', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const ports = makePorts({ readFile: vi.fn(async () => bytes) })

    const result = await ingestStoryAssets(baseInput([validEntry()], ports))

    expect(result.items).toHaveLength(1)
    expect(Object.prototype.hasOwnProperty.call(result.items[0], 'bytes')).toBe(false)
  })
})

describe('ingestStoryAssets — input validation throws', () => {
  it('throws for an invalid clientSlug', async () => {
    const ports = makePorts()
    const input = { ...baseInput([validEntry()], ports), clientSlug: 'Bad Slug!' }

    await expect(ingestStoryAssets(input)).rejects.toThrow(/Invalid clientSlug/)
  })

  it('throws for an empty clientSlug', async () => {
    const ports = makePorts()
    const input = { ...baseInput([validEntry()], ports), clientSlug: '' }

    await expect(ingestStoryAssets(input)).rejects.toThrow(/Invalid clientSlug/)
  })

  it('throws for a non-UUID clientId', async () => {
    const ports = makePorts()
    const input = { ...baseInput([validEntry()], ports), clientId: 'client-1' }

    await expect(ingestStoryAssets(input)).rejects.toThrow(/Invalid clientId/)
  })

  it('throws for a non-UUID packId', async () => {
    const ports = makePorts()
    const input = { ...baseInput([validEntry()], ports), packId: 'pack-1' }

    await expect(ingestStoryAssets(input)).rejects.toThrow(/Invalid packId/)
  })

  it('throws for a non-https publicBaseUrl', async () => {
    const ports = makePorts()
    const input = { ...baseInput([validEntry()], ports), publicBaseUrl: 'http://x/' }

    await expect(ingestStoryAssets(input)).rejects.toThrow(/invalid publicBaseUrl/)
  })

  it('throws for maxVideoSeconds of 0 or NaN', async () => {
    const ports = makePorts()
    const zero = { ...baseInput([validEntry()], ports), maxVideoSeconds: 0 }
    const nan = { ...baseInput([validEntry()], ports), maxVideoSeconds: Number.NaN }

    await expect(ingestStoryAssets(zero)).rejects.toThrow(/Invalid maxVideoSeconds/)
    await expect(ingestStoryAssets(nan)).rejects.toThrow(/Invalid maxVideoSeconds/)
  })

  it('throws for maxVideoSeconds of Infinity (not finite)', async () => {
    const ports = makePorts()
    const input = {
      ...baseInput([validEntry()], ports),
      maxVideoSeconds: Number.POSITIVE_INFINITY,
    }

    await expect(ingestStoryAssets(input)).rejects.toThrow(/Invalid maxVideoSeconds/)
  })
})

describe('declarations must be real booleans', () => {
  it('rejects a manifest entry whose price / place / reply declarations are not booleans', async () => {
    for (const field of ['contains_price', 'names_place', 'has_reply_cta'] as const) {
      const ports = makePorts()
      const entry = { ...validEntry(), [field]: 'yes' } as unknown as StoryManifestEntry
      const result = await ingestStoryAssets(baseInput([entry], ports))
      expect(result.items).toHaveLength(0)
      expect(result.rejected.map((r) => r.reason_code)).toEqual(['BAD_FIELDS'])
    }
  })
})
