import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parsePriceDisplayString, lookupTourPrice } from '../cts-tour-price'

vi.mock('@/lib/web-intelligence/first-party-tours', () => ({
  loadFirstPartyTourProducts: vi.fn(async () => []),
}))

/**
 * 按调用方真实链路建模，不是猜的形状——实测 `cts-tour-price.ts` 对 group_tours
 * 只调用 `.from('group_tours').select('payload').eq('client_id', ...).eq('status', ...)`
 * 这一条链，不调用其他任何方法（源码第 47-50 行核实过）。这个假件只需要覆盖这一条链。
 */
function fakeSupabase(groupTourRows: Array<{ payload: unknown }>): SupabaseClient {
  return {
    from: (table: string) => {
      if (table !== 'group_tours') throw new Error(`unexpected table: ${table}`)
      return {
        select: () => ({
          eq: () => ({
            eq: async () => ({ data: groupTourRows, error: null }),
          }),
        }),
      }
    },
  } as unknown as SupabaseClient
}

describe('parsePriceDisplayString', () => {
  it('extracts amount and currency from a real CTS price string', () => {
    expect(parsePriceDisplayString('From NZD $4,999 per person')).toEqual({
      amountMinor: 499900,
      currency: 'NZD',
    })
  })

  it('returns null when there is no currency code (refuses to guess)', () => {
    expect(parsePriceDisplayString('$4,999 per person')).toBeNull()
  })

  it('returns null for null/empty input', () => {
    expect(parsePriceDisplayString(null)).toBeNull()
    expect(parsePriceDisplayString('')).toBeNull()
  })
})

describe('lookupTourPrice', () => {
  it('matches by exact (case/whitespace-insensitive) name against group_tours', async () => {
    const supabase = fakeSupabase([
      { payload: { name: 'China Discovery — Golden China', title: 'Golden China Tour', price: 'From NZD $4,999 per person' } },
    ])
    const result = await lookupTourPrice(supabase, 'client-1', '  golden china tour  ', null)
    expect(result).toEqual({ amountMinor: 499900, currency: 'NZD' })
  })

  it('returns null when no exact match exists — does not guess via fuzzy matching', async () => {
    const supabase = fakeSupabase([
      { payload: { name: 'China Discovery — Golden China', price: 'From NZD $4,999 per person' } },
    ])
    const result = await lookupTourPrice(supabase, 'client-1', 'Best of China 15D', null)
    expect(result).toBeNull()
  })

  it('returns null when group_tours has no published rows at all', async () => {
    const supabase = fakeSupabase([])
    const result = await lookupTourPrice(supabase, 'client-1', 'Best of China 15D', null)
    expect(result).toBeNull()
  })
})
