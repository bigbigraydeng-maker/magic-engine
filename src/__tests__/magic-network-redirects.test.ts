/**
 * Magic Network moved to its own site (PM 2026-11-10「Redirect now」): the old public product and
 * application pages send visitors there with their query string; the portal (/partner) is not touched.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const redirect = vi.hoisted(() => vi.fn((url: string) => { throw new Error(`REDIRECT ${url}`) }))
vi.mock('next/navigation', () => ({ redirect }))

import { magicNetworkUrl } from '@/lib/magic-network-url'
import AiStewardPage from '@/app/ai-steward/page'
import ApplyPage from '@/app/partner/apply/page'

afterEach(() => {
  delete process.env.MAGIC_NETWORK_URL
  redirect.mockClear()
})

describe('magicNetworkUrl', () => {
  it('points at the Magic Network site and keeps the query string', () => {
    expect(magicNetworkUrl('/join', { ref: 'ABCD2345' })).toBe('https://network.magiclab.co.nz/join?ref=ABCD2345')
    expect(magicNetworkUrl('/join')).toBe('https://network.magiclab.co.nz/join')
  })

  it('uses MAGIC_NETWORK_URL once set, without a doubled slash, and keeps repeated params', () => {
    process.env.MAGIC_NETWORK_URL = 'https://network.example.nz/'
    expect(magicNetworkUrl('/products/ai-steward', { ref: 'ABCD2345', utm: ['a', 'b'] })).toBe(
      'https://network.example.nz/products/ai-steward?ref=ABCD2345&utm=a&utm=b',
    )
  })
})

describe('old ME pages', () => {
  it('/ai-steward sends visitors to the product page on the new site', async () => {
    await expect(AiStewardPage({ searchParams: Promise.resolve({ ref: 'ABCD2345' }) })).rejects.toThrow(
      'REDIRECT https://network.magiclab.co.nz/products/ai-steward?ref=ABCD2345',
    )
  })

  it('/partner/apply sends visitors to the application page on the new site', async () => {
    await expect(ApplyPage({ searchParams: Promise.resolve({ ref: 'ABCD2345' }) })).rejects.toThrow(
      'REDIRECT https://network.magiclab.co.nz/join?ref=ABCD2345',
    )
  })
})
