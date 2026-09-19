/**
 * Tests for the Meta token lookup.
 *
 * Focus on the decisions that are easy to get silently wrong:
 *   1. lookup ORDER — domain beats page, page beats the shared fallback
 *   2. a client with no domain must still be able to have its own token
 *      (this is the 30 Kiteroa case: no website, Page inbox that needs syncing)
 *   3. never throw — a missing client or a DB error falls back, it does not crash
 *      a cron that is syncing several clients in one run
 *   4. AD-SEC-4 — a scoped token only serves the client that OWNS its key
 *      (full ownership rules: token-selection.test.ts)
 *
 * The Supabase client is the table-modelled fake, so the ownership read really
 * filters rows instead of replaying canned answers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeBindingFakeDb, type FakeDb, type FakeFailures } from './binding-fake-db'

const state: { db: FakeDb; failures: FakeFailures } = { db: {}, failures: {} }
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (t: string) => makeBindingFakeDb(state.db, state.failures).from(t) }),
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
  state.db = {}
  state.failures = {}
})

afterEach(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

function client(row: { domain?: string | null; facebook_page_id?: string | null } | null, id = 'any') {
  state.db.clients = row
    ? [{ id, domain: null, facebook_page_id: null, created_at: '2026-01-01T00:00:00Z', source: 'fde', ...row }]
    : []
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

describe('AD-SEC-4 — a copied domain does not hand over the owner\'s token', () => {
  it('a self-serve signup carrying an existing client\'s domain gets the shared token, the owner keeps its own', async () => {
    state.db.clients = [
      { id: 'cts', domain: 'ctstours.co.nz', facebook_page_id: null, created_at: '2026-01-01T00:00:00Z', source: 'fde' },
      { id: 'squatter', domain: 'ctstours.co.nz', facebook_page_id: null, created_at: '2026-09-16T00:00:00Z', source: 'self_serve' },
    ]
    process.env[DOMAIN_VAR] = 'by-domain'
    process.env.META_SYSTEM_USER_TOKEN = 'shared'

    expect(await getMetaTokenForClient('squatter')).toBe('shared')
    expect(await getMetaTokenForClient('cts')).toBe('by-domain')
  })

  it('the older owner sits past the first 1000 rows → still found (ownership scan reads every page)', async () => {
    const filler = Array.from({ length: 1200 }, (_, i) => ({
      id: `a${String(i).padStart(5, '0')}`, domain: `filler${i}.example.com`, facebook_page_id: null,
      created_at: '2026-05-01T00:00:00Z', source: 'fde',
    }))
    state.db.clients = [
      ...filler,
      { id: 'b-copy', domain: 'ctstours.co.nz', facebook_page_id: null, created_at: '2026-09-01T00:00:00Z', source: 'fde' },
      { id: 'z-owner', domain: 'ctstours.co.nz', facebook_page_id: null, created_at: '2025-01-01T00:00:00Z', source: 'fde' },
    ]
    process.env[DOMAIN_VAR] = 'by-domain'
    process.env.META_SYSTEM_USER_TOKEN = 'shared'

    expect(await getMetaTokenForClient('b-copy')).toBe('shared')
    expect(await getMetaTokenForClient('z-owner')).toBe('by-domain')
  })

  it('cannot tell who owns the key (ownership read fails) → no token at all, never the wider shared one', async () => {
    const { resolveMetaTokenForClient } = await import('../token-manager')
    client({ domain: 'ctstours.co.nz' })
    process.env[DOMAIN_VAR] = 'by-domain'
    process.env.META_SYSTEM_USER_TOKEN = 'shared'
    // single-row read succeeds, the full ownership scan (range) fails
    const real = state.db
    let calls = 0
    state.db = new Proxy(real, {
      get(target, prop) {
        if (prop === 'clients' && ++calls > 1) throw new Error('scan failed')
        return Reflect.get(target, prop)
      },
    })

    expect(await resolveMetaTokenForClient('any')).toBeNull()
  })
})

describe('never throws', () => {
  it('returns the shared token when the client row is missing', async () => {
    client(null)
    process.env.META_SYSTEM_USER_TOKEN = 'shared'

    expect(await getMetaTokenForClient('ghost')).toBe('shared')
  })

  it('returns the shared token on a DB error', async () => {
    client({ domain: 'ctstours.co.nz' })
    state.failures = { select: new Set(['clients']) }
    process.env.META_SYSTEM_USER_TOKEN = 'shared'

    expect(await getMetaTokenForClient('any')).toBe('shared')
  })

  it('returns null when nothing at all is configured', async () => {
    client({ domain: null, facebook_page_id: null })

    expect(await getMetaTokenForClient('any')).toBeNull()
  })
})

describe('resolveMetaTokenForClient — reports where the token came from', () => {
  it('labels each lookup step', async () => {
    const { resolveMetaTokenForClient } = await import('../token-manager')
    process.env.META_SYSTEM_USER_TOKEN = 'shared'

    client({ domain: 'ctstours.co.nz', facebook_page_id: '227633594573276' })
    process.env[DOMAIN_VAR] = 'by-domain'
    expect(await resolveMetaTokenForClient('any')).toEqual({ token: 'by-domain', source: 'client_domain' })

    delete process.env[DOMAIN_VAR]
    process.env[PAGE_VAR] = 'by-page'
    expect(await resolveMetaTokenForClient('any')).toEqual({ token: 'by-page', source: 'client_page' })

    delete process.env[PAGE_VAR]
    expect(await resolveMetaTokenForClient('any')).toEqual({ token: 'shared', source: 'shared_fallback' })
  })

  it('nothing configured → null', async () => {
    const { resolveMetaTokenForClient } = await import('../token-manager')
    client({ domain: null, facebook_page_id: null })
    expect(await resolveMetaTokenForClient('any')).toBeNull()
  })
})
