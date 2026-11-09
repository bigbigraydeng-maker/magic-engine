/**
 * Tests for the email/role whitelist used by the dashboard auth middleware.
 *
 * The whitelist is fail-closed: when no env var is configured, nobody is
 * allowed in. CLIENT_VIEWERS takes precedence over ADMIN_EMAILS so a viewer
 * email never accidentally lands on the admin path.
 *
 * Reference: P8.3.2 Dashboard Magic Link 鉴权 re-enable.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getUserPermissions, isAllowedEmail, isGlobalAdminEmail } from '../whitelist'

const KEYS = ['ADMIN_EMAILS', 'ADMIN_EMAIL_DOMAIN', 'CLIENT_VIEWERS'] as const

describe('getUserPermissions', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
  })

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('returns null when no env vars are configured (fail-closed)', () => {
    expect(getUserPermissions('anyone@example.com')).toBeNull()
  })

  it('returns admin for an exact ADMIN_EMAILS match', () => {
    process.env.ADMIN_EMAILS = 'alice@magiclab.com'
    expect(getUserPermissions('alice@magiclab.com')).toEqual({
      role: 'admin',
      allowedClientId: null,
    })
  })

  it('is case-insensitive and trims whitespace for ADMIN_EMAILS', () => {
    process.env.ADMIN_EMAILS = '  Alice@MagicLab.com , bob@magiclab.com '
    expect(getUserPermissions('ALICE@magiclab.com')).toEqual({
      role: 'admin',
      allowedClientId: null,
    })
    expect(getUserPermissions(' bob@MAGICLAB.com ')).toEqual({
      role: 'admin',
      allowedClientId: null,
    })
  })

  it('returns null when ADMIN_EMAILS does not include the address', () => {
    process.env.ADMIN_EMAILS = 'alice@magiclab.com'
    expect(getUserPermissions('eve@evil.com')).toBeNull()
  })

  it('returns admin when email matches ADMIN_EMAIL_DOMAIN suffix', () => {
    process.env.ADMIN_EMAIL_DOMAIN = 'magiclab.com'
    expect(getUserPermissions('anyone@magiclab.com')).toEqual({
      role: 'admin',
      allowedClientId: null,
    })
  })

  it('domain match is case-insensitive', () => {
    process.env.ADMIN_EMAIL_DOMAIN = 'MagicLab.com'
    expect(getUserPermissions('anyone@MAGICLAB.com')).toEqual({
      role: 'admin',
      allowedClientId: null,
    })
  })

  it('does not match a domain when only a suffix substring matches', () => {
    // "evil-magiclab.com" should NOT match domain "magiclab.com"
    process.env.ADMIN_EMAIL_DOMAIN = 'magiclab.com'
    expect(getUserPermissions('attacker@evil-magiclab.com')).toBeNull()
  })

  it('returns client-viewer with the assigned client id', () => {
    process.env.CLIENT_VIEWERS = 'viewer@nalexpress.com:4ae76381-cd45-43bd-85cd-98cfd7604007'
    expect(getUserPermissions('viewer@nalexpress.com')).toEqual({
      role: 'client-viewer',
      allowedClientId: '4ae76381-cd45-43bd-85cd-98cfd7604007',
    })
  })

  it('parses multiple CLIENT_VIEWERS entries separated by commas', () => {
    process.env.CLIENT_VIEWERS =
      'a@x.com:client-a, b@y.com:client-b ,c@z.com:client-c'
    expect(getUserPermissions('b@y.com')).toEqual({
      role: 'client-viewer',
      allowedClientId: 'client-b',
    })
    expect(getUserPermissions('c@z.com')).toEqual({
      role: 'client-viewer',
      allowedClientId: 'client-c',
    })
  })

  it('skips malformed CLIENT_VIEWERS entries (no colon)', () => {
    process.env.CLIENT_VIEWERS = 'broken-no-colon, good@x.com:client-x'
    expect(getUserPermissions('broken-no-colon')).toBeNull()
    expect(getUserPermissions('good@x.com')).toEqual({
      role: 'client-viewer',
      allowedClientId: 'client-x',
    })
  })

  it('CLIENT_VIEWERS takes precedence over ADMIN_EMAILS for the same address', () => {
    // If an email is in both lists, viewer wins — guards against accidentally
    // promoting a client to admin by leaving the address in both env vars.
    process.env.ADMIN_EMAILS = 'overlap@magiclab.com'
    process.env.CLIENT_VIEWERS = 'overlap@magiclab.com:client-x'
    expect(getUserPermissions('overlap@magiclab.com')).toEqual({
      role: 'client-viewer',
      allowedClientId: 'client-x',
    })
  })

  it('returns null for empty string email', () => {
    process.env.ADMIN_EMAILS = 'alice@magiclab.com'
    expect(getUserPermissions('')).toBeNull()
  })
})

describe('isAllowedEmail', () => {
  const saved = process.env.ADMIN_EMAILS

  beforeEach(() => {
    delete process.env.ADMIN_EMAILS
    delete process.env.ADMIN_EMAIL_DOMAIN
    delete process.env.CLIENT_VIEWERS
  })

  afterEach(() => {
    if (saved === undefined) delete process.env.ADMIN_EMAILS
    else process.env.ADMIN_EMAILS = saved
  })

  it('returns false when no env vars configured', () => {
    expect(isAllowedEmail('anyone@example.com')).toBe(false)
  })

  it('returns true for an admin email', () => {
    process.env.ADMIN_EMAILS = 'alice@magiclab.com'
    expect(isAllowedEmail('alice@magiclab.com')).toBe(true)
  })

  it('returns true for a client-viewer email', () => {
    process.env.CLIENT_VIEWERS = 'viewer@x.com:client-x'
    expect(isAllowedEmail('viewer@x.com')).toBe(true)
  })
})

describe('isGlobalAdminEmail', () => {
  const KEYS2 = ['ADMIN_EMAILS', 'ADMIN_EMAIL_DOMAIN'] as const
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of KEYS2) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
  })

  afterEach(() => {
    for (const k of KEYS2) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('returns false when ADMIN_EMAILS is not configured (fail-closed)', () => {
    expect(isGlobalAdminEmail('anyone@magicengine.cloud')).toBe(false)
  })

  it('returns true for an exact ADMIN_EMAILS match', () => {
    process.env.ADMIN_EMAILS = 'ray@magicengine.cloud'
    expect(isGlobalAdminEmail('ray@magicengine.cloud')).toBe(true)
  })

  it('is case-insensitive and trims whitespace', () => {
    process.env.ADMIN_EMAILS = '  Ray@MagicEngine.cloud '
    expect(isGlobalAdminEmail('RAY@magicengine.cloud')).toBe(true)
  })

  it('returns false for an email not in the exact list', () => {
    process.env.ADMIN_EMAILS = 'ray@magicengine.cloud'
    expect(isGlobalAdminEmail('someone-else@magicengine.cloud')).toBe(false)
  })

  it('does NOT fall back to ADMIN_EMAIL_DOMAIN — 只认精确名单', () => {
    // Issue #1644 §双签变异测试③：全局管理员判定只认写死的 ADMIN_EMAILS 精确
    // 名单，不认邮箱域名匹配 —— 否则公司里任何一个人都会被当成"全局管理员"。
    process.env.ADMIN_EMAIL_DOMAIN = 'magicengine.cloud'
    expect(isGlobalAdminEmail('anyone@magicengine.cloud')).toBe(false)
  })

  it('returns false for an empty email', () => {
    process.env.ADMIN_EMAILS = 'ray@magicengine.cloud'
    expect(isGlobalAdminEmail('')).toBe(false)
  })
})
