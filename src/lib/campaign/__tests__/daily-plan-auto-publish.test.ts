import { describe, expect, it } from 'vitest'
import {
  AUTO_PUBLISH_DEFAULT_EXPIRY_DAYS,
  AUTO_PUBLISH_MAX_EXPIRY_DAYS,
  AUTO_PUBLISH_MAX_PER_DAY_CEILING,
  CampaignDailyAutoPublishAuthorizeCommandSchema,
  CampaignDailyAutoPublishRevokeCommandSchema,
  computeExpiry,
  judgeAuthorization,
  remainingAuthorizedDates,
  type AutoPublishAuthorization,
} from '../daily-plan-auto-publish'

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000001'
const CAMPAIGN_ID = 'c0000000-0000-0000-0000-000000000002'
const PLAN_ID = 'c0000000-0000-0000-0000-000000000003'
const REVIEW_REVISION = 'c0000000-0000-0000-0000-000000000004'
const USER_ID = 'c0000000-0000-0000-0000-000000000005'
const PLAN_REVISION = '2026-09-01T00:00:00.000Z'
const PAGE_ID = '1234567890'

function authorizeCommand(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    client_id: CLIENT_ID,
    campaign_id: CAMPAIGN_ID,
    plan_id: PLAN_ID,
    plan_revision: PLAN_REVISION,
    review_revision: REVIEW_REVISION,
    page_id: PAGE_ID,
    dates: ['2026-09-04'],
    ...overrides,
  }
}

function authorization(overrides: Partial<AutoPublishAuthorization> = {}): AutoPublishAuthorization {
  return {
    id: 'c0000000-0000-0000-0000-0000000000aa',
    request_id: 'c0000000-0000-0000-0000-0000000000bb',
    client_id: CLIENT_ID,
    campaign_id: CAMPAIGN_ID,
    plan_id: PLAN_ID,
    plan_revision: PLAN_REVISION,
    review_revision: REVIEW_REVISION,
    page_id: PAGE_ID,
    dates: ['2026-09-04'],
    lifted_dates: [],
    max_per_day: 1,
    authorized_by_email: 'ops@example.com',
    authorized_by_user_id: USER_ID,
    authorized_at: '2026-09-01T00:00:00.000Z',
    activated_at: '2026-09-01T00:00:05.000Z',
    expires_at: '2026-09-15T00:00:00.000Z',
    revoked_at: null,
    revoked_by_email: null,
    revoked_reason: null,
    ...overrides,
  }
}

function current(overrides: Partial<{ planId: string; planRevision: string; reviewRevision: string; now: Date }> = {}) {
  return {
    planId: PLAN_ID,
    planRevision: PLAN_REVISION,
    reviewRevision: REVIEW_REVISION,
    now: new Date('2026-09-05T00:00:00.000Z'),
    ...overrides,
  }
}

describe('CampaignDailyAutoPublishAuthorizeCommandSchema', () => {
  it('applies defaults: max_per_day 1, expires_in_days 14, confirm false', () => {
    const parsed = CampaignDailyAutoPublishAuthorizeCommandSchema.parse(authorizeCommand())
    expect(parsed.max_per_day).toBe(1)
    expect(parsed.expires_in_days).toBe(AUTO_PUBLISH_DEFAULT_EXPIRY_DAYS)
    expect(parsed.confirm).toBe(false)
  })

  it('accepts an explicit max_per_day at the ceiling', () => {
    const parsed = CampaignDailyAutoPublishAuthorizeCommandSchema.parse(
      authorizeCommand({ max_per_day: AUTO_PUBLISH_MAX_PER_DAY_CEILING }),
    )
    expect(parsed.max_per_day).toBe(AUTO_PUBLISH_MAX_PER_DAY_CEILING)
  })

  it('rejects max_per_day above the ceiling', () => {
    expect(() =>
      CampaignDailyAutoPublishAuthorizeCommandSchema.parse(
        authorizeCommand({ max_per_day: AUTO_PUBLISH_MAX_PER_DAY_CEILING + 1 }),
      ),
    ).toThrow()
  })

  it('rejects an empty dates array', () => {
    expect(() => CampaignDailyAutoPublishAuthorizeCommandSchema.parse(authorizeCommand({ dates: [] }))).toThrow()
  })

  it('rejects duplicate dates', () => {
    expect(() =>
      CampaignDailyAutoPublishAuthorizeCommandSchema.parse(
        authorizeCommand({ dates: ['2026-09-04', '2026-09-04'] }),
      ),
    ).toThrow()
  })

  it('rejects a non-numeric page id', () => {
    expect(() =>
      CampaignDailyAutoPublishAuthorizeCommandSchema.parse(authorizeCommand({ page_id: 'page-abc' })),
    ).toThrow()
  })

  it('rejects expires_in_days above the ceiling', () => {
    expect(() =>
      CampaignDailyAutoPublishAuthorizeCommandSchema.parse(
        authorizeCommand({ expires_in_days: AUTO_PUBLISH_MAX_EXPIRY_DAYS + 1 }),
      ),
    ).toThrow()
  })
})

describe('CampaignDailyAutoPublishRevokeCommandSchema', () => {
  it('accepts a non-empty reason', () => {
    const parsed = CampaignDailyAutoPublishRevokeCommandSchema.parse({
      client_id: CLIENT_ID,
      campaign_id: CAMPAIGN_ID,
      plan_id: PLAN_ID,
      reason: 'client asked to pause',
    })
    expect(parsed.reason).toBe('client asked to pause')
  })

  it('rejects an empty reason', () => {
    expect(() =>
      CampaignDailyAutoPublishRevokeCommandSchema.parse({
        client_id: CLIENT_ID,
        campaign_id: CAMPAIGN_ID,
        plan_id: PLAN_ID,
        reason: '',
      }),
    ).toThrow()
  })

  it('rejects a whitespace-only reason', () => {
    expect(() =>
      CampaignDailyAutoPublishRevokeCommandSchema.parse({
        client_id: CLIENT_ID,
        campaign_id: CAMPAIGN_ID,
        plan_id: PLAN_ID,
        reason: '   ',
      }),
    ).toThrow()
  })
})

describe('judgeAuthorization — activation', () => {
  it('🔴 a grant that was never armed (no activation) is NOT_ACTIVATED, not active', () => {
    expect(judgeAuthorization(authorization({ activated_at: null }), current())).toEqual({ active: false, reason: 'NOT_ACTIVATED' })
  })

  it('revoked wins over not-activated', () => {
    expect(
      judgeAuthorization(authorization({ activated_at: null, revoked_at: '2026-09-02T00:00:00.000Z' }), current()),
    ).toEqual({ active: false, reason: 'REVOKED' })
  })
})

describe('judgeAuthorization', () => {
  it('is active for a matching, unexpired, unrevoked grant', () => {
    expect(judgeAuthorization(authorization(), current())).toEqual({ active: true })
  })

  it('reports REVOKED when revoked_at is set', () => {
    const verdict = judgeAuthorization(
      authorization({ revoked_at: '2026-09-02T00:00:00.000Z', revoked_reason: 'pause' }),
      current(),
    )
    expect(verdict).toEqual({ active: false, reason: 'REVOKED' })
  })

  it('reports PLAN_CHANGED when the plan id differs', () => {
    const verdict = judgeAuthorization(authorization(), current({ planId: 'c0000000-0000-0000-0000-0000000000ff' }))
    expect(verdict).toEqual({ active: false, reason: 'PLAN_CHANGED' })
  })

  it('reports PLAN_CHANGED when the plan revision differs', () => {
    const verdict = judgeAuthorization(
      authorization(),
      current({ planRevision: '2026-09-02T00:00:00.000Z' }),
    )
    expect(verdict).toEqual({ active: false, reason: 'PLAN_CHANGED' })
  })

  it('reports PLAN_CHANGED when the review revision differs', () => {
    const verdict = judgeAuthorization(
      authorization(),
      current({ reviewRevision: 'c0000000-0000-0000-0000-0000000000ff' }),
    )
    expect(verdict).toEqual({ active: false, reason: 'PLAN_CHANGED' })
  })

  it('reports EXPIRED when now equals expires_at', () => {
    const verdict = judgeAuthorization(
      authorization({ expires_at: '2026-09-05T00:00:00.000Z' }),
      current({ now: new Date('2026-09-05T00:00:00.000Z') }),
    )
    expect(verdict).toEqual({ active: false, reason: 'EXPIRED' })
  })

  it('reports EXPIRED when now is past expires_at', () => {
    const verdict = judgeAuthorization(
      authorization({ expires_at: '2026-09-04T00:00:00.000Z' }),
      current({ now: new Date('2026-09-05T00:00:00.000Z') }),
    )
    expect(verdict).toEqual({ active: false, reason: 'EXPIRED' })
  })

  it('reports EXPIRED for an unparseable expires_at (fails closed)', () => {
    const verdict = judgeAuthorization(authorization({ expires_at: 'not-a-date' }), current())
    expect(verdict).toEqual({ active: false, reason: 'EXPIRED' })
  })

  it('checks REVOKED before EXPIRED', () => {
    const verdict = judgeAuthorization(
      authorization({ revoked_at: '2026-09-02T00:00:00.000Z', expires_at: '2026-09-04T00:00:00.000Z' }),
      current({ now: new Date('2026-09-05T00:00:00.000Z') }),
    )
    expect(verdict).toEqual({ active: false, reason: 'REVOKED' })
  })

  it('checks REVOKED before PLAN_CHANGED', () => {
    const verdict = judgeAuthorization(
      authorization({ revoked_at: '2026-09-02T00:00:00.000Z' }),
      current({ planId: 'c0000000-0000-0000-0000-0000000000ff' }),
    )
    expect(verdict).toEqual({ active: false, reason: 'REVOKED' })
  })

  it('checks PLAN_CHANGED before EXPIRED', () => {
    const verdict = judgeAuthorization(
      authorization({ expires_at: '2026-09-04T00:00:00.000Z' }),
      current({ planId: 'c0000000-0000-0000-0000-0000000000ff', now: new Date('2026-09-05T00:00:00.000Z') }),
    )
    expect(verdict).toEqual({ active: false, reason: 'PLAN_CHANGED' })
  })
})

describe('remainingAuthorizedDates', () => {
  it('subtracts recalled dates', () => {
    expect(remainingAuthorizedDates(['2026-09-04', '2026-09-05'], ['2026-09-04'])).toEqual(['2026-09-05'])
  })

  it('preserves order', () => {
    expect(remainingAuthorizedDates(['2026-09-06', '2026-09-04', '2026-09-05'], [])).toEqual([
      '2026-09-06',
      '2026-09-04',
      '2026-09-05',
    ])
  })

  it('removes duplicates', () => {
    expect(remainingAuthorizedDates(['2026-09-04', '2026-09-04', '2026-09-05'], [])).toEqual([
      '2026-09-04',
      '2026-09-05',
    ])
  })

  it('returns an empty array when everything is recalled', () => {
    expect(remainingAuthorizedDates(['2026-09-04'], ['2026-09-04'])).toEqual([])
  })

  it('ignores recalled dates that were never authorized', () => {
    expect(remainingAuthorizedDates(['2026-09-04'], ['2026-09-09'])).toEqual(['2026-09-04'])
  })
})

describe('computeExpiry', () => {
  const authorizedAt = new Date('2026-09-01T00:00:00.000Z')

  it('adds the requested number of days', () => {
    expect(computeExpiry(authorizedAt, 7).toISOString()).toBe('2026-09-08T00:00:00.000Z')
  })

  it('clamps days above the ceiling', () => {
    expect(computeExpiry(authorizedAt, AUTO_PUBLISH_MAX_EXPIRY_DAYS + 100).toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    )
  })

  it('clamps days below 1', () => {
    expect(computeExpiry(authorizedAt, 0).toISOString()).toBe('2026-09-02T00:00:00.000Z')
  })

  it('clamps negative days to 1', () => {
    expect(computeExpiry(authorizedAt, -5).toISOString()).toBe('2026-09-02T00:00:00.000Z')
  })
})

describe('CampaignDailyAutoPublishAuthorizeCommandSchema — lift_recalled_dates', () => {
  it('defaults to an empty list', () => {
    expect(CampaignDailyAutoPublishAuthorizeCommandSchema.parse(authorizeCommand()).lift_recalled_dates).toEqual([])
  })

  it('accepts a subset of dates and rejects a date outside them', () => {
    expect(CampaignDailyAutoPublishAuthorizeCommandSchema.safeParse(authorizeCommand({ lift_recalled_dates: ['2026-09-04'] })).success).toBe(true)
    expect(CampaignDailyAutoPublishAuthorizeCommandSchema.safeParse(authorizeCommand({ lift_recalled_dates: ['2026-09-09'] })).success).toBe(false)
  })
})
