/**
 * AD-SEC-4 ownership rules for staff-provisioned Meta tokens.
 *
 * The attack: `clients.domain` is written by public self-serve signup and the
 * onboarding wizard, and `META_SYSTEM_USER_TOKEN_<DOMAIN_KEY>` was handed to
 * whichever row carried that domain. Each case below is a way to end up running
 * on another client's token, or to knock a real client off its own.
 */

import { describe, expect, it } from 'vitest'
import { pickScopedMetaToken, type TokenOwnerRow } from '../token-selection'

const ENV = {
  META_SYSTEM_USER_TOKEN_CTSTOURS_CO_NZ: 'cts-token',
  META_SYSTEM_USER_TOKEN_PAGE_1616575215312482: 'cts-page-token',
}

const row = (over: Partial<TokenOwnerRow> & { id: string }): TokenOwnerRow => ({
  domain: null, facebook_page_id: null, created_at: '2026-01-01T00:00:00Z', source: 'fde', ...over,
})

const CTS = row({ id: 'cts', domain: 'ctstours.co.nz', facebook_page_id: '1616575215312482' })

describe('domain key → earliest staff-created client only', () => {
  it('the owner keeps its token when a newer client copies the domain', () => {
    const copy = row({ id: 'copy', domain: 'ctstours.co.nz', created_at: '2026-09-01T00:00:00Z' })
    expect(pickScopedMetaToken(CTS, [CTS, copy], ENV)).toEqual({ token: 'cts-token', source: 'client_domain' })
    expect(pickScopedMetaToken(copy, [CTS, copy], ENV)).toBeNull()
  })

  it('a self-serve row never owns a key — even as the only / oldest holder (pre-registered squat)', () => {
    const squat = row({ id: 'squat', domain: 'ctstours.co.nz', created_at: '2020-01-01T00:00:00Z', source: 'self_serve' })
    expect(pickScopedMetaToken(squat, [squat], ENV)).toBeNull()
    // …and does not block the real, newer staff-created client either
    const real = row({ id: 'real', domain: 'ctstours.co.nz', created_at: '2026-09-10T00:00:00Z' })
    expect(pickScopedMetaToken(real, [squat, real], ENV)?.token).toBe('cts-token')
  })

  it('different spellings that map to the same env key are the same key', () => {
    for (const spelling of ['CTSTOURS.CO.NZ', 'ctstours-co.nz', 'ctstours_co_nz', 'ctſtours.co.nz']) {
      const copy = row({ id: 'copy', domain: spelling, created_at: '2026-09-01T00:00:00Z' })
      expect(pickScopedMetaToken(copy, [CTS, copy], ENV)).toBeNull()
    }
  })

  it('same created_at → lowest id wins, exactly one owner', () => {
    const a = row({ id: 'a', domain: 'ctstours.co.nz' })
    const b = row({ id: 'b', domain: 'ctstours.co.nz' })
    expect(pickScopedMetaToken(a, [a, b], ENV)?.token).toBe('cts-token')
    expect(pickScopedMetaToken(b, [a, b], ENV)).toBeNull()
  })

  it('an unparseable created_at never makes two rows both "older"', () => {
    const a = row({ id: 'a', domain: 'ctstours.co.nz', created_at: 'garbage' })
    const b = row({ id: 'b', domain: 'ctstours.co.nz', created_at: 'also garbage' })
    const owners = [a, b].filter((c) => pickScopedMetaToken(c, [a, b], ENV) !== null)
    expect(owners).toHaveLength(1)
  })
})

describe('page key → only when no other client carries the Page', () => {
  it('sole holder gets the Page token', () => {
    const noDomain = row({ id: 'kiteroa', facebook_page_id: '1616575215312482' })
    expect(pickScopedMetaToken(noDomain, [noDomain], ENV)).toEqual({ token: 'cts-page-token', source: 'client_page' })
  })

  it('a Page on two clients → neither gets the Page token', () => {
    const a = row({ id: 'a', facebook_page_id: '1616575215312482' })
    const b = row({ id: 'b', facebook_page_id: '1616575215312482', created_at: '2027-01-01T00:00:00Z' })
    expect(pickScopedMetaToken(a, [a, b], ENV)).toBeNull()
    expect(pickScopedMetaToken(b, [a, b], ENV)).toBeNull()
  })
})
