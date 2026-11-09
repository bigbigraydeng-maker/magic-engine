import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  admin: { ok: true, user: { email: 'admin@example.test' }, scope: { kind: 'global' } } as Record<string, unknown>,
  order: { id: 'wo-1', client_id: 'client-a', status: 'in_review', remotion_brief: { template: 'postcard', props: { invalid: true } }, creative_recipe: null } as Record<string, unknown> | null,
  error: null as { message: string } | null,
}))

vi.mock('@/lib/auth/require-admin', () => ({ requireAdminScope: async () => h.admin }))
vi.mock('@/lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = () => chain
  chain.maybeSingle = async () => ({ data: h.order, error: h.error })
  return { supabaseAdmin: { from: () => chain } }
})

import { GET } from './route'

const call = () => GET(new Request('https://me.example.test/api'), { params: Promise.resolve({ id: 'wo-1' }) })

describe('GET /api/factory/work-orders/[id]/music-options', () => {
  beforeEach(() => {
    h.admin = { ok: true, user: { email: 'admin@example.test' }, scope: { kind: 'global' } }
    h.order = { id: 'wo-1', client_id: 'client-a', status: 'in_review', remotion_brief: { template: 'postcard', props: { invalid: true } }, creative_recipe: null }
    h.error = null
  })

  it('returns derived choices only, never the Remotion brief', async () => {
    const res = await call()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toEqual({ music_choices: [] })
    expect(JSON.stringify(json)).not.toContain('invalid')
  })

  it('rejects cross-client access and non-review states', async () => {
    h.admin = { ok: true, user: { email: 'client@example.test' }, scope: { kind: 'client', clientId: 'client-b' } }
    expect((await call()).status).toBe(403)
    h.admin = { ok: true, user: { email: 'admin@example.test' }, scope: { kind: 'global' } }
    h.order = { ...h.order!, status: 'approved' }
    expect((await call()).status).toBe(409)
  })

  it('does not offer music choices while a recipe order waits for replanning', async () => {
    h.order = { ...h.order!, creative_recipe: { id: 'recipe-1' } }
    const res = await call()
    expect(await res.json()).toEqual({ music_choices: [] })
  })
})
