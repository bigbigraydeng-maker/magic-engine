// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { buildConfirmationDocx } from '@/lib/confirmation/docx'
import { sampleConfirmation } from '@/lib/confirmation/defaults'

const access = vi.fn()
const feature = vi.fn()
const model = vi.fn()
vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: (...a: unknown[]) => access(...a) }))
vi.mock('@/lib/clients/industry-guard', () => ({ clientHasIndustryFeature: (...a: unknown[]) => feature(...a) }))
vi.mock('@/lib/confirmation/extract', async (orig) => ({ ...(await orig<typeof import('@/lib/confirmation/extract')>()), callExtractModel: (...a: unknown[]) => model(...a) }))

import { POST } from './route'

const upload = (file?: File) => {
  const form = new FormData()
  if (file) form.append('file', file)
  return POST(new NextRequest('http://localhost/api/clients/c1/confirmation/extract', { method: 'POST', body: form }), { params: { id: 'c1' } })
}

describe('POST /api/clients/[id]/confirmation/extract', () => {
  beforeEach(() => {
    access.mockReset().mockResolvedValue({ ok: true })
    feature.mockReset().mockResolvedValue(true)
    model.mockReset().mockResolvedValue({ tourCode: 'DEMO123456', days: [{ date: '29 Jul', route: 'Arrive', highlights: 'x', overnight: 'Beijing' }] })
  })

  it('refuses people without access and non-tourism clients before reading the file or calling the AI', async () => {
    access.mockResolvedValue({ ok: false, status: 401, error: '请先登录' })
    expect((await upload(new File(['x'], 'a.txt', { type: 'text/plain' }))).status).toBe(401)
    access.mockResolvedValue({ ok: true })
    feature.mockResolvedValue(false)
    expect((await upload(new File(['x'], 'a.txt', { type: 'text/plain' }))).status).toBe(403)
    expect(model).not.toHaveBeenCalled()
  })

  it('rejects missing, empty, oversized and unsupported files', async () => {
    expect((await upload()).status).toBe(400)
    expect((await upload(new File([], 'a.txt', { type: 'text/plain' }))).status).toBe(400)
    expect((await upload(new File([new Uint8Array(9 * 1024 * 1024)], 'a.txt', { type: 'text/plain' }))).status).toBe(413)
    const old = await upload(new File(['x'], 'old.doc'))
    expect(old.status).toBe(400)
    expect((await old.json()).error).toContain('.docx')
    expect(model).not.toHaveBeenCalled()
  })

  it('reads a real Word file end to end: the generated confirmation goes in, its text reaches the AI, form data comes out', async () => {
    const docx = await buildConfirmationDocx(sampleConfirmation())
    const res = await upload(new File([new Uint8Array(docx)], 'CTS.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))
    expect(res.status).toBe(200)
    expect(model.mock.calls[0][0].kind).toBe('text')
    expect(model.mock.calls[0][0].text).toContain('DEMO123456')
    const body = await res.json()
    expect(body.data.tourCode).toBe('DEMO123456')
    expect(body.data.tips.length).toBeGreaterThan(5)
  })

  it('sends a PDF to the AI as a document, and turns AI/network failure into a plain message (no stack, no 500 page)', async () => {
    await upload(new File(['%PDF-1.4'], 'x.pdf', { type: 'application/pdf' }))
    expect(model.mock.calls[0][0].kind).toBe('pdf')
    model.mockRejectedValue(new Error('socket hang up with secret details'))
    const res = await upload(new File(['hello'], 'a.txt', { type: 'text/plain' }))
    expect(res.status).toBe(502)
    expect((await res.json()).error).not.toContain('secret')
  })
})
