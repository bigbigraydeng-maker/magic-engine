/**
 * Tests for per-client config resolution — P21.K.5
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const maybeSingle = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  },
}))

import { defaultConfig, resolveDigestRecipients, loadAdStrategyConfigWithSource } from '../config'

describe('loadAdStrategyConfigWithSource — asymmetric fail-open', () => {
  beforeEach(() => { maybeSingle.mockReset(); vi.spyOn(console, 'warn').mockImplementation(() => {}) })
  afterEach(() => vi.restoreAllMocks())

  it('marks a read error as fallback (so the caller can skip emailing)', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'timeout' } })
    const { config, source } = await loadAdStrategyConfigWithSource('c1')
    // Still enabled for data collection, but flagged as a guess.
    expect(config.enabled).toBe(true)
    expect(source).toBe('fallback')
  })

  it('marks a missing row as default (a fresh client, legitimately on)', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    const { config, source } = await loadAdStrategyConfigWithSource('c1')
    expect(config.enabled).toBe(true)
    expect(source).toBe('default')
  })

  it('passes a real row through as source row', async () => {
    maybeSingle.mockResolvedValue({ data: { client_id: 'c1', enabled: false, digest_recipients: ['a@b.com'] }, error: null })
    const { config, source } = await loadAdStrategyConfigWithSource('c1')
    expect(config.enabled).toBe(false)
    expect(config.digest_recipients).toEqual(['a@b.com'])
    expect(source).toBe('row')
  })

  it('fail-closed on autopilot: a row missing the new columns reads as disabled + dry-run', async () => {
    maybeSingle.mockResolvedValue({ data: { client_id: 'c1', enabled: true, digest_recipients: [] }, error: null })
    const { config } = await loadAdStrategyConfigWithSource('c1')
    expect(config.autopilot_enabled).toBe(false)
    expect(config.autopilot_dry_run).toBe(true)
  })

  it('reads an explicit autopilot_enabled=true, autopilot_dry_run=false row through', async () => {
    maybeSingle.mockResolvedValue({
      data: { client_id: 'c1', enabled: true, digest_recipients: [], autopilot_enabled: true, autopilot_dry_run: false },
      error: null,
    })
    const { config } = await loadAdStrategyConfigWithSource('c1')
    expect(config.autopilot_enabled).toBe(true)
    expect(config.autopilot_dry_run).toBe(false)
  })

  it('a read error falls back to autopilot disabled — never silently auto-pauses on a DB hiccup', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'timeout' } })
    const { config } = await loadAdStrategyConfigWithSource('c1')
    expect(config.autopilot_enabled).toBe(false)
    expect(config.autopilot_dry_run).toBe(true)
  })
})

describe('defaultConfig', () => {
  it('defaults a client with no row to enabled, global recipient', () => {
    const c = defaultConfig('client-1')
    expect(c.enabled).toBe(true)
    expect(c.digest_recipients).toEqual([])
  })
})

describe('resolveDigestRecipients', () => {
  const OLD = process.env.AD_HEALTH_DIGEST_TO
  beforeEach(() => { delete process.env.AD_HEALTH_DIGEST_TO })
  afterEach(() => { if (OLD) process.env.AD_HEALTH_DIGEST_TO = OLD; else delete process.env.AD_HEALTH_DIGEST_TO })

  const base = { autopilot_enabled: false, autopilot_dry_run: true }

  it('uses the client list when set', () => {
    expect(resolveDigestRecipients({ client_id: 'x', enabled: true, digest_recipients: ['a@b.com', 'c@d.com'], ...base }))
      .toEqual(['a@b.com', 'c@d.com'])
  })

  it('falls back to the env inbox when the client list is empty', () => {
    process.env.AD_HEALTH_DIGEST_TO = 'ops@magicengine.com.au'
    expect(resolveDigestRecipients({ client_id: 'x', enabled: true, digest_recipients: [], ...base }))
      .toEqual(['ops@magicengine.com.au'])
  })

  it('falls back to the shared verified-domain ME inbox when no env is set', () => {
    expect(resolveDigestRecipients({ client_id: 'x', enabled: true, digest_recipients: [], ...base }))
      .toEqual(['hello@magicengine.cloud'])
  })
})
