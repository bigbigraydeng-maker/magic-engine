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
import { REQUIRED_LICENSE_SCOPES, serializeLicenseReviewEvidence } from '@/lib/factory/clip-library'

const CLIENT_ID = 'cts-client'
const CLIP_ID = 'clip-123'
const context = { params: Promise.resolve({ id: CLIENT_ID, clipId: CLIP_ID }) }

function chainQuery(result: Record<string, unknown>) {
  const query = {
    select: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: (resolve?: (value: Record<string, unknown>) => unknown) => Promise.resolve(result).then(resolve),
  }
  query.select.mockImplementation(() => query)
  query.update.mockImplementation(() => query)
  query.eq.mockImplementation(() => query)
  query.is.mockImplementation(() => query)
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
      jsonRequest(`http://localhost/api/clients/${CLIENT_ID}/factory-clips/${CLIP_ID}/license-review`, {
        status: 'verified', note: 'Official licence page states the permitted reuse conditions for this uploaded clip.', permittedScopes: [...REQUIRED_LICENSE_SCOPES],
      }),
      context,
    )

    expect(response.status).toBe(400)
    expect(query.eq).toHaveBeenCalledWith('client_id', CLIENT_ID)
    expect(query.eq).toHaveBeenCalledWith('id', CLIP_ID)
    expect(query.update).not.toHaveBeenCalled()
  })

  it('requires a substantive evidence note and all intended reuse scopes before marking a licence verified', async () => {
    const response = await reviewLicense(
      jsonRequest(`http://localhost/api/clients/${CLIENT_ID}/factory-clips/${CLIP_ID}/license-review`, {
        status: 'verified', note: 'Looks fine', permittedScopes: ['commercial_use'],
      }),
      context,
    )

    expect(response.status).toBe(400)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('records the evidence summary and permitted scopes in the licence audit note', async () => {
    const clipQuery = chainQuery({
      data: { id: CLIP_ID, source_author: 'Source author', source_url: 'https://example.test/source', license_name: 'CC BY 4.0', license_url: 'https://example.test/license', license_status: 'unknown', status: 'pending_review', sha256: null },
      error: null,
    })
    const updateQuery = chainQuery({ data: { id: CLIP_ID }, error: null })
    mocks.from.mockReturnValueOnce(clipQuery).mockReturnValueOnce(updateQuery)
    const note = 'Official licence terms allow commercial online publication and edited adaptations.'

    const response = await reviewLicense(
      jsonRequest(`http://localhost/api/clients/${CLIENT_ID}/factory-clips/${CLIP_ID}/license-review`, {
        status: 'verified', note, permittedScopes: [...REQUIRED_LICENSE_SCOPES],
      }),
      context,
    )

    expect(response.status).toBe(200)
    const saved = updateQuery.update.mock.calls[0]?.[0] as { license_review_note: string }
    expect(saved.license_review_note).toContain(note)
    expect(saved.license_review_note).toContain('commercial_use')
    expect(saved.license_review_note).toContain('online_distribution')
  })

  it('does not verify licence evidence if source metadata changed concurrently', async () => {
    const clipQuery = chainQuery({
      data: {
        id: CLIP_ID,
        source_author: 'Original author',
        source_url: 'https://example.test/original',
        license_name: 'CC BY 4.0',
        license_url: 'https://example.test/original-license',
        license_status: 'unknown',
        status: 'pending_review',
        sha256: null,
      },
      error: null,
    })
    const updateQuery = chainQuery({ data: null, error: null })
    mocks.from.mockReturnValueOnce(clipQuery).mockReturnValueOnce(updateQuery)

    const response = await reviewLicense(
      jsonRequest(`http://localhost/api/clients/${CLIENT_ID}/factory-clips/${CLIP_ID}/license-review`, {
        status: 'verified', note: 'Official licence page states the permitted reuse conditions for this uploaded clip.', permittedScopes: [...REQUIRED_LICENSE_SCOPES],
      }),
      context,
    )

    expect(response.status).toBe(409)
    expect(updateQuery.eq).toHaveBeenCalledWith('source_author', 'Original author')
    expect(updateQuery.eq).toHaveBeenCalledWith('source_url', 'https://example.test/original')
    expect(updateQuery.eq).toHaveBeenCalledWith('license_status', 'unknown')
    expect(updateQuery.eq).toHaveBeenCalledWith('status', 'pending_review')
    expect(updateQuery.is).toHaveBeenCalledWith('sha256', null)
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

  it('does not activate a stale licence snapshot after a concurrent review change', async () => {
    const sha256 = 'a'.repeat(64)
    const clipQuery = chainQuery({
      data: {
        track: 'a_real',
        scene_tag: 'chongqing_street',
        motion_type: 'walking',
        tags: ['chongqing'],
        source_author: 'Source author',
        source_url: 'https://example.test/video',
        license_name: 'CC BY 4.0',
        license_url: 'https://example.test/license',
        duration_seconds: 5,
        media_type: 'video',
        sha256,
        license_status: 'verified',
        license_review_note: serializeLicenseReviewEvidence('Official licence terms allow commercial online publication and edited adaptations.', [...REQUIRED_LICENSE_SCOPES]),
      },
      error: null,
    })
    const clientQuery = chainQuery({ data: { factory_config: {} }, error: null })
    const updateQuery = chainQuery({ data: null, error: null })
    mocks.from
      .mockReturnValueOnce(clipQuery)
      .mockReturnValueOnce(clientQuery)
      .mockReturnValueOnce(updateQuery)

    const response = await reviewClip(
      jsonRequest(`http://localhost/api/clients/${CLIENT_ID}/factory-clips/${CLIP_ID}/review`, { decision: 'approve' }),
      context,
    )

    expect(response.status).toBe(409)
    expect(updateQuery.eq).toHaveBeenCalledWith('status', 'pending_review')
    expect(updateQuery.eq).toHaveBeenCalledWith('license_status', 'verified')
    expect(updateQuery.eq).toHaveBeenCalledWith('sha256', sha256)
  })
})
