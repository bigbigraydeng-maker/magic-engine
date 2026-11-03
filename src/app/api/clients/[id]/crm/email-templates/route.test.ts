import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn(),
  requireOperatorAccess: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { marker: 'db' } }))
vi.mock('@/lib/crm/email-templates/settings-store', () => ({ loadEmailSettings: vi.fn() }))
vi.mock('@/lib/crm/email-templates/template-store', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/crm/email-templates/template-store')>()
  return { ...original, listCurrentTemplates: vi.fn(), appendTemplateVersion: vi.fn() }
})
vi.mock('@/lib/crm/email-templates/receipt-store', () => ({ summariseReceiptsSince: vi.fn() }))
vi.mock('@/lib/crm/email-templates/settings-input', () => ({ canEditSettings: vi.fn(() => false) }))

import { requireOperatorAccess, requirePaidClientAccess } from '@/lib/auth/client-access'
import { loadEmailSettings } from '@/lib/crm/email-templates/settings-store'
import { appendTemplateVersion, listCurrentTemplates } from '@/lib/crm/email-templates/template-store'
import { summariseReceiptsSince } from '@/lib/crm/email-templates/receipt-store'
import { canEditSettings } from '@/lib/crm/email-templates/settings-input'
import { settingsObj } from '@/lib/crm/email-templates/__tests__/fixtures'
import { GET, POST } from './route'

const ctx = { params: { id: 'client-a' } }
const access = (over: Record<string, unknown> = {}) => ({
  ok: true,
  role: 'admin',
  tier: 'admin',
  allowedClientId: null,
  user: { email: ' Ops@MagicLab.example ' },
  ...over,
})
const get = () => GET(new NextRequest('http://x/api'), ctx)
const post = (body: unknown, raw?: string) =>
  POST(new NextRequest('http://x/api', { method: 'POST', body: raw ?? JSON.stringify(body) }), ctx)

const goodBody = {
  templateKey: 'post-call-single-tour',
  name: 'Post-call single tour',
  subject: '{{tour_name}}: your itinerary',
  body: 'Kia ora {{first_name}}, {{tour_name}} departs {{departure_date}}. {{tour_url}} {{sender_name}}',
  factSource: 'published_tours',
  pickMode: 'one',
  pickFilter: {},
  status: 'active',
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requirePaidClientAccess).mockResolvedValue(access() as never)
  vi.mocked(requireOperatorAccess).mockResolvedValue(access() as never)
  vi.mocked(canEditSettings).mockReturnValue(false)
  vi.mocked(loadEmailSettings).mockResolvedValue({ kind: 'ok', version: 1, settings: settingsObj() })
})

describe('GET email-templates', () => {
  it('lists the templates with the feature state and what the viewer may edit', async () => {
    vi.mocked(listCurrentTemplates).mockResolvedValue([])
    vi.mocked(summariseReceiptsSince).mockResolvedValue([])
    vi.mocked(canEditSettings).mockReturnValue(true)
    const res = await get()
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown> & { variables: { common: string[]; bySource: Record<string, string[]> } }
    expect(body).toMatchObject({ featureState: 'ready', canEditTemplates: true, canEditSettings: true, templates: [], stats: [] })
    // the placeholders come from the providers, so the editor never hard-codes a vocabulary
    expect(body.variables.common).toEqual(['first_name', 'sender_name', 'call_when'])
    expect(body.variables.bySource.none).toEqual([])
    expect(body.variables.bySource.published_tours).toContain('tour_name')
    expect(listCurrentTemplates).toHaveBeenCalledWith({ marker: 'db' }, 'client-a')
  })

  it('an ordinary staff member can read but is not offered editing', async () => {
    vi.mocked(requirePaidClientAccess).mockResolvedValue(access({ role: 'client', tier: 'paid_client' }) as never)
    vi.mocked(listCurrentTemplates).mockResolvedValue([])
    vi.mocked(summariseReceiptsSince).mockResolvedValue([])
    const body = (await (await get()).json()) as { canEditTemplates: boolean; canEditSettings: boolean }
    expect(body.canEditTemplates).toBe(false)
    expect(body.canEditSettings).toBe(false)
  })

  it('still lists when the settings cannot be read, and says so', async () => {
    vi.mocked(loadEmailSettings).mockRejectedValue(new Error('boom'))
    vi.mocked(listCurrentTemplates).mockResolvedValue([])
    vi.mocked(summariseReceiptsSince).mockResolvedValue([])
    expect(((await (await get()).json()) as { featureState: string }).featureState).toBe('unreadable')
  })

  it('passes an access failure through, reading nothing', async () => {
    vi.mocked(requirePaidClientAccess).mockResolvedValue({ ok: false, status: 401, error: 'login' } as never)
    expect((await get()).status).toBe(401)
    expect(listCurrentTemplates).not.toHaveBeenCalled()
  })

  it('503 with a plain message when the tables cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(listCurrentTemplates).mockRejectedValue(new Error('relation does not exist'))
    vi.mocked(summariseReceiptsSince).mockResolvedValue([])
    const res = await get()
    expect(res.status).toBe(503)
    expect(((await res.json()) as { error: string }).error).toContain('暂时读不到')
  })
})

describe('POST email-templates', () => {
  it('needs operator access, and writes nothing without it', async () => {
    vi.mocked(requireOperatorAccess).mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' } as never)
    expect((await post(goodBody)).status).toBe(403)
    expect(appendTemplateVersion).not.toHaveBeenCalled()
  })

  it('refuses when the actor cannot be identified', async () => {
    vi.mocked(requireOperatorAccess).mockResolvedValue(access({ user: { email: null } }) as never)
    expect((await post(goodBody)).status).toBe(403)
    expect(appendTemplateVersion).not.toHaveBeenCalled()
  })

  it('400 on malformed JSON or a malformed template', async () => {
    expect((await post(null, '{nope')).status).toBe(400)
    expect((await post({ ...goodBody, factSource: 'crystal_ball' })).status).toBe(400)
    expect(appendTemplateVersion).not.toHaveBeenCalled()
  })

  it('400 with every problem listed when the text breaks a rule, and nothing is saved', async () => {
    const res = await post({ ...goodBody, body: `${goodBody.body} Our tours are visa-free.` })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; errors: string[] }
    expect(body.errors.join('|')).toContain('no-visa-free')
    expect(appendTemplateVersion).not.toHaveBeenCalled()
  })

  it('creates version 1 for THIS client, as the signed-in person, and returns notices', async () => {
    const saved = { templateKey: 'post-call-single-tour', version: 1 }
    vi.mocked(appendTemplateVersion).mockResolvedValue({ ok: true, value: saved as never })
    const res = await post({ ...goodBody, clientId: 'someone-else' })
    expect(res.status).toBe(400) // a client id in the body is an unknown field
    const ok = await post(goodBody)
    expect(ok.status).toBe(201)
    expect(await ok.json()).toEqual({ template: saved, notices: [] })
    expect(appendTemplateVersion).toHaveBeenCalledWith(
      { marker: 'db' },
      expect.objectContaining({ clientId: 'client-a', templateKey: 'post-call-single-tour', baseVersion: null, createdBy: 'ops@magiclab.example', status: 'active' }),
    )
  })

  it('works before any settings exist, with a notice that the red lines were not checked', async () => {
    vi.mocked(loadEmailSettings).mockResolvedValue({ kind: 'none' })
    vi.mocked(appendTemplateVersion).mockResolvedValue({ ok: true, value: {} as never })
    const res = await post(goodBody)
    expect(res.status).toBe(201)
    expect(((await res.json()) as { notices: string[] }).notices.join('|')).toContain('没有检查')
  })

  it.each([
    ['conflict', 409],
    ['invalid', 400],
    ['error', 503],
  ] as const)('a store %s becomes HTTP %i', async (reason, status) => {
    vi.mocked(appendTemplateVersion).mockResolvedValue({ ok: false, reason, message: 'm' })
    expect((await post(goodBody)).status).toBe(status)
  })
})
