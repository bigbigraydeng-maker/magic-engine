/**
 * AD-SEC-4 sync gate: the Messenger / lead-form syncs and comment auto-reply
 * only run on a Page verified as this client's.
 *
 * The attack it closes: `clients.facebook_page_id` used to be editable by client
 * staff, and without a stored OAuth Page token the syncs derive one from a token
 * that may be the shared fallback — which can see several clients' Pages. So a
 * client could bind another client's Page and pull its inbox and leads.
 *
 * Table-modelled fake DB: the client / binding_kind / outcome filters really
 * filter, so deleting one turns a case red.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { makeBindingFakeDb, asSupabaseClient, type FakeDb, type FakeFailures } from './binding-fake-db'

vi.mock('../page-posts', () => ({ getPageAccessToken: vi.fn() }))
vi.mock('@/lib/platform-oauth/vocabulary', () => ({
  decryptToken: (enc: string) => enc.replace(/^enc:/, ''),
}))

import { getPageAccessToken } from '../page-posts'
import { authorizePageSync, assessPageBinding, authorizeConfiguredPage } from '../page-sync-authorization'

const mockPageToken = vi.mocked(getPageAccessToken)

const A = 'client-a'
const B = 'client-b'
const PAGE = '1616575215312482'
const SHARED_ONLY = { META_SYSTEM_USER_TOKEN: 'shared' }
const A_DOMAIN_ENV = { META_SYSTEM_USER_TOKEN: 'shared', META_SYSTEM_USER_TOKEN_A_EXAMPLE_COM: 'a-domain-token' }

let db: FakeDb
let failures: FakeFailures

function client(id: string, over: Record<string, unknown> = {}) {
  return { id, name: id, domain: null, facebook_page_id: null, created_at: '2026-01-01T00:00:00Z', source: 'fde', ...over }
}

function supa(): SupabaseClient {
  return asSupabaseClient(makeBindingFakeDb(db, failures))
}

function audit(over: Record<string, unknown>) {
  return {
    client_id: A, binding_kind: 'facebook_page', action: 'bind', outcome: 'applied',
    requested_value: PAGE, created_at: '2026-09-17T00:00:00Z', ...over,
  }
}

beforeEach(() => {
  db = { clients: [client(A, { facebook_page_id: PAGE, domain: 'a.example.com' })], client_binding_audit: [], platform_oauth_connections: [] }
  failures = {}
  mockPageToken.mockResolvedValue('derived-page-token')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('refused — the sync must not read the Page', () => {
  it('legacy binding (no audit) with only the shared token', async () => {
    const res = await authorizePageSync(supa(), A, PAGE, SHARED_ONLY)
    expect(res).toMatchObject({ ok: false, skipped: 'page_not_verified', reason: 'unverified_shared_token' })
    expect(mockPageToken).not.toHaveBeenCalled()
  })

  it('the Page is also bound to another client — even a dirty copy, even with this client\'s OAuth connection', async () => {
    db.clients.push(client(B, { facebook_page_id: ` ０${PAGE}​ ` }))
    db.platform_oauth_connections.push({ client_id: A, provider: 'meta', account_id: PAGE, status: 'active', access_token_enc: 'enc:oauth' })
    db.client_binding_audit.push(audit({}))

    const res = await authorizePageSync(supa(), A, PAGE, A_DOMAIN_ENV)
    expect(res).toMatchObject({ ok: false, skipped: 'page_not_verified', reason: 'bound_to_other_client' })
    expect(mockPageToken).not.toHaveBeenCalled()
  })

  it('latest audited binding is a different Page (column changed outside the audited path)', async () => {
    db.client_binding_audit.push(audit({ requested_value: '999999999999', created_at: '2026-09-18T00:00:00Z' }))
    db.client_binding_audit.push(audit({ created_at: '2026-09-17T00:00:00Z' }))
    const res = await authorizePageSync(supa(), A, PAGE, A_DOMAIN_ENV)
    expect(res).toMatchObject({ ok: false, reason: 'audit_mismatch' })
  })

  it('latest audited action is a clear', async () => {
    db.client_binding_audit.push(audit({ action: 'clear', requested_value: null, created_at: '2026-09-18T00:00:00Z' }))
    db.client_binding_audit.push(audit({ created_at: '2026-09-17T00:00:00Z' }))
    const res = await authorizePageSync(supa(), A, PAGE, SHARED_ONLY)
    expect(res).toMatchObject({ ok: false, reason: 'audit_mismatch' })
  })

  it('a staff-verified row for ANOTHER client, or for another binding kind, does not verify this one', async () => {
    db.client_binding_audit.push(audit({ client_id: B }))
    db.client_binding_audit.push(audit({ binding_kind: 'meta_ad_account' }))
    const res = await authorizePageSync(supa(), A, PAGE, SHARED_ONLY)
    expect(res).toMatchObject({ ok: false, reason: 'unverified_shared_token' })
  })

  it('a rejected / failed staff attempt does not verify', async () => {
    db.client_binding_audit.push(audit({ outcome: 'rejected_duplicate' }))
    db.client_binding_audit.push(audit({ outcome: 'write_failed' }))
    const res = await authorizePageSync(supa(), A, PAGE, SHARED_ONLY)
    expect(res).toMatchObject({ ok: false, reason: 'unverified_shared_token' })
  })

  it('audit read fails for any reason other than "table not created yet" → check_failed', async () => {
    failures = { select: new Set(['client_binding_audit']) }
    const res = await authorizePageSync(supa(), A, PAGE, A_DOMAIN_ENV)
    expect(res).toMatchObject({ ok: false, reason: 'check_failed' })
  })

  it('duplicate check read fails → check_failed', async () => {
    failures = { select: new Set(['clients']) }
    const res = await authorizePageSync(supa(), A, PAGE, A_DOMAIN_ENV)
    expect(res).toMatchObject({ ok: false, reason: 'check_failed' })
    expect(mockPageToken).not.toHaveBeenCalled()
  })

  it('an undecryptable OAuth row is not OAuth evidence — falls to the stricter rules', async () => {
    db.platform_oauth_connections.push({ client_id: A, provider: 'meta', account_id: PAGE, status: 'active', access_token_enc: '' })
    const res = await authorizePageSync(supa(), A, PAGE, SHARED_ONLY)
    expect(res).toMatchObject({ ok: false, reason: 'unverified_shared_token' })
  })
})

describe('allowed', () => {
  it('this client\'s own OAuth connection → uses only that stored token', async () => {
    db.platform_oauth_connections.push({ client_id: A, provider: 'meta', account_id: PAGE, status: 'active', access_token_enc: 'enc:oauth-page' })
    const res = await authorizePageSync(supa(), A, PAGE, SHARED_ONLY)
    expect(res).toEqual({ ok: true, pageToken: 'oauth-page', via: 'client_oauth' })
    expect(mockPageToken).not.toHaveBeenCalled()
  })

  it('another client\'s OAuth connection for this Page is not this client\'s evidence', async () => {
    db.platform_oauth_connections.push({ client_id: B, provider: 'meta', account_id: PAGE, status: 'active', access_token_enc: 'enc:b' })
    const res = await authorizePageSync(supa(), A, PAGE, SHARED_ONLY)
    expect(res).toMatchObject({ ok: false, reason: 'unverified_shared_token' })
  })

  it('staff-verified binding → runs even on the shared token', async () => {
    db.client_binding_audit.push(audit({}))
    const res = await authorizePageSync(supa(), A, PAGE, SHARED_ONLY)
    expect(res).toEqual({ ok: true, pageToken: 'derived-page-token', via: 'staff_verified' })
    expect(mockPageToken).toHaveBeenCalledWith('shared', PAGE)
  })

  it('an "authorized" row stuck after its applied update failed still counts when it names this Page', async () => {
    db.client_binding_audit.push(audit({ outcome: 'authorized' }))
    const res = await authorizePageSync(supa(), A, PAGE, SHARED_ONLY)
    expect(res).toMatchObject({ ok: true, via: 'staff_verified' })
  })

  it('legacy binding on a staff-provisioned per-client token keeps running (no deploy-day outage)', async () => {
    const res = await authorizePageSync(supa(), A, PAGE, A_DOMAIN_ENV)
    expect(res).toEqual({ ok: true, pageToken: 'derived-page-token', via: 'legacy_client_token' })
    expect(mockPageToken).toHaveBeenCalledWith('a-domain-token', PAGE)
  })

  it('audit table not created yet (migration pending) → treated as no audit rows, legacy rules apply', async () => {
    const fake = makeBindingFakeDb(db, failures)
    const missing = {
      select: () => missing, eq: () => missing, in: () => missing, order: () => missing, limit: () => missing,
      maybeSingle: () => Promise.resolve({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.client_binding_audit' in the schema cache" } }),
    }
    const withMissingAudit = { from: (t: string) => (t === 'client_binding_audit' ? missing : fake.from(t)) } as unknown as SupabaseClient

    expect(await assessPageBinding(withMissingAudit, A, PAGE, A_DOMAIN_ENV)).toEqual({ verified: true, via: 'legacy_client_token' })
    expect(await assessPageBinding(withMissingAudit, A, PAGE, SHARED_ONLY)).toMatchObject({ verified: false, reason: 'unverified_shared_token' })
  })
})

describe('no token paths', () => {
  it('nothing configured → no_meta_token', async () => {
    const res = await authorizePageSync(supa(), A, PAGE, {})
    expect(res).toEqual({ ok: false, skipped: 'no_meta_token' })
  })

  it('verified but Meta will not hand over a Page token → no_page_token', async () => {
    mockPageToken.mockResolvedValue(null)
    const res = await authorizePageSync(supa(), A, PAGE, A_DOMAIN_ENV)
    expect(res).toEqual({ ok: false, skipped: 'no_page_token' })
  })
})

describe('stuck audit and unknown ownership (魏征 / 狄仁杰 implementation review)', () => {
  it('rebind wrote "authorized" for a NEW Page, the column write and the finish both failed → the old Page is refused, not silently kept', async () => {
    db.client_binding_audit.push(audit({ created_at: '2026-09-17T00:00:00Z' }))
    db.client_binding_audit.push(audit({ outcome: 'authorized', requested_value: '999999999999', created_at: '2026-09-18T00:00:00Z' }))
    const res = await authorizePageSync(supa(), A, PAGE, SHARED_ONLY)
    expect(res).toMatchObject({ ok: false, reason: 'audit_mismatch' })
  })

  it('who owns the scoped token key cannot be read → check_failed (reported), not "no token"', async () => {
    const fake = makeBindingFakeDb(db, failures)
    let clientReads = 0
    const flaky = {
      from: (t: string) => {
        // 1st clients read = duplicate scan, 2nd = the client row, 3rd = ownership scan → fail it
        if (t === 'clients' && ++clientReads === 3) return makeBindingFakeDb(db, { select: new Set(['clients']) }).from(t)
        return fake.from(t)
      },
    } as unknown as SupabaseClient
    const res = await authorizePageSync(flaky, A, PAGE, A_DOMAIN_ENV)
    expect(res).toMatchObject({ ok: false, skipped: 'page_not_verified', reason: 'check_failed' })
    expect(mockPageToken).not.toHaveBeenCalled()
  })
})

describe('authorizeConfiguredPage — client-editable Page ids (comment auto-reply, page metrics)', () => {
  it('configured Page = bound Page (even with stray spaces) → same gate as the sync', async () => {
    db.client_binding_audit.push(audit({}))
    const res = await authorizeConfiguredPage(supa(), A, `  ${PAGE} `, SHARED_ONLY)
    expect(res).toEqual({ ok: true, pageToken: 'derived-page-token', via: 'staff_verified' })
  })

  it('configured Page = bound Page but binding unverified → refused', async () => {
    const res = await authorizeConfiguredPage(supa(), A, PAGE, SHARED_ONLY)
    expect(res).toMatchObject({ ok: false, reason: 'unverified_shared_token' })
  })

  it('another client\'s Page typed into the config → refused, Meta never asked', async () => {
    db.clients.push(client(B, { facebook_page_id: '227633594573276' }))
    const res = await authorizeConfiguredPage(supa(), A, '227633594573276', A_DOMAIN_ENV)
    expect(res).toMatchObject({ ok: false, reason: 'bound_to_other_client' })
    expect(mockPageToken).not.toHaveBeenCalled()
  })

  it('an unbound Page with no OAuth consent from this client → refused', async () => {
    const res = await authorizeConfiguredPage(supa(), A, '333333333333', A_DOMAIN_ENV)
    expect(res).toMatchObject({ ok: false, reason: 'not_bound_page' })
    expect(mockPageToken).not.toHaveBeenCalled()
  })

  it('a different Page this client consented to via OAuth (e.g. its publishing Page) → only that stored token', async () => {
    db.platform_oauth_connections.push({ client_id: A, provider: 'meta', account_id: '333333333333', status: 'active', access_token_enc: 'enc:publish-page' })
    const res = await authorizeConfiguredPage(supa(), A, '333333333333', SHARED_ONLY)
    expect(res).toEqual({ ok: true, pageToken: 'publish-page', via: 'client_oauth' })
    expect(mockPageToken).not.toHaveBeenCalled()
  })

  it('non-numeric junk in the config → refused', async () => {
    const res = await authorizeConfiguredPage(supa(), A, 'facebook.com/whatever', A_DOMAIN_ENV)
    expect(res).toMatchObject({ ok: false, reason: 'not_bound_page' })
  })
})
