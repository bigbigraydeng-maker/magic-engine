/**
 * Regression — clearing the Brand Aliases panel must not write NULL.
 *
 * clients.brand_aliases has been NOT NULL DEFAULT '{}' since
 * 20260625000001_a21_goal_current_value.sql hardened it (that migration
 * back-fills NULLs, then SET DEFAULT + SET NOT NULL). Repo and production
 * agree — this was never schema drift. The bug was only in the handler: it
 * persisted NULL when the FDE removed the last alias, so Postgres raised
 * 23502 and the panel returned 500. Aliases could be added but never cleared.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { update, eq } = vi.hoisted(() => ({
  update: vi.fn(),
  eq:     vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: () => ({ update }) },
}))

import { PATCH } from '../route'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'

/** Mirrors the NOT NULL constraint production actually enforces. */
function notNullColumn() {
  update.mockImplementation((patch: { brand_aliases: unknown }) => {
    eq(patch)
    return {
      eq: async () =>
        patch.brand_aliases === null
          ? { error: { message: 'null value in column "brand_aliases" violates not-null constraint', code: '23502' } }
          : { error: null },
    }
  })
}

const patchReq = (aliases: unknown[]) =>
  new NextRequest(`http://localhost:3001/api/clients/${CLIENT_ID}/brand-aliases`, {
    method:  'PATCH',
    body:    JSON.stringify({ aliases }),
    headers: { 'Content-Type': 'application/json' },
  })

const params = { params: Promise.resolve({ id: CLIENT_ID }) }

afterEach(() => vi.clearAllMocks())

describe('PATCH /api/clients/[id]/brand-aliases', () => {
  it('clearing every alias succeeds and persists [] rather than NULL', async () => {
    vi.mocked(requireDashboardClientAccess).mockResolvedValue({ ok: true } as never)
    notNullColumn()

    const res  = await PATCH(patchReq([]), params)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ success: true, aliases: [], count: 0 })
    expect(eq).toHaveBeenCalledWith({ brand_aliases: [] })
    expect(eq).not.toHaveBeenCalledWith({ brand_aliases: null })
  })

  it('a list that normalises down to nothing also persists [] rather than NULL', async () => {
    vi.mocked(requireDashboardClientAccess).mockResolvedValue({ ok: true } as never)
    notNullColumn()

    // '  ' trims to empty and 'a' is below MIN_ALIAS_LEN — both dropped.
    const res = await PATCH(patchReq(['  ', 'a', 42]), params)

    expect(res.status).toBe(200)
    expect(eq).toHaveBeenCalledWith({ brand_aliases: [] })
  })

  it('a non-empty list still round-trips normalised', async () => {
    vi.mocked(requireDashboardClientAccess).mockResolvedValue({ ok: true } as never)
    notNullColumn()

    const res  = await PATCH(patchReq(['  CTS   Tours ', 'cts tours', 'CTS Travel']), params)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.aliases).toEqual(['cts tours', 'cts travel'])
    expect(eq).toHaveBeenCalledWith({ brand_aliases: ['cts tours', 'cts travel'] })
  })
})
