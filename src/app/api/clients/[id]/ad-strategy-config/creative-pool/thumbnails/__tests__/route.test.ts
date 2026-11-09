import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/ads-strategy/config', () => ({ loadAdStrategyConfig: vi.fn() }))
vi.mock('@/lib/ads-strategy/creative-pool-thumbnails', () => ({ loadCreativeThumbnails: vi.fn() }))

import { GET } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { loadAdStrategyConfig } from '@/lib/ads-strategy/config'
import { loadCreativeThumbnails } from '@/lib/ads-strategy/creative-pool-thumbnails'

const mockAccess = vi.mocked(requirePaidClientAccess)
const mockConfig = vi.mocked(loadAdStrategyConfig)
const mockThumbs = vi.mocked(loadCreativeThumbnails)

const req = () => new NextRequest('http://localhost:3001/api/clients/c1/ad-strategy-config/creative-pool/thumbnails')

beforeEach(() => {
  vi.resetAllMocks()
})

describe('GET creative-pool/thumbnails', () => {
  it('blocks callers who fail the paid-client access check, without touching Meta', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: 'forbidden' } as never)
    const res = await GET(req(), { params: { id: 'c1' } })
    expect(res.status).toBe(403)
    expect(mockThumbs).not.toHaveBeenCalled()
  })

  it('passes the pool entries (ref + aliases) to the loader and returns its result', async () => {
    mockAccess.mockResolvedValue({ ok: true } as never)
    const pool = [{ kind: 'meta_video', ref: '111', status: 'candidate', alias_refs: ['222'] }]
    mockConfig.mockResolvedValue({ creative_pool: pool } as never)
    const thumbs = { '111': { thumbnailUrl: 'https://cdn/x.jpg', title: null, durationSeconds: 15 } }
    mockThumbs.mockResolvedValue(thumbs)
    const res = await GET(req(), { params: { id: 'c1' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, thumbnails: thumbs })
    expect(mockThumbs).toHaveBeenCalledWith('c1', pool)
  })
})
