import { describe, it, expect, vi } from 'vitest'
import {
  ChannelLockError,
  lockChannel,
  readBackVideo,
  uploadStagingVideo,
} from '../client'
import { PUBLISH_GATE_IDS, evaluatePublishGates, type GateResult } from '../gates'

const CHANNEL = 'UC_target_channel_000000'

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('lockChannel', () => {
  it('returns the channel when the id matches exactly', async () => {
    const f = vi.fn().mockResolvedValue(
      json({ items: [{ id: CHANNEL, snippet: { title: 'Target' } }] }),
    )
    await expect(lockChannel('tok', CHANNEL, f)).resolves.toEqual({ id: CHANNEL, title: 'Target' })
  })

  it('refuses when only a different channel is managed', async () => {
    const f = vi.fn().mockResolvedValue(json({ items: [{ id: 'UC_other', snippet: { title: 'x' } }] }))
    await expect(lockChannel('tok', CHANNEL, f)).rejects.toBeInstanceOf(ChannelLockError)
  })

  it('refuses when no channel is returned', async () => {
    const f = vi.fn().mockResolvedValue(json({}))
    await expect(lockChannel('tok', CHANNEL, f)).rejects.toBeInstanceOf(ChannelLockError)
  })
})

describe('uploadStagingVideo', () => {
  it('runs init then upload and returns a receipt with the locked channel', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { location: 'https://upload.example/session' } }))
      .mockResolvedValueOnce(json({ id: 'vid123' }))
    const video = new Blob(['abc'], { type: 'video/mp4' })
    const receipt = await uploadStagingVideo(
      'tok',
      CHANNEL,
      { title: 't', description: 'd', privacyStatus: 'private', video },
      f,
    )
    expect(receipt).toMatchObject({ videoId: 'vid123', channelId: CHANNEL, privacyStatus: 'private' })
    const initBody = JSON.parse(f.mock.calls[0][1].body as string)
    expect(initBody.status.privacyStatus).toBe('private')
    expect(f.mock.calls[1][0]).toBe('https://upload.example/session')
  })

  it('rejects public at runtime and makes no network call', async () => {
    const f = vi.fn()
    const input = {
      title: 't',
      description: 'd',
      privacyStatus: 'public' as never,
      video: new Blob(['abc']),
    }
    await expect(uploadStagingVideo('tok', CHANNEL, input, f)).rejects.toThrow(/private or unlisted/)
    expect(f).not.toHaveBeenCalled()
  })

  it('throws when init returns no upload url', async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    await expect(
      uploadStagingVideo('tok', CHANNEL, { title: 't', description: 'd', privacyStatus: 'unlisted', video: new Blob(['a']) }, f),
    ).rejects.toThrow(/no resumable upload URL/)
  })
})

describe('readBackVideo', () => {
  it('maps channel, privacy and best thumbnail', async () => {
    const f = vi.fn().mockResolvedValue(
      json({
        items: [
          {
            id: 'v1',
            snippet: { channelId: CHANNEL, title: 'T', thumbnails: { default: { url: 'd' }, high: { url: 'h' } } },
            status: { privacyStatus: 'private' },
          },
        ],
      }),
    )
    await expect(readBackVideo('tok', 'v1', f)).resolves.toMatchObject({
      channelId: CHANNEL,
      privacyStatus: 'private',
      thumbnailUrl: 'h',
    })
  })

  it('returns null when the video is not found', async () => {
    const f = vi.fn().mockResolvedValue(json({ items: [] }))
    await expect(readBackVideo('tok', 'nope', f)).resolves.toBeNull()
  })
})

describe('evaluatePublishGates', () => {
  const allPass: GateResult[] = PUBLISH_GATE_IDS.map((id) => ({ id, videoId: 'v1', status: 'pass', evidence: 'doc:x' }))

  it('allows only when all seven gates pass with evidence', () => {
    expect(evaluatePublishGates(allPass, 'v1').canGoPublic).toBe(true)
  })

  it('blocks on fail, unknown, missing and evidence-less pass', () => {
    const results: GateResult[] = [
      { id: PUBLISH_GATE_IDS[0], videoId: 'v1', status: 'fail', evidence: 'x' },
      { id: PUBLISH_GATE_IDS[1], videoId: 'v1', status: 'unknown' },
      { id: PUBLISH_GATE_IDS[2], videoId: 'v1', status: 'pass' },
      ...allPass.slice(4),
    ]
    const v = evaluatePublishGates(results, 'v1')
    expect(v.canGoPublic).toBe(false)
    expect(v.blocking.map((b) => b.reason).sort()).toEqual(['fail', 'missing', 'pass without evidence', 'unknown'])
  })

  it('blocks unexpected statuses, duplicates and evidence for another video', () => {
    const odd = { ...allPass[0], status: 'skipped' as never }
    expect(evaluatePublishGates([odd, ...allPass.slice(1)], 'v1').blocking[0].reason).toBe('unknown')
    const dup = [{ ...allPass[0], status: 'fail' as const }, ...allPass]
    expect(evaluatePublishGates(dup, 'v1').blocking[0].reason).toBe('duplicate entries')
    expect(evaluatePublishGates(allPass, 'other').blocking).toHaveLength(PUBLISH_GATE_IDS.length)
  })
})
