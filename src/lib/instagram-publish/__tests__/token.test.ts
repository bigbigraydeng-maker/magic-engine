import { describe, expect, it, vi } from 'vitest'
import { getInstagramPublishToken, InstagramPublishTokenError, type InstagramTokenDeps } from '../token'

const NOW = Date.parse('2026-10-20T00:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const BOTH = ['instagram_business_basic', 'instagram_business_content_publish']
const ACCOUNT = '987654321098765432'
const CANARY = 'IGQ-CANARY-SECRET-TOKEN'

type Row = { id: string; account_id: string; access_token_enc: string; token_expiry: string | null; scopes: string[] | null; location_name: string | null }
const row = (over: Partial<Row> = {}): Row => ({
  id: 'conn-1', account_id: ACCOUNT, access_token_enc: 'enc:current', scopes: BOTH, location_name: 'example.syd',
  token_expiry: new Date(NOW + 40 * DAY).toISOString(), ...over,
})

function deps(over: Partial<InstagramTokenDeps> & { rows?: Row[] } = {}): InstagramTokenDeps & { saved: unknown[] } {
  const saved: unknown[] = []
  const { rows, ...rest } = over
  return {
    saved,
    enabled: () => true,
    registeredHandle: vi.fn(async () => 'Example.Syd' as string | null),
    now: () => NOW,
    listActive: vi.fn(async () => rows ?? [row()]),
    decrypt: (enc: string) => enc.replace('enc:', ''),
    encrypt: (value: string) => `enc:${value}`,
    refresh: vi.fn(async () => ({ accessToken: 'refreshed', expiresIn: 60 * 24 * 3600 })),
    saveRefreshed: vi.fn(async (input) => { saved.push(input); return 1 }),
    ...rest,
  }
}
const code = async (p: Promise<unknown>) => p.then(() => 'resolved', (e: unknown) => (e instanceof InstagramPublishTokenError ? e.code : `other:${String(e)}`))

describe('getInstagramPublishToken — gates', () => {
  it('🔴 switch off → refuses, even with a perfectly good publish-capable connection, and reads nothing', async () => {
    const d = deps({ enabled: () => false })
    expect(await code(getInstagramPublishToken('c1', d))).toBe('disabled')
    expect(d.listActive).not.toHaveBeenCalled()
  })
  it('no active connection → not_connected', async () => {
    expect(await code(getInstagramPublishToken('c1', deps({ rows: [] })))).toBe('not_connected')
  })
  it('🔴 two active connections → ambiguous (never picks one)', async () => {
    const d = deps({ rows: [row(), row({ id: 'conn-2', account_id: '111111111111' })] })
    expect(await code(getInstagramPublishToken('c1', d))).toBe('ambiguous')
    expect(d.refresh).not.toHaveBeenCalled()
  })
  it.each([[['instagram_business_basic']], [[]], [null]])('🔴 grant without publish permission %j → needs_reauth', async scopes => {
    expect(await code(getInstagramPublishToken('c1', deps({ rows: [row({ scopes })] })))).toBe('needs_reauth')
  })
  it.each([null, new Date(NOW).toISOString(), new Date(NOW - DAY).toISOString(), 'not-a-date'])('🔴 missing/expired/invalid expiry %s → needs_reauth', async token_expiry => {
    expect(await code(getInstagramPublishToken('c1', deps({ rows: [row({ token_expiry })] })))).toBe('needs_reauth')
  })
  it.each(['', 'abc', '12 34'])('🔴 account id that is not a professional account id (%j) → invalid_account', async account_id => {
    expect(await code(getInstagramPublishToken('c1', deps({ rows: [row({ account_id })] })))).toBe('invalid_account')
  })
  it('lookup failure surfaces as unavailable, not as "not connected"', async () => {
    const d = deps({ listActive: vi.fn(async () => { throw new Error('db down') }) })
    expect(await code(getInstagramPublishToken('c1', d))).toBe('unavailable')
  })
  it('🔴 undecryptable stored value → unavailable, never returns garbage', async () => {
    const d = deps({ decrypt: () => { throw new Error('bad key') } })
    expect(await code(getInstagramPublishToken('c1', d))).toBe('unavailable')
  })
})

describe('getInstagramPublishToken — account must still be the registered one', () => {
  it('🔴 customer re-registered another handle after connecting → account_mismatch (face value of the panel)', async () => {
    const d = deps({ registeredHandle: vi.fn(async () => 'new.handle') })
    expect(await code(getInstagramPublishToken('c1', d))).toBe('account_mismatch')
  })
  it.each([null, '', 'not a handle!'])('🔴 no usable registered handle (%j) → account_mismatch, never "missing means allowed"', async handle => {
    expect(await code(getInstagramPublishToken('c1', deps({ registeredHandle: vi.fn(async () => handle) })))).toBe('account_mismatch')
  })
  it('🔴 connection without a saved username → account_mismatch', async () => {
    expect(await code(getInstagramPublishToken('c1', deps({ rows: [row({ location_name: null })] })))).toBe('account_mismatch')
  })
  it('handle comparison ignores case and a leading @', async () => {
    const d = deps({ registeredHandle: vi.fn(async () => '@EXAMPLE.syd') })
    expect(await getInstagramPublishToken('c1', d)).toMatchObject({ accountId: ACCOUNT })
  })
  it('registered-handle lookup failure → unavailable', async () => {
    const d = deps({ registeredHandle: vi.fn(async () => { throw new Error('db') }) })
    expect(await code(getInstagramPublishToken('c1', d))).toBe('unavailable')
  })
})

describe('getInstagramPublishToken — renewal', () => {
  it('🔴 renewal window edge: 1 ms more than 30 days left → no renewal; exactly 30 days → renews', async () => {
    const outside = deps({ rows: [row({ token_expiry: new Date(NOW + 30 * DAY + 1).toISOString() })] })
    await getInstagramPublishToken('c1', outside)
    expect(outside.refresh).not.toHaveBeenCalled()
    const edge = deps({ rows: [row({ token_expiry: new Date(NOW + 30 * DAY).toISOString() })] })
    await getInstagramPublishToken('c1', edge)
    expect(edge.refresh).toHaveBeenCalledTimes(1)
  })
  it('🔴 saving the renewed value is retried once; a second failure stops the publish', async () => {
    const near = { rows: [row({ token_expiry: new Date(NOW + 3 * DAY).toISOString() })] }
    const flaky = deps({ ...near, saveRefreshed: vi.fn().mockRejectedValueOnce(new Error('blip')).mockResolvedValueOnce(1) })
    expect(await getInstagramPublishToken('c1', flaky)).toMatchObject({ accessToken: 'refreshed' })
    expect(flaky.saveRefreshed).toHaveBeenCalledTimes(2)
    const dead = deps({ ...near, saveRefreshed: vi.fn().mockRejectedValue(new Error('down')) })
    expect(await code(getInstagramPublishToken('c1', dead))).toBe('refresh_save_failed')
    expect(dead.saveRefreshed).toHaveBeenCalledTimes(2)
  })
  it('🔴 after losing the lock, the other writer\'s connection is also checked against the registered handle', async () => {
    const stale = row({ token_expiry: new Date(NOW + 3 * DAY).toISOString() })
    const winner = row({ access_token_enc: 'enc:winner', token_expiry: new Date(NOW + 60 * DAY).toISOString(), location_name: 'someone.else' })
    const list = vi.fn().mockResolvedValueOnce([stale]).mockResolvedValueOnce([winner])
    const d = deps({ listActive: list, saveRefreshed: vi.fn(async () => 0) })
    expect(await code(getInstagramPublishToken('c1', d))).toBe('account_mismatch')
  })
  it('after losing the lock, a re-read that finds the connection revoked/ambiguous/failing is refused, not guessed', async () => {
    const stale = row({ token_expiry: new Date(NOW + 3 * DAY).toISOString() })
    for (const [second, expected] of [[[], 'not_connected'], [[row(), row({ id: 'x' })], 'ambiguous']] as const) {
      const list = vi.fn().mockResolvedValueOnce([stale]).mockResolvedValueOnce(second)
      expect(await code(getInstagramPublishToken('c1', deps({ listActive: list, saveRefreshed: vi.fn(async () => 0) })))).toBe(expected)
    }
    const failing = vi.fn().mockResolvedValueOnce([stale]).mockRejectedValueOnce(new Error('db'))
    expect(await code(getInstagramPublishToken('c1', deps({ listActive: failing, saveRefreshed: vi.fn(async () => 0) })))).toBe('unavailable')
  })
  it('plenty of life left → returns current value, no renewal, no write', async () => {
    const d = deps()
    expect(await getInstagramPublishToken('c1', d)).toEqual({ accessToken: 'current', accountId: ACCOUNT })
    expect(d.refresh).not.toHaveBeenCalled()
    expect(d.saved).toHaveLength(0)
  })
  it('🔴 within 30 days of expiry → renews, saves with the expiry it read as the lock', async () => {
    const expiry = new Date(NOW + 5 * DAY).toISOString() // issued ~55 days ago
    const d = deps({ rows: [row({ token_expiry: expiry })] })
    expect(await getInstagramPublishToken('c1', d)).toEqual({ accessToken: 'refreshed', accountId: ACCOUNT })
    expect(d.refresh).toHaveBeenCalledWith('current')
    expect(d.saved).toEqual([{ id: 'conn-1', expectedExpiry: expiry, accessTokenEnc: 'enc:refreshed', newExpiry: new Date(NOW + 60 * DAY).toISOString() }])
  })
  it('renewal call fails but current value is still valid → uses current value', async () => {
    const d = deps({ rows: [row({ token_expiry: new Date(NOW + 3 * DAY).toISOString() })], refresh: vi.fn(async () => null) })
    expect(await getInstagramPublishToken('c1', d)).toMatchObject({ accessToken: 'current' })
    expect(d.saved).toHaveLength(0)
  })
  it('🔴 renewal fails and the current value has under 15 minutes left → needs_reauth, not a value about to die mid-publish', async () => {
    const d = deps({ rows: [row({ token_expiry: new Date(NOW + 10 * 60 * 1000).toISOString() })], refresh: vi.fn(async () => null) })
    expect(await code(getInstagramPublishToken('c1', d))).toBe('needs_reauth')
  })
  it('renewal fails but 20 minutes remain → still usable', async () => {
    const d = deps({ rows: [row({ token_expiry: new Date(NOW + 20 * 60 * 1000).toISOString() })], refresh: vi.fn(async () => null) })
    expect(await getInstagramPublishToken('c1', d)).toMatchObject({ accessToken: 'current' })
  })
  it('🔴 renewal succeeded but saving it throws → error, new value is not handed out', async () => {
    const d = deps({ rows: [row({ token_expiry: new Date(NOW + 3 * DAY).toISOString() })],
      saveRefreshed: vi.fn(async () => { throw new Error('db down') }) })
    expect(await code(getInstagramPublishToken('c1', d))).toBe('refresh_save_failed')
  })
  it('🔴 lock lost (0 rows updated): re-reads once and uses the other writer\'s value; if still unchanged → error', async () => {
    const stale = row({ token_expiry: new Date(NOW + 3 * DAY).toISOString() })
    const winner = row({ access_token_enc: 'enc:winner', token_expiry: new Date(NOW + 60 * DAY).toISOString() })
    const list = vi.fn().mockResolvedValueOnce([stale]).mockResolvedValueOnce([winner])
    const d1 = deps({ listActive: list, saveRefreshed: vi.fn(async () => 0) })
    expect(await getInstagramPublishToken('c1', d1)).toMatchObject({ accessToken: 'winner' })
    const d2 = deps({ rows: [stale], saveRefreshed: vi.fn(async () => 0) })
    expect(await code(getInstagramPublishToken('c1', d2))).toBe('refresh_conflict')
  })
})

describe('getInstagramPublishToken — default wiring', () => {
  it('🔴 with real defaults and the switch unset, refuses immediately (no database access)', async () => {
    vi.unstubAllEnvs()
    expect(await code(getInstagramPublishToken('c1'))).toBe('disabled')
  })
})

describe('getInstagramPublishToken — secrecy', () => {
  it('🔴 a canary value never appears in a thrown error message', async () => {
    const d = deps({ rows: [row({ token_expiry: new Date(NOW + 3 * DAY).toISOString(), access_token_enc: `enc:${CANARY}` })],
      refresh: vi.fn(async () => { throw new Error(`GET https://graph.instagram.com/refresh_access_token?access_token=${CANARY}`) }),
      saveRefreshed: vi.fn(async () => { throw new Error(`write failed ${CANARY}`) }) })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const err = await getInstagramPublishToken('c1', d).then(() => null, e => e as Error)
    expect(String(err?.message)).not.toContain(CANARY)
    expect(JSON.stringify([log.mock.calls, warn.mock.calls])).not.toContain(CANARY)
    log.mockRestore(); warn.mockRestore()
  })
})
