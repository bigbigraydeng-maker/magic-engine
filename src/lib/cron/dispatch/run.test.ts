import { afterEach, describe, expect, it, vi } from 'vitest'
import { runDueJobs } from './run'
import type { DispatchJob } from './types'

const job = (service: string, healthcheckUrl?: string): DispatchJob => ({
  service,
  route: service,
  method: 'GET',
  auth: 'bearer',
  schedule: '0 * * * *',
  healthcheckUrl,
})

describe('runDueJobs', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps going when one job throws and records that job alone', async () => {
    const invoke = vi.fn(async (item: DispatchJob) => {
      if (item.service === 'bad') throw new Error('places denied')
      return { status: 200, body: 'ok' }
    })
    const report = await runDueJobs([job('bad'), job('good')], 'secret', invoke)
    expect(report.find((row) => row.service === 'bad')).toMatchObject({ ok: false, status: 0 })
    expect(report.find((row) => row.service === 'good')).toMatchObject({ ok: true, status: 200 })
  })

  it('pings the healthcheck only after a 2xx', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input
      return new Response('ok', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const invoke = vi.fn(async (item: DispatchJob) => {
      return item.service === 'slow'
        ? { status: 500, body: 'nope' }
        : { status: 202, body: 'accepted' }
    })
    const report = await runDueJobs(
      [job('slow', 'https://hc.example/slow'), job('fast', 'https://hc.example/fast')],
      'secret',
      invoke,
    )
    expect(report.find((row) => row.service === 'slow')?.ping).toBe('skipped')
    expect(report.find((row) => row.service === 'fast')?.ping).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://hc.example/fast')
  })
})
