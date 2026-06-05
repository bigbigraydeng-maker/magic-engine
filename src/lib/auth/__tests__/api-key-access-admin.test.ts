/**
 * P34-P3.2 — admin key auth fork. Covers prefix XOR, expectedKind
 * (wrong_endpoint), env kill-switch, DB kill-switch, IP allowlist, expiry,
 * generateAdminApiKey, requireAdminContext, and ipInCidrList.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

import {
  generateApiKey,
  generateAdminApiKey,
  verifyApiKey,
  requireAdminContext,
  requireMeClientId,
  ipInCidrList,
  sha256Hex,
  KEY_PREFIX_ADMIN,
  KEY_PREFIX_CLIENT,
} from '../api-key-access'
import { supabaseAdmin } from '@/lib/supabase'

const mockFrom = vi.mocked(supabaseAdmin.from)
const ADMIN_KEY_ID = 'dddddddd-0000-0000-0000-000000000001'

/** admin lookup chain: .select().eq().is().gte().maybeSingle() */
function mockAdminLookup(row: Record<string, unknown> | null, settingsBefore = 'epoch') {
  const adminChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  }
  const settingsChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { admin_revoke_all_before: settingsBefore },
      error: null,
    }),
  }
  const updateChain = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) }
  // call order: admin_api_keys lookup → api_key_settings → (touchLastUsed) admin_api_keys update
  mockFrom
    .mockReturnValueOnce(adminChain as never)
    .mockReturnValueOnce(settingsChain as never)
    .mockReturnValue(updateChain as never)
}

beforeEach(() => vi.resetAllMocks())
afterEach(() => {
  delete process.env.ADMIN_KEY_KILL_SWITCH
})

describe('generateAdminApiKey', () => {
  it('produces me_admin_ prefix, distinct from client', () => {
    const a = generateAdminApiKey()
    expect(a.plaintext.startsWith(KEY_PREFIX_ADMIN)).toBe(true)
    expect(a.prefix.startsWith('me_admin_')).toBe(true)
    expect(generateApiKey().plaintext.startsWith(KEY_PREFIX_CLIENT)).toBe(true)
    expect(a.hash).toBe(sha256Hex(a.plaintext))
  })
})

describe('verifyApiKey — prefix XOR', () => {
  it('rejects unknown prefix as malformed', async () => {
    expect(await verifyApiKey('sk_live_whatever')).toEqual({ ok: false, reason: 'malformed' })
  })
  it('missing key → missing', async () => {
    expect(await verifyApiKey(null)).toEqual({ ok: false, reason: 'missing' })
  })
})

describe('verifyApiKey — expectedKind (Z1 wrong_endpoint)', () => {
  it('admin key at client endpoint → wrong_endpoint', async () => {
    const res = await verifyApiKey(`${KEY_PREFIX_ADMIN}abc`, { expectedKind: 'client' })
    expect(res).toEqual({ ok: false, reason: 'wrong_endpoint' })
    expect(mockFrom).not.toHaveBeenCalled() // rejected before any DB hit
  })
  it('client key at admin endpoint → wrong_endpoint', async () => {
    const res = await verifyApiKey(`${KEY_PREFIX_CLIENT}abc`, { expectedKind: 'admin' })
    expect(res).toEqual({ ok: false, reason: 'wrong_endpoint' })
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

describe('verifyApiKey — admin kill-switch', () => {
  it('env kill-switch denies admin key before DB lookup', async () => {
    process.env.ADMIN_KEY_KILL_SWITCH = 'true'
    const res = await verifyApiKey(`${KEY_PREFIX_ADMIN}abc`, { expectedKind: 'admin' })
    expect(res).toEqual({ ok: false, reason: 'kill_switched' })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('DB kill-switch (revoke_all_before in the future) denies', async () => {
    // key created 2026-01-01, revoke_all_before 2026-06-01 → killed
    mockAdminLookup(
      {
        id: ADMIN_KEY_ID,
        owner_email: 'pm@x.test',
        scopes: ['admin:read:all'],
        ip_allowlist: [],
        created_at: '2026-01-01T00:00:00Z',
      },
      '2026-06-01T00:00:00Z',
    )
    const res = await verifyApiKey(`${KEY_PREFIX_ADMIN}abc`, { expectedKind: 'admin' })
    expect(res).toEqual({ ok: false, reason: 'not_found_or_revoked' })
  })
})

describe('verifyApiKey — admin success + IP allowlist', () => {
  it('admin key with empty allowlist succeeds (soft-launch)', async () => {
    mockAdminLookup({
      id: ADMIN_KEY_ID,
      owner_email: 'pm@x.test',
      scopes: ['admin:read:all'],
      ip_allowlist: [],
      created_at: '2026-06-05T00:00:00Z',
    })
    const res = await verifyApiKey(`${KEY_PREFIX_ADMIN}abc`, { expectedKind: 'admin', sourceIp: '203.0.113.9' })
    expect(res.ok).toBe(true)
    if (res.ok && res.auth.kind === 'admin') {
      expect(res.auth.ownerEmail).toBe('pm@x.test')
      expect(res.auth.keyId).toBe(ADMIN_KEY_ID)
    } else {
      throw new Error('expected admin auth')
    }
  })

  it('IP not in allowlist → ip_blocked', async () => {
    mockAdminLookup({
      id: ADMIN_KEY_ID,
      owner_email: 'pm@x.test',
      scopes: ['admin:read:all'],
      ip_allowlist: ['203.0.113.0/24'],
      created_at: '2026-06-05T00:00:00Z',
    })
    const res = await verifyApiKey(`${KEY_PREFIX_ADMIN}abc`, {
      expectedKind: 'admin',
      sourceIp: '198.51.100.7',
    })
    expect(res).toEqual({ ok: false, reason: 'ip_blocked' })
  })

  it('IP in allowlist → success', async () => {
    mockAdminLookup({
      id: ADMIN_KEY_ID,
      owner_email: 'pm@x.test',
      scopes: ['admin:read:all'],
      ip_allowlist: ['203.0.113.0/24'],
      created_at: '2026-06-05T00:00:00Z',
    })
    const res = await verifyApiKey(`${KEY_PREFIX_ADMIN}abc`, {
      expectedKind: 'admin',
      sourceIp: '203.0.113.42',
    })
    expect(res.ok).toBe(true)
  })

  it('non-existent / expired admin key (SQL gte filters) → not_found', async () => {
    mockAdminLookup(null)
    const res = await verifyApiKey(`${KEY_PREFIX_ADMIN}abc`, { expectedKind: 'admin' })
    expect(res).toEqual({ ok: false, reason: 'not_found_or_revoked' })
  })
})

describe('ipInCidrList', () => {
  it.each([
    ['203.0.113.42', ['203.0.113.0/24'], true],
    ['203.0.113.42', ['203.0.113.42'], true], // bare IP = /32
    ['198.51.100.1', ['203.0.113.0/24'], false],
    ['10.0.0.5', ['10.0.0.0/8', '192.168.0.0/16'], true],
    ['172.16.0.1', ['10.0.0.0/8'], false],
  ])('%s in %j → %s', (ip, list, expected) => {
    expect(ipInCidrList(ip, list as string[])).toBe(expected)
  })
})

describe('requireAdminContext', () => {
  it('returns ctx for admin authInfo', () => {
    const ctx = requireAdminContext({ extra: { kind: 'admin', adminKeyId: ADMIN_KEY_ID, ownerEmail: 'pm@x.test', scopes: ['admin:read:all'] } })
    expect(ctx).toEqual({ adminKeyId: ADMIN_KEY_ID, ownerEmail: 'pm@x.test', scopes: ['admin:read:all'] })
  })

  it.each([
    ['undefined', undefined],
    ['client kind', { extra: { kind: 'client', meClientId: 'c1', keyId: 'k1' } }],
    ['no kind', { extra: { adminKeyId: ADMIN_KEY_ID, ownerEmail: 'x' } }],
    ['missing adminKeyId', { extra: { kind: 'admin', ownerEmail: 'x' } }],
    ['missing ownerEmail', { extra: { kind: 'admin', adminKeyId: ADMIN_KEY_ID } }],
  ])('throws for %s', (_l, authInfo) => {
    expect(() => requireAdminContext(authInfo)).toThrow()
  })

  it('client guard rejects admin authInfo (no meClientId)', () => {
    // cross-guard: admin context must NOT pass requireMeClientId
    expect(() => requireMeClientId({ extra: { kind: 'admin', adminKeyId: ADMIN_KEY_ID, ownerEmail: 'x' } })).toThrow()
  })
})
