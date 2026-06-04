import { describe, it, expect } from 'vitest'
import {
  ACCESS_TYPE_VALUES,
  ACCESS_TYPES_DASHBOARD,
  ACCESS_TYPES_PAID,
  ACCESS_TYPES_PORTAL,
  tierForAccessType,
} from '../access-types'

describe('ACCESS_TYPE_VALUES', () => {
  it('matches the live DB CHECK constraint (20260626000002)', () => {
    // If you add a new value here, also update the migration's CHECK
    // constraint and back-fill tierForAccessType.
    expect([...ACCESS_TYPE_VALUES].sort()).toEqual(
      ['both', 'client', 'dashboard', 'fde', 'portal', 'self_serve']
    )
  })
})

describe('tierForAccessType', () => {
  it('paid tiers map to paid_client', () => {
    expect(tierForAccessType('client')).toBe('paid_client')
    expect(tierForAccessType('dashboard')).toBe('paid_client')
    expect(tierForAccessType('fde')).toBe('paid_client')
    expect(tierForAccessType('both')).toBe('paid_client')
  })

  it('self_serve stays in its own tier', () => {
    expect(tierForAccessType('self_serve')).toBe('self_serve')
  })

  it('portal maps to portal_only — NOT into dashboard tier', () => {
    expect(tierForAccessType('portal')).toBe('portal_only')
  })

  it('unknown values fail closed to portal_only (no /dashboard access)', () => {
    expect(tierForAccessType('made_up_value')).toBe('portal_only')
    expect(tierForAccessType('')).toBe('portal_only')
  })
})

describe('whitelist arrays', () => {
  it('ACCESS_TYPES_DASHBOARD includes every value whose tier can reach /dashboard', () => {
    // All values that map to admin/paid_client/self_serve should be reachable.
    // admin is env-driven (not in this list); only DB-stored values count here.
    const expected = ACCESS_TYPE_VALUES.filter(v =>
      tierForAccessType(v) === 'paid_client' || tierForAccessType(v) === 'self_serve'
    )
    expect([...ACCESS_TYPES_DASHBOARD].sort()).toEqual([...expected].sort())
  })

  it('ACCESS_TYPES_PAID excludes self_serve', () => {
    expect(ACCESS_TYPES_PAID).not.toContain('self_serve')
  })

  it('ACCESS_TYPES_PAID matches the paid_client tier exactly', () => {
    const expected = ACCESS_TYPE_VALUES.filter(v => tierForAccessType(v) === 'paid_client')
    expect([...ACCESS_TYPES_PAID].sort()).toEqual([...expected].sort())
  })

  it('ACCESS_TYPES_PORTAL is exactly portal + both (the legacy /portal-eligible set)', () => {
    expect([...ACCESS_TYPES_PORTAL].sort()).toEqual(['both', 'portal'])
  })

  it('every value in ACCESS_TYPES_DASHBOARD is a valid AccessType', () => {
    for (const v of ACCESS_TYPES_DASHBOARD) {
      expect(ACCESS_TYPE_VALUES).toContain(v)
    }
  })
})
