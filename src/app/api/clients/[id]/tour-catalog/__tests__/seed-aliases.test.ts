import { describe, it, expect, vi, beforeEach } from 'vitest'
import { adminAccess } from './access-fixtures'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

vi.mock('@/lib/tour-catalog/access', () => ({
  requireCatalogAccess: vi.fn(),
}))

vi.mock('@/lib/tour-catalog/store', () => ({
  addAlias: vi.fn(),
  removeAlias: vi.fn(),
  getBatch: vi.fn(),
  rollbackBatch: vi.fn(),
  getClientDomain: vi.fn(),
}))

vi.mock('@/lib/tour-catalog/store-edit', () => ({
  getDepartureLabel: vi.fn(),
}))

vi.mock('@/lib/tour-catalog/seed', () => ({
  fetchFirstPartyFeed: vi.fn(),
  seedCatalog: vi.fn(),
  normalizeDomain: (d: string) => d.replace(/^https?:\/\//, '').replace(/^www\./, ''),
}))

vi.mock('@/lib/web-intelligence/first-party-tours', () => ({
  firstPartyTourSourceUrl: vi.fn(),
}))

import { requireCatalogAccess } from '@/lib/tour-catalog/access'
import {
  addAlias,
  removeAlias,
  getBatch,
  rollbackBatch,
  getClientDomain,
} from '@/lib/tour-catalog/store'
import { getDepartureLabel } from '@/lib/tour-catalog/store-edit'
import { fetchFirstPartyFeed, seedCatalog } from '@/lib/tour-catalog/seed'
import { firstPartyTourSourceUrl } from '@/lib/web-intelligence/first-party-tours'
import { POST as seedPOST } from '../seed/route'
import { POST as aliasesPOST, DELETE as aliasesDELETE } from '../aliases/route'
import { POST as rollbackPOST } from '../batches/[batchId]/rollback/route'

const requireCatalogAccessMock = vi.mocked(requireCatalogAccess)
const addAliasMock = vi.mocked(addAlias)
const removeAliasMock = vi.mocked(removeAlias)
const getBatchMock = vi.mocked(getBatch)
const rollbackBatchMock = vi.mocked(rollbackBatch)
const fetchFirstPartyFeedMock = vi.mocked(fetchFirstPartyFeed)
const seedCatalogMock = vi.mocked(seedCatalog)
const firstPartyTourSourceUrlMock = vi.mocked(firstPartyTourSourceUrl)
const getClientDomainMock = vi.mocked(getClientDomain)
const getDepartureLabelMock = vi.mocked(getDepartureLabel)

const CLIENT_ID = 'client-1'

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeDeleteRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/test', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeParams(): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: CLIENT_ID }) }
}

function makeBatchParams(): { params: Promise<{ id: string; batchId: string }> } {
  return { params: Promise.resolve({ id: CLIENT_ID, batchId: 'b0000000-0000-4000-8000-000000000001' }) }
}

function allowAccess(): void {
  requireCatalogAccessMock.mockResolvedValue(adminAccess('admin@example.com'))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /tour-catalog/seed', () => {
  beforeEach(() => {
    getClientDomainMock.mockResolvedValue('example.com')
  })

  it('returns 400 when the client record has no website domain', async () => {
    allowAccess()
    getClientDomainMock.mockResolvedValue(null)
    const res = await seedPOST(makeRequest({}), makeParams())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'client_domain_missing' })
    expect(firstPartyTourSourceUrlMock).not.toHaveBeenCalled()
  })

  it('uses the client\'s own domain (normalised), never a domain from the request body', async () => {
    allowAccess()
    getClientDomainMock.mockResolvedValue('https://www.client-site.example')
    firstPartyTourSourceUrlMock.mockReturnValue(null)
    await seedPOST(makeRequest({ domain: 'attacker.example' }), makeParams())
    expect(getClientDomainMock).toHaveBeenCalledWith({}, CLIENT_ID)
    expect(firstPartyTourSourceUrlMock).toHaveBeenCalledWith('client-site.example')
  })

  it('returns 400 when the feed is not configured', async () => {
    allowAccess()
    firstPartyTourSourceUrlMock.mockReturnValue(null)
    const res = await seedPOST(makeRequest({ domain: 'example.com' }), makeParams())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'feed_not_configured' })
    expect(fetchFirstPartyFeedMock).not.toHaveBeenCalled()
  })

  it('returns 502 feed_unavailable without a message when the feed fetch fails', async () => {
    allowAccess()
    firstPartyTourSourceUrlMock.mockReturnValue('https://example.com/feed.json')
    fetchFirstPartyFeedMock.mockRejectedValue(new Error('feed_http_500'))
    const res = await seedPOST(makeRequest({ domain: 'example.com' }), makeParams())
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'feed_unavailable' })
    expect(seedCatalogMock).not.toHaveBeenCalled()
  })

  it('returns 502 feed_too_large when the feed is too large', async () => {
    allowAccess()
    firstPartyTourSourceUrlMock.mockReturnValue('https://example.com/feed.json')
    fetchFirstPartyFeedMock.mockRejectedValue(new Error('feed_too_large'))
    const res = await seedPOST(makeRequest({ domain: 'example.com' }), makeParams())
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'feed_too_large' })
    expect(seedCatalogMock).not.toHaveBeenCalled()
  })

  it('returns the seedCatalog result on success', async () => {
    allowAccess()
    firstPartyTourSourceUrlMock.mockReturnValue('https://example.com/feed.json')
    const feed = { source: 's', source_version: '1', products: [] }
    fetchFirstPartyFeedMock.mockResolvedValue(feed)
    const seedResult = {
      toursInserted: 2,
      departuresInserted: 3,
      skippedExisting: ['a/b/c'],
      notes: [],
    }
    seedCatalogMock.mockResolvedValue(seedResult)

    const res = await seedPOST(makeRequest({ domain: 'example.com' }), makeParams())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, ...seedResult })
    expect(seedCatalogMock).toHaveBeenCalledWith({}, CLIENT_ID, feed)
  })

  it('returns 409 catalog_not_empty when the catalog already has tours', async () => {
    allowAccess()
    firstPartyTourSourceUrlMock.mockReturnValue('https://example.com/feed.json')
    fetchFirstPartyFeedMock.mockResolvedValue({ source: 's', source_version: '1', products: [] })
    seedCatalogMock.mockRejectedValue(new Error('catalog_not_empty'))
    const res = await seedPOST(makeRequest({}), makeParams())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'catalog_not_empty' })
  })

  it('returns 400 feed_missing_content_fields for an old-shape website feed', async () => {
    allowAccess()
    firstPartyTourSourceUrlMock.mockReturnValue('https://example.com/feed.json')
    fetchFirstPartyFeedMock.mockResolvedValue({ source: 's', source_version: '1', products: [] })
    seedCatalogMock.mockRejectedValue(new Error('feed_missing_content_fields'))
    const res = await seedPOST(makeRequest({}), makeParams())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'feed_missing_content_fields' })
  })

  it('still answers 500 seed_failed for any other failure', async () => {
    allowAccess()
    firstPartyTourSourceUrlMock.mockReturnValue('https://example.com/feed.json')
    fetchFirstPartyFeedMock.mockResolvedValue({ source: 's', source_version: '1', products: [] })
    seedCatalogMock.mockRejectedValue(new Error('connection reset'))
    const res = await seedPOST(makeRequest({}), makeParams())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'seed_failed' })
  })

  it('passes through the access denial response', async () => {
    const denied = new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
    })
    requireCatalogAccessMock.mockResolvedValue({
      ok: false,
      response: denied as never,
    })
    const res = await seedPOST(makeRequest({ domain: 'example.com' }), makeParams())
    expect(res.status).toBe(403)
    expect(firstPartyTourSourceUrlMock).not.toHaveBeenCalled()
  })
})

describe('POST /tour-catalog/aliases', () => {
  it('returns 400 when alias or tourId is missing', async () => {
    allowAccess()
    const res = await aliasesPOST(makeRequest({ alias: 'x' }), makeParams())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'alias_and_tour_required' })
    expect(addAliasMock).not.toHaveBeenCalled()
  })

  it('returns 409 when the alias is taken', async () => {
    allowAccess()
    addAliasMock.mockResolvedValue({ ok: false, message: 'alias_taken' })
    const res = await aliasesPOST(
      makeRequest({ alias: 'x', tourId: 't1' }),
      makeParams(),
    )
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'alias_taken' })
  })

  it('returns 409 with existingTourId when the alias is taken by another tour', async () => {
    allowAccess()
    addAliasMock.mockResolvedValue({
      ok: false,
      message: 'alias_taken',
      existingTourId: 't-other',
    })
    const res = await aliasesPOST(
      makeRequest({ alias: 'x', tourId: 't1' }),
      makeParams(),
    )
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'alias_taken',
      existingTourId: 't-other',
    })
  })

  it('returns 404 when the tour is not found', async () => {
    allowAccess()
    addAliasMock.mockResolvedValue({ ok: false, message: 'tour_not_found' })
    const res = await aliasesPOST(
      makeRequest({ alias: 'x', tourId: 't1' }),
      makeParams(),
    )
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'tour_not_found' })
  })

  it('returns 400 alias_and_tour_required when the alias is empty', async () => {
    allowAccess()
    addAliasMock.mockResolvedValue({ ok: false, message: 'empty_alias' })
    const res = await aliasesPOST(
      makeRequest({ alias: 'x', tourId: 't1' }),
      makeParams(),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'alias_and_tour_required' })
  })

  it('returns 500 alias_failed for alias_failed', async () => {
    allowAccess()
    addAliasMock.mockResolvedValue({ ok: false, message: 'alias_failed' })
    const res = await aliasesPOST(
      makeRequest({ alias: 'x', tourId: 't1' }),
      makeParams(),
    )
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'alias_failed' })
  })

  it('returns 500 alias_failed for an unknown message without echoing it', async () => {
    allowAccess()
    addAliasMock.mockResolvedValue({ ok: false, message: 'some_internal_detail' })
    const res = await aliasesPOST(
      makeRequest({ alias: 'x', tourId: 't1' }),
      makeParams(),
    )
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'alias_failed' })
  })

  it('returns 200 with aliasNorm on success', async () => {
    allowAccess()
    addAliasMock.mockResolvedValue({ ok: true, aliasNorm: 'x' })
    const res = await aliasesPOST(
      makeRequest({ alias: 'X', tourId: 't1' }),
      makeParams(),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, aliasNorm: 'x' })
    expect(addAliasMock).toHaveBeenCalledWith({}, CLIENT_ID, 'X', 't1')
  })

  it('passes through the access denial response', async () => {
    const denied = new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
    })
    requireCatalogAccessMock.mockResolvedValue({
      ok: false,
      response: denied as never,
    })
    const res = await aliasesPOST(
      makeRequest({ alias: 'x', tourId: 't1' }),
      makeParams(),
    )
    expect(res.status).toBe(403)
    expect(addAliasMock).not.toHaveBeenCalled()
  })
})

describe('DELETE /tour-catalog/aliases', () => {
  it('returns 400 when aliasNorm is missing', async () => {
    allowAccess()
    const res = await aliasesDELETE(makeDeleteRequest({}), makeParams())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'alias_required' })
    expect(removeAliasMock).not.toHaveBeenCalled()
  })

  it('returns 400 when aliasNorm is empty', async () => {
    allowAccess()
    const res = await aliasesDELETE(
      makeDeleteRequest({ aliasNorm: '   ' }),
      makeParams(),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'alias_required' })
    expect(removeAliasMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the alias is not found', async () => {
    allowAccess()
    removeAliasMock.mockResolvedValue({ ok: false, message: 'alias_not_found' })
    const res = await aliasesDELETE(
      makeDeleteRequest({ aliasNorm: 'x' }),
      makeParams(),
    )
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'alias_not_found' })
  })

  it('returns 500 alias_failed on error', async () => {
    allowAccess()
    removeAliasMock.mockResolvedValue({ ok: false, message: 'alias_failed' })
    const res = await aliasesDELETE(
      makeDeleteRequest({ aliasNorm: 'x' }),
      makeParams(),
    )
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'alias_failed' })
  })

  it('returns 200 with ok on success', async () => {
    allowAccess()
    removeAliasMock.mockResolvedValue({ ok: true })
    const res = await aliasesDELETE(
      makeDeleteRequest({ aliasNorm: 'x' }),
      makeParams(),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(removeAliasMock).toHaveBeenCalledWith({}, CLIENT_ID, 'x')
  })

  it('passes through the access denial response', async () => {
    const denied = new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
    })
    requireCatalogAccessMock.mockResolvedValue({
      ok: false,
      response: denied as never,
    })
    const res = await aliasesDELETE(
      makeDeleteRequest({ aliasNorm: 'x' }),
      makeParams(),
    )
    expect(res.status).toBe(403)
    expect(removeAliasMock).not.toHaveBeenCalled()
  })
})

describe('POST /tour-catalog/batches/[batchId]/rollback', () => {
  it('returns 404 when the batch is not found', async () => {
    allowAccess()
    getBatchMock.mockResolvedValue(null)
    const res = await rollbackPOST(makeRequest({}), makeBatchParams())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'batch_not_found' })
    expect(rollbackBatchMock).not.toHaveBeenCalled()
  })

  it('returns 409 conflict with the departure label when the message is parseable', async () => {
    allowAccess()
    getBatchMock.mockResolvedValue({ id: 'b0000000-0000-4000-8000-000000000001' } as never)
    rollbackBatchMock.mockResolvedValue({
      ok: false,
      code: 'conflict',
      message: 'conflict:modified:11111111-1111-1111-1111-111111111111',
    })
    getDepartureLabelMock.mockResolvedValue({
      tourName: 'Grand Tour',
      departOn: '2026-05-01',
    })
    const res = await rollbackPOST(makeRequest({}), makeBatchParams())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'conflict',
      conflict: {
        reason: 'modified',
        tourName: 'Grand Tour',
        departOn: '2026-05-01',
      },
    })
    expect(getDepartureLabelMock).toHaveBeenCalledWith(
      {},
      CLIENT_ID,
      '11111111-1111-1111-1111-111111111111',
    )
  })

  it('returns 409 conflict with reason missing when the message says missing', async () => {
    allowAccess()
    getBatchMock.mockResolvedValue({ id: 'b0000000-0000-4000-8000-000000000001' } as never)
    rollbackBatchMock.mockResolvedValue({
      ok: false,
      code: 'conflict',
      message: 'conflict:missing:22222222-2222-2222-2222-222222222222',
    })
    getDepartureLabelMock.mockResolvedValue({
      tourName: 'Short Trip',
      departOn: '2026-06-01',
    })
    const res = await rollbackPOST(makeRequest({}), makeBatchParams())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'conflict',
      conflict: {
        reason: 'missing',
        tourName: 'Short Trip',
        departOn: '2026-06-01',
      },
    })
  })

  it('returns 409 conflict without a conflict field when the label is null', async () => {
    allowAccess()
    getBatchMock.mockResolvedValue({ id: 'b0000000-0000-4000-8000-000000000001' } as never)
    rollbackBatchMock.mockResolvedValue({
      ok: false,
      code: 'conflict',
      message: 'conflict:modified:11111111-1111-1111-1111-111111111111',
    })
    getDepartureLabelMock.mockResolvedValue(null)
    const res = await rollbackPOST(makeRequest({}), makeBatchParams())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'conflict' })
  })

  it('returns 409 conflict without a conflict field when the message is unparseable', async () => {
    allowAccess()
    getBatchMock.mockResolvedValue({ id: 'b0000000-0000-4000-8000-000000000001' } as never)
    rollbackBatchMock.mockResolvedValue({
      ok: false,
      code: 'conflict',
      message: 'conflict:departure_changed',
    })
    const res = await rollbackPOST(makeRequest({}), makeBatchParams())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'conflict' })
    expect(getDepartureLabelMock).not.toHaveBeenCalled()
  })

  it('returns 409 not_applicable', async () => {
    allowAccess()
    getBatchMock.mockResolvedValue({ id: 'b0000000-0000-4000-8000-000000000001' } as never)
    rollbackBatchMock.mockResolvedValue({
      ok: false,
      code: 'not_applicable',
      message: 'batch_not_rollbackable',
    })
    const res = await rollbackPOST(makeRequest({}), makeBatchParams())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'not_applicable' })
  })

  it('returns 500 rollback_failed on error', async () => {
    allowAccess()
    getBatchMock.mockResolvedValue({ id: 'b0000000-0000-4000-8000-000000000001' } as never)
    rollbackBatchMock.mockResolvedValue({
      ok: false,
      code: 'error',
      message: 'db_down',
    })
    const res = await rollbackPOST(makeRequest({}), makeBatchParams())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'rollback_failed' })
  })

  it('returns 200 with the result on success', async () => {
    allowAccess()
    getBatchMock.mockResolvedValue({ id: 'b0000000-0000-4000-8000-000000000001' } as never)
    rollbackBatchMock.mockResolvedValue({ ok: true, result: { reverted: 2 } })
    const res = await rollbackPOST(makeRequest({}), makeBatchParams())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, result: { reverted: 2 } })
  })

  it('passes through the access denial response', async () => {
    const denied = new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
    })
    requireCatalogAccessMock.mockResolvedValue({
      ok: false,
      response: denied as never,
    })
    const res = await rollbackPOST(makeRequest({}), makeBatchParams())
    expect(res.status).toBe(403)
    expect(getBatchMock).not.toHaveBeenCalled()
  })
})
