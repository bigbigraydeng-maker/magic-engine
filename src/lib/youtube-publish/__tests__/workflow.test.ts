import { describe, expect, it, vi } from 'vitest'
import { PUBLISH_GATE_IDS, type GateResult } from '../gates'
import { runPublicStep, runStaging, type PublicStepDeps, type StagingDeps } from '../workflow'
import type { ReceiptRow } from '../store'

const CHANNEL = 'UCmJJDRx88y0IuZXJJQuGNFw'
const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), { status: 200, ...init })
const channelsOk = () => json({ items: [{ id: CHANNEL, snippet: { title: 'CTS' } }] })
const videoBack = (privacy: string, channelId = CHANNEL) =>
  json({ items: [{ id: 'v1', snippet: { channelId, title: 'T', thumbnails: { high: { url: 'https://t/x.jpg' } } }, status: { privacyStatus: privacy } }] })

function stagingDeps(over: Partial<StagingDeps> = {}) {
  const saved: ReceiptRow[] = []
  const deps: StagingDeps = {
    getChannelId: async () => CHANNEL,
    getWorkOrder: async () => ({ id: 'w1', videoUrl: 'https://cdn/x.mp4', title: 'T', description: 'D' }),
    alreadyStaged: async () => false,
    getToken: async () => 'tok',
    fetchVideo: async () => new Blob(['x'], { type: 'video/mp4' }),
    saveReceipt: async (r) => void saved.push(r),
    ...over,
  }
  return { deps, saved }
}
const ev = { requestId: 'r1', clientId: 'c1', workOrderId: 'w1' }

describe('runStaging', () => {
  it.each([
    ['no channel configured', { getChannelId: async () => null }, 'channel_not_configured'],
    ['work order not approved / not factory', { getWorkOrder: async () => null }, 'work_order_not_approved'],
    ['already staged', { alreadyStaged: async () => true }, 'already_staged'],
  ])('blocks: %s, with a receipt and no network', async (_n, over, reason) => {
    const f = vi.fn()
    const { deps, saved } = stagingDeps({ ...over, fetchImpl: f })
    const r = await runStaging(ev, deps)
    expect(r).toMatchObject({ status: 'blocked', reason, noPublish: true })
    expect(saved).toHaveLength(1)
    expect(f).not.toHaveBeenCalled()
  })

  it('blocks on channel mismatch and never uploads', async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ items: [{ id: 'UCother', snippet: {} }] }))
    const { deps, saved } = stagingDeps({ fetchImpl: f })
    const r = await runStaging(ev, deps)
    expect(r).toMatchObject({ status: 'blocked', reason: 'channel_mismatch' })
    expect(f).toHaveBeenCalledTimes(1)
    expect(saved[0]?.videoId).toBeUndefined()
  })

  it('uploads private, reads back, records staged', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(channelsOk())
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { location: 'https://up/1' } }))
      .mockResolvedValueOnce(json({ id: 'v1' }))
      .mockResolvedValueOnce(videoBack('private'))
    const { deps, saved } = stagingDeps({ fetchImpl: f })
    const r = await runStaging(ev, deps)
    expect(r).toMatchObject({ status: 'staged', videoId: 'v1', noPublish: true })
    const initBody = JSON.parse(f.mock.calls[1][1].body as string) as { status: { privacyStatus: string } }
    expect(initBody.status.privacyStatus).toBe('private')
    expect(saved.map((x) => x.status)).toEqual(['pending', 'staged'])
    expect(saved[0].requestId).not.toBe(saved[1].requestId)
  })

  it('records failed (not staged) when read-back is not private', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(channelsOk())
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { location: 'https://up/1' } }))
      .mockResolvedValueOnce(json({ id: 'v1' }))
      .mockResolvedValueOnce(videoBack('public'))
    const { deps } = stagingDeps({ fetchImpl: f })
    expect(await runStaging(ev, deps)).toMatchObject({ status: 'failed', reason: 'readback_mismatch' })
  })

  it('a failure before the upload leaves no pending row, so a retry stays possible', async () => {
    const { deps, saved } = stagingDeps({ fetchVideo: async () => { throw new Error('download timeout') }, fetchImpl: vi.fn().mockResolvedValueOnce(channelsOk()) })
    expect(await runStaging(ev, deps)).toMatchObject({ status: 'failed', reason: 'staging_error' })
    expect(saved.map((x) => x.status)).toEqual(['failed'])
  })

  it('turns an upload error into a failed receipt instead of throwing', async () => {
    const f = vi.fn().mockResolvedValueOnce(channelsOk()).mockResolvedValueOnce(new Response('quota', { status: 403 }))
    const { deps, saved } = stagingDeps({ fetchImpl: f })
    expect(await runStaging(ev, deps)).toMatchObject({ status: 'failed', reason: 'staging_error', noPublish: true })
    expect(saved.map((x) => x.status)).toEqual(['pending', 'failed'])
  })
})

const grantedAt = new Date().toISOString()
const allPass: GateResult[] = PUBLISH_GATE_IDS.map((id) => ({ id, videoId: 'v1', status: 'pass', evidence: 'doc:x' }))

function publicDeps(over: Partial<PublicStepDeps> = {}) {
  const saved: ReceiptRow[] = []
  const deps: PublicStepDeps = {
    consume: async (_n: string, _c: string) => ({ clientId: 'c1', channelId: CHANNEL, videoId: 'v1', grantedBy: 'ray', grantedAt }),
    getStaged: async () => ({ gates: allPass, channelId: CHANNEL }),
    getChannelId: async () => CHANNEL,
    getToken: async () => 'tok',
    saveReceipt: async (r) => void saved.push(r),
    ...over,
  }
  return { deps, saved }
}

describe('runPublicStep', () => {
  it('an unknown or already-consumed nonce blocks with no network', async () => {
    const f = vi.fn()
    const { deps, saved } = publicDeps({ consume: async (_n: string, _c: string) => null, fetchImpl: f })
    expect(await runPublicStep({ clientId: 'c1', nonce: 'n' }, deps)).toMatchObject({ status: 'blocked', reason: 'authorization_invalid' })
    expect(saved).toHaveLength(1)
    expect(f).not.toHaveBeenCalled()
  })

  it('a grant for another client is refused', async () => {
    const f = vi.fn()
    const { deps } = publicDeps({ fetchImpl: f })
    expect(await runPublicStep({ clientId: 'other', nonce: 'n' }, deps)).toMatchObject({ reason: 'authorization_invalid' })
    expect(f).not.toHaveBeenCalled()
  })

  it('a video without a staging receipt is refused', async () => {
    const { deps } = publicDeps({ getStaged: async () => null, fetchImpl: vi.fn() })
    expect(await runPublicStep({ clientId: 'c1', nonce: 'n' }, deps)).toMatchObject({ reason: 'video_not_staged' })
  })

  it('a grant is void if the client channel was reconfigured after it was issued', async () => {
    const f = vi.fn()
    const { deps } = publicDeps({ getChannelId: async () => 'UCsomethingElseElseElse12', fetchImpl: f })
    expect(await runPublicStep({ clientId: 'c1', nonce: 'n' }, deps)).toMatchObject({ reason: 'channel_config_changed', noPublish: true })
    expect(f).not.toHaveBeenCalled()
  })

  it('missing gate evidence blocks (staging records no passing gates)', async () => {
    const { deps } = publicDeps({ getStaged: async () => ({ gates: [], channelId: CHANNEL }), fetchImpl: vi.fn() })
    const r = await runPublicStep({ clientId: 'c1', nonce: 'n' }, deps)
    expect(r).toMatchObject({ status: 'blocked', reason: 'gates_not_passed', noPublish: true })
  })

  it('even with every gate passing it only dry-runs: no write call is ever made', async () => {
    const f = vi.fn().mockResolvedValueOnce(channelsOk()).mockResolvedValueOnce(videoBack('private'))
    const { deps, saved } = publicDeps({ fetchImpl: f })
    const r = await runPublicStep({ clientId: 'c1', nonce: 'n-1' }, deps)
    expect(r).toMatchObject({ status: 'dry_run_ok', noPublish: true, authorizationNonce: 'n-1', authorizedBy: 'ray' })
    expect(f.mock.calls.every((c) => (c[1]?.method ?? 'GET') === 'GET')).toBe(true)
    expect(saved).toHaveLength(1)
  })
})
