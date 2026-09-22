import { describe, expect, it, vi } from 'vitest'

const collect = vi.hoisted(() => vi.fn())
const collectTraffic = vi.hoisted(() => vi.fn())
vi.mock('../apify-external', () => ({ collectApifyExternalObservations: collect, collectTrafficDirectionObservations: collectTraffic }))
vi.mock('../store', () => ({ recordExternalObservation: vi.fn() }))

import { collectAndRecordExternalObservations, collectAndRecordTrafficDirectionObservations } from '../external-run'

const observation = (url: string) => ({
  client_id: '00000000-0000-0000-0000-000000000001', source_type: 'industry_media', source_tier: 'B',
  source_name: 'Travel Today', source_url: url, canonical_url: url, title: 'Story', excerpt: 'Evidence',
  competitor_domain: null, published_at: null, observed_at: '2026-09-11T00:00:00.000Z', valid_until: null,
  content_hash: 'a'.repeat(64), status: 'observed',
})

describe('external observation run orchestration', () => {
  it('persists every valid row and counts duplicate retries separately', async () => {
    collect.mockResolvedValue({ observations: [observation('https://example.com/1'), observation('https://example.com/2')], rejected: 1, runId: 'run-1' })
    const persist = vi.fn()
      .mockResolvedValueOnce('id-1')
      .mockRejectedValueOnce(new Error('external_observation_duplicate'))
    const result = await collectAndRecordExternalObservations({
      actorId: 'actor/news', actorInput: {}, sourceId: 'travel-today', clientId: observation('').client_id,
      observedAt: '2026-09-11T00:00:00Z', persist,
    })
    expect(result).toMatchObject({ runId: 'run-1', rejected: 1, persisted: 1, duplicates: 1, writeFailures: 0, filtered: 0 })
    expect(persist).toHaveBeenCalledTimes(2)
  })

  it('reports storage failures without hiding a successful provider run', async () => {
    collect.mockResolvedValue({ observations: [observation('https://example.com/1')], rejected: 0, runId: 'run-2' })
    const result = await collectAndRecordExternalObservations({
      actorId: 'actor/news', actorInput: {}, sourceId: 'travel-today', clientId: observation('').client_id,
      observedAt: '2026-09-11T00:00:00Z', persist: vi.fn().mockRejectedValue(new Error('db down')),
    })
    expect(result).toMatchObject({ runId: 'run-2', persisted: 0, duplicates: 0, writeFailures: 1, filtered: 0 })
  })

  it('drops industry observations outside the client market before persistence', async () => {
    collect.mockResolvedValue({ observations: [observation('https://example.com/egypt')], rejected: 0, runId: 'run-3' })
    const persist = vi.fn().mockResolvedValue('id-3')
    const result = await collectAndRecordExternalObservations({
      actorId: 'actor/news', actorInput: {}, sourceId: 'travel-today', clientId: observation('').client_id,
      observedAt: '2026-09-11T00:00:00Z', relevanceTerms: ['china'], persist,
    })
    expect(result).toMatchObject({ runId: 'run-3', rejected: 0, filtered: 1, persisted: 0 })
    expect(persist).not.toHaveBeenCalled()
  })

  it('persists traffic direction observations through the shared path', async () => {
    collectTraffic.mockResolvedValue({
      observations: [observation('https://www.similarweb.com/website/wendywutours.co.nz/')],
      rejected: 0, runId: 'traffic-run-1', datasetId: 'traffic-dataset-1', costUsd: 0.01,
    })
    const persist = vi.fn().mockResolvedValue('traffic-observation-1')
    const result = await collectAndRecordTrafficDirectionObservations({
      clientId: observation('').client_id, domains: ['wendywutours.co.nz'], observedAt: '2026-09-13T00:00:00Z', persist,
    })
    expect(result).toMatchObject({ runId: 'traffic-run-1', datasetId: 'traffic-dataset-1', costUsd: 0.01, persisted: 1 })
    expect(persist).toHaveBeenCalledTimes(1)
  })
})
