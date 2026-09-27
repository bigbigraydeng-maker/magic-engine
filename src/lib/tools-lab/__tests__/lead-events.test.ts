import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ existing: [] as unknown[], readError: null as null | { message: string }, insertError: null as null | { message: string }, insert: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'contains']) chain[m] = vi.fn(() => chain)
      chain.limit = vi.fn(async () => ({ data: mocks.existing, error: mocks.readError }))
      chain.insert = vi.fn(async (row: unknown) => { mocks.insert(row); return { error: mocks.insertError } })
      return chain
    },
  },
}))

import { recordToolSignupOnce } from '../lead-events'

beforeEach(() => { vi.clearAllMocks(); mocks.existing = []; mocks.readError = null; mocks.insertError = null })

describe('recordToolSignupOnce', () => {
  it('writes one tool_signup row with the required columns and only the client id as metadata', async () => {
    await recordToolSignupOnce('c-1', 'ads-check')
    expect(mocks.insert).toHaveBeenCalledWith({
      page_path: '/meta-ads-ai/mine', cta_key: 'tool_signup', destination: 'ads-check',
      target_href: '/meta-ads-ai/mine', source: 'tools_lab', metadata: { client_id: 'c-1' },
    })
  })

  it('does nothing when this client was already recorded', async () => {
    mocks.existing = [{ id: 'x' }]
    await recordToolSignupOnce('c-1', 'ads-check')
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('does not write when the duplicate check itself fails (never double-counts)', async () => {
    mocks.readError = { message: 'down' }
    await recordToolSignupOnce('c-1', 'ads-check')
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('a failed write never throws into the sign-in', async () => {
    mocks.insertError = { message: 'down' }
    await expect(recordToolSignupOnce('c-1', 'ads-check')).resolves.toBeUndefined()
  })
})
