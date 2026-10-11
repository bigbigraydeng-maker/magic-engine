import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { patchContext } from '@/lib/tour-catalog/__tests__/content-fixture'
import { adminAccess, editorAccess } from './access-fixtures'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

const { requireCatalogAccess, updateTour, saveDeparture, loadTourPatchContext } = vi.hoisted(() => ({
  requireCatalogAccess: vi.fn(),
  updateTour: vi.fn(),
  saveDeparture: vi.fn(),
  loadTourPatchContext: vi.fn(),
}))
vi.mock('@/lib/tour-catalog/access', () => ({ requireCatalogAccess }))
vi.mock('@/lib/tour-catalog/store-edit', () => ({ updateTour, saveDeparture }))
vi.mock('@/lib/tour-catalog/patch-context', () => ({ loadTourPatchContext }))

import { PATCH as patchTour } from '../tours/[tourId]/route'
import { POST as postDeparture } from '../tours/[tourId]/departures/route'
import { PATCH as patchDeparture } from '../departures/[departureId]/route'

const CLIENT_ID = 'client-1'
const TOUR_ID = '11111111-1111-4111-8111-111111111111'
const DEPARTURE_ID = '22222222-2222-4222-8222-222222222222'

/** Marker values planted in `internal`; none of them may appear anywhere in an editor's response. */
const AIRLINE_MARK = 'ZZ-AIRLINE-MARK'
const CAPACITY_MARK = 987654321
const ROUTE_MARK = 'ROUTE-MARK-AKL-PVG'

function savedDeparture() {
  return {
    id: DEPARTURE_ID,
    tourId: TOUR_ID,
    clientId: CLIENT_ID,
    departOn: '2027-05-08',
    returnOn: '2027-05-18',
    priceTextOverride: null,
    status: 'open',
    internal: { airline: AIRLINE_MARK, capacity: CAPACITY_MARK, outboundRoute: ROUTE_MARK },
    updatedAt: 'v2',
  }
}

function request(method: 'PATCH' | 'POST', body: unknown): NextRequest {
  return new NextRequest('http://localhost/test', {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

async function patchResponse(): Promise<NextResponse> {
  return patchDeparture(
    request('PATCH', { tourId: TOUR_ID, expectedUpdatedAt: 'v1', patch: { status: 'limited' } }),
    { params: Promise.resolve({ id: CLIENT_ID, departureId: DEPARTURE_ID }) },
  )
}

async function postResponse(): Promise<NextResponse> {
  return postDeparture(request('POST', { departOn: '2027-05-08', returnOn: '2027-05-18', status: 'open' }), {
    params: Promise.resolve({ id: CLIENT_ID, tourId: TOUR_ID }),
  })
}

function expectNoMarkers(text: string): void {
  expect(text).not.toContain(AIRLINE_MARK)
  expect(text).not.toContain(String(CAPACITY_MARK))
  expect(text).not.toContain(ROUTE_MARK)
}

beforeEach(() => {
  vi.clearAllMocks()
  saveDeparture.mockResolvedValue({ ok: true, value: savedDeparture() })
  loadTourPatchContext.mockResolvedValue(patchContext())
})

describe('departure save responses are trimmed by role (design §6.10.1 item 3)', () => {
  it('PATCH departures/[departureId]: a client editor gets the saved row without any internal fact', async () => {
    requireCatalogAccess.mockResolvedValue(editorAccess('staff@client.example'))
    const res = await patchResponse()
    expect(res.status).toBe(200)
    const text = await res.text()
    expectNoMarkers(text)
    const body = JSON.parse(text) as { departure: Record<string, unknown> }
    expect(body.departure.internal).toEqual({})
    expect(body.departure.id).toBe(DEPARTURE_ID)
    expect(body.departure.updatedAt).toBe('v2')
  })

  it('POST tours/[tourId]/departures: a client editor gets the new row without any internal fact', async () => {
    requireCatalogAccess.mockResolvedValue(editorAccess('staff@client.example'))
    const res = await postResponse()
    expect(res.status).toBe(201)
    const text = await res.text()
    expectNoMarkers(text)
    expect((JSON.parse(text) as { departure: Record<string, unknown> }).departure.internal).toEqual({})
  })

  it('PATCH departures/[departureId]: a Magic Engine admin still sees internal', async () => {
    requireCatalogAccess.mockResolvedValue(adminAccess('admin@example.com'))
    const text = await (await patchResponse()).text()
    expect(text).toContain(AIRLINE_MARK)
    expect(text).toContain(String(CAPACITY_MARK))
    expect(text).toContain(ROUTE_MARK)
  })

  it('POST tours/[tourId]/departures: a Magic Engine admin still sees internal', async () => {
    requireCatalogAccess.mockResolvedValue(adminAccess('admin@example.com'))
    const text = await (await postResponse()).text()
    expect(text).toContain(AIRLINE_MARK)
    expect(text).toContain(String(CAPACITY_MARK))
    expect(text).toContain(ROUTE_MARK)
  })

  it('PATCH tours/[tourId]: the tour row has no internal field to leak', async () => {
    requireCatalogAccess.mockResolvedValue(editorAccess('staff@client.example'))
    updateTour.mockResolvedValue({ ok: true, value: { id: TOUR_ID, name: 'X', updatedAt: 'v2' } })
    const res = await patchTour(request('PATCH', { expectedUpdatedAt: 'v1', patch: { name: 'X' } }), {
      params: Promise.resolve({ id: CLIENT_ID, tourId: TOUR_ID }),
    })
    expect(res.status).toBe(200)
    expect(Object.keys((await res.json() as { tour: Record<string, unknown> }).tour)).not.toContain('internal')
  })
})
