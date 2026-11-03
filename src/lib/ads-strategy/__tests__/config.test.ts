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

import {
  defaultConfig,
  resolveDigestRecipients,
  loadAdStrategyConfigWithSource,
  parseCreativePool,
  CREATIVE_POOL_EXTENDED_STATUSES,
} from '../config'

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

  // 2026-09-25 事故：读失败时调用方需要原始报错才能把它记进运行记录（否则只剩一个 'fallback'）
  it('a read error carries the provider message out; a missing row carries no error', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'column ad_strategy_configs.autopilot_enabled does not exist' } })
    const failed = await loadAdStrategyConfigWithSource('c1')
    expect(failed.source).toBe('fallback')
    expect(failed.error).toContain('autopilot_enabled does not exist')

    maybeSingle.mockResolvedValue({ data: null, error: null })
    const missing = await loadAdStrategyConfigWithSource('c1')
    expect(missing.source).toBe('default')
    expect(missing.error).toBeUndefined()
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

  it('fail-closed on autonomy: a row missing the new columns reads as observe', async () => {
    maybeSingle.mockResolvedValue({ data: { client_id: 'c1', enabled: true, digest_recipients: [] }, error: null })
    const { config } = await loadAdStrategyConfigWithSource('c1')
    expect(config.autonomy_mode).toBe('observe')
    expect(config.daily_budget_cap_cents).toBeNull()
    expect(config.creative_pool).toEqual([])
  })

  it('reads an explicit bounded_auto row through', async () => {
    maybeSingle.mockResolvedValue({
      data: { client_id: 'c1', enabled: true, digest_recipients: [], autonomy_mode: 'bounded_auto', daily_budget_cap_cents: 5000, creative_pool: [] },
      error: null,
    })
    const { config } = await loadAdStrategyConfigWithSource('c1')
    expect(config.autonomy_mode).toBe('bounded_auto')
    expect(config.daily_budget_cap_cents).toBe(5000)
  })

  it('a read error falls back to observe — never silently grants autonomy on a DB hiccup', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'timeout' } })
    const { config } = await loadAdStrategyConfigWithSource('c1')
    expect(config.autonomy_mode).toBe('observe')
    expect(config.daily_budget_cap_cents).toBeNull()
  })
})

describe('parseCreativePool — 扩展状态只为读而容忍', () => {
  it.each(CREATIVE_POOL_EXTENDED_STATUSES)('keeps an entry with status %s', status => {
    const pool = parseCreativePool([{ kind: 'meta_video', ref: 'v1', status }])
    expect(pool).toHaveLength(1)
    expect(pool[0].status).toBe(status)
  })

  it('none of the extended statuses equals approved', () => {
    for (const status of CREATIVE_POOL_EXTENDED_STATUSES) {
      expect(status).not.toBe('approved')
    }
  })

  it('still drops an unknown status string', () => {
    expect(parseCreativePool([{ kind: 'meta_video', ref: 'v1', status: 'yolo' }])).toEqual([])
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

  it('uses the client list when set', () => {
    expect(resolveDigestRecipients({ ...defaultConfig('x'), digest_recipients: ['a@b.com', 'c@d.com'] }))
      .toEqual(['a@b.com', 'c@d.com'])
  })

  it('falls back to the env inbox when the client list is empty', () => {
    process.env.AD_HEALTH_DIGEST_TO = 'ops@magicengine.com.au'
    expect(resolveDigestRecipients({ ...defaultConfig('x'), digest_recipients: [] }))
      .toEqual(['ops@magicengine.com.au'])
  })

  it('falls back to the shared verified-domain ME inbox when no env is set', () => {
    expect(resolveDigestRecipients({ ...defaultConfig('x'), digest_recipients: [] }))
      .toEqual(['hello@magicengine.cloud'])
  })
})
