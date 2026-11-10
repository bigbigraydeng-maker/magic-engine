/**
 * Magic Network moved to its own site (PM 2026-11-10「Redirect now」): the old public product and
 * application pages must send visitors there, temporarily, and only those two — the distributor
 * portal (/partner) stays in ME until the new site has a database.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

type Redirect = { source: string; destination: string; permanent: boolean }

async function load(env?: string): Promise<Redirect[]> {
  vi.resetModules()
  if (env === undefined) delete process.env.MAGIC_NETWORK_URL
  else process.env.MAGIC_NETWORK_URL = env
  const config = (await import('../../next.config.js')).default as { redirects: () => Promise<Redirect[]> }
  return config.redirects()
}

afterEach(() => {
  delete process.env.MAGIC_NETWORK_URL
})

describe('Magic Network redirects', () => {
  it('sends the old product and application pages to the new site, not permanently', async () => {
    const r = await load()
    expect(r).toEqual(expect.arrayContaining([
      { source: '/ai-steward', destination: 'https://magic-network.onrender.com/products/ai-steward', permanent: false },
      { source: '/partner/apply', destination: 'https://magic-network.onrender.com/join', permanent: false },
    ]))
  })

  it('leaves the distributor portal in ME', async () => {
    const r = await load()
    expect(r.some((x) => x.source === '/partner' || x.source.startsWith('/partner/:'))).toBe(false)
  })

  it('uses MAGIC_NETWORK_URL once the real domain is set, without a doubled slash', async () => {
    const r = await load('https://network.example.nz/')
    expect(r.find((x) => x.source === '/partner/apply')?.destination).toBe('https://network.example.nz/join')
  })
})
