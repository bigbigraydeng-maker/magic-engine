/**
 * Tests for per-client config resolution — P21.K.5
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defaultConfig, resolveDigestRecipients } from '../config'

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
    expect(resolveDigestRecipients({ client_id: 'x', enabled: true, digest_recipients: ['a@b.com', 'c@d.com'] }))
      .toEqual(['a@b.com', 'c@d.com'])
  })

  it('falls back to the env inbox when the client list is empty', () => {
    process.env.AD_HEALTH_DIGEST_TO = 'ops@magicengine.com.au'
    expect(resolveDigestRecipients({ client_id: 'x', enabled: true, digest_recipients: [] }))
      .toEqual(['ops@magicengine.com.au'])
  })

  it('falls back to the hardcoded ME inbox when no env is set', () => {
    expect(resolveDigestRecipients({ client_id: 'x', enabled: true, digest_recipients: [] }))
      .toEqual(['raydeng@magicengine.com.au'])
  })
})
