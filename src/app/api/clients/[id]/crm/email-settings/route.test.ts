import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/auth/whitelist', () => ({ isGlobalAdminEmail: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { marker: 'db' } }))
vi.mock('@/lib/crm/email-templates/settings-store', () => ({
  loadEmailSettings: vi.fn(),
  listSettingsHistory: vi.fn(),
  appendEmailSettings: vi.fn(),
}))

import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { isGlobalAdminEmail } from '@/lib/auth/whitelist'
import { serialiseEmailSettings } from '@/lib/crm/email-templates/settings'
import { appendEmailSettings, listSettingsHistory, loadEmailSettings } from '@/lib/crm/email-templates/settings-store'
import { settingsObj } from '@/lib/crm/email-templates/__tests__/fixtures'
import { GET, PUT } from './route'

const ctx = { params: { id: 'client-a' } }
const access = (over: Record<string, unknown> = {}) => ({ ok: true, role: 'admin', tier: 'admin', allowedClientId: null, user: { email: 'Boss@MagicLab.example' }, ...over })
const get = () => GET(new NextRequest('http://x/api'), ctx)
const put = (body: unknown) => PUT(new NextRequest('http://x/api', { method: 'PUT', body: JSON.stringify(body) }), ctx)

const stored = (over = {}) => serialiseEmailSettings(settingsObj({ recipientAllowlist: ['hello@magicengine.cloud'], ...over }))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requirePaidClientAccess).mockResolvedValue(access() as never)
  vi.mocked(isGlobalAdminEmail).mockReturnValue(true)
  vi.mocked(listSettingsHistory).mockResolvedValue([])
})

describe('who may touch the settings', () => {
  it.each([
    ['not a global admin', () => vi.mocked(isGlobalAdminEmail).mockReturnValue(false)],
    ['a scoped admin (allowed for one client only)', () => vi.mocked(requirePaidClientAccess).mockResolvedValue(access({ allowedClientId: 'client-a' }) as never)],
  ])('%s: 403 on read and on write, and nothing is read or written', async (_name, arrange) => {
    arrange()
    expect((await get()).status).toBe(403)
    expect((await put({ settings: stored(), baseVersion: 1 })).status).toBe(403)
    expect(loadEmailSettings).not.toHaveBeenCalled()
    expect(appendEmailSettings).not.toHaveBeenCalled()
  })

  it('an access failure is passed through', async () => {
    vi.mocked(requirePaidClientAccess).mockResolvedValue({ ok: false, status: 401, error: 'login' } as never)
    expect((await get()).status).toBe(401)
    expect((await put({})).status).toBe(401)
  })

  it('the global-admin test is made on the signed-in email', async () => {
    await get()
    expect(isGlobalAdminEmail).toHaveBeenCalledWith('Boss@MagicLab.example')
  })
})

describe('GET email-settings', () => {
  it('no settings yet', async () => {
    vi.mocked(loadEmailSettings).mockResolvedValue({ kind: 'none' })
    expect(await (await get()).json()).toEqual({ state: 'none', version: null, settings: null, errors: [], history: [] })
  })

  it('settings that do not parse are reported with their errors, not defaulted', async () => {
    vi.mocked(loadEmailSettings).mockResolvedValue({ kind: 'invalid', version: 4, errors: ['bad cap'] })
    expect(await (await get()).json()).toMatchObject({ state: 'invalid', version: 4, settings: null, errors: ['bad cap'] })
  })

  it('valid settings come back in the stored shape the PUT accepts', async () => {
    vi.mocked(loadEmailSettings).mockResolvedValue({ kind: 'ok', version: 2, settings: settingsObj() })
    const body = (await (await get()).json()) as { state: string; version: number; settings: unknown }
    expect(body).toMatchObject({ state: 'ok', version: 2 })
    expect(body.settings).toEqual(serialiseEmailSettings(settingsObj()))
  })

  it('503 when the read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(loadEmailSettings).mockRejectedValue(new Error('boom'))
    expect((await get()).status).toBe(503)
  })
})

describe('PUT email-settings', () => {
  it('400 with the problems when the settings do not parse (strict: nothing is defaulted)', async () => {
    const res = await put({ settings: { ...stored(), frequency_cap: { max: 0, window_days: 7 } }, baseVersion: 1 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { errors: string[] }).errors.length).toBeGreaterThan(0)
    expect(appendEmailSettings).not.toHaveBeenCalled()
  })

  it('refuses to open the feature to everybody without an explicit confirmation', async () => {
    const open = stored({ recipientAllowlist: null })
    const refused = await put({ settings: open, baseVersion: 1 })
    expect(refused.status).toBe(400)
    expect(((await refused.json()) as { reason: string }).reason).toBe('unrestricted_needs_confirmation')
    expect(appendEmailSettings).not.toHaveBeenCalled()

    vi.mocked(appendEmailSettings).mockResolvedValue({ ok: true, value: { version: 2 } })
    expect((await put({ settings: open, baseVersion: 1, confirmUnrestricted: true })).status).toBe(200)
  })

  it('a switched-off feature with an empty list needs no confirmation', async () => {
    vi.mocked(appendEmailSettings).mockResolvedValue({ ok: true, value: { version: 2 } })
    expect((await put({ settings: stored({ enabled: false, recipientAllowlist: null }), baseVersion: 1 })).status).toBe(200)
  })

  it('saves a new version for THIS client as the signed-in admin', async () => {
    vi.mocked(appendEmailSettings).mockResolvedValue({ ok: true, value: { version: 2 } })
    const res = await put({ settings: stored(), baseVersion: 1, changeNote: 'trial list only' })
    expect(await res.json()).toEqual({ ok: true, version: 2 })
    expect(appendEmailSettings).toHaveBeenCalledWith(
      { marker: 'db' },
      expect.objectContaining({ clientId: 'client-a', baseVersion: 1, changeNote: 'trial list only', createdBy: 'boss@magiclab.example' }),
    )
  })

  it('the first settings are saved with baseVersion null', async () => {
    vi.mocked(appendEmailSettings).mockResolvedValue({ ok: true, value: { version: 1 } })
    await put({ settings: stored(), baseVersion: null })
    expect(appendEmailSettings).toHaveBeenCalledWith({ marker: 'db' }, expect.objectContaining({ baseVersion: null }))
  })

  it('someone else changed them first: 409', async () => {
    vi.mocked(appendEmailSettings).mockResolvedValue({ ok: false, reason: 'conflict', message: 'stale' })
    expect((await put({ settings: stored(), baseVersion: 1 })).status).toBe(409)
  })
})
