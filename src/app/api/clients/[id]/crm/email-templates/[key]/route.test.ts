import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn(), requireOperatorAccess: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { marker: 'db' } }))
vi.mock('@/lib/crm/email-templates/settings-store', () => ({ loadEmailSettings: vi.fn() }))
vi.mock('@/lib/crm/email-templates/template-store', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/crm/email-templates/template-store')>()
  return { ...original, getCurrentTemplate: vi.fn(), listTemplateHistory: vi.fn(), appendTemplateVersion: vi.fn() }
})

import { requireOperatorAccess, requirePaidClientAccess } from '@/lib/auth/client-access'
import { loadEmailSettings } from '@/lib/crm/email-templates/settings-store'
import { appendTemplateVersion, getCurrentTemplate, listTemplateHistory } from '@/lib/crm/email-templates/template-store'
import { settingsObj } from '@/lib/crm/email-templates/__tests__/fixtures'
import { GET, PUT } from './route'

const ctx = (key = 'post-call-single-tour') => ({ params: { id: 'client-a', key } })
const access = (over: Record<string, unknown> = {}) => ({ ok: true, role: 'admin', tier: 'admin', allowedClientId: null, user: { email: 'Ops@MagicLab.example' }, ...over })
const put = (body: unknown, key?: string) => PUT(new NextRequest('http://x/api', { method: 'PUT', body: JSON.stringify(body) }), ctx(key))

const goodBody = {
  baseVersion: 3,
  name: 'Post-call single tour',
  subject: '{{tour_name}}: your itinerary',
  body: 'Kia ora {{first_name}}, {{tour_name}} departs {{departure_date}}. {{tour_url}} {{sender_name}}',
  factSource: 'published_tours',
  pickMode: 'one',
  pickFilter: {},
  status: 'disabled',
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requirePaidClientAccess).mockResolvedValue(access() as never)
  vi.mocked(requireOperatorAccess).mockResolvedValue(access() as never)
  vi.mocked(loadEmailSettings).mockResolvedValue({ kind: 'ok', version: 1, settings: settingsObj() })
})

describe('GET email-templates/[key]', () => {
  it('returns the current version and the whole history', async () => {
    vi.mocked(getCurrentTemplate).mockResolvedValue({ version: 3 } as never)
    vi.mocked(listTemplateHistory).mockResolvedValue([{ version: 3 }, { version: 2 }] as never)
    const res = await GET(new NextRequest('http://x/api'), ctx())
    expect(await res.json()).toEqual({ template: { version: 3 }, history: [{ version: 3 }, { version: 2 }] })
    expect(getCurrentTemplate).toHaveBeenCalledWith({ marker: 'db' }, 'client-a', 'post-call-single-tour')
  })

  it('404 for a malformed key (no query is made) and for an unknown template', async () => {
    expect((await GET(new NextRequest('http://x/api'), ctx('Bad Key!'))).status).toBe(404)
    expect(getCurrentTemplate).not.toHaveBeenCalled()
    vi.mocked(getCurrentTemplate).mockResolvedValue(null)
    expect((await GET(new NextRequest('http://x/api'), ctx())).status).toBe(404)
  })

  it('503 when the store cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(getCurrentTemplate).mockRejectedValue(new Error('boom'))
    expect((await GET(new NextRequest('http://x/api'), ctx())).status).toBe(503)
  })
})

describe('PUT email-templates/[key]', () => {
  it('needs operator access', async () => {
    vi.mocked(requireOperatorAccess).mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' } as never)
    expect((await put(goodBody)).status).toBe(403)
    expect(appendTemplateVersion).not.toHaveBeenCalled()
  })

  it('404 for a malformed key; 400 without the version being edited', async () => {
    expect((await put(goodBody, 'Bad Key!')).status).toBe(404)
    const { baseVersion: _base, ...noBase } = goodBody
    expect((await put(noBase)).status).toBe(400)
    expect(appendTemplateVersion).not.toHaveBeenCalled()
  })

  it('a key in the body is refused: the key comes from the address only', async () => {
    expect((await put({ ...goodBody, templateKey: 'other-template' })).status).toBe(400)
  })

  it('appends a new version on top of the version that was edited (disable / enable are versions too)', async () => {
    vi.mocked(appendTemplateVersion).mockResolvedValue({ ok: true, value: { version: 4 } as never })
    const res = await put(goodBody)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ template: { version: 4 }, notices: [] })
    expect(appendTemplateVersion).toHaveBeenCalledWith(
      { marker: 'db' },
      expect.objectContaining({ clientId: 'client-a', templateKey: 'post-call-single-tour', baseVersion: 3, createdBy: 'ops@magiclab.example', status: 'disabled' }),
    )
  })

  it('saves under the key in the ADDRESS, whatever else is going on', async () => {
    vi.mocked(appendTemplateVersion).mockResolvedValue({ ok: true, value: { version: 2 } as never })
    await put(goodBody, 'spring-2027-follow-up')
    expect(appendTemplateVersion).toHaveBeenCalledWith({ marker: 'db' }, expect.objectContaining({ templateKey: 'spring-2027-follow-up' }))
  })

  it('someone else saved first: 409, nothing overwritten', async () => {
    vi.mocked(appendTemplateVersion).mockResolvedValue({ ok: false, reason: 'conflict', message: 'stale' })
    expect((await put(goodBody)).status).toBe(409)
  })

  it('red-line text is refused before it reaches the store', async () => {
    const res = await put({ ...goodBody, subject: 'Last chance! {{tour_name}} (TBC)' })
    expect(res.status).toBe(400)
    expect(appendTemplateVersion).not.toHaveBeenCalled()
  })
})
