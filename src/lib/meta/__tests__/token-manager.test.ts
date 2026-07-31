/**
 * Tests for the Meta token lookup.
 *
 * Focus on the decisions that are easy to get silently wrong:
 *   1. lookup ORDER — domain beats page, page beats the shared fallback
 *   2. a client with no domain must still be able to have its own token
 *      (this is the 30 Kiteroa case: no website, Page inbox that needs syncing)
 *   3. never throw — a missing client or a DB error falls back, it does not crash
 *      a cron that is syncing several clients in one run
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const maybeSingle = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}))

import { getMetaTokenForClient, domainToEnvKey, pageIdToEnvVar } from '../token-manager'

const DOMAIN_VAR = 'META_SYSTEM_USER_TOKEN_CTSTOURS_CO_NZ'
const PAGE_VAR = 'META_SYSTEM_USER_TOKEN_PAGE_227633594573276'

/** Snapshot the env keys this suite writes, so tests cannot leak into each other. */
const TOUCHED = [DOMAIN_VAR, PAGE_VAR, 'META_SYSTEM_USER_TOKEN'] as const
let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]))
  for (const k of TOUCHED) delete process.env[k]
  maybeSingle.mockReset()
})

afterEach(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

function client(row: { domain?: string | null; facebook_page_id?: string | null } | null) {
  maybeSingle.mockResolvedValue({ data: row, error: null })
}

describe('key derivation', () => {
  it('turns a domain into an env-safe key', () => {
    expect(domainToEnvKey('ctstours.co.nz')).toBe('CTSTOURS_CO_NZ')
  })

  it('turns a page id into the page-scoped env var name', () => {
    expect(pageIdToEnvVar('227633594573276')).toBe(PAGE_VAR)
  })
})

describe('lookup order', () => {
  it('prefers the domain-scoped token over everything else', async () => {
    client({ domain: 'ctstours.co.nz', facebook_page_id: '227633594573276' })
    process.env[DOMAIN_VAR] = 'by-domain'
    process.env[PAGE_VAR] = 'by-page'
    process.env.META_SYSTEM_USER_TOKEN = 'shared'

    expect(await getMetaTokenForClient('any')).toBe('by-domain')
  })

  it('falls to the page-scoped token when no domain token is set', async () => {
    client({ domain: 'ctstours.co.nz', facebook_page_id: '227633594573276' })
    process.env[PAGE_VAR] = 'by-page'
    process.env.META_SYSTEM_USER_TOKEN = 'shared'

    expect(await getMetaTokenForClient('any')).toBe('by-page')
  })

  it('falls to the shared token when neither scoped token exists', async () => {
    client({ domain: 'ctstours.co.nz', facebook_page_id: '227633594573276' })
    process.env.META_SYSTEM_USER_TOKEN = 'shared'

    expect(await getMetaTokenForClient('any')).toBe('shared')
  })
})

describe('client with no domain (the 30 Kiteroa case)', () => {
  it('still resolves its own token via the Page id', async () => {
    // A single-property campaign has no website. Before the page-keyed lookup
    // it fell straight through to the shared token, whose scopes did not cover
    // this Page — so the inbox sync silently returned zero conversations.
    client({ domain: null, facebook_page_id: '227633594573276' })
    process.env[PAGE_VAR] = 'by-page'
    process.env.META_SYSTEM_USER_TOKEN = 'shared'

    expect(await getMetaTokenForClient('any')).toBe('by-page')
  })

  it('uses the shared token when no page-scoped token is configured yet', async () => {
    client({ domain: null, facebook_page_id: '227633594573276' })
    process.env.META_SYSTEM_USER_TOKEN = 'shared'

    expect(await getMetaTokenForClient('any')).toBe('shared')
  })
})

describe('never throws', () => {
  it('returns the shared token when the client row is missing', async () => {
    client(null)
    process.env.META_SYSTEM_USER_TOKEN = 'shared'

    expect(await getMetaTokenForClient('ghost')).toBe('shared')
  })

  it('returns the shared token on a DB error', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } })
    process.env.META_SYSTEM_USER_TOKEN = 'shared'

    expect(await getMetaTokenForClient('any')).toBe('shared')
  })

  it('returns null when nothing at all is configured', async () => {
    client({ domain: null, facebook_page_id: null })

    expect(await getMetaTokenForClient('any')).toBeNull()
  })
})
