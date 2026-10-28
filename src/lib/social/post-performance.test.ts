import { describe, it, expect } from 'vitest'
import {
  fieldReadToReading,
  platformOfPublishPayload,
  platformOfStoryChannel,
  readingFromReceipt,
  pickReceipt,
  buildPostItem,
  buildStoryItem,
  summarizeMetric,
  buildPageLevel,
  buildPostPerformanceReport,
  formatPostPerformanceText,
  type ReceiptRow,
  type PublishActionRow,
  type StoryRow,
  type PageMetricRow,
  type Reading,
} from './post-performance'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function receipt(over: Partial<ReceiptRow> = {}): ReceiptRow {
  return {
    action_id: 'a1',
    window_hours: 24,
    status: 'ok',
    measured_at: '2024-01-01T00:00:00Z',
    values: {},
    missing: {},
    reason: null,
    ...over,
  }
}

function action(over: Partial<PublishActionRow> = {}): PublishActionRow {
  return {
    id: 'a1',
    executed_at: '2024-01-01T00:00:00Z',
    payload: { source: 'daily_plan', platform: 'facebook' },
    ...over,
  }
}

function story(over: Partial<StoryRow> = {}): StoryRow {
  return {
    item_id: 's1',
    channel: 'facebook_story',
    status: 'SENT',
    sent_at: '2024-01-01T00:00:00Z',
    slot_at: '2024-01-01T00:00:00Z',
    ...over,
  }
}

function pageMetric(over: Partial<PageMetricRow> = {}): PageMetricRow {
  return {
    metric_key: 'social.fb.posts_7d',
    metric_value: 3,
    measured_at: '2024-01-01T00:00:00Z',
    ...over,
  }
}

function emptyInput() {
  return {
    clientId: 'c1',
    since: '2024-01-01',
    until: '2024-01-31',
    limit: 10,
    actions: [] as PublishActionRow[],
    receipts: [] as ReceiptRow[],
    stories: [] as StoryRow[],
    pageMetrics: [] as PageMetricRow[],
  }
}

// ---------------------------------------------------------------------------
// readingFromReceipt
// ---------------------------------------------------------------------------

describe('readingFromReceipt', () => {
  it('treats a real 0 as a value', () => {
    const r = readingFromReceipt(receipt({ values: { likes: 0 } }), 'likes')
    expect(r).toEqual({ kind: 'value', value: 0 })
  })

  it('reads missing[metric] string as not_readable', () => {
    const r = readingFromReceipt(
      receipt({ values: { likes: 1 }, missing: { shares: 'omitted_unverified' } }),
      'shares',
    )
    expect(r).toEqual({ kind: 'not_readable', reason: 'omitted_unverified' })
  })

  it('uses reason for unmeasurable status', () => {
    const r = readingFromReceipt(
      receipt({ status: 'unmeasurable', values: {}, missing: {}, reason: 'permission' }),
      'likes',
    )
    expect(r).toEqual({ kind: 'not_readable', reason: 'permission' })
  })

  it('returns no_receipt for null', () => {
    expect(readingFromReceipt(null, 'likes')).toEqual({
      kind: 'not_readable',
      reason: 'no_receipt',
    })
  })

  it('rejects negative and non-number values', () => {
    expect(readingFromReceipt(receipt({ values: { likes: -1 } }), 'likes').kind).toBe(
      'not_readable',
    )
    expect(readingFromReceipt(receipt({ values: { likes: 'x' } }), 'likes').kind).toBe(
      'not_readable',
    )
  })
})

// ---------------------------------------------------------------------------
// fieldReadToReading
// ---------------------------------------------------------------------------

describe('fieldReadToReading', () => {
  it('maps the three FieldRead kinds', () => {
    expect(fieldReadToReading({ kind: 'value', value: 5 })).toEqual({ kind: 'value', value: 5 })
    expect(fieldReadToReading({ kind: 'absent' })).toEqual({
      kind: 'not_readable',
      reason: 'absent',
    })
    expect(fieldReadToReading({ kind: 'omitted_unverified' })).toEqual({
      kind: 'not_readable',
      reason: 'omitted_unverified',
    })
  })
})

// ---------------------------------------------------------------------------
// pickReceipt
// ---------------------------------------------------------------------------

describe('pickReceipt', () => {
  it('prefers largest window among ok/partial even if a larger window is unmeasurable', () => {
    const ok24 = receipt({ window_hours: 24, status: 'ok' })
    const partial48 = receipt({ window_hours: 48, status: 'partial' })
    const unmeasurable72 = receipt({ window_hours: 72, status: 'unmeasurable' })
    expect(pickReceipt([ok24, partial48, unmeasurable72])).toBe(partial48)
  })

  it('returns null for empty list', () => {
    expect(pickReceipt([])).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// platformOfPublishPayload
// ---------------------------------------------------------------------------

describe('platformOfPublishPayload', () => {
  it('reads platform from payload', () => {
    expect(platformOfPublishPayload({ platform: 'facebook' })).toBe('facebook')
  })

  it('returns unknown for missing platform', () => {
    expect(platformOfPublishPayload({})).toBe('unknown')
  })

  it('never guesses from page_id', () => {
    expect(platformOfPublishPayload({ page_id: '123' })).toBe('unknown')
  })

  it('returns unknown for null', () => {
    expect(platformOfPublishPayload(null)).toBe('unknown')
  })
})

// ---------------------------------------------------------------------------
// platformOfStoryChannel
// ---------------------------------------------------------------------------

describe('platformOfStoryChannel', () => {
  it('maps known channels', () => {
    expect(platformOfStoryChannel('facebook_story')).toBe('facebook')
    expect(platformOfStoryChannel('instagram_story')).toBe('instagram')
  })

  it('returns unknown for other channels', () => {
    expect(platformOfStoryChannel('tiktok_story')).toBe('unknown')
  })
})

// ---------------------------------------------------------------------------
// summarizeMetric
// ---------------------------------------------------------------------------

describe('summarizeMetric', () => {
  it('empty -> n_items 0 and no_readable_samples', () => {
    const s = summarizeMetric([])
    expect(s.n_items).toBe(0)
    expect(s.sum).toEqual({ kind: 'not_readable', reason: 'no_readable_samples' })
  })

  it('value 0 plus not_readable -> sum value 0', () => {
    const readings: Reading[] = [
      { kind: 'value', value: 0 },
      { kind: 'not_readable', reason: 'x' },
    ]
    const s = summarizeMetric(readings)
    expect(s.sum).toEqual({ kind: 'value', value: 0 })
    expect(s.n_readable).toBe(1)
    expect(s.n_not_readable).toBe(1)
  })

  it('all not readable -> sum not_readable (not value 0)', () => {
    const s = summarizeMetric([{ kind: 'not_readable', reason: 'x' }])
    expect(s.sum.kind).toBe('not_readable')
  })
})

// ---------------------------------------------------------------------------
// buildPageLevel
// ---------------------------------------------------------------------------

describe('buildPageLevel', () => {
  it('shares_7d is always not_readable even when stored 0', () => {
    const out = buildPageLevel([
      pageMetric({ metric_key: 'social.fb.shares_7d', metric_value: 0 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].reading).toEqual({
      kind: 'not_readable',
      reason: 'shares_7d_constant_zero_unverified',
    })
  })

  it('ignores other prefixes', () => {
    const out = buildPageLevel([pageMetric({ metric_key: 'social.ig.posts_7d' })])
    expect(out).toHaveLength(0)
  })

  it('keeps latest per key', () => {
    const out = buildPageLevel([
      pageMetric({ metric_value: 1, measured_at: '2024-01-01T00:00:00Z' }),
      pageMetric({ metric_value: 3, measured_at: '2024-01-05T00:00:00Z' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].reading).toEqual({ kind: 'value', value: 3 })
  })

  it('posts_7d value 3 -> value 3', () => {
    const out = buildPageLevel([pageMetric({ metric_key: 'social.fb.posts_7d', metric_value: 3 })])
    expect(out[0].reading).toEqual({ kind: 'value', value: 3 })
  })
})

// ---------------------------------------------------------------------------
// buildPostPerformanceReport
// ---------------------------------------------------------------------------

describe('buildPostPerformanceReport', () => {
  it('(a) empty input -> 6 not_connected blocks, no unknown', () => {
    const report = buildPostPerformanceReport(emptyInput())
    expect(report.platforms).toHaveLength(6)
    for (const b of report.platforms) {
      expect(b.status).toBe('not_connected')
      expect(b.label).toBe('该平台未接入')
    }
    expect(report.platforms.some((b) => b.platform === 'unknown')).toBe(false)
  })

  it('(b) connected instagram -> connected_no_data', () => {
    const report = buildPostPerformanceReport({
      ...emptyInput(),
      connectedPlatforms: ['instagram'],
    })
    const ig = report.platforms.find((b) => b.platform === 'instagram')
    expect(ig?.status).toBe('connected_no_data')
  })

  it('(c) one facebook daily_plan post with ok receipt', () => {
    const report = buildPostPerformanceReport({
      ...emptyInput(),
      actions: [action({ id: 'a1', payload: { source: 'daily_plan', platform: 'facebook' } })],
      receipts: [
        receipt({
          action_id: 'a1',
          status: 'ok',
          values: { likes: 0, comments: 2 },
          missing: { shares: 'omitted_unverified' },
        }),
      ],
    })
    const fb = report.platforms.find((b) => b.platform === 'facebook')!
    expect(fb.posts.n).toBe(1)
    expect(fb.posts.items[0].likes).toEqual({ kind: 'value', value: 0 })
    expect(fb.posts.items[0].comments).toEqual({ kind: 'value', value: 2 })
    expect(fb.posts.items[0].shares.kind).toBe('not_readable')
    expect(fb.posts.metrics.likes.sum).toEqual({ kind: 'value', value: 0 })
  })

  it('(d) action with no platform goes to unknown block only', () => {
    const report = buildPostPerformanceReport({
      ...emptyInput(),
      actions: [action({ id: 'a1', payload: { source: 'daily_plan' } })],
    })
    const fb = report.platforms.find((b) => b.platform === 'facebook')!
    expect(fb.posts.n).toBe(0)
    const unknown = report.platforms.find((b) => b.platform === 'unknown')
    expect(unknown?.posts.n).toBe(1)
  })

  it('(e) factory_reel excluded and counted', () => {
    const report = buildPostPerformanceReport({
      ...emptyInput(),
      actions: [action({ id: 'a1', payload: { source: 'factory_reel', platform: 'facebook' } })],
    })
    expect(report.reel_actions_excluded).toBe(1)
    const fb = report.platforms.find((b) => b.platform === 'facebook')!
    expect(fb.posts.n).toBe(0)
  })

  it('(f) two platforms never merged', () => {
    const report = buildPostPerformanceReport({
      ...emptyInput(),
      actions: [
        action({ id: 'a1', payload: { source: 'daily_plan', platform: 'facebook' } }),
        action({ id: 'a2', payload: { source: 'daily_plan', platform: 'tiktok' } }),
      ],
      receipts: [
        receipt({ action_id: 'a1', values: { likes: 5 } }),
        receipt({ action_id: 'a2', values: { likes: 7 } }),
      ],
    })
    const fb = report.platforms.find((b) => b.platform === 'facebook')!
    const tt = report.platforms.find((b) => b.platform === 'tiktok')!
    expect(fb.posts.metrics.likes.sum).toEqual({ kind: 'value', value: 5 })
    expect(tt.posts.metrics.likes.sum).toEqual({ kind: 'value', value: 7 })
  })

  it('(g) SENT stories counted, PENDING ignored, views not_readable', () => {
    const report = buildPostPerformanceReport({
      ...emptyInput(),
      stories: [
        story({ item_id: 's1', status: 'SENT', channel: 'facebook_story' }),
        story({ item_id: 's2', status: 'PENDING', channel: 'facebook_story' }),
      ],
    })
    const fb = report.platforms.find((b) => b.platform === 'facebook')!
    expect(fb.stories.n).toBe(1)
    expect(fb.stories.items[0].views.kind).toBe('not_readable')
  })

  it('(h) limit slices to newest', () => {
    const report = buildPostPerformanceReport({
      ...emptyInput(),
      limit: 1,
      actions: [
        action({
          id: 'a1',
          executed_at: '2024-01-01T00:00:00Z',
          payload: { source: 'daily_plan', platform: 'facebook', published_at: '2024-01-01T00:00:00Z' },
        }),
        action({
          id: 'a2',
          executed_at: '2024-01-02T00:00:00Z',
          payload: { source: 'daily_plan', platform: 'facebook', published_at: '2024-01-02T00:00:00Z' },
        }),
      ],
    })
    const fb = report.platforms.find((b) => b.platform === 'facebook')!
    expect(fb.posts.n).toBe(1)
    expect(fb.posts.items[0].action_id).toBe('a2')
  })
})

// ---------------------------------------------------------------------------
// formatPostPerformanceText
// ---------------------------------------------------------------------------

describe('formatPostPerformanceText', () => {
  it('renders 0 as a value and not-readable distinctly', () => {
    const report = buildPostPerformanceReport({
      ...emptyInput(),
      actions: [action({ id: 'a1', payload: { source: 'daily_plan', platform: 'facebook' } })],
      receipts: [receipt({ action_id: 'a1', values: { likes: 0 }, missing: { shares: 'x' } })],
    })
    const text = formatPostPerformanceText(report)
    expect(text).toContain('likes: 0')
    expect(text).toContain('读不到(')
  })

  it('prints 该平台未接入 for not_connected', () => {
    const report = buildPostPerformanceReport(emptyInput())
    const text = formatPostPerformanceText(report)
    expect(text).toContain('该平台未接入')
  })
})
