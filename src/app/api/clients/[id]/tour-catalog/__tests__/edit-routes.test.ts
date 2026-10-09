import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

// vi.mock is hoisted above plain consts, so the mock fns must come from vi.hoisted.
const { requireCatalogAdmin, updateTour, saveDeparture } = vi.hoisted(() => ({
  requireCatalogAdmin: vi.fn(),
  updateTour: vi.fn(),
  saveDeparture: vi.fn(),
}))
vi.mock('@/lib/tour-catalog/access', () => ({ requireCatalogAdmin }))
vi.mock('@/lib/tour-catalog/store-edit', () => ({ updateTour, saveDeparture }))

import { PATCH as patchTour } from '../tours/[tourId]/route'
import { POST as postDeparture } from '../tours/[tourId]/departures/route'
import { PATCH as patchDeparture } from '../departures/[departureId]/route'

const CLIENT_ID = 'client-1'
const TOUR_ID = 'tour-1'
const DEPARTURE_ID = 'dep-1'
const ACTOR = 'admin@example.com'
const ASSISTANT_ACTOR = `${ACTOR} (AI 助手)`

function jsonRequest(body: unknown, url = 'http://localhost/test'): NextRequest {
  return new NextRequest(url, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

function rawRequest(raw: string): NextRequest {
  return new NextRequest('http://localhost/test', {
    method: 'PATCH',
    body: raw,
    headers: { 'content-type': 'application/json' },
  })
}

function tourContext() {
  return { params: Promise.resolve({ id: CLIENT_ID, tourId: TOUR_ID }) }
}

function departureContext() {
  return { params: Promise.resolve({ id: CLIENT_ID, departureId: DEPARTURE_ID }) }
}

async function bodyOf(res: NextResponse): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  requireCatalogAdmin.mockResolvedValue({ ok: true, actor: ACTOR })
})

describe('PATCH tours/[tourId]', () => {
  it('returns 400 when expectedUpdatedAt is missing', async () => {
    const res = await patchTour(jsonRequest({ patch: { name: 'X' } }), tourContext())
    expect(res.status).toBe(400)
    expect(await bodyOf(res)).toEqual({ error: 'expected_updated_at_required' })
    expect(updateTour).not.toHaveBeenCalled()
  })

  it('returns 400 when expectedUpdatedAt is blank', async () => {
    const res = await patchTour(
      jsonRequest({ expectedUpdatedAt: '   ', patch: { name: 'X' } }),
      tourContext(),
    )
    expect(res.status).toBe(400)
    expect(await bodyOf(res)).toEqual({ error: 'expected_updated_at_required' })
  })

  it('returns 400 invalid_fields when the patch is invalid', async () => {
    const res = await patchTour(
      jsonRequest({ expectedUpdatedAt: 'v1', patch: { name: '' } }),
      tourContext(),
    )
    expect(res.status).toBe(400)
    const body = await bodyOf(res)
    expect(body.error).toBe('invalid_fields')
    expect(Array.isArray(body.fields)).toBe(true)
    expect(updateTour).not.toHaveBeenCalled()
  })

  it('returns 200 with the tour on success and passes the actor', async () => {
    updateTour.mockResolvedValue({ ok: true, value: { id: TOUR_ID } })
    const res = await patchTour(
      jsonRequest({ expectedUpdatedAt: 'v1', patch: { name: 'New Name' } }),
      tourContext(),
    )
    expect(res.status).toBe(200)
    expect(await bodyOf(res)).toEqual({ tour: { id: TOUR_ID } })
    expect(updateTour).toHaveBeenCalledWith(
      expect.anything(),
      CLIENT_ID,
      TOUR_ID,
      'v1',
      { name: 'New Name' },
      ACTOR,
    )
  })

  it('tags the actor when via=assistant', async () => {
    updateTour.mockResolvedValue({ ok: true, value: { id: TOUR_ID } })
    const res = await patchTour(
      jsonRequest(
        { expectedUpdatedAt: 'v1', patch: { name: 'New Name' } },
        'http://localhost/test?via=assistant',
      ),
      tourContext(),
    )
    expect(res.status).toBe(200)
    expect(updateTour).toHaveBeenCalledWith(
      expect.anything(),
      CLIENT_ID,
      TOUR_ID,
      'v1',
      { name: 'New Name' },
      ASSISTANT_ACTOR,
    )
  })

  it('maps conflict to 409', async () => {
    updateTour.mockResolvedValue({ ok: false, code: 'conflict', message: 'conflict:stale' })
    const res = await patchTour(
      jsonRequest({ expectedUpdatedAt: 'v1', patch: { name: 'X' } }),
      tourContext(),
    )
    expect(res.status).toBe(409)
    expect(await bodyOf(res)).toEqual({ error: 'conflict' })
  })

  it('maps not_found to 404', async () => {
    updateTour.mockResolvedValue({ ok: false, code: 'not_found', message: 'tour_not_found' })
    const res = await patchTour(
      jsonRequest({ expectedUpdatedAt: 'v1', patch: { name: 'X' } }),
      tourContext(),
    )
    expect(res.status).toBe(404)
    expect(await bodyOf(res)).toEqual({ error: 'not_found' })
  })

  it('maps invalid to 400 invalid_fields', async () => {
    updateTour.mockResolvedValue({ ok: false, code: 'invalid', message: 'field_not_editable' })
    const res = await patchTour(
      jsonRequest({ expectedUpdatedAt: 'v1', patch: { name: 'X' } }),
      tourContext(),
    )
    expect(res.status).toBe(400)
    expect(await bodyOf(res)).toEqual({ error: 'invalid_fields' })
  })

  it('maps duplicate to 500 save_failed', async () => {
    updateTour.mockResolvedValue({ ok: false, code: 'duplicate', message: 'conflict:duplicate_departure' })
    const res = await patchTour(
      jsonRequest({ expectedUpdatedAt: 'v1', patch: { name: 'X' } }),
      tourContext(),
    )
    expect(res.status).toBe(500)
    expect(await bodyOf(res)).toEqual({ error: 'save_failed' })
  })

  it('maps error to 500 save_failed', async () => {
    updateTour.mockResolvedValue({ ok: false, code: 'error', message: 'boom' })
    const res = await patchTour(
      jsonRequest({ expectedUpdatedAt: 'v1', patch: { name: 'X' } }),
      tourContext(),
    )
    expect(res.status).toBe(500)
    expect(await bodyOf(res)).toEqual({ error: 'save_failed' })
  })

  it('treats invalid JSON as an empty body', async () => {
    const res = await patchTour(rawRequest('{not json'), tourContext())
    expect(res.status).toBe(400)
    expect(await bodyOf(res)).toEqual({ error: 'expected_updated_at_required' })
  })

  it('passes through the access denial response', async () => {
    const denied = NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    requireCatalogAdmin.mockResolvedValue({ ok: false, response: denied })
    const res = await patchTour(
      jsonRequest({ expectedUpdatedAt: 'v1', patch: { name: 'X' } }),
      tourContext(),
    )
    expect(res.status).toBe(403)
    expect(await bodyOf(res)).toEqual({ error: 'Forbidden' })
    expect(updateTour).not.toHaveBeenCalled()
  })
})

describe('POST tours/[tourId]/departures', () => {
  const validBody = {
    departOn: '2026-01-01',
    returnOn: '2026-01-10',
    status: 'open',
    priceTextOverride: null,
  }

  it('returns 400 invalid_fields for an invalid body', async () => {
    const res = await postDeparture(jsonRequest({ departOn: '' }), tourContext())
    expect(res.status).toBe(400)
    const body = await bodyOf(res)
    expect(body.error).toBe('invalid_fields')
    expect(Array.isArray(body.fields)).toBe(true)
    expect(saveDeparture).not.toHaveBeenCalled()
  })

  it('returns 201 with the departure on success and passes the actor', async () => {
    saveDeparture.mockResolvedValue({ ok: true, value: { id: DEPARTURE_ID } })
    const res = await postDeparture(jsonRequest(validBody), tourContext())
    expect(res.status).toBe(201)
    expect(await bodyOf(res)).toEqual({ departure: { id: DEPARTURE_ID } })
    expect(saveDeparture).toHaveBeenCalledWith(
      expect.anything(),
      CLIENT_ID,
      TOUR_ID,
      null,
      null,
      {
        depart_on: '2026-01-01',
        return_on: '2026-01-10',
        status: 'open',
        price_text_override: null,
      },
      ACTOR,
    )
  })

  it('tags the actor when via=assistant', async () => {
    saveDeparture.mockResolvedValue({ ok: true, value: { id: DEPARTURE_ID } })
    const res = await postDeparture(
      jsonRequest(validBody, 'http://localhost/test?via=assistant'),
      tourContext(),
    )
    expect(res.status).toBe(201)
    expect(saveDeparture).toHaveBeenCalledWith(
      expect.anything(),
      CLIENT_ID,
      TOUR_ID,
      null,
      null,
      {
        depart_on: '2026-01-01',
        return_on: '2026-01-10',
        status: 'open',
        price_text_override: null,
      },
      ASSISTANT_ACTOR,
    )
  })

  it('maps duplicate to 409 duplicate_departure', async () => {
    saveDeparture.mockResolvedValue({ ok: false, code: 'duplicate', message: 'conflict:duplicate_departure' })
    const res = await postDeparture(jsonRequest(validBody), tourContext())
    expect(res.status).toBe(409)
    expect(await bodyOf(res)).toEqual({ error: 'duplicate_departure' })
  })

  it('maps not_found to 404', async () => {
    saveDeparture.mockResolvedValue({ ok: false, code: 'not_found', message: 'tour_not_found' })
    const res = await postDeparture(jsonRequest(validBody), tourContext())
    expect(res.status).toBe(404)
    expect(await bodyOf(res)).toEqual({ error: 'not_found' })
  })

  it('maps invalid to 400 invalid_fields', async () => {
    saveDeparture.mockResolvedValue({ ok: false, code: 'invalid', message: 'invalid_dates' })
    const res = await postDeparture(jsonRequest(validBody), tourContext())
    expect(res.status).toBe(400)
    expect(await bodyOf(res)).toEqual({ error: 'invalid_fields', fields: [{ field: 'returnOn', code: 'return_before_depart' }] })
  })

  it('maps conflict to 500 save_failed', async () => {
    saveDeparture.mockResolvedValue({ ok: false, code: 'conflict', message: 'conflict:stale' })
    const res = await postDeparture(jsonRequest(validBody), tourContext())
    expect(res.status).toBe(500)
    expect(await bodyOf(res)).toEqual({ error: 'save_failed' })
  })

  it('maps error to 500 save_failed', async () => {
    saveDeparture.mockResolvedValue({ ok: false, code: 'error', message: 'boom' })
    const res = await postDeparture(jsonRequest(validBody), tourContext())
    expect(res.status).toBe(500)
    expect(await bodyOf(res)).toEqual({ error: 'save_failed' })
  })

  it('treats invalid JSON as an empty body', async () => {
    const res = await postDeparture(rawRequest('{not json'), tourContext())
    expect(res.status).toBe(400)
    const body = await bodyOf(res)
    expect(body.error).toBe('invalid_fields')
  })

  it('passes through the access denial response', async () => {
    const denied = NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    requireCatalogAdmin.mockResolvedValue({ ok: false, response: denied })
    const res = await postDeparture(jsonRequest(validBody), tourContext())
    expect(res.status).toBe(403)
    expect(saveDeparture).not.toHaveBeenCalled()
  })
})

describe('PATCH departures/[departureId]', () => {
  const validBody = {
    tourId: TOUR_ID,
    expectedUpdatedAt: 'v1',
    patch: { status: 'closed' },
  }

  it('returns 400 when tourId is missing', async () => {
    const res = await patchDeparture(
      jsonRequest({ expectedUpdatedAt: 'v1', patch: { status: 'closed' } }),
      departureContext(),
    )
    expect(res.status).toBe(400)
    expect(await bodyOf(res)).toEqual({ error: 'tour_and_version_required' })
    expect(saveDeparture).not.toHaveBeenCalled()
  })

  it('returns 400 when expectedUpdatedAt is missing', async () => {
    const res = await patchDeparture(
      jsonRequest({ tourId: TOUR_ID, patch: { status: 'closed' } }),
      departureContext(),
    )
    expect(res.status).toBe(400)
    expect(await bodyOf(res)).toEqual({ error: 'tour_and_version_required' })
  })

  it('returns 400 invalid_fields when the patch is invalid', async () => {
    const res = await patchDeparture(
      jsonRequest({ tourId: TOUR_ID, expectedUpdatedAt: 'v1', patch: { status: 'nope' } }),
      departureContext(),
    )
    expect(res.status).toBe(400)
    const body = await bodyOf(res)
    expect(body.error).toBe('invalid_fields')
    expect(Array.isArray(body.fields)).toBe(true)
    expect(saveDeparture).not.toHaveBeenCalled()
  })

  it('returns 200 with the departure on success and passes the actor', async () => {
    saveDeparture.mockResolvedValue({ ok: true, value: { id: DEPARTURE_ID } })
    const res = await patchDeparture(jsonRequest(validBody), departureContext())
    expect(res.status).toBe(200)
    expect(await bodyOf(res)).toEqual({ departure: { id: DEPARTURE_ID } })
    expect(saveDeparture).toHaveBeenCalledWith(
      expect.anything(),
      CLIENT_ID,
      TOUR_ID,
      DEPARTURE_ID,
      'v1',
      { status: 'closed' },
      ACTOR,
    )
  })

  it('tags the actor when via=assistant', async () => {
    saveDeparture.mockResolvedValue({ ok: true, value: { id: DEPARTURE_ID } })
    const res = await patchDeparture(
      jsonRequest(validBody, 'http://localhost/test?via=assistant'),
      departureContext(),
    )
    expect(res.status).toBe(200)
    expect(saveDeparture).toHaveBeenCalledWith(
      expect.anything(),
      CLIENT_ID,
      TOUR_ID,
      DEPARTURE_ID,
      'v1',
      { status: 'closed' },
      ASSISTANT_ACTOR,
    )
  })

  it('maps conflict to 409', async () => {
    saveDeparture.mockResolvedValue({ ok: false, code: 'conflict', message: 'conflict:stale' })
    const res = await patchDeparture(jsonRequest(validBody), departureContext())
    expect(res.status).toBe(409)
    expect(await bodyOf(res)).toEqual({ error: 'conflict' })
  })

  it('maps not_found to 404', async () => {
    saveDeparture.mockResolvedValue({ ok: false, code: 'not_found', message: 'departure_not_found' })
    const res = await patchDeparture(jsonRequest(validBody), departureContext())
    expect(res.status).toBe(404)
    expect(await bodyOf(res)).toEqual({ error: 'not_found' })
  })

  it('maps invalid to 400 invalid_fields', async () => {
    saveDeparture.mockResolvedValue({ ok: false, code: 'invalid', message: 'invalid_dates' })
    const res = await patchDeparture(jsonRequest(validBody), departureContext())
    expect(res.status).toBe(400)
    expect(await bodyOf(res)).toEqual({ error: 'invalid_fields', fields: [{ field: 'returnOn', code: 'return_before_depart' }] })
  })

  it('maps duplicate to 500 save_failed', async () => {
    saveDeparture.mockResolvedValue({ ok: false, code: 'duplicate', message: 'conflict:duplicate_departure' })
    const res = await patchDeparture(jsonRequest(validBody), departureContext())
    expect(res.status).toBe(500)
    expect(await bodyOf(res)).toEqual({ error: 'save_failed' })
  })

  it('maps error to 500 save_failed', async () => {
    saveDeparture.mockResolvedValue({ ok: false, code: 'error', message: 'boom' })
    const res = await patchDeparture(jsonRequest(validBody), departureContext())
    expect(res.status).toBe(500)
    expect(await bodyOf(res)).toEqual({ error: 'save_failed' })
  })

  it('treats invalid JSON as an empty body', async () => {
    const res = await patchDeparture(rawRequest('{not json'), departureContext())
    expect(res.status).toBe(400)
    expect(await bodyOf(res)).toEqual({ error: 'tour_and_version_required' })
  })

  it('passes through the access denial response', async () => {
    const denied = NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    requireCatalogAdmin.mockResolvedValue({ ok: false, response: denied })
    const res = await patchDeparture(jsonRequest(validBody), departureContext())
    expect(res.status).toBe(403)
    expect(await bodyOf(res)).toEqual({ error: 'Forbidden' })
    expect(saveDeparture).not.toHaveBeenCalled()
  })
})

describe('database date rule surfaces as a field error', () => {
  it('PATCH departure: invalid_dates becomes a returnOn field error the form can show', async () => {
    requireCatalogAdmin.mockResolvedValue({ ok: true, actor: 'a@b.c' })
    saveDeparture.mockResolvedValue({ ok: false, code: 'invalid', message: 'invalid_dates' })
    const res = await patchDeparture(
      jsonRequest({ tourId: 'tour-1', expectedUpdatedAt: '2026-10-10T00:00:00Z', patch: { returnOn: '2027-01-01' } }),
      { params: Promise.resolve({ id: 'client-1', departureId: 'dep-1' }) },
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_fields', fields: [{ field: 'returnOn', code: 'return_before_depart' }] })
  })
})
