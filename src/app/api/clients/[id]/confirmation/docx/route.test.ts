// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { sampleConfirmation } from '@/lib/confirmation/defaults'

const access = vi.fn()
const feature = vi.fn()
vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: (...a: unknown[]) => access(...a) }))
vi.mock('@/lib/clients/industry-guard', () => ({ clientHasIndustryFeature: (...a: unknown[]) => feature(...a) }))

import { POST } from './route'

const call = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/clients/c1/confirmation/docx', { method: 'POST', body: JSON.stringify(body) }), {
    params: { id: 'c1' },
  })

describe('POST /api/clients/[id]/confirmation/docx', () => {
  beforeEach(() => {
    access.mockReset().mockResolvedValue({ ok: true })
    feature.mockReset().mockResolvedValue(true)
  })

  it('refuses people who are not logged in / not allowed for this client, without generating anything', async () => {
    access.mockResolvedValue({ ok: false, status: 401, error: '请先登录' })
    const res = await call(sampleConfirmation())
    expect(res.status).toBe(401)
    expect(feature).not.toHaveBeenCalled()
  })

  it('refuses clients that are not tourism businesses', async () => {
    feature.mockResolvedValue(false)
    expect((await call(sampleConfirmation())).status).toBe(403)
  })

  it('answers 400 (not 500) for malformed data', async () => {
    expect((await call({ days: [null], tips: [] })).status).toBe(400)
  })

  it('answers 400 with the reason when the form is incomplete', async () => {
    const res = await call({ ...sampleConfirmation(), tourCode: '' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('团号必填')
  })

  it('returns a Word file for a valid document', async () => {
    const res = await call(sampleConfirmation())
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toContain('DEMO123456-confirmation.docx')
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 2).toString()).toBe('PK')
  })
})
