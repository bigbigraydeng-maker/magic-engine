import { describe, expect, it } from 'vitest'

import { PUBLISH_MEASUREMENT_OFFSETS_HOURS } from '@/lib/campaign/daily-plan-publish'
import type { PublishActionRow, ReceiptRow, StoryRow } from '@/lib/social/post-performance'
import {
  buildSocialReadbackPanel,
  parseStoryRegistrationItemIds,
  resolveWindowStatus,
  reasonToZh,
} from '@/lib/social/social-readback-panel'

const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const NOW = new Date('2026-11-03T12:00:00.000Z')

function action(partial: Partial<PublishActionRow> & { id: string; source: string }): PublishActionRow {
  return {
    id: partial.id,
    executed_at: partial.executed_at ?? '2026-11-01T10:00:00.000Z',
    payload: {
      source: partial.source,
      platform: 'facebook',
      published_at: partial.executed_at ?? '2026-11-01T10:00:00.000Z',
    },
  }
}

function receipt(partial: Partial<ReceiptRow> & { action_id: string; window_hours: number }): ReceiptRow {
  return {
    action_id: partial.action_id,
    window_hours: partial.window_hours,
    status: partial.status ?? 'ok',
    measured_at: partial.measured_at ?? null,
    values: partial.values ?? { likes: 3, comments: 1, shares: 0 },
    missing: partial.missing ?? {},
    reason: partial.reason ?? null,
  }
}

describe('buildSocialReadbackPanel', () => {
  it('merges image post, reel, and story with per-window metrics', () => {
    const panel = buildSocialReadbackPanel({
      clientId: CLIENT,
      since: '2026-10-01T00:00:00.000Z',
      until: '2026-11-03T00:00:00.000Z',
      limit: 10,
      now: NOW,
      actions: [
        action({ id: 'post-1', source: 'daily_plan', executed_at: '2026-11-02T08:00:00.000Z' }),
        action({ id: 'reel-1', source: 'factory_reel', executed_at: '2026-11-01T08:00:00.000Z' }),
      ],
      receipts: [
        receipt({ action_id: 'post-1', window_hours: 4, values: { likes: 2, comments: 0, shares: 0 } }),
        receipt({ action_id: 'post-1', window_hours: 72, values: { likes: 5, comments: 1, shares: 0 } }),
        receipt({ action_id: 'reel-1', window_hours: 72, values: { likes: 9, comments: 2, shares: 1 } }),
      ],
      stories: [
        {
          item_id: 'story-1',
          channel: 'facebook_story',
          status: 'SENT',
          sent_at: '2026-10-30T18:00:00.000Z',
          slot_at: '2026-10-30T18:00:00.000Z',
        },
      ],
      storyRegistrationRows: [{ payload: { idempotency_key: 'story-lite:story-1' } }],
    })

    expect(panel.items).toHaveLength(3)
    expect(panel.items[0].kind).toBe('image_post')
    expect(panel.items[0].windows?.[0].status).toBe('read')
    expect(panel.items[0].windows?.[0].metrics[0].display).toBe('2')
    expect(panel.items[1].kind).toBe('reel')
    expect(panel.items[2].kind).toBe('story')
    expect(panel.items[2].story_registered).toBe(true)
    expect(panel.items[2].windows).toBeNull()
  })

  it('marks a future window as pending and past missing receipt as missing', () => {
    const now = new Date('2026-11-01T14:00:00.000Z')
    const panel = buildSocialReadbackPanel({
      clientId: CLIENT,
      since: '2026-10-01T00:00:00.000Z',
      until: '2026-11-03T00:00:00.000Z',
      limit: 5,
      now,
      actions: [action({ id: 'a1', source: 'daily_plan', executed_at: '2026-11-01T10:00:00.000Z' })],
      receipts: [],
      stories: [],
      storyRegistrationRows: [],
    })
    const windows = panel.items[0].windows!
    expect(windows[0].hours).toBe(PUBLISH_MEASUREMENT_OFFSETS_HOURS[0])
    expect(windows[0].status).toBe('missing')
    expect(windows[0].status_label).toBe('过点没读到')
    expect(windows[1].status).toBe('pending')
    expect(windows[1].status_label).toBe('还没到点')
  })
})

describe('parseStoryRegistrationItemIds', () => {
  it('extracts item ids from story-lite idempotency keys', () => {
    const ids = parseStoryRegistrationItemIds([
      { payload: { idempotency_key: 'story-lite:abc' } },
      { payload: { idempotency_key: 'other:abc' } },
    ])
    expect(Array.from(ids)).toEqual(['abc'])
  })
})

describe('scheduled image posts', () => {
  it('uses scheduled public time and measure_at, not the early Facebook submit time', () => {
    const now = new Date('2026-11-03T12:00:00.000Z')
    const panel = buildSocialReadbackPanel({
      clientId: CLIENT,
      since: '2026-10-01T00:00:00.000Z',
      until: '2026-11-04T00:00:00.000Z',
      limit: 5,
      now,
      actions: [
        {
          id: 'scheduled-1',
          executed_at: '2026-11-03T10:00:00.000Z',
          payload: {
            source: 'daily_plan',
            platform: 'facebook',
            published_at: '2026-11-01T10:00:00.000Z',
            scheduled_publish_time: '2026-11-03T10:00:00.000Z',
            measure_at: [
              { hours: 4, at: '2026-11-03T14:00:00.000Z' },
              { hours: 72, at: '2026-11-06T10:00:00.000Z' },
            ],
          },
        },
      ],
      receipts: [],
      stories: [],
      storyRegistrationRows: [],
    })

    const item = panel.items[0]
    expect(item.published_at).toBe('2026-11-03T10:00:00.000Z')
    expect(item.windows?.[0].status).toBe('pending')
    expect(item.windows?.[0].status_label).toBe('还没到点')
    expect(item.windows?.[1].status).toBe('pending')
  })
})

describe('resolveWindowStatus', () => {
  it('maps reason codes to Chinese labels', () => {
    expect(reasonToZh('no_receipt')).toContain('读数')
    expect(
      resolveWindowStatus('2026-11-01T10:00:00.000Z', 4, null, new Date('2026-11-01T13:00:00.000Z')),
    ).toBe('pending')
  })
})
