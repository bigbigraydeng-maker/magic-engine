import { describe, expect, it } from 'vitest'
import { parseRenderWorkerField, renderWorkerDownReason } from './render-worker-report'

const CLIENT = 'client-a'

describe('parseRenderWorkerField', () => {
  it('a missing field is not reported as healthy', () => {
    expect(parseRenderWorkerField({ worker_id: 'w' })).toBeUndefined()
  })

  it('a bad shape is unreadable', () => {
    expect(parseRenderWorkerField({ render_worker: 'nope' })).toEqual({ ok: false, reason: '读不到' })
    expect(parseRenderWorkerField({ render_worker: { ok: false } })).toEqual({ ok: false, reason: '读不到' })
  })

  it('keeps an explicit failure reason', () => {
    expect(parseRenderWorkerField({ render_worker: { ok: false, reason: 'engine down' } })).toEqual({
      ok: false,
      reason: 'engine down',
    })
    expect(parseRenderWorkerField({ render_worker: { ok: true } })).toEqual({ ok: true })
  })
})

describe('renderWorkerDownReason', () => {
  it('reports only an explicit failure for this client', () => {
    const pings = [
      { summary: { client_ids: ['other'], render_worker: { ok: false, reason: 'other' } } },
      { summary: { client_ids: [CLIENT], render_worker: { ok: true } } },
    ]
    expect(renderWorkerDownReason(pings, CLIENT)).toBeNull()
    expect(renderWorkerDownReason([
      { summary: { client_ids: [CLIENT], render_worker: { ok: false, reason: 'engine down' } } },
    ], CLIENT)).toBe('engine down')
  })

  it('a missing report is not a failure, a bad report is unreadable', () => {
    expect(renderWorkerDownReason([{ summary: { client_ids: [CLIENT] } }], CLIENT)).toBeNull()
    expect(renderWorkerDownReason([
      { summary: { client_ids: [CLIENT], render_worker: 'bad' } },
    ], CLIENT)).toBe('读不到')
  })
})
