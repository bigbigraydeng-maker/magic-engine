import { describe, expect, it } from 'vitest'
import { pingRenderWorker, watchRenderWorker } from './render-worker-watch.mjs'

describe('watchRenderWorker', () => {
  it('an unreadable check is not healthy', () => {
    expect(watchRenderWorker(undefined)).toEqual({ ok: false, watched: false, reason: '读不到' })
    expect(watchRenderWorker([1])).toEqual({ ok: false, watched: false, reason: '读不到' })
  })

  it('an empty problem list is healthy, a problem line is not', () => {
    expect(watchRenderWorker([])).toEqual({ ok: true, watched: true })
    expect(watchRenderWorker(['engine down'])).toEqual({ ok: false, watched: true, reason: 'engine down' })
  })
})

describe('pingRenderWorker', () => {
  it('forwards a watched failure and does not invent health', () => {
    expect(pingRenderWorker({ ok: true, watched: true })).toEqual({ ok: true })
    expect(pingRenderWorker({ ok: false, watched: true, reason: 'engine down' })).toEqual({
      ok: false,
      reason: 'engine down',
    })
    expect(pingRenderWorker(undefined)).toEqual({ ok: false, reason: '读不到' })
    expect(pingRenderWorker({ ok: true, watched: false })).toEqual({ ok: false, reason: '读不到' })
  })
})
