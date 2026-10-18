// @vitest-environment node
import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import { checkVideoFile } from '../video-check'

function u32(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
}
function box(type: string, payload: number[]): number[] {
  return [...u32(8 + payload.length), ...Array.from(type).map((c) => c.charCodeAt(0)), ...payload]
}
/** A tiny but well-formed MP4: ftyp + moov{mvhd v0, trak{tkhd}} of the given length and picture size. */
function mp4(seconds: number, width: number, height: number): Uint8Array {
  const mvhd = box('mvhd', [0, 0, 0, 0, ...u32(0), ...u32(0), ...u32(1000), ...u32(seconds * 1000), ...new Array(80).fill(0)])
  const tkhd = box('tkhd', [0, 0, 0, 7, ...new Array(72).fill(0), ...u32(width * 65536), ...u32(height * 65536)])
  const moov = box('moov', [...mvhd, ...box('trak', tkhd)])
  return Uint8Array.from([...box('ftyp', [...Array.from('isom').map((c) => c.charCodeAt(0)), 0, 0, 0, 0]), ...moov])
}
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const HOSTS = ['x.supabase.co']
const URL_OK = 'https://x.supabase.co/storage/v1/object/public/b/v.mp4'

function body(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function fetcherFor(bytes: Uint8Array, init: ResponseInit = { status: 200 }): typeof fetch {
  return vi.fn(async () => new Response(body(bytes), init)) as unknown as typeof fetch
}

describe('checkVideoFile', () => {
  it('a good 6 s vertical clip with the registered hash is OK', async () => {
    const file = mp4(6, 1080, 1920)
    expect(await checkVideoFile({ media_url: URL_OK, media_sha256: sha(file) }, { allowedHosts: HOSTS, fetcher: fetcherFor(file) })).toBe('OK')
  })

  it('a changed file is CHANGED (hash first, before judging the clip)', async () => {
    const file = mp4(6, 1080, 1920)
    expect(await checkVideoFile({ media_url: URL_OK, media_sha256: 'a'.repeat(64) }, { allowedHosts: HOSTS, fetcher: fetcherFor(file) })).toBe('CHANGED')
  })

  it('too long, not vertical, too small, or not a video at all are BAD_VIDEO', async () => {
    for (const file of [mp4(90, 1080, 1920), mp4(6, 1920, 1080), mp4(6, 360, 640), new TextEncoder().encode('not a video')]) {
      expect(await checkVideoFile({ media_url: URL_OK, media_sha256: sha(file) }, { allowedHosts: HOSTS, fetcher: fetcherFor(file) })).toBe('BAD_VIDEO')
    }
  })

  it('unreachable cases: other host, http, bad url, error status, network failure, empty, too big, redirect', async () => {
    const file = mp4(6, 1080, 1920)
    const base = { media_sha256: sha(file) }
    expect(await checkVideoFile({ ...base, media_url: 'https://evil.example.com/v.mp4' }, { allowedHosts: HOSTS, fetcher: fetcherFor(file) })).toBe('UNREACHABLE')
    expect(await checkVideoFile({ ...base, media_url: 'http://x.supabase.co/v.mp4' }, { allowedHosts: HOSTS, fetcher: fetcherFor(file) })).toBe('UNREACHABLE')
    expect(await checkVideoFile({ ...base, media_url: 'not a url' }, { allowedHosts: HOSTS, fetcher: fetcherFor(file) })).toBe('UNREACHABLE')
    expect(await checkVideoFile({ ...base, media_url: URL_OK }, { allowedHosts: HOSTS, fetcher: fetcherFor(file, { status: 404 }) })).toBe('UNREACHABLE')
    const failing = vi.fn(async () => { throw new Error('offline') }) as unknown as typeof fetch
    expect(await checkVideoFile({ ...base, media_url: URL_OK }, { allowedHosts: HOSTS, fetcher: failing })).toBe('UNREACHABLE')
    expect(await checkVideoFile({ ...base, media_url: URL_OK }, { allowedHosts: HOSTS, fetcher: fetcherFor(new Uint8Array()) })).toBe('UNREACHABLE')
    expect(await checkVideoFile({ ...base, media_url: URL_OK }, { allowedHosts: HOSTS, fetcher: fetcherFor(file), maxBytes: 10 })).toBe('UNREACHABLE')
    expect(await checkVideoFile({ ...base, media_url: URL_OK }, { allowedHosts: [], fetcher: fetcherFor(file) })).toBe('UNREACHABLE')
  })

  it('never follows a redirect', async () => {
    const file = mp4(6, 1080, 1920)
    const spy = vi.fn(async () => new Response(body(file))) as unknown as typeof fetch
    await checkVideoFile({ media_url: URL_OK, media_sha256: sha(file) }, { allowedHosts: HOSTS, fetcher: spy })
    expect((spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({ redirect: 'error', cache: 'no-store' })
  })
})
