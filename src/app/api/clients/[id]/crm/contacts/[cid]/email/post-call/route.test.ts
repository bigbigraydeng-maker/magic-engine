import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { marker: 'db' } }))
vi.mock('@/lib/crm/email-templates/settings-store', () => ({ loadEmailSettings: vi.fn() }))
vi.mock('@/lib/crm/email-templates/template-store', () => ({ listCurrentTemplates: vi.fn() }))
vi.mock('@/lib/crm/email-templates/preview-prod', () => ({ createPreviewData: vi.fn(() => ({ marker: 'data' })) }))
vi.mock('@/lib/crm/email-templates/post-call-state', () => ({ loadPostCallState: vi.fn() }))
vi.mock('@/lib/crm/email-templates/settings-input', () => ({ canEditSettings: vi.fn(() => false) }))

import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { loadEmailSettings } from '@/lib/crm/email-templates/settings-store'
import { listCurrentTemplates } from '@/lib/crm/email-templates/template-store'
import { loadPostCallState } from '@/lib/crm/email-templates/post-call-state'
import { createPreviewData } from '@/lib/crm/email-templates/preview-prod'
import { canEditSettings } from '@/lib/crm/email-templates/settings-input'
import { settingsObj } from '@/lib/crm/email-templates/__tests__/fixtures'
import { GET } from './route'

const ctx = { params: { id: 'client-a', cid: 'contact-1' } }
const get = () => GET(new NextRequest('http://x/api'), ctx)
const state = { featureState: 'ready', templates: [], callEvidenceAt: null, emailedSinceCall: false }

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requirePaidClientAccess).mockResolvedValue({ ok: true, role: 'client', tier: 'paid_client', allowedClientId: null, user: { email: 'a@b.c' } } as never)
  vi.mocked(canEditSettings).mockReturnValue(false)
  vi.mocked(loadEmailSettings).mockResolvedValue({ kind: 'ok', version: 2, settings: settingsObj({ callPromptHours: 12 }) })
  vi.mocked(listCurrentTemplates).mockResolvedValue([])
  vi.mocked(loadPostCallState).mockResolvedValue({ ok: true, state: state as never })
})

describe('GET post-call', () => {
  it('asks for the state of THIS client and contact with the configured call window', async () => {
    const res = await get()
    expect(await res.json()).toEqual({ ...state, canEditSettings: false })
    expect(vi.mocked(loadPostCallState).mock.calls[0][0]).toMatchObject({
      clientId: 'client-a',
      contactId: 'contact-1',
      featureState: 'ready',
      callPromptHours: 12,
    })
    expect(createPreviewData).toHaveBeenCalledWith('client-a')
  })

  it('reads the templates only when the feature is ready', async () => {
    vi.mocked(loadEmailSettings).mockResolvedValue({ kind: 'none' })
    await get()
    expect(listCurrentTemplates).not.toHaveBeenCalled()
    expect(vi.mocked(loadPostCallState).mock.calls[0][0]).toMatchObject({ featureState: 'unconfigured', callPromptHours: 24 })
  })

  it('unreadable settings are reported as such, not as "ready"', async () => {
    vi.mocked(loadEmailSettings).mockRejectedValue(new Error('boom'))
    await get()
    expect(vi.mocked(loadPostCallState).mock.calls[0][0]).toMatchObject({ featureState: 'unreadable' })
  })

  it('tells the global admin they may open the settings', async () => {
    vi.mocked(canEditSettings).mockReturnValue(true)
    expect(((await (await get()).json()) as { canEditSettings: boolean }).canEditSettings).toBe(true)
  })

  it('passes access failures and missing contacts through', async () => {
    vi.mocked(requirePaidClientAccess).mockResolvedValue({ ok: false, status: 401, error: 'login' } as never)
    expect((await get()).status).toBe(401)
    vi.mocked(requirePaidClientAccess).mockResolvedValue({ ok: true, role: 'client', tier: 'paid_client', allowedClientId: null, user: { email: 'a@b.c' } } as never)
    vi.mocked(loadPostCallState).mockResolvedValue({ ok: false, status: 404, error: 'no' })
    expect((await get()).status).toBe(404)
  })

  it('503 when something throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(loadPostCallState).mockRejectedValue(new Error('boom'))
    expect((await get()).status).toBe(503)
  })
})
