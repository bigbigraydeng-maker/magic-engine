import { describe, expect, it } from 'vitest'
import {
  CampaignDailyPublishCommandSchema,
  CampaignDailyPublishMetaSchema,
  DAILY_PLAN_POST_PUBLISHED_EVENT,
  measurementSchedule,
  partitionByIdempotency,
  publishIdempotencyKey,
  resolvePublishSchedule,
  resolvePublishStatus,
  shiftDateString,
  StoryResolveDueSchema,
} from '../daily-plan-publish'

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const CAMPAIGN_ID = 'a0000000-0000-0000-0000-000000000001'
const PLAN_ID = 'b0000000-0000-0000-0000-000000000001'
const REVIEW_REVISION = '10000000-0000-0000-0000-000000000001'
const PLAN_REVISION = '2026-09-01T15:00:04.513Z'
const PAGE_ID = '227633594573276'

function command(overrides: Record<string, unknown> = {}) {
  return {
    client_id: CLIENT_ID,
    campaign_id: CAMPAIGN_ID,
    plan_id: PLAN_ID,
    plan_revision: PLAN_REVISION,
    review_revision: REVIEW_REVISION,
    page_id: PAGE_ID,
    approved: true,
    publish_authorization: true,
    ...overrides,
  }
}

describe('publish command — fail-closed authorisation', () => {
  it('defaults to no_publish=true when the caller says nothing', () => {
    const parsed = CampaignDailyPublishCommandSchema.parse(command())
    expect(parsed.no_publish).toBe(true)
  })

  it.each([
    ['approved', { approved: undefined }],
    ['publish_authorization', { publish_authorization: undefined }],
    ['client_id', { client_id: undefined }],
    ['plan_id', { plan_id: undefined }],
    ['plan_revision', { plan_revision: undefined }],
    ['page_id', { page_id: undefined }],
  ])('rejects a command missing %s', (_label, overrides) => {
    expect(CampaignDailyPublishCommandSchema.safeParse(command(overrides)).success).toBe(false)
  })

  it.each([
    ['approved=false', { approved: false }],
    ['publish_authorization=false', { publish_authorization: false }],
    ['approved is a truthy string', { approved: 'yes' }],
    ['publish_authorization is 1', { publish_authorization: 1 }],
  ])('rejects %s rather than coercing it to consent', (_label, overrides) => {
    expect(CampaignDailyPublishCommandSchema.safeParse(command(overrides)).success).toBe(false)
  })

  it('rejects a non-numeric page id before any provider call could happen', () => {
    expect(CampaignDailyPublishCommandSchema.safeParse(command({ page_id: 'CTSTOURS' })).success).toBe(false)
  })

  it('accepts an explicit live command only when everything is present', () => {
    const parsed = CampaignDailyPublishCommandSchema.parse(command({ no_publish: false }))
    expect(parsed.no_publish).toBe(false)
    expect(parsed.approved).toBe(true)
    expect(parsed.publish_authorization).toBe(true)
  })
})

describe('idempotency key', () => {
  const base = {
    clientId: CLIENT_ID,
    planId: PLAN_ID,
    planRevision: PLAN_REVISION,
    reviewRevision: REVIEW_REVISION,
    date: '2026-09-03',
  }

  it('is stable across attempts for the same content identity', () => {
    expect(publishIdempotencyKey(base)).toBe(publishIdempotencyKey({ ...base }))
  })

  it.each([
    ['date', { date: '2026-09-04' }],
    ['plan revision', { planRevision: '2026-09-02T00:00:00.000Z' }],
    ['review revision', { reviewRevision: '10000000-0000-0000-0000-000000000002' }],
    ['plan id', { planId: 'b0000000-0000-0000-0000-000000000002' }],
    ['client id', { clientId: 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84' }],
  ])('changes when the %s changes', (_label, overrides) => {
    expect(publishIdempotencyKey({ ...base, ...overrides })).not.toBe(publishIdempotencyKey(base))
  })
})

describe('duplicate suppression', () => {
  const a = { date: '2026-09-03', idempotency_key: 'fbpost_a' }
  const b = { date: '2026-09-04', idempotency_key: 'fbpost_b' }

  it('skips a post whose key was already published', () => {
    const { pending, skipped } = partitionByIdempotency([a, b], [{ idempotency_key: 'fbpost_a' }])
    expect(pending).toEqual([b])
    expect(skipped).toEqual([a])
  })

  it('matches on the key, not the date, so a stale receipt cannot block new copy', () => {
    const republished = { date: '2026-09-03', idempotency_key: 'fbpost_a_v2' }
    const { pending, skipped } = partitionByIdempotency([republished], [{ idempotency_key: 'fbpost_a' }])
    expect(pending).toEqual([republished])
    expect(skipped).toEqual([])
  })

  it('leaves everything pending when nothing was published before', () => {
    expect(partitionByIdempotency([a, b], []).pending).toEqual([a, b])
  })
})

describe('measurement handoff', () => {
  it('schedules T+4 (early signal) and T+72 (settled) from the real publish time', () => {
    expect(measurementSchedule('2026-09-03T00:00:00.000Z')).toEqual([
      { hours: 4, at: '2026-09-03T04:00:00.000Z' },
      { hours: 72, at: '2026-09-06T00:00:00.000Z' },
    ])
  })

  it('uses a client-agnostic event name so other clients share the workflow', () => {
    expect(DAILY_PLAN_POST_PUBLISHED_EVENT).toBe('daily_plan.post.published')
  })
})

describe('date_offset_days — shift a batch forward when morning has passed', () => {
  // 2026-09-04 13:12 NZ = 2026-09-04 01:12 UTC. This is the exact clock the
  // recall-and-reschedule scenario ran at; 09-04 08:00 NZ was 5 hours past,
  // so with offset:0 that post would fire immediately. offset:1 must push
  // every post one calendar day so 09-04 content lands 09-05 morning.
  const NOW_AFTER_MORNING = new Date('2026-09-04T01:12:00Z')

  it('offset:0 (default) is a no-op — behaviour identical to no offset', () => {
    const a = resolvePublishSchedule('2026-09-05', NOW_AFTER_MORNING)
    const b = resolvePublishSchedule('2026-09-05', NOW_AFTER_MORNING, 0)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('offset:1 turns "publish now" into "schedule for the next morning"', () => {
    // Without offset: 09-04 08:00 NZ has passed → publish now.
    expect(resolvePublishSchedule('2026-09-04', NOW_AFTER_MORNING).publishNow).toBe(true)
    // With offset:1: target moves to 09-05 08:00 NZ → schedule.
    const r = resolvePublishSchedule('2026-09-04', NOW_AFTER_MORNING, 1)
    expect(r.publishNow).toBe(false)
    if (r.publishNow) return
    expect(r.scheduledPublishTime.toISOString()).toBe('2026-09-04T20:00:00.000Z')
  })

  it('offset:1 keeps every one of the six posts scheduled for morning — no immediate leak', () => {
    const outcomes = ['2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09']
      .map((d) => resolvePublishSchedule(d, NOW_AFTER_MORNING, 1))
    expect(outcomes.every((o) => !o.publishNow)).toBe(true)
    const times = outcomes.map((o) => (o.publishNow ? '' : o.scheduledPublishTime.toISOString()))
    // Six distinct instants, exactly 24h apart, first one is 09-05 morning.
    expect(new Set(times).size).toBe(6)
    expect(times[0]).toBe('2026-09-04T20:00:00.000Z') // 09-05 08:00 NZST
    for (let i = 1; i < times.length; i++) {
      expect(new Date(times[i]).getTime() - new Date(times[i - 1]).getTime()).toBe(24 * 3600 * 1000)
    }
  })

  it('negative offset pulls a scheduled batch forward (a launch date moves in)', () => {
    // 09-10 with offset:-2 = 09-08 08:00 NZ target. Given NOW_AFTER_MORNING is
    // 09-04 13:12 NZ, 09-08 morning is still a few days ahead → scheduled.
    const r = resolvePublishSchedule('2026-09-10', NOW_AFTER_MORNING, -2)
    expect(r.publishNow).toBe(false)
    if (r.publishNow) return
    expect(r.scheduledPublishTime.toISOString()).toBe('2026-09-07T20:00:00.000Z') // 09-08 08:00 NZST
  })

  it('the command schema defaults date_offset_days to 0 and rejects wild values', () => {
    const cmd = {
      client_id: 'c0000000-0000-0000-0000-000000000000',
      campaign_id: 'a0000000-0000-0000-0000-000000000001',
      plan_id: 'b0000000-0000-0000-0000-000000000001',
      plan_revision: '2026-09-01T15:00:04.513Z',
      review_revision: '10000000-0000-0000-0000-000000000001',
      page_id: '227633594573276',
      approved: true, publish_authorization: true,
    }
    expect(CampaignDailyPublishCommandSchema.parse(cmd).date_offset_days).toBe(0)
    expect(CampaignDailyPublishCommandSchema.parse({ ...cmd, date_offset_days: 1 }).date_offset_days).toBe(1)
    expect(CampaignDailyPublishCommandSchema.safeParse({ ...cmd, date_offset_days: 31 }).success).toBe(false)
    expect(CampaignDailyPublishCommandSchema.safeParse({ ...cmd, date_offset_days: 1.5 }).success).toBe(false)
    expect(CampaignDailyPublishCommandSchema.safeParse({ ...cmd, date_offset_days: '1' }).success).toBe(false)
  })
})

describe('shiftDateString — DST-safe calendar arithmetic', () => {
  it('adds days across a month boundary', () => {
    expect(shiftDateString('2026-09-29', 3)).toBe('2026-10-02')
  })
  it('subtracts days across a year boundary', () => {
    expect(shiftDateString('2027-01-02', -3)).toBe('2026-12-30')
  })
  it('crosses the NZ DST boundary (2026-09-28) without gaining or losing a day', () => {
    expect(shiftDateString('2026-09-27', 1)).toBe('2026-09-28')
    expect(shiftDateString('2026-09-28', 1)).toBe('2026-09-29')
    expect(shiftDateString('2026-09-27', 3)).toBe('2026-09-30')
  })
  it('zero-shift is the identity', () => {
    expect(shiftDateString('2026-09-04', 0)).toBe('2026-09-04')
  })
})

describe('resolvePublishSchedule — the 2026-09-03 regression', () => {
  // 2026-09-03 04:00 UTC = 2026-09-03 16:00 NZST. Well before "08:00 NZ next
  // day" for any of 09-04..09-09, so all six of them should schedule.
  const NOW_MID_AFTERNOON_NZ = new Date('2026-09-03T04:00:00Z')

  it('a future NZ morning schedules — the plan does NOT fire immediately', () => {
    const r = resolvePublishSchedule('2026-09-04', NOW_MID_AFTERNOON_NZ)
    expect(r.publishNow).toBe(false)
    if (r.publishNow) return
    // 2026-09-04 08:00 NZST (winter, UTC+12) = 2026-09-03 20:00 UTC
    expect(r.scheduledPublishTime.toISOString()).toBe('2026-09-03T20:00:00.000Z')
  })

  it('all seven days spread out to seven distinct instants — no minute-apart burst', () => {
    const times = ['2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09']
      .map((d) => resolvePublishSchedule(d, NOW_MID_AFTERNOON_NZ))
      .filter((r): r is { publishNow: false; scheduledPublishTime: Date } => !r.publishNow)
      .map((r) => r.scheduledPublishTime.toISOString())
    // 09-03 08:00 NZ is already past by 16:00 NZ, so it publishes now (1 of 7 filtered out).
    expect(times).toHaveLength(6)
    expect(new Set(times).size).toBe(6)
    // Each pair is exactly 24 hours apart — the mechanism proof, not a coincidence.
    for (let i = 1; i < times.length; i++) {
      expect(new Date(times[i]).getTime() - new Date(times[i - 1]).getTime()).toBe(24 * 3600 * 1000)
    }
  })

  it('the target hour of day is 08:00 in Pacific/Auckland, not UTC', () => {
    const r = resolvePublishSchedule('2026-09-05', NOW_MID_AFTERNOON_NZ)
    if (r.publishNow) throw new Error('expected schedule')
    const nzHour = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Pacific/Auckland', hour: '2-digit', hour12: false,
    }).format(r.scheduledPublishTime)
    expect(Number(nzHour) % 24).toBe(8)
  })

  it('DST is respected: same 08:00 NZ target across the Sep 28 2026 boundary', () => {
    // Sep 27 = NZST (UTC+12); Sep 28 = NZDT (UTC+13). A fixed-offset
    // implementation would silently ship at 09:00 NZ for post-DST dates.
    const winter = resolvePublishSchedule('2026-09-27', new Date('2026-09-01T00:00:00Z'))
    const summer = resolvePublishSchedule('2026-09-29', new Date('2026-09-01T00:00:00Z'))
    if (winter.publishNow || summer.publishNow) throw new Error('expected schedules')
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Pacific/Auckland', hour: '2-digit', hour12: false,
    })
    expect(Number(fmt.format(winter.scheduledPublishTime)) % 24).toBe(8)
    expect(Number(fmt.format(summer.scheduledPublishTime)) % 24).toBe(8)
  })

  it('today publishes immediately — Facebook rejects a scheduled_publish_time within 10 minutes', () => {
    // 07:50 NZ, target is 08:00 NZ same day — only 10 minutes away, inside the guard.
    const now = new Date('2026-09-04T19:50:00Z') // 07:50 NZST on 09-04
    const r = resolvePublishSchedule('2026-09-04', now)
    expect(r.publishNow).toBe(true)
  })

  it('past dates publish immediately, they never negative-schedule', () => {
    const r = resolvePublishSchedule('2026-08-15', new Date('2026-09-03T04:00:00Z'))
    expect(r.publishNow).toBe(true)
  })

  it('a plan that says next year publishes immediately rather than getting silently dropped by Meta', () => {
    // Meta ceiling is ~6 months. A date beyond that would be a data error, not a
    // legitimate long-lead schedule. Publishing now surfaces the mistake.
    const r = resolvePublishSchedule('2027-06-01', new Date('2026-09-03T04:00:00Z'))
    expect(r.publishNow).toBe(true)
  })
})

describe('first comment fields', () => {
  function receipt(publishedOverrides: Record<string, unknown> = {}) {
    return {
      schema_version: 1,
      event_name: DAILY_PLAN_POST_PUBLISHED_EVENT,
      status: 'PUBLISHED',
      request_id: '20000000-0000-0000-0000-000000000001',
      client_id: CLIENT_ID,
      campaign_id: CAMPAIGN_ID,
      plan_id: PLAN_ID,
      plan_revision: PLAN_REVISION,
      review_revision: REVIEW_REVISION,
      page_id: PAGE_ID,
      publishing_authorization: 'AUTHORIZED',
      approved_by_user_id: '30000000-0000-0000-0000-000000000001',
      created_at: '2026-09-03T00:00:00.000Z',
      published: [
        {
          date: '2026-09-03',
          idempotency_key: 'fbpost_a',
          post_id: `${PAGE_ID}_123`,
          post_id_source: 'post_id',
          page_id: PAGE_ID,
          published_at: '2026-09-03T00:00:00.000Z',
          permalink: 'https://www.facebook.com/123',
          provider_response: {},
          ...publishedOverrides,
        },
      ],
      failed: [],
      event_ids: [],
    }
  }

  it('parses a published item without first_comment_status / first_comment_id (old receipts)', () => {
    const parsed = CampaignDailyPublishMetaSchema.parse(receipt())
    expect(parsed.published[0].first_comment_status).toBeUndefined()
    expect(parsed.published[0].first_comment_id).toBeUndefined()
  })

  it('accepts POSTED with an id, and rejects an unknown status', () => {
    const parsed = CampaignDailyPublishMetaSchema.parse(
      receipt({ first_comment_status: 'POSTED', first_comment_id: 'comment-1' }),
    )
    expect(parsed.published[0].first_comment_status).toBe('POSTED')
    expect(parsed.published[0].first_comment_id).toBe('comment-1')

    expect(
      CampaignDailyPublishMetaSchema.safeParse(receipt({ first_comment_status: 'WHATEVER' })).success,
    ).toBe(false)
  })

  function storyResolveDue(overrides: Record<string, unknown> = {}) {
    return {
      client_id: CLIENT_ID,
      campaign_id: CAMPAIGN_ID,
      plan_id: PLAN_ID,
      plan_revision: PLAN_REVISION,
      review_revision: REVIEW_REVISION,
      date: '2026-09-03',
      idempotency_key: 'fbpost_a',
      photo_id: '123456789',
      page_id: PAGE_ID,
      published_at: '2026-09-03T00:00:00.000Z',
      measure_at: [{ hours: 4, at: '2026-09-03T04:00:00.000Z' }],
      ...overrides,
    }
  }

  it('accepts a normal first_comment_text and rejects empty / over-long text', () => {
    expect(
      StoryResolveDueSchema.safeParse(storyResolveDue({ first_comment_text: 'Book now' })).success,
    ).toBe(true)
    expect(StoryResolveDueSchema.safeParse(storyResolveDue({ first_comment_text: '' })).success).toBe(false)
    expect(
      StoryResolveDueSchema.safeParse(storyResolveDue({ first_comment_text: 'x'.repeat(2001) })).success,
    ).toBe(false)
  })
})

describe('status resolution', () => {
  it.each([
    [2, 0, 'PUBLISHED'],
    [1, 1, 'PARTIAL'],
    [0, 2, 'FAILED'],
  ])('resolves %i published / %i failed to %s', (published, failed, expected) => {
    expect(resolvePublishStatus(published, failed)).toBe(expected)
  })
})
