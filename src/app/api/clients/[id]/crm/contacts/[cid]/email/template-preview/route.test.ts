import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { marker: 'db' } }))
vi.mock('@/lib/crm/email-templates/settings-store', () => ({ loadEmailSettings: vi.fn() }))
vi.mock('@/lib/crm/email-templates/preview-prod', () => ({ createPreviewData: vi.fn(() => ({ marker: 'data' })) }))
vi.mock('@/lib/crm/email-templates/template-preview', () => ({ previewTemplate: vi.fn() }))
vi.mock('@/lib/microsoft/mail-send-new', () => ({ previewCompose: vi.fn() }))
vi.mock('@/lib/microsoft/mail-send-new-prod', () => ({ createMailNewDeps: vi.fn(() => ({ marker: 'deps' })) }))

import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { loadEmailSettings } from '@/lib/crm/email-templates/settings-store'
import { createPreviewData } from '@/lib/crm/email-templates/preview-prod'
import { previewTemplate } from '@/lib/crm/email-templates/template-preview'
import { previewCompose } from '@/lib/microsoft/mail-send-new'
import { createMailNewDeps } from '@/lib/microsoft/mail-send-new-prod'
import { settingsObj } from '@/lib/crm/email-templates/__tests__/fixtures'
import { POST } from './route'

const ctx = { params: { id: 'client-a', cid: 'contact-1' } }
const post = (body: unknown, raw?: string) =>
  POST(new NextRequest('http://x/api', { method: 'POST', body: raw ?? JSON.stringify(body) }), ctx)

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(createPreviewData).mockReturnValue({ marker: 'data' } as never)
  vi.mocked(createMailNewDeps).mockReturnValue({ marker: 'deps' } as never)
  vi.mocked(requirePaidClientAccess).mockResolvedValue({ ok: true, role: 'client', tier: 'paid_client', allowedClientId: null, user: { email: ' Lisa@CTS.example ' } } as never)
  vi.mocked(loadEmailSettings).mockResolvedValue({ kind: 'ok', version: 4, settings: settingsObj() })
})

describe('POST template-preview', () => {
  it('passes access failures through and previews nothing', async () => {
    vi.mocked(requirePaidClientAccess).mockResolvedValue({ ok: false, status: 401, error: 'login' } as never)
    expect((await post({ key: 'post-call' })).status).toBe(401)
    expect(previewTemplate).not.toHaveBeenCalled()
  })

  it('refuses when the sender cannot be identified', async () => {
    vi.mocked(requirePaidClientAccess).mockResolvedValue({ ok: true, role: 'client', tier: 'paid_client', allowedClientId: null, user: { email: null } } as never)
    expect((await post({ key: 'post-call' })).status).toBe(403)
  })

  it('400 for malformed JSON and for a malformed request', async () => {
    expect((await post(null, '{nope')).status).toBe(400)
    expect((await post({ key: 'Bad Key' })).status).toBe(400)
    expect((await post({ key: 'post-call', extra: 1 })).status).toBe(400)
    expect(previewTemplate).not.toHaveBeenCalled()
  })

  it.each([
    ['no settings yet', { kind: 'none' as const }, 'unconfigured'],
    ['invalid settings', { kind: 'invalid' as const, version: 2, errors: ['x'] }, 'invalid'],
    ['the switch off', { kind: 'ok' as const, version: 2, settings: settingsObj({ enabled: false }) }, 'disabled'],
  ])('409 feature_off with %s, previewing nothing', async (_name, settings, featureState) => {
    vi.mocked(loadEmailSettings).mockResolvedValue(settings)
    const res = await post({ key: 'post-call' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ reason: 'feature_off', featureState })
    expect(previewTemplate).not.toHaveBeenCalled()
  })

  it('previews for THIS client and contact with the real settings, and adds who/what it would send from', async () => {
    vi.mocked(previewTemplate).mockResolvedValue({ ok: true, template: { key: 'post-call' } } as never)
    vi.mocked(previewCompose).mockResolvedValue({ canCompose: true, recipient: 'amy@gmail.com', mailbox: 'info@cts.example', sentToContactLast7Days: 1 })
    const res = await post({ key: 'post-call', picks: [{ tourId: 't1', departOn: '2027-03-11' }], callBasis: 'staff_attested' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      template: { key: 'post-call' },
      send: { canCompose: true, recipient: 'amy@gmail.com', mailbox: 'info@cts.example', sentToContactLast7Days: 1 },
    })
    const [args, data] = vi.mocked(previewTemplate).mock.calls[0]
    expect(args).toMatchObject({
      clientId: 'client-a',
      contactId: 'contact-1',
      sentByEmail: 'lisa@cts.example',
      request: { key: 'post-call', picks: [{ tourId: 't1', departOn: '2027-03-11' }], inputs: {}, callBasis: 'staff_attested' },
    })
    expect(args.config).toMatchObject({ source: 'settings', settingsVersion: 4 })
    expect(data).toEqual({ marker: 'data' })
    expect(createPreviewData).toHaveBeenCalledWith('client-a')
    expect(previewCompose).toHaveBeenCalledWith({ clientId: 'client-a', contactId: 'contact-1' }, { marker: 'deps' })
  })

  it('maps a refused preview to its status and reason', async () => {
    vi.mocked(previewTemplate).mockResolvedValue({ ok: false, status: 409, reason: 'template_unavailable', error: 'off' })
    const res = await post({ key: 'post-call' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'off', reason: 'template_unavailable' })
    expect(previewCompose).not.toHaveBeenCalled()
  })

  it('503 when something throws, not a stack trace', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(previewTemplate).mockRejectedValue(new Error('boom'))
    const res = await post({ key: 'post-call' })
    expect(res.status).toBe(503)
    expect(JSON.stringify(await res.json())).not.toContain('boom')
  })
})
