/**
 * Tests for normaliseContentTargets() — the JS-side guard that mirrors the DB
 * CHECK constraint on cms_connections.content_targets.
 *
 * Two purposes:
 *  - Catch bad input at the API boundary so the FDE sees a 400 + clean message
 *    instead of a Postgres CHECK violation.
 *  - Lock the MVP whitelist (html|php × global_head) so adding support for
 *    jsx/vue/page_head/etc later requires updating both the DB function and
 *    these tests together.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock supabase BEFORE importing the store so updateContentTargets picks up the stub.
vi.mock('../supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

// crypto is imported at module top-level — stub it so the import graph resolves
// without a real ENCRYPTION_KEY env var (updateContentTargets itself never calls it).
vi.mock('./crypto', () => ({
  encryptToken:  vi.fn(() => 'enc'),
  decryptToken:  vi.fn(() => 'dec'),
  tokenLastFour: vi.fn(() => '1234'),
}))

import {
  normaliseContentTargets,
  updateContentTargets,
  CmsContentTargetValidationError,
} from './connection-store'
import { supabaseAdmin } from '../supabase'

describe('normaliseContentTargets', () => {
  it('returns [] for undefined/null', () => {
    expect(normaliseContentTargets(undefined)).toEqual([])
    expect(normaliseContentTargets(null)).toEqual([])
  })

  it('accepts an empty array', () => {
    expect(normaliseContentTargets([])).toEqual([])
  })

  it('accepts a valid html target without label', () => {
    const result = normaliseContentTargets([
      { path: 'layouts/main.html', syntax: 'html', role: 'global_head' },
    ])
    expect(result).toEqual([
      { path: 'layouts/main.html', syntax: 'html', role: 'global_head' },
    ])
  })

  it('accepts a valid php target with label', () => {
    const result = normaliseContentTargets([
      { path: 'header.php', syntax: 'php', role: 'global_head', label: 'Site header' },
    ])
    expect(result).toEqual([
      { path: 'header.php', syntax: 'php', role: 'global_head', label: 'Site header' },
    ])
  })

  it('trims whitespace from path', () => {
    const result = normaliseContentTargets([
      { path: '  header.php  ', syntax: 'php', role: 'global_head' },
    ])
    expect(result[0]?.path).toBe('header.php')
  })

  it('rejects non-array input', () => {
    expect(() => normaliseContentTargets('foo' as unknown)).toThrow(/must be an array/)
    expect(() => normaliseContentTargets({} as unknown)).toThrow(/must be an array/)
  })

  it('rejects empty path', () => {
    expect(() =>
      normaliseContentTargets([{ path: '', syntax: 'html', role: 'global_head' }]),
    ).toThrow(/Invalid content target/)
  })

  it('rejects whitespace-only path (M4 — was passing JS but failing DB CHECK as 500)', () => {
    expect(() =>
      normaliseContentTargets([{ path: '   ', syntax: 'html', role: 'global_head' }]),
    ).toThrow(/path cannot be blank/)
  })

  it('rejects tab/newline-only path', () => {
    expect(() =>
      normaliseContentTargets([{ path: '\t\n', syntax: 'php', role: 'global_head' }]),
    ).toThrow(/path cannot be blank/)
  })

  it('MF1: rejects path with leading slash (would produce // in GitHub contents URL)', () => {
    expect(() =>
      normaliseContentTargets([{ path: '/header.php', syntax: 'php', role: 'global_head' }]),
    ).toThrow(/no leading/)
  })

  it('rejects missing path', () => {
    expect(() =>
      normaliseContentTargets([{ syntax: 'html', role: 'global_head' }]),
    ).toThrow(/Invalid content target/)
  })

  it('rejects unsupported syntax (jsx) — MVP whitelist enforcement', () => {
    expect(() =>
      normaliseContentTargets([
        { path: 'app/layout.tsx', syntax: 'jsx', role: 'global_head' },
      ]),
    ).toThrow(/Invalid content target/)
  })

  it('rejects unsupported syntax (vue)', () => {
    expect(() =>
      normaliseContentTargets([
        { path: 'app.vue', syntax: 'vue', role: 'global_head' },
      ]),
    ).toThrow(/Invalid content target/)
  })

  it('rejects unsupported role (body_end)', () => {
    expect(() =>
      normaliseContentTargets([
        { path: 'header.php', syntax: 'php', role: 'body_end' },
      ]),
    ).toThrow(/Invalid content target/)
  })

  it('rejects non-string label', () => {
    expect(() =>
      normaliseContentTargets([
        { path: 'header.php', syntax: 'php', role: 'global_head', label: 123 },
      ]),
    ).toThrow(/Invalid content target/)
  })

  it('rejects mixed valid/invalid (fails on first bad element)', () => {
    expect(() =>
      normaliseContentTargets([
        { path: 'header.php', syntax: 'php', role: 'global_head' },
        { path: 'bad.tsx',    syntax: 'jsx', role: 'global_head' },
      ]),
    ).toThrow(/Invalid content target/)
  })

  it('accepts multiple valid targets in one call', () => {
    const result = normaliseContentTargets([
      { path: 'header.php',         syntax: 'php',  role: 'global_head', label: 'PHP header' },
      { path: 'layouts/main.html',  syntax: 'html', role: 'global_head' },
    ])
    expect(result).toHaveLength(2)
    expect(result[0]?.syntax).toBe('php')
    expect(result[1]?.syntax).toBe('html')
  })
})

/**
 * B2-5 (魏征 B2 carryover): unit tests for updateContentTargets().
 *
 * Previously this was only exercised end-to-end via the PATCH route integration
 * tests. These cover the store function in isolation:
 *   - validation runs BEFORE the DB call (bad input never touches supabase)
 *   - the update is scoped to provider=github (never clobbers a wordpress/shopify row)
 *   - null row (no GitHub connection) → returns null, not a throw
 *   - supabase error → surfaces as a thrown Error
 */
describe('updateContentTargets', () => {
  const CLIENT_ID = 'client-abc'

  const VALID_TARGETS = [
    { path: 'layouts/main.html', syntax: 'html', role: 'global_head' },
  ]

  const ROW = {
    id:              'conn1',
    client_id:       CLIENT_ID,
    provider:        'github',
    repo_owner:      'acme',
    repo_name:       'website',
    default_branch:  'main',
    content_paths:   [],
    content_targets: VALID_TARGETS,
    site_url:        null,
    username:        null,
    encrypted_token: 'enc',
    token_last_four: '1234',
    status:          'connected',
    last_error:      null,
    last_tested_at:  null,
    created_at:      '',
    updated_at:      '',
  }

  /**
   * Build a chainable supabase mock whose terminal .maybeSingle() resolves to
   * the given result. Returns the spies so tests can assert on the chain.
   */
  function mockUpdateChain(result: { data: unknown; error: unknown }) {
    const maybeSingle = vi.fn().mockResolvedValue(result)
    const select      = vi.fn().mockReturnValue({ maybeSingle })
    const eqProvider  = vi.fn().mockReturnValue({ select })
    const eqClient    = vi.fn().mockReturnValue({ eq: eqProvider })
    const update      = vi.fn().mockReturnValue({ eq: eqClient })
    vi.mocked(supabaseAdmin.from).mockReturnValue({ update } as unknown as ReturnType<typeof supabaseAdmin.from>)
    return { update, eqClient, eqProvider, select, maybeSingle }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates content_targets and returns the connection status on success', async () => {
    const chain = mockUpdateChain({ data: ROW, error: null })

    const status = await updateContentTargets(CLIENT_ID, VALID_TARGETS)

    expect(status).not.toBeNull()
    expect(status?.provider).toBe('github')
    expect(status?.contentTargets).toEqual(VALID_TARGETS)
    // The write must carry the normalised targets
    expect(chain.update).toHaveBeenCalledWith({ content_targets: VALID_TARGETS })
  })

  it('scopes the update to client_id AND provider=github', async () => {
    const chain = mockUpdateChain({ data: ROW, error: null })

    await updateContentTargets(CLIENT_ID, VALID_TARGETS)

    expect(chain.eqClient).toHaveBeenCalledWith('client_id', CLIENT_ID)
    expect(chain.eqProvider).toHaveBeenCalledWith('provider', 'github')
  })

  it('trims whitespace in paths before writing (normalise runs first)', async () => {
    const chain = mockUpdateChain({ data: ROW, error: null })

    await updateContentTargets(CLIENT_ID, [
      { path: '  layouts/main.html  ', syntax: 'html', role: 'global_head' },
    ])

    expect(chain.update).toHaveBeenCalledWith({
      content_targets: [{ path: 'layouts/main.html', syntax: 'html', role: 'global_head' }],
    })
  })

  it('throws CmsContentTargetValidationError on bad input BEFORE touching supabase', async () => {
    await expect(
      updateContentTargets(CLIENT_ID, [{ path: 'x.tsx', syntax: 'jsx', role: 'global_head' }]),
    ).rejects.toBeInstanceOf(CmsContentTargetValidationError)

    // The DB must never be hit when validation fails
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('returns null when no GitHub connection exists for the client', async () => {
    mockUpdateChain({ data: null, error: null })

    const status = await updateContentTargets(CLIENT_ID, VALID_TARGETS)

    expect(status).toBeNull()
  })

  it('throws when supabase returns an error', async () => {
    mockUpdateChain({ data: null, error: { message: 'connection terminated' } })

    await expect(
      updateContentTargets(CLIENT_ID, VALID_TARGETS),
    ).rejects.toThrow(/content_targets update failed/)
  })

  it('clears targets to [] when passed an empty array', async () => {
    const chain = mockUpdateChain({ data: { ...ROW, content_targets: [] }, error: null })

    const status = await updateContentTargets(CLIENT_ID, [])

    expect(chain.update).toHaveBeenCalledWith({ content_targets: [] })
    expect(status?.contentTargets).toEqual([])
  })
})
