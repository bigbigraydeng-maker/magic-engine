import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: dbMocks.from } }))
import { loadTrustedClientRedlines } from '../client-redlines'

function query(result: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => result),
  }
  builder.select.mockReturnValue(builder)
  builder.eq.mockReturnValue(builder)
  return builder
}

describe('trusted client redline loader', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads tenant-filtered client phrases plus active brief avoid words', async () => {
    const clients = query({
      data: { brand_redline_phrases: ['guaranteed departure', ' local since 1928 '] },
      error: null,
    })
    const briefs = query({
      data: { avoid_words: ['cheap', 'guaranteed departure'] },
      error: null,
    })
    dbMocks.from.mockImplementation((table: string) => table === 'clients' ? clients : briefs)

    await expect(loadTrustedClientRedlines('client-cts')).resolves.toEqual({
      redline: {
        available: true,
        phrases: ['guaranteed departure', 'local since 1928', 'cheap'],
      },
      source: 'clients:client-cts:brand_redline_phrases+master_briefs:client-cts:avoid_words',
    })
    expect(clients.eq).toHaveBeenCalledWith('id', 'client-cts')
    expect(briefs.eq).toHaveBeenCalledWith('client_id', 'client-cts')
    expect(briefs.eq).toHaveBeenCalledWith('is_active', true)
  })

  it('fails closed on lookup errors or missing client rows', async () => {
    dbMocks.from.mockImplementation((table: string) => table === 'clients'
      ? query({ data: null, error: { message: 'unavailable' } })
      : query({ data: null, error: null }))
    const result = await loadTrustedClientRedlines('client-cts')
    expect(result.redline).toEqual({ available: false, reason: 'tenant redline lookup failed' })
  })

  it('fails closed on malformed persisted arrays', async () => {
    dbMocks.from.mockImplementation((table: string) => table === 'clients'
      ? query({ data: { brand_redline_phrases: 'not-an-array' }, error: null })
      : query({ data: { avoid_words: [] }, error: null }))
    const result = await loadTrustedClientRedlines('client-cts')
    expect(result.redline).toEqual({ available: false, reason: 'tenant redline shape invalid' })
  })
})
