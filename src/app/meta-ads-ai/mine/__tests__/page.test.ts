import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  user: null as null | { email: string },
  landing: '',
  rows: [] as unknown[],
  resolve: vi.fn(),
}))
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`) } }))
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient: () => ({ auth: { getUser: async () => ({ data: { user: mocks.user } }) } }) }))
vi.mock('@/lib/auth/resolve-redirect', () => ({ resolveRedirectForSession: async (...a: unknown[]) => { mocks.resolve(...a); return mocks.landing } }))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: () => { const c: Record<string, unknown> = {}; c.select = () => c; c.eq = () => c; c.limit = async () => ({ data: mocks.rows }); return c } },
}))

import AdsCheckEntry from '../page'

async function destination(): Promise<string> {
  try { await AdsCheckEntry(); return 'NO_REDIRECT' } catch (e) { return String((e as Error).message).replace('REDIRECT:', '') }
}
const REGISTER = '/portal/register?next=%2Fmeta-ads-ai%2Fmine'

beforeEach(() => { vi.clearAllMocks(); mocks.user = null; mocks.landing = ''; mocks.rows = [] })

describe('/meta-ads-ai/mine', () => {
  it('not signed in → Chinese sign-up / sign-in page carrying the entry as next', async () => {
    expect(await destination()).toBe(REGISTER)
    expect(mocks.resolve).not.toHaveBeenCalled()
  })

  it('self-serve member → wherever the shared landing sends them (their own check-up page)', async () => {
    mocks.user = { email: 'owner@example.com' }
    mocks.landing = '/meta-ads-ai/c-1'
    expect(await destination()).toBe('/meta-ads-ai/c-1')
    expect(mocks.resolve).toHaveBeenCalledWith(expect.anything(), '/meta-ads-ai/mine')
  })

  it('staff / paying client whose landing comes back unchanged → dashboard, never this same page', async () => {
    mocks.user = { email: 'fde@example.com' }
    mocks.landing = '/meta-ads-ai/mine'
    mocks.rows = [{ client_id: 'c-9' }]
    expect(await destination()).toBe('/dashboard')
  })

  it('signed in with no workspace at all → sign-up (creates the self-serve workspace), never a loop', async () => {
    mocks.user = { email: 'new@example.com' }
    mocks.landing = '/meta-ads-ai/mine'
    expect(await destination()).toBe(REGISTER)
  })
})
