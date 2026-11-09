import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createTour } from '../store-create'
import { validateNewTour } from '../new-tour'
import { patchContext } from './content-fixture'

const parsed = validateNewTour(
  {
    destination: 'china',
    tier: 'signature',
    slug: 'china-unveiled',
    tour: { name: 'China Unveiled' },
    departures: [{ departOn: '2027-03-22', returnOn: '2027-04-04' }],
  },
  patchContext(),
)
if (!parsed.ok) throw new Error('fixture invalid')
const input = parsed.value

interface Fake {
  db: SupabaseClient
  deleted: string[]
  rpc: ReturnType<typeof vi.fn>
}

function fakeDb(opts: { insertError?: { code: string; message: string }; rpcError?: string }): Fake {
  const deleted: string[] = []
  const rpc = vi.fn(async () =>
    opts.rpcError ? { data: null, error: { message: opts.rpcError } } : { data: { id: 'dep-1', tour_id: 'tour-new' }, error: null },
  )
  const tours = {
    select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [{ sort_order: 4 }], error: null }) }) }) }),
    insert: () => ({
      select: () => ({
        single: async () =>
          opts.insertError
            ? { data: null, error: opts.insertError }
            : { data: { id: 'tour-new', client_id: 'client-1', slug: 'china-unveiled', name: 'China Unveiled' }, error: null },
      }),
    }),
    delete: () => ({ eq: () => ({ eq: async (_c: string, id: string) => (deleted.push(id), { error: null }) }) }),
  }
  const db = { from: () => tours, rpc } as unknown as SupabaseClient
  return { db, deleted, rpc }
}

describe('createTour', () => {
  it('inserts the tour then saves each departure with the actor', async () => {
    const f = fakeDb({})
    const result = await createTour(f.db, 'client-1', input, 'admin@example.com')
    expect(result.ok).toBe(true)
    expect(f.rpc).toHaveBeenCalledTimes(1)
    expect(f.rpc).toHaveBeenCalledWith(
      'tour_catalog_save_departure',
      expect.objectContaining({ p_tour_id: 'tour-new', p_actor: 'admin@example.com' }),
    )
  })

  it('reports a clash with an existing tour as duplicate', async () => {
    const f = fakeDb({ insertError: { code: '23505', message: 'unique' } })
    const result = await createTour(f.db, 'client-1', input, 'a')
    expect(result).toMatchObject({ ok: false, code: 'duplicate' })
    expect(f.rpc).not.toHaveBeenCalled()
  })

  it('removes the half-made tour when a departure cannot be saved', async () => {
    const f = fakeDb({ rpcError: 'invalid_dates' })
    const result = await createTour(f.db, 'client-1', input, 'a')
    expect(result).toMatchObject({ ok: false, code: 'invalid' })
    expect(f.deleted).toEqual(['tour-new'])
  })
})
