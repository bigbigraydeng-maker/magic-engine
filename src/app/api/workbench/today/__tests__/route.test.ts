/**
 * GET /api/workbench/today — global admins only.
 *
 * The payload is every client's to-do list, so a scoped DEMO_ADMINS account
 * (role 'admin' + allowedClientId) must be refused before any data is loaded.
 * Uses the real require-admin + whitelist modules; only the session is faked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  email: null as string | null,
  loadTodoCounts: vi.fn(),
}))

vi.mock('@/lib/auth/require-session', () => ({
  requireSession: async () =>
    h.email
      ? { ok: true, user: { id: 'u', email: h.email } }
      : { ok: false, status: 401, error: 'Unauthorized' },
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/pm-todo/daily-todo', () => ({
  loadTodoCounts: h.loadTodoCounts,
  nzWeekday: () => 1,
  DAY_THEMES: { 1: { title: 't', hint: 'h' } },
  ZH_DAYS: ['日', '一', '二', '三', '四', '五', '六'],
}))

import { GET } from '../route'

const ENV = ['ADMIN_EMAILS', 'ADMIN_EMAIL_DOMAIN', 'DEMO_ADMINS', 'CLIENT_VIEWERS'] as const
const saved: Record<string, string | undefined> = {}
const CLIENT = 'aaaaaaaa-0000-0000-0000-000000000001'

beforeEach(() => {
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k] }
  process.env.ADMIN_EMAILS = 'fde@magiclab.test'
  process.env.DEMO_ADMINS = `demo@x.test:${CLIENT}`
  process.env.CLIENT_VIEWERS = `viewer@x.test:${CLIENT}`
  h.loadTodoCounts.mockReset()
  h.loadTodoCounts.mockResolvedValue({ manualItems: [], cronFailures24h: 0 })
})
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
})

describe('GET /api/workbench/today', () => {
  it('scoped DEMO_ADMINS account → 403 and never loads the cross-client to-do list', async () => {
    h.email = 'demo@x.test'

    const res = await GET()

    expect(res.status).toBe(403)
    expect(h.loadTodoCounts).not.toHaveBeenCalled()
  })

  it.each([
    ['client viewer', 403, 'viewer@x.test'],
    ['not whitelisted', 403, 'stranger@x.test'],
    ['not signed in', 401, null],
  ])('%s → %i', async (_label, status, email) => {
    h.email = email

    const res = await GET()

    expect(res.status).toBe(status)
    expect(h.loadTodoCounts).not.toHaveBeenCalled()
  })

  it('global admin → 200 with the to-do counts', async () => {
    h.email = 'fde@magiclab.test'

    const res = await GET()

    expect(res.status).toBe(200)
    expect(h.loadTodoCounts).toHaveBeenCalledTimes(1)
    expect((await res.json()).counts).toEqual({ manualItems: [], cronFailures24h: 0 })
  })
})
