import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireGlobalAdmin: vi.fn(),
  sendInngestEvent: vi.fn(),
  findStagedReceipt: vi.fn(),
  insertAuthorization: vi.fn(),
}))
vi.mock('@/lib/auth/require-admin', () => ({ requireGlobalAdmin: mocks.requireGlobalAdmin }))
vi.mock('@/lib/workflows/inngest-event', () => ({ sendInngestEvent: mocks.sendInngestEvent }))
vi.mock('@/lib/youtube-publish/store', () => ({
  findStagedReceipt: mocks.findStagedReceipt,
  insertAuthorization: mocks.insertAuthorization,
}))

import { POST as stage } from '../stage/route'
import { POST as authorize } from '../authorize-public/route'

const ctx = { params: { id: 'c1' } }
const post = (body: unknown) =>
  new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireGlobalAdmin.mockResolvedValue({ ok: true, user: { id: 'u1', email: 'ray@example.com' } })
  mocks.sendInngestEvent.mockResolvedValue({ event_ids: ['e1'] })
})

describe('POST youtube/stage', () => {
  it('rejects non-admins without sending anything', async () => {
    mocks.requireGlobalAdmin.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    expect((await stage(post({ workOrderId: 'x' }), ctx)).status).toBe(403)
    expect(mocks.sendInngestEvent).not.toHaveBeenCalled()
  })
  it('400 on a non-uuid work order', async () => {
    expect((await stage(post({ workOrderId: 'nope' }), ctx)).status).toBe(400)
  })
  it('emits the staging event and says nothing is published', async () => {
    const res = await stage(post({ workOrderId: '11111111-1111-4111-8111-111111111111' }), ctx)
    expect(await res.json()).toMatchObject({ success: true, noPublish: true })
    expect(mocks.sendInngestEvent.mock.calls[0][0]).toMatchObject({ name: 'youtube.staging.requested' })
  })
})

describe('POST youtube/authorize-public', () => {
  it('404 when the video has no staging receipt for this client', async () => {
    mocks.findStagedReceipt.mockResolvedValue(null)
    expect((await authorize(post({ videoId: 'abcdefghijk' }), ctx)).status).toBe(404)
    expect(mocks.insertAuthorization).not.toHaveBeenCalled()
  })
  it('stores a one-time grant, then emits the event carrying only the nonce', async () => {
    mocks.findStagedReceipt.mockResolvedValue({ videoId: 'abcdefghijk', channelId: 'UCmJJDRx88y0IuZXJJQuGNFw', gates: [] })
    const res = await authorize(post({ videoId: 'abcdefghijk' }), ctx)
    expect(await res.json()).toMatchObject({ success: true, dryRunOnly: true })
    const grant = mocks.insertAuthorization.mock.calls[0][0]
    expect(grant).toMatchObject({ clientId: 'c1', videoId: 'abcdefghijk', grantedBy: 'ray@example.com' })
    expect(mocks.sendInngestEvent.mock.calls[0][0].data).toEqual({ clientId: 'c1', nonce: grant.nonce })
  })
  it('does not emit if the grant could not be stored', async () => {
    mocks.findStagedReceipt.mockResolvedValue({ videoId: 'abcdefghijk', channelId: 'UCx', gates: [] })
    mocks.insertAuthorization.mockRejectedValue(new Error('db'))
    await expect(authorize(post({ videoId: 'abcdefghijk' }), ctx)).rejects.toThrow()
    expect(mocks.sendInngestEvent).not.toHaveBeenCalled()
  })
})
