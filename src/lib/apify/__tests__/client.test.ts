import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { abortRun, getDatasetItems, getRun, runActor, waitForRun } from '../client'
const mockFetch = vi.fn()
beforeEach(() => { vi.stubEnv('APIFY_API_KEY', 'test-secret'); vi.stubGlobal('fetch', mockFetch); mockFetch.mockReset() })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
const success = () => mockFetch.mockResolvedValue({ ok: true, json: async () => ({ data: { id: 'run1', status: 'SUCCEEDED', usageTotalUsd: 0.02 } }) })
describe('Apify shared transport', () => {
  it('keeps legacy two-argument starts and moves credential to header', async () => {
    success()
    await runActor('apify/website-content-crawler', { startUrls: [] })
    expect(mockFetch).toHaveBeenCalledWith('https://api.apify.com/v2/acts/apify~website-content-crawler/runs?', expect.objectContaining({ headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-secret' } }))
  })
  it('serializes bounded start options without embedding credentials', async () => {
    success()
    await runActor('owner/actor', {}, { maxTotalChargeUsd: 0.05, timeout: 120, memory: 1024, build: '1.2.3' })
    const url = new URL(mockFetch.mock.calls[0][0])
    expect(Object.fromEntries(url.searchParams)).toEqual({ maxTotalChargeUsd: '0.05', timeout: '120', memory: '1024', build: '1.2.3' })
  })
  it('reads run usage without spawning another actor', async () => {
    success()
    expect((await getRun('run1')).usageTotalUsd).toBe(0.02)
    expect(mockFetch).toHaveBeenCalledWith('https://api.apify.com/v2/actor-runs/run1', expect.objectContaining({ method: 'GET' }))
  })
  it('aborts known run via POST', async () => {
    success(); await abortRun('run1')
    expect(mockFetch).toHaveBeenCalledWith('https://api.apify.com/v2/actor-runs/run1/abort', expect.objectContaining({ method: 'POST' }))
  })
  it('rejects path injection in run ID before network', async () => {
    await expect(getRun('../runs')).rejects.toThrow('Invalid')
    expect(mockFetch).not.toHaveBeenCalled()
  })
  it('reuses getRun in legacy polling', async () => {
    success(); expect((await waitForRun('owner/actor', 'run1')).status).toBe('SUCCEEDED')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
  it('uses header auth for dataset reads', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => [] })
    await getDatasetItems('dataset1')
    expect(mockFetch).toHaveBeenCalledWith('https://api.apify.com/v2/datasets/dataset1/items', expect.objectContaining({ headers: { Authorization: 'Bearer test-secret' }, signal: expect.any(AbortSignal) }))
  })
  it('surfaces failed run reads without leaking response content', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 })
    await expect(getRun('run1')).rejects.toThrow('getRun error 401')
  })
})
