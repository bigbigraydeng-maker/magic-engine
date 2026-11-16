/**
 * Link tracking of a named letter on 127's real tagger (production code; the settings read and the token store are
 * faked): the first attempt tokens and stores, a replay puts the SAME tokens back without storing anything, and any
 * failure leaves the letter untracked instead of holding it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const settings = vi.hoisted(() => ({ read: vi.fn() }))
const inserts = vi.hoisted(() => ({ rows: [] as unknown[], error: null as { message: string } | null }))
vi.mock('@/lib/crm/email-templates/settings-store', () => ({ loadEmailSettings: settings.read }))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      insert: async (rows: unknown[]) => {
        inserts.rows.push(...rows)
        return { error: inserts.error }
      },
    }),
  },
}))

import { createLinkTracking } from '../named-letter-deps-prod'
import { storedTracking } from '../letter-body'

const BODY = 'Hi Jane,\nHere is the 2027 catalogue: https://www.example.com/catalogue-2027\nBaker'
const args = { clientId: 'c', contactId: 'b', requestId: 'e0000000-0000-4000-8000-000000000001', body: BODY }

beforeEach(() => {
  settings.read.mockReset()
  settings.read.mockResolvedValue({ kind: 'ok', settings: { providers: { linkTracking: { hosts: ['www.example.com'] } } } })
  inserts.rows = []
  inserts.error = null
})

describe('createLinkTracking', () => {
  it('🔴 first attempt: tokens the tracked link, stores the token under the ledger row id, and says which token', async () => {
    const out = await createLinkTracking().tag(args)
    expect(out.tagged).toBe(1)
    expect(out.tokens).toHaveLength(1)
    expect(out.body).toContain(`https://www.example.com/catalogue-2027?me=${out.tokens[0]}`)
    expect(inserts.rows).toEqual([expect.objectContaining({ token: out.tokens[0], request_id: args.requestId, url: 'https://www.example.com/catalogue-2027' })])
  })

  it('🔴 a replay puts the same tokens back, byte for byte, and stores nothing', async () => {
    const tracking = createLinkTracking()
    const first = await tracking.tag(args)
    inserts.rows = []
    expect(await tracking.retag({ clientId: 'c', body: BODY, tokens: first.tokens })).toEqual({ ok: true, body: first.body })
    expect(inserts.rows).toEqual([])
  })

  it('a replay that cannot rebuild the same text says so (the sender then never sends it again)', async () => {
    const tracking = createLinkTracking()
    expect(await tracking.retag({ clientId: 'c', body: BODY, tokens: [] })).toEqual({ ok: false })
    expect(await tracking.retag({ clientId: 'c', body: BODY, tokens: ['Aaaaaaaaaaa1', 'Bbbbbbbbbbb2'] })).toEqual({ ok: false })
    settings.read.mockResolvedValue({ kind: 'ok', settings: { providers: {} } })
    expect(await tracking.retag({ clientId: 'c', body: BODY, tokens: ['Aaaaaaaaaaa1'] })).toEqual({ ok: false })
  })

  it('🔴 unreadable settings or a store that fails: the original text, untracked, with a warning (never a throw)', async () => {
    settings.read.mockRejectedValue(new Error('db down'))
    expect(await createLinkTracking().tag(args)).toEqual({ body: BODY, tagged: 0, tokens: [], warning: 'link_tracking_failed' })
    settings.read.mockResolvedValue({ kind: 'ok', settings: { providers: { linkTracking: { hosts: ['www.example.com'] } } } })
    inserts.error = { message: 'unique violation' }
    expect(await createLinkTracking().tag(args)).toEqual({ body: BODY, tagged: 0, tokens: [], warning: 'link_tracking_failed' })
  })
})

describe('storedTracking (what an earlier attempt wrote on the row)', () => {
  const good = { tagged: 1, tokens: ['Aaaaaaaaaaa1'], final_text_sha256: 'f'.repeat(64), warning: null }
  it('reads a well-formed record; anything else is not a record', () => {
    expect(storedTracking({ link_tracking: good })).toEqual(good)
    expect(storedTracking({})).toBeNull()
    expect(storedTracking({ link_tracking: { ...good, tagged: 2 } })).toBeNull()
    expect(storedTracking({ link_tracking: { ...good, tokens: ['short'] } })).toBeNull()
    expect(storedTracking({ link_tracking: { ...good, final_text_sha256: 'x' } })).toBeNull()
  })
})
