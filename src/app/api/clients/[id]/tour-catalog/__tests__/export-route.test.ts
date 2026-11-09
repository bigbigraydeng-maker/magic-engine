import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { blankTour } from '@/lib/tour-catalog/__tests__/content-fixture'
import { adminAccess, editorAccess } from './access-fixtures'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

const { requireCatalogAccess, loadDraftCatalog } = vi.hoisted(() => ({
  requireCatalogAccess: vi.fn(),
  loadDraftCatalog: vi.fn(),
}))
vi.mock('@/lib/tour-catalog/access', () => ({ requireCatalogAccess }))
vi.mock('@/lib/tour-catalog/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tour-catalog/store')>()),
  loadDraftCatalog,
}))

import { GET } from '../export/route'

const CONTEXT = { params: Promise.resolve({ id: 'client-1' }) }
const call = () => GET(new NextRequest('http://localhost/api/clients/client-1/tour-catalog/export'), CONTEXT)

const TOUR = blankTour({ id: 'tour-1', name: 'Golden China', destination: 'china' })
const DEPARTURE = {
  id: 'dep-1',
  tourId: 'tour-1',
  clientId: 'client-1',
  departOn: '2099-05-01',
  returnOn: '2099-05-12',
  priceTextOverride: null,
  status: 'open' as const,
  internal: { airline: 'SECRET-AIR', capacity: 40 },
  updatedAt: '2026-10-01T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  requireCatalogAccess.mockResolvedValue(adminAccess('admin@example.com'))
  loadDraftCatalog.mockResolvedValue({ tours: [TOUR], departures: [DEPARTURE], aliases: [] })
})

describe('GET export', () => {
  it('asks for the view capability and returns a CSV download', async () => {
    const res = await call()
    expect(requireCatalogAccess).toHaveBeenCalledWith('client-1', 'view')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="tours-\d{4}-\d{2}-\d{2}\.csv"$/)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const bytes = new Uint8Array(await res.clone().arrayBuffer())
    const body = await res.text()
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    expect(body).toContain('Golden China')
    expect(body).toContain('2099-05-01')
  })

  it('never writes departure internal facts, also for a client editor', async () => {
    requireCatalogAccess.mockResolvedValue(editorAccess('staff@example.com'))
    const body = await (await call()).text()
    expect(body).not.toContain('SECRET-AIR')
  })

  it('returns the access refusal untouched and loads nothing', async () => {
    const refusal = NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    requireCatalogAccess.mockResolvedValue({ ok: false, response: refusal })
    const res = await call()
    expect(res.status).toBe(403)
    expect(loadDraftCatalog).not.toHaveBeenCalled()
  })

  it('answers 500 without leaking details when the catalog cannot be read', async () => {
    loadDraftCatalog.mockRejectedValue(new Error('db password in message'))
    const res = await call()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('db password')
  })
})
