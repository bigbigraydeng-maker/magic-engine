import { describe, it, expect } from 'vitest'
import {
  SCHEDULED_GRANT_KEY,
  SCHEDULED_CLAIM_LEASE_MS,
  readGrant,
  withGrant,
  nzToday,
  checkGrant,
  claimedGrant,
  isLeaseExpired,
  revokedGrant,
  grantWithStatus,
  type ScheduledGrant,
} from './scheduled-grant'

function grant(over: Partial<ScheduledGrant> = {}): ScheduledGrant {
  return {
    status: 'armed',
    work_order_id: 'wo_1',
    publish_on: '2026-11-09',
    fingerprint: 'fp1',
    card_run_id: 'cr_1',
    authorized_by: 'boss@x.com',
    authorized_at: '2026-11-01T00:00:00.000Z',
    catalog_version_at_approval: 3,
    ...over,
  }
}

const alwaysApprover = () => true
const neverApprover = () => false

describe('readGrant / withGrant', () => {
  it('round-trips through withGrant', () => {
    const g = grant()
    const payload = withGrant({ other: 'keep' }, g)
    expect(readGrant(payload)).toEqual(g)
  })

  it('preserves other payload keys', () => {
    const payload = withGrant({ a: 1, b: 'two' }, grant())
    expect(payload.a).toBe(1)
    expect(payload.b).toBe('two')
    expect(payload[SCHEDULED_GRANT_KEY]).toBeDefined()
  })

  it('returns null for malformed grants', () => {
    expect(readGrant({})).toBeNull()
    expect(readGrant({ [SCHEDULED_GRANT_KEY]: 'nope' })).toBeNull()
    expect(readGrant({ [SCHEDULED_GRANT_KEY]: { ...grant(), publish_on: '2026/11/09' } })).toBeNull()
    expect(readGrant({ [SCHEDULED_GRANT_KEY]: { ...grant(), fingerprint: '' } })).toBeNull()
    expect(readGrant({ [SCHEDULED_GRANT_KEY]: { ...grant(), status: 'bogus' } })).toBeNull()
  })

  it('defaults missing catalog_version_at_approval to null', () => {
    const raw = { ...grant() } as Record<string, unknown>
    delete raw.catalog_version_at_approval
    const parsed = readGrant({ [SCHEDULED_GRANT_KEY]: raw })
    expect(parsed?.catalog_version_at_approval).toBeNull()
  })
})

describe('nzToday', () => {
  it('returns the NZ calendar date', () => {
    expect(nzToday(new Date('2026-11-08T12:00:00Z'))).toBe('2026-11-09')
  })
})

describe('checkGrant', () => {
  const base = {
    today: '2026-11-09',
    currentPublishOn: '2026-11-09',
    currentFingerprint: 'fp1',
    isApprover: alwaysApprover,
  }

  it('ok when everything matches on the day', () => {
    expect(checkGrant({ ...base, grant: grant() })).toEqual({ ok: true })
  })

  it('no_grant when grant is null', () => {
    expect(checkGrant({ ...base, grant: null })).toEqual({ ok: false, next: null, reason: 'no_grant' })
  })

  it('status checked first: stale status + past day → grant_stale', () => {
    const g = grant({ status: 'stale', publish_on: '2026-11-01' })
    expect(checkGrant({ ...base, grant: g })).toEqual({ ok: false, next: null, reason: 'grant_stale' })
  })

  it('day before → not_today with next null', () => {
    const g = grant({ publish_on: '2026-11-10' })
    expect(checkGrant({ ...base, grant: g })).toEqual({ ok: false, next: null, reason: 'not_today' })
  })

  it('day after → missed', () => {
    const g = grant({ publish_on: '2026-11-08' })
    expect(checkGrant({ ...base, grant: g })).toEqual({ ok: false, next: 'missed', reason: 'missed_day' })
  })

  it('publish day changed → stale', () => {
    expect(checkGrant({ ...base, grant: grant(), currentPublishOn: '2026-11-10' })).toEqual({
      ok: false, next: 'stale', reason: 'publish_day_changed',
    })
  })

  it('content changed → stale', () => {
    expect(checkGrant({ ...base, grant: grant(), currentFingerprint: 'fp2' })).toEqual({
      ok: false, next: 'stale', reason: 'content_changed',
    })
  })

  it('approver no longer admin → stale', () => {
    expect(checkGrant({ ...base, grant: grant(), isApprover: neverApprover })).toEqual({
      ok: false, next: 'stale', reason: 'approver_not_admin',
    })
  })
})

describe('claimedGrant', () => {
  it('sets claim fields and keeps authorized_by', () => {
    const now = new Date('2026-11-09T01:00:00.000Z')
    const c = claimedGrant(grant(), 'att_1', 'exec@x.com', now)
    expect(c.status).toBe('claimed')
    expect(c.attempt_id).toBe('att_1')
    expect(c.claimed_at).toBe(now.toISOString())
    expect(c.executed_by).toBe('exec@x.com')
    expect(c.authorized_by).toBe('boss@x.com')
  })
})

describe('isLeaseExpired', () => {
  const claimedAt = new Date('2026-11-09T01:00:00.000Z')
  const claimed = claimedGrant(grant(), 'att_1', 'exec@x.com', claimedAt)

  it('false before lease elapses', () => {
    const before = new Date(claimedAt.getTime() + SCHEDULED_CLAIM_LEASE_MS - 1)
    expect(isLeaseExpired(claimed, before)).toBe(false)
  })

  it('true at/after lease elapses', () => {
    const at = new Date(claimedAt.getTime() + SCHEDULED_CLAIM_LEASE_MS)
    expect(isLeaseExpired(claimed, at)).toBe(true)
  })

  it('false for non-claimed status', () => {
    expect(isLeaseExpired(grant(), new Date('2030-01-01T00:00:00Z'))).toBe(false)
  })
})

describe('revokedGrant', () => {
  const now = new Date('2026-11-09T01:00:00.000Z')

  it('armed → revoked', () => {
    const r = revokedGrant(grant(), 'admin@x.com', now)
    expect(r?.status).toBe('revoked')
    expect(r?.reason).toBe('revoked_by:admin@x.com')
    expect(r?.updated_at).toBe(now.toISOString())
  })

  it('claimed → null', () => {
    expect(revokedGrant(grant({ status: 'claimed' }), 'admin@x.com', now)).toBeNull()
  })

  it('consumed → null', () => {
    expect(revokedGrant(grant({ status: 'consumed' }), 'admin@x.com', now)).toBeNull()
  })

  it('null → null', () => {
    expect(revokedGrant(null, 'admin@x.com', now)).toBeNull()
  })
})

describe('grantWithStatus', () => {
  it('sets status, reason, updated_at', () => {
    const now = new Date('2026-11-09T01:00:00.000Z')
    const g = grantWithStatus(grant(), 'failed', 'boom', now)
    expect(g.status).toBe('failed')
    expect(g.reason).toBe('boom')
    expect(g.updated_at).toBe(now.toISOString())
  })
})
