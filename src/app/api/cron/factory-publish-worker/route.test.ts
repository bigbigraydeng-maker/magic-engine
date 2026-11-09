import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  runPublishWorker: vi.fn(),
  reconcileMissingReelEvents: vi.fn(),
  runLecturePublishSweep: vi.fn(),
  startCronRun: vi.fn(),
  finish: vi.fn(),
}))

vi.mock('@/lib/factory/publish/publish-worker', () => ({
  runPublishWorker: mocks.runPublishWorker,
  reconcileMissingReelEvents: mocks.reconcileMissingReelEvents,
}))
vi.mock('@/lib/factory/lecture-publish', () => ({
  runLecturePublishSweep: mocks.runLecturePublishSweep,
}))
vi.mock('@/lib/cron/run-logger', () => ({ startCronRun: mocks.startCronRun }))

import { GET } from './route'

function request(secret?: string) {
  return new NextRequest('http://localhost/api/cron/factory-publish-worker', {
    headers: secret === undefined ? {} : { authorization: `Bearer ${secret}` },
  })
}

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'local-test')
  mocks.startCronRun.mockResolvedValue({ finish: mocks.finish })
  mocks.runPublishWorker.mockResolvedValue({ claimed: 1, published: 0, drafted: 1 })
  mocks.runLecturePublishSweep.mockResolvedValue({ handled: [] })
  mocks.reconcileMissingReelEvents.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('factory-publish-worker route', () => {
  it.each([undefined, 'wrong-secret'])('rejects a missing or wrong secret (%s) without doing any work', async secret => {
    const response = await GET(request(secret))
    expect(response.status).toBe(401)
    expect(mocks.startCronRun).not.toHaveBeenCalled()
    expect(mocks.runPublishWorker).not.toHaveBeenCalled()
  })

  it('runs in draft mode when FACTORY_PUBLISH_LIVE is not set, with no instagram field', async () => {
    const response = await GET(request('local-test'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({
      ok: true, live: false, claimed: 1, published: 0, drafted: 1, lecture: [], reel_event_reconcile: 'ok',
    })
    expect(JSON.stringify(body)).not.toMatch(/instagram/i)
    expect(mocks.runPublishWorker).toHaveBeenCalledWith(expect.objectContaining({ draft: true }))
    expect(mocks.finish).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(mocks.finish.mock.calls[0][0])).not.toMatch(/instagram/i)
  })

  it('keeps the Facebook publish path live when FACTORY_PUBLISH_LIVE=true', async () => {
    vi.stubEnv('FACTORY_PUBLISH_LIVE', 'true')
    mocks.runPublishWorker.mockResolvedValue({ claimed: 1, published: 1, drafted: 0 })
    const response = await GET(request('local-test'))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, live: true, claimed: 1, published: 1, drafted: 0 })
    expect(mocks.runPublishWorker).toHaveBeenCalledWith(expect.objectContaining({ draft: false }))
    expect(mocks.reconcileMissingReelEvents).toHaveBeenCalledTimes(1)
  })

  it('isolates lecture and reconcile failures from the publish result', async () => {
    mocks.runLecturePublishSweep.mockRejectedValue(new Error('lecture down'))
    mocks.reconcileMissingReelEvents.mockRejectedValue(new Error('reconcile down'))
    const response = await GET(request('local-test'))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.lecture).toEqual({ error: 'lecture down' })
    expect(body.reel_event_reconcile).toEqual({ error: 'reconcile down' })
    expect(body.claimed).toBe(1)
  })
})
