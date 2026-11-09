import { describe, expect, it, vi } from 'vitest'
import { PUBLISH_GATE_IDS, type GateResult } from '../gates'
import { publishStagedVideo, type PublishAuthorization, type PublishInput } from '../publish'

const CHANNEL = 'UCmJJDRx88y0IuZXJJQuGNFw'
const NOW = Date.parse('2026-10-18T01:00:00Z')
const allPass: GateResult[] = PUBLISH_GATE_IDS.map((id) => ({ id, videoId: 'v1', status: 'pass', evidence: 'doc:x' }))

function auth(over: Partial<PublishAuthorization> = {}): PublishAuthorization {
  return { videoId: 'v1', channelId: CHANNEL, grantedBy: 'pm', nonce: 'n-1', grantedAt: '2026-10-18T00:50:00Z', ...over }
}

function input(over: Partial<PublishInput> = {}): PublishInput {
  return { accessToken: 't', clientId: 'client-1', channelId: CHANNEL, videoId: 'v1', gates: allPass, authorization: auth(), ...over }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

const channelsOk = () => json({ items: [{ id: CHANNEL, snippet: { title: 'CTS' } }] })
function videoOk(privacy = 'private', thumb: string | null = 'https://t/x.jpg', channelId = CHANNEL) {
  return json({
    items: [
      {
        id: 'v1',
        snippet: { channelId, title: 'T', thumbnails: thumb ? { high: { url: thumb } } : {} },
        status: { privacyStatus: privacy, license: 'creativeCommon', embeddable: false, publishAt: '2027-01-01T00:00:00Z' },
      },
    ],
  })
}

describe('publishStagedVideo blocks (no network write)', () => {
  it.each([
    ['no authorization', { authorization: null }],
    ['authorization for another video', { authorization: auth({ videoId: 'other' }) }],
    ['authorization for another channel', { authorization: auth({ channelId: 'UCother' }) }],
    ['stale authorization', { authorization: auth({ grantedAt: '2026-10-18T00:00:00Z' }) }],
    ['future-dated authorization', { authorization: auth({ grantedAt: '2026-10-18T02:00:00Z' }) }],
    ['authorization without nonce', { authorization: auth({ nonce: ' ' }) }],
    ['garbage authorization time', { authorization: auth({ grantedAt: 'nope' }) }],
  ])('%s', async (_n, over) => {
    const f = vi.fn()
    const r = await publishStagedVideo(input(over), f, () => NOW)
    expect(r).toMatchObject({ status: 'blocked', reason: 'authorization_invalid', noPublish: true })
    expect(f).not.toHaveBeenCalled()
  })

  it('blocks when any gate is not a pass', async () => {
    const f = vi.fn()
    const gates = allPass.map((g, i) => (i === 0 ? { ...g, status: 'unknown' as const } : g))
    const r = await publishStagedVideo(input({ gates }), f, () => NOW)
    expect(r).toMatchObject({ status: 'blocked', reason: 'gates_not_passed' })
    expect(r.blockingGates).toHaveLength(1)
    expect(f).not.toHaveBeenCalled()
  })

  it('blocks on channel mismatch', async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ items: [{ id: 'UCother', snippet: {} }] }))
    const r = await publishStagedVideo(input(), f, () => NOW)
    expect(r).toMatchObject({ status: 'blocked', reason: 'channel_mismatch' })
  })

  it.each([
    ['already public', () => videoOk('public'), 'already_public'],
    ['no thumbnail', () => videoOk('private', null), 'thumbnail_missing'],
    ['video on another channel', () => videoOk('private', 'x', 'UCother'), 'video_on_other_channel'],
    ['video missing', () => json({ items: [] }), 'video_not_found'],
    ['status missing', () => json({ items: [{ id: 'v1', snippet: { channelId: CHANNEL, thumbnails: { high: { url: 'x' } } } }] }), 'status_unknown'],
  ])('blocks when staged video is %s', async (_n, video, reason) => {
    const f = vi.fn().mockResolvedValueOnce(channelsOk()).mockResolvedValueOnce(video())
    const r = await publishStagedVideo(input(), f, () => NOW)
    expect(r).toMatchObject({ status: 'blocked', reason, noPublish: true })
    expect(f).toHaveBeenCalledTimes(2)
  })
})

describe('publishStagedVideo ok paths', () => {
  it('dry run (default) validates everything and writes nothing', async () => {
    const f = vi.fn().mockResolvedValueOnce(channelsOk()).mockResolvedValueOnce(videoOk())
    const r = await publishStagedVideo(input(), f, () => NOW)
    expect(r).toMatchObject({ status: 'dry_run_ok', noPublish: true, authorizedBy: 'pm', authorizationNonce: 'n-1' })
    expect(f.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true)
  })

  it('execute writes public once and confirms by read-back', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(channelsOk())
      .mockResolvedValueOnce(videoOk())
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(videoOk('public'))
    const r = await publishStagedVideo(input({ mode: 'execute' }), f, () => NOW)
    expect(r).toMatchObject({ status: 'published', noPublish: false })
    const put = f.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(JSON.parse(put?.[1].body as string).status.privacyStatus).toBe('public')
  })

  it('execute keeps existing status fields and drops only the schedule', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(channelsOk())
      .mockResolvedValueOnce(videoOk())
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(videoOk('public'))
    await publishStagedVideo(input({ mode: 'execute' }), f, () => NOW)
    const put = f.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(JSON.parse(put?.[1].body as string).status).toEqual({
      privacyStatus: 'public',
      license: 'creativeCommon',
      embeddable: false,
    })
  })

  it('execute returns a failed receipt with noPublish=true when the update is rejected', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(channelsOk())
      .mockResolvedValueOnce(videoOk())
      .mockResolvedValueOnce(new Response('insufficient scope', { status: 403 }))
    const r = await publishStagedVideo(input({ mode: 'execute' }), f, () => NOW)
    expect(r).toMatchObject({ status: 'failed', reason: 'update_failed', noPublish: true, clientId: 'client-1' })
  })

  it('execute returns failed with noPublish=false when the write is accepted but read-back is not public', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(channelsOk())
      .mockResolvedValueOnce(videoOk())
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(videoOk('private'))
    const r = await publishStagedVideo(input({ mode: 'execute' }), f, () => NOW)
    expect(r).toMatchObject({ status: 'failed', reason: 'status_unknown', noPublish: false })
  })
})
