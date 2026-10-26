// @vitest-environment node
import { readFile } from 'fs/promises'
import { createHash } from 'crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inspectTikTokVideo } from './video-proof'
afterEach(()=>vi.unstubAllGlobals())
describe('actual video inspection',()=>{
  it('derives duration and identity from real MP4 bytes',async()=>{
    const bytes = await readFile(new URL('./__fixtures__/one-second.mp4',import.meta.url))
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(bytes)))
    const proof = await inspectTikTokVideo('https://example.com/video.mp4')
    expect(proof.durationSeconds).toBeCloseTo(1,1)
    expect(proof.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
  })
  it('rejects non-video data even when named mp4',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('not a video')))
    await expect(inspectTikTokVideo('https://example.com/video.mp4')).rejects.toThrow()
  })
  it('rejects declared oversized files before download',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('x',{headers:{'content-length':String(300*1024*1024)}})))
    await expect(inspectTikTokVideo('https://example.com/video.mp4')).rejects.toThrow('256 MiB')
  })
})
