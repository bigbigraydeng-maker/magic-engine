/**
 * google-ads/creds-loader — tests for the per-client customer_id chain
 *
 * Pins the fallback order:
 *   1. clients.google_ads_customer_id          → 'clients_table'
 *   2. platform_oauth_connections.account_id   → 'platform_oauth_connections'
 *   3. flywheel_actions.payload->>customer_id  → 'flywheel_actions_payload'
 *   4. nothing                                  → 'none' (customer_id: null)
 *
 * A regression that swaps (1) and (2) would make freshly-FDE-set customer_ids
 * silently overridden by stale OAuth-flow values — exactly the kind of
 * surprise this PR is meant to remove.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  resolveCustomerId,
  loadGoogleAdsCredsForClient,
  mergeGoogleAdsAccounts,
  clientOwnsGoogleAdsAccount,
} from '../creds-loader'
import type { SupabaseClient } from '@supabase/supabase-js'

const CLIENT_ID = 'client-uuid-123'

/**
 * Build a Supabase stub that returns the supplied row for each table.
 * Pass `null` (or omit) to simulate "no row" for a given table.
 *
 * Chains modelled:
 *   - clients:                       select → eq → maybeSingle
 *   - platform_oauth_connections:    select → eq → eq → eq → not → limit → maybeSingle
 *   - flywheel_actions:              select → eq → eq → not → order → limit → maybeSingle
 */
function makeSupabase(opts: {
  clientsRow?:               { google_ads_customer_id: string | null } | null
  platformOauthRow?:         { account_id: string | null } | null
  flywheelActionsRow?:       { payload: Record<string, unknown> | null } | null
}) {
  const fluent = (resolvedData: unknown) => {
    const node: any = {
      eq:           () => node,
      not:          () => node,
      order:        () => node,
      limit:        () => node,
      maybeSingle:  () => Promise.resolve({ data: resolvedData, error: null }),
    }
    return node
  }

  return {
    from: (table: string) => {
      let row: unknown
      switch (table) {
        case 'clients':                    row = opts.clientsRow ?? null;         break
        case 'platform_oauth_connections': row = opts.platformOauthRow ?? null;   break
        case 'flywheel_actions':           row = opts.flywheelActionsRow ?? null; break
        default:                           row = null
      }
      return { select: () => fluent(row) }
    },
  } as any
}

describe('resolveCustomerId — fallback chain', () => {
  it('returns clients_table source when clients.google_ads_customer_id is set', async () => {
    const sb = makeSupabase({
      clientsRow:        { google_ads_customer_id: '1234567890' },
      platformOauthRow:  { account_id: 'should-not-win' },
      flywheelActionsRow:{ payload: { customer_id: 'should-not-win-either' } },
    })
    const out = await resolveCustomerId(sb, CLIENT_ID)
    expect(out).toEqual({ customer_id: '1234567890', source: 'clients_table' })
  })

  it('falls back to platform_oauth_connections when clients column is null', async () => {
    const sb = makeSupabase({
      clientsRow:        { google_ads_customer_id: null },
      platformOauthRow:  { account_id: '9999999999' },
    })
    const out = await resolveCustomerId(sb, CLIENT_ID)
    expect(out).toEqual({ customer_id: '9999999999', source: 'platform_oauth_connections' })
  })

  it('falls back to flywheel_actions.payload.customer_id when both clients + platform_oauth are empty', async () => {
    const sb = makeSupabase({
      clientsRow:        null,
      platformOauthRow:  null,
      flywheelActionsRow:{ payload: { customer_id: '7777777777', other: 'noise' } },
    })
    const out = await resolveCustomerId(sb, CLIENT_ID)
    expect(out).toEqual({ customer_id: '7777777777', source: 'flywheel_actions_payload' })
  })

  it('returns { customer_id: null, source: none } when nothing is wired up', async () => {
    const sb = makeSupabase({})
    const out = await resolveCustomerId(sb, CLIENT_ID)
    expect(out).toEqual({ customer_id: null, source: 'none' })
  })

  it('trims whitespace and ignores empty-string customer_ids', async () => {
    const sb = makeSupabase({
      clientsRow:        { google_ads_customer_id: '   ' },        // whitespace only — must NOT win
      platformOauthRow:  { account_id: '  4444444444  ' },         // valid after trim
    })
    const out = await resolveCustomerId(sb, CLIENT_ID)
    expect(out).toEqual({ customer_id: '4444444444', source: 'platform_oauth_connections' })
  })

  it('skips a layer cleanly when its query throws (non-fatal, falls through)', async () => {
    const throwingClients = {
      from: (table: string) => {
        if (table === 'clients') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () => Promise.reject(new Error('boom: clients query died')),
              }),
            }),
          }
        }
        return makeSupabase({ platformOauthRow: { account_id: '5555555555' } }).from(table)
      },
    } as any
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = await resolveCustomerId(throwingClients, CLIENT_ID)
    expect(out).toEqual({ customer_id: '5555555555', source: 'platform_oauth_connections' })
    expect(consoleErr).toHaveBeenCalled()
  })
})

describe('loadGoogleAdsCredsForClient — combines resolver + env loader', () => {
  beforeEach(() => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'dev-token'
    process.env.GOOGLE_ADS_CLIENT_ID       = 'cid'
    process.env.GOOGLE_ADS_CLIENT_SECRET   = 'cs'
    process.env.GOOGLE_ADS_REFRESH_TOKEN   = 'rt'
    delete process.env.GOOGLE_ADS_MANAGER_ID
  })

  it('returns null when no customer_id is resolvable (no connection wired)', async () => {
    const sb = makeSupabase({})
    const creds = await loadGoogleAdsCredsForClient(sb, CLIENT_ID)
    expect(creds).toBeNull()
  })

  it('returns null when customer_id resolves but env vars are missing', async () => {
    delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN
    const sb = makeSupabase({ clientsRow: { google_ads_customer_id: '1234567890' } })
    const creds = await loadGoogleAdsCredsForClient(sb, CLIENT_ID)
    expect(creds).toBeNull()
  })

  it('returns full GoogleAdsCreds when customer_id + env vars are both present', async () => {
    const sb = makeSupabase({ clientsRow: { google_ads_customer_id: '1234567890' } })
    const creds = await loadGoogleAdsCredsForClient(sb, CLIENT_ID)
    expect(creds).toEqual({
      developerToken: 'dev-token',
      clientId:       'cid',
      clientSecret:   'cs',
      refreshToken:   'rt',
      customerId:     '1234567890',
      managerCustomerId: undefined,
    })
  })
})

describe('mergeGoogleAdsAccounts — batch form for the daily cron', () => {
  it('lists a client that only has the settings-page id', () => {
    expect(mergeGoogleAdsAccounts([{ id: 'c1', google_ads_customer_id: '1234567890' }], []))
      .toEqual([{ client_id: 'c1', account_id: '1234567890' }])
  })

  it('lets the settings-page id win over an OAuth row for the same client', () => {
    expect(mergeGoogleAdsAccounts(
      [{ id: 'c1', google_ads_customer_id: '111' }],
      [{ client_id: 'c1', account_id: '222' }, { client_id: 'c2', account_id: '333' }],
    )).toEqual([
      { client_id: 'c1', account_id: '111' },
      { client_id: 'c2', account_id: '333' },
    ])
  })

  it('drops an id claimed by two clients rather than guess whose it is', () => {
    expect(mergeGoogleAdsAccounts(
      [
        { id: 'c1', google_ads_customer_id: '1234567890' },
        { id: 'c2', google_ads_customer_id: '123-456-7890' },
        { id: 'c3', google_ads_customer_id: '5555555555' },
      ],
      [],
    )).toEqual([{ client_id: 'c3', account_id: '5555555555' }])
  })

  it('strips dashes and skips blank or missing ids', () => {
    expect(mergeGoogleAdsAccounts(
      [
        { id: 'c1', google_ads_customer_id: '123-456-7890' },
        { id: 'c2', google_ads_customer_id: '   ' },
        { id: 'c3', google_ads_customer_id: null },
        { id: 'c4' },
        { id: 'c5', google_ads_customer_id: 'not-an-id' },
      ],
      [],
    )).toEqual([{ client_id: 'c1', account_id: '1234567890' }])
  })
})

describe('clientOwnsGoogleAdsAccount — tenant boundary for a shared credential', () => {
  /** Stub for `.from('clients').select('id').eq('google_ads_customer_id', id)`. */
  function clientsStub(result: { data: unknown; error: unknown } | Error) {
    const eq = result instanceof Error
      ? vi.fn().mockRejectedValue(result)
      : vi.fn().mockResolvedValue(result)
    const from = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ eq }) })
    return { supabase: { from } as unknown as SupabaseClient, from, eq }
  }

  it('accepts the account when this client is its only holder, in either display form', async () => {
    const { supabase, from, eq } = clientsStub({ data: [{ id: CLIENT_ID }], error: null })
    expect(await clientOwnsGoogleAdsAccount(supabase, CLIENT_ID, '1234567890')).toBe(true)
    expect(await clientOwnsGoogleAdsAccount(supabase, CLIENT_ID, '123-456-7890')).toBe(true)
    expect(from).toHaveBeenCalledWith('clients')
    // Always looked up in digits-only form, whatever the caller sent.
    expect(eq).toHaveBeenNthCalledWith(1, 'google_ads_customer_id', '1234567890')
    expect(eq).toHaveBeenNthCalledWith(2, 'google_ads_customer_id', '1234567890')
  })

  it("rejects an account registered to another client", async () => {
    const { supabase } = clientsStub({ data: [{ id: 'someone-else' }], error: null })
    expect(await clientOwnsGoogleAdsAccount(supabase, CLIENT_ID, '9999999999')).toBe(false)
  })

  it('rejects an account nobody has registered', async () => {
    const { supabase } = clientsStub({ data: [], error: null })
    expect(await clientOwnsGoogleAdsAccount(supabase, CLIENT_ID, '1234567890')).toBe(false)
  })

  it('rejects an account held by two clients, even when this client is one of them', async () => {
    const { supabase } = clientsStub({ data: [{ id: CLIENT_ID }, { id: 'someone-else' }], error: null })
    expect(await clientOwnsGoogleAdsAccount(supabase, CLIENT_ID, '1234567890')).toBe(false)
  })

  it('fails closed when the lookup errors, returns nothing, or throws', async () => {
    const errored = clientsStub({ data: [{ id: CLIENT_ID }], error: { message: 'boom' } })
    expect(await clientOwnsGoogleAdsAccount(errored.supabase, CLIENT_ID, '1234567890')).toBe(false)
    const empty = clientsStub({ data: null, error: null })
    expect(await clientOwnsGoogleAdsAccount(empty.supabase, CLIENT_ID, '1234567890')).toBe(false)
    const thrown = clientsStub(new Error('network'))
    expect(await clientOwnsGoogleAdsAccount(thrown.supabase, CLIENT_ID, '1234567890')).toBe(false)
  })

  it('rejects a malformed id without querying', async () => {
    const { supabase, from } = clientsStub({ data: [{ id: CLIENT_ID }], error: null })
    expect(await clientOwnsGoogleAdsAccount(supabase, CLIENT_ID, '')).toBe(false)
    expect(await clientOwnsGoogleAdsAccount(supabase, CLIENT_ID, '12 OR 1=1')).toBe(false)
    expect(await clientOwnsGoogleAdsAccount(supabase, CLIENT_ID, 1234567890)).toBe(false)
    expect(from).not.toHaveBeenCalled()
  })
})
