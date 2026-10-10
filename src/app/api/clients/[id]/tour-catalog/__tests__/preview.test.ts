import { describe, it, expect, vi, beforeEach } from 'vitest'
import { adminAccess } from './access-fixtures'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

vi.mock('@/lib/tour-catalog/access', () => ({
  requireCatalogAccess: vi.fn(),
}))

vi.mock('@/lib/tour-catalog/store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tour-catalog/store')>(
    '@/lib/tour-catalog/store',
  )
  return {
    ...actual,
    loadDraftCatalog: vi.fn(),
    createPreviewBatch: vi.fn(),
  }
})

import { requireCatalogAccess } from '@/lib/tour-catalog/access'
import { loadDraftCatalog, createPreviewBatch } from '@/lib/tour-catalog/store'
import { POST } from '../preview/route'
import { EMPTY_TOUR_CONTENT } from '@/lib/tour-catalog/__tests__/content-fixture'

const TOUR_NAME = 'China Discovery — Best of China'
const VALID_CSV = `tour,depart_on,return_on\n${TOUR_NAME},2027-03-11,2027-03-25`

const TOUR = {
  id: 'tour-1',
  clientId: 'client-1',
  slug: 'china-discovery',
  destination: 'China',
  tier: 'standard',
  name: TOUR_NAME,
  title: null,
  shortDescription: null,
  durationText: null,
  displayPriceText: null,
  highlights: [],
  itinerary: [],
  inclusions: [],
  exclusions: [],
  tourCities: [],
  singleSupplement: null,
  maxGroupSize: null,
  isActive: true,
  managesDepartures: true,
  sortOrder: 0,
  ...EMPTY_TOUR_CONTENT,
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const EMPTY_SNAPSHOT = { tours: [TOUR], departures: [], aliases: [] }

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/clients/client-1/tour-catalog/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeParams(): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: 'client-1' }) }
}

const mockedAccess = vi.mocked(requireCatalogAccess)
const mockedLoadCatalog = vi.mocked(loadDraftCatalog)
const mockedCreatePreviewBatch = vi.mocked(createPreviewBatch)

beforeEach(() => {
  vi.clearAllMocks()
  mockedAccess.mockResolvedValue(adminAccess('pm@example.com'))
  mockedLoadCatalog.mockResolvedValue(EMPTY_SNAPSHOT)
})

describe('POST tour-catalog preview', () => {
  it('passes through the access denial response', async () => {
    const denied = NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    mockedAccess.mockResolvedValue({ ok: false, response: denied })

    const res = await POST(makeRequest({ csv: VALID_CSV }), makeParams())

    expect(res.status).toBe(403)
    expect(mockedLoadCatalog).not.toHaveBeenCalled()
  })

  it('returns 400 when csv is missing', async () => {
    const res = await POST(makeRequest({}), makeParams())

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'csv_required' })
  })

  it('returns 400 on a fatal parse error', async () => {
    const res = await POST(makeRequest({ csv: 'foo,bar\n1,2' }), makeParams())

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'missing_required_columns' })
  })

  it('creates a preview batch for a valid row', async () => {
    mockedCreatePreviewBatch.mockResolvedValue({ ok: true, batchId: 'batch-1' })

    const res = await POST(makeRequest({ csv: VALID_CSV }), makeParams())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.batchId).toBe('batch-1')
    expect(body.summary.adds).toBe(1)

    expect(mockedCreatePreviewBatch).toHaveBeenCalledTimes(1)
    const args = mockedCreatePreviewBatch.mock.calls[0][1]
    expect(args.kind).toBe('departures')
    expect(args.fileSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns 409 on a duplicate file', async () => {
    mockedCreatePreviewBatch.mockResolvedValue({
      ok: false,
      reason: 'duplicate_file',
      existingBatchId: 'batch-existing',
    })

    const res = await POST(makeRequest({ csv: VALID_CSV }), makeParams())

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({
      error: 'duplicate_file',
      existingBatchId: 'batch-existing',
    })
  })

  it('returns 200 with a null batchId when no tour matches', async () => {
    const csv = 'tour,depart_on,return_on\nUnknown Tour,2027-03-11,2027-03-25'

    const res = await POST(makeRequest({ csv }), makeParams())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.batchId).toBeNull()
    expect(body.rejected).toContainEqual(
      expect.objectContaining({ reason: 'tour_not_found' }),
    )
    expect(mockedCreatePreviewBatch).not.toHaveBeenCalled()
  })

  it('returns 500 on a db error', async () => {
    mockedCreatePreviewBatch.mockResolvedValue({
      ok: false,
      reason: 'db_error',
      message: 'boom',
    })

    const res = await POST(makeRequest({ csv: VALID_CSV }), makeParams())

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ error: 'preview_failed' })
  })

  it('returns 413 when content-length exceeds the limit', async () => {
    const req = new NextRequest(
      'http://localhost/api/clients/client-1/tour-catalog/preview',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(3 * 1024 * 1024 + 1),
        },
        body: JSON.stringify({ csv: VALID_CSV }),
      },
    )

    const res = await POST(req, makeParams())

    expect(res.status).toBe(413)
    await expect(res.json()).resolves.toEqual({ error: 'request_too_large' })
    expect(mockedLoadCatalog).not.toHaveBeenCalled()
  })

  it('returns 413 when the actual body exceeds the limit without a header', async () => {
    const bigCsv = 'x'.repeat(3 * 1024 * 1024 + 1)
    const req = new NextRequest(
      'http://localhost/api/clients/client-1/tour-catalog/preview',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ csv: bigCsv }),
      },
    )

    const res = await POST(req, makeParams())

    expect(res.status).toBe(413)
    await expect(res.json()).resolves.toEqual({ error: 'request_too_large' })
    expect(mockedLoadCatalog).not.toHaveBeenCalled()
  })

  it('includes a planHash matching the summary passed to createPreviewBatch', async () => {
    mockedCreatePreviewBatch.mockResolvedValue({ ok: true, batchId: 'batch-1' })

    const res = await POST(makeRequest({ csv: VALID_CSV }), makeParams())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.planHash).toMatch(/^[0-9a-f]{64}$/)

    const args = mockedCreatePreviewBatch.mock.calls[0][1]
    expect(args.summary.planHash).toBe(body.planHash)
  })

  it('includes a planHash in the null-batchId response', async () => {
    const csv = 'tour,depart_on,return_on\nUnknown Tour,2027-03-11,2027-03-25'

    const res = await POST(makeRequest({ csv }), makeParams())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.batchId).toBeNull()
    expect(body.planHash).toMatch(/^[0-9a-f]{64}$/)
  })
})
