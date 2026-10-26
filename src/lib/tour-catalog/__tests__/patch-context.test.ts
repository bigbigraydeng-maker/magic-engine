import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { blankTour } from './content-fixture'

const { loadDraftCatalog, getClientDomain, getSettings } = vi.hoisted(() => ({
  loadDraftCatalog: vi.fn(),
  getClientDomain: vi.fn(),
  getSettings: vi.fn(),
}))
vi.mock('../store', () => ({ loadDraftCatalog, getClientDomain }))
vi.mock('../store-access', () => ({ getSettings }))

import { loadTourPatchContext } from '../patch-context'

const db = {} as SupabaseClient
const A = blankTour({ id: 'a', heroImage: '/images/a.jpg', gallery: ['/images/a.jpg', 'https://img.example-cdn.com/b.jpg'] })
const B = blankTour({ id: 'b', itinerary: [{ day: 1, title: 'T', description: '', operatorLogo: { src: '/images/logo.png', alt: 'L' } }] })

beforeEach(() => {
  vi.clearAllMocks()
  loadDraftCatalog.mockResolvedValue({ tours: [A, B], departures: [], aliases: [] })
  getClientDomain.mockResolvedValue('example.co.nz')
  getSettings.mockResolvedValue({ logoUrl: null, brandPrimary: null, brandSecondary: null, channelsConnected: false, imageHosts: ['img.example-cdn.com'] })
})

describe('loadTourPatchContext', () => {
  it('returns the tour, the whole client’s image pool, the allow-list and the domain', async () => {
    const ctx = await loadTourPatchContext(db, 'client-1', 'b', false)
    expect(ctx).not.toBeNull()
    if (ctx === null) return
    expect(ctx.canEditSite).toBe(false)
    expect(ctx.existingTour).toBe(B)
    // Images of OTHER tours of the same client count as "already in the catalog".
    expect([...ctx.imagePool].sort()).toEqual(['/images/a.jpg', '/images/logo.png', 'https://img.example-cdn.com/b.jpg'])
    expect(ctx.imageHosts).toEqual(['img.example-cdn.com'])
    expect(ctx.clientDomain).toBe('example.co.nz')
    expect(loadDraftCatalog).toHaveBeenCalledWith(db, 'client-1')
    expect(getSettings).toHaveBeenCalledWith(db, 'client-1')
    expect(getClientDomain).toHaveBeenCalledWith(db, 'client-1')
  })

  it('passes the tier through unchanged', async () => {
    expect((await loadTourPatchContext(db, 'client-1', 'a', true))?.canEditSite).toBe(true)
  })

  it('returns null for a tour that is not in this client’s catalog, without reading settings', async () => {
    expect(await loadTourPatchContext(db, 'client-1', 'someone-elses-tour', true)).toBeNull()
    expect(getSettings).not.toHaveBeenCalled()
  })

  it('lets a load failure through to the caller (the route answers 500)', async () => {
    getSettings.mockRejectedValue(new Error('db down'))
    await expect(loadTourPatchContext(db, 'client-1', 'a', true)).rejects.toThrow('db down')
  })
})
