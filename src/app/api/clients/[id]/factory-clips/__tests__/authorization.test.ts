import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: mocks.access,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: mocks.from,
    storage: { from: vi.fn() },
  },
}))

import { GET } from '../route'
import { PATCH } from '../[clipId]/route'
import { POST as reviewClip } from '../[clipId]/review/route'
import { POST as reviewLicense } from '../[clipId]/license-review/route'

const CLIENT_ID = 'cts-client'
const CLIP_ID = 'clip-123'
const context = { params: Promise.resolve({ id: CLIENT_ID, clipId: CLIP_ID }) }

function chainQuery(result: Record<string, unknown>) {
  const query = {
    select: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: (resolve?: (value: Record<string, unknown>) => unknown) => Promise.resolve(result).then(resolve),
  }
  query.select.mockImplementation(() => query)
  query.update.mockImplementation(() => query)
  query.eq.mockImplementation(() => query)
  query.order.mockImplementation(() => query)
  query.range.mockImplementation(() => query)
  return query
}

function jsonRequest(url: string, body: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.access.mockResolvedValue({ ok: true, tier: 'admin', user: { id: 'admin-1', email: 'admin@example.test' } })
})

describe('factory clip catalog authorization and client scope', () => {
  it('rejects a client-tier user before reading the catalogue', async () => {
    mocks.access.mockResolvedValue({ ok: true, tier: 'paid_client', user: { id: 'client-user' } })

    const response = await GET(new NextRequest(`http://localhost/api/clients/${CLIENT_ID}/factory-clips`), context)

    expect(response.status).toBe(403)
    expect(mocks.access).toHaveBeenCalledWith(CLIENT_ID)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('scopes catalogue reads to the authorized client and requested status', async () => {
    const query = chainQuery({ data: [], error: null, count: 0 })
    mocks.from.mockReturnValue(query)

    const response = await GET(
      new NextRequest(`http://localhost/api/clients/${CLIENT_ID}/factory-clips?status=pending_review`),
      context,
    )

    expect(response.status).toBe(200)
    expect(mocks.access).toHaveBeenCalledWith(CLIENT_ID)
    expect(query.eq).toHaveBeenCalledWith('client_id', CLIENT_ID)
    expect(query.eq).toHaveBeenCalledWith('status', 'pending_review')
  })

  it('scopes metadata edits to both the route client and clip', async () => {
    const query = chainQuery({ data: { id: CLIP_ID, status: 'pending_review' }, error: null })
    mocks.from.mockReturnValue(query)

    const response = await PATCH(
      jsonRequest(`http://localhost/api/clients/${CLIENT_ID}/factory-clips/${CLIP_ID}`, {
        title: 'Liziba train',
        sceneTag: 'train_entering_building',
        tags: ['chongqing', 'train'],
        motionType: 'approach',
        sourceAuthor: null,
        sourceUrl: null,
        licenseName: null,
        licenseUrl: null,
      }),
      context,
    )

    expect(response.status).toBe(200)
    expect(mocks.access).toHaveBeenCalledWith(CLIENT_ID)
    expect(query.eq).toHaveBeenCalledWith('client_id', CLIENT_ID)
    expect(query.eq).toHaveBeenCalledWith('id', CLIP_ID)
  })

  it('will not mark incomplete source evidence as verified', async () => {
    const query = chainQuery({
      data: { id: CLIP_ID, source_author: 'Source author', source_url: null, license_name: 'CC BY', license_url: 'https://example.test/license' },
      error: null,
    })
    mocks.from.mockReturnValue(query)

    const response = await reviewLicense(
      jsonRequest(`http://localhost/api/clients/${CLIENT_ID}/factory-clips/${CLIP_ID}/license-review`, { status: 'verified' }),
      context,
    )

    expect(response.status).toBe(400)
    expect(query.eq).toHaveBeenCalledWith('client_id', CLIENT_ID)
    expect(query.eq).toHaveBeenCalledWith('id', CLIP_ID)
    expect(query.update).not.toHaveBeenCalled()
  })

  it('blocks activation review for non-admin users before touching the clip', async () => {
    mocks.access.mockResolvedValue({ ok: true, tier: 'paid_client', user: { id: 'client-user' } })

    const response = await reviewClip(
      jsonRequest(`http://localhost/api/clients/${CLIENT_ID}/factory-clips/${CLIP_ID}/review`, { decision: 'approve' }),
      context,
    )

    expect(response.status).toBe(403)
    expect(mocks.access).toHaveBeenCalledWith(CLIENT_ID)
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
