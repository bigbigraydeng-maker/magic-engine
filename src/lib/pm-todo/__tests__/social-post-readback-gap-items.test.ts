import { describe, expect, it, vi } from 'vitest'

import type { ManualItem } from '../manual-items'
import {
  READBACK_GAP_GRACE_MS,
  buildGapItemsForClient,
  pushSocialPostReadbackGapItems,
} from '../social-post-readback-gap-items'
import type { SocialReadbackItem } from '@/lib/social/social-readback-panel'
import type { PublishActionRow, ReceiptRow } from '@/lib/social/post-performance'

const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const NOW = new Date('2026-11-10T16:00:00.000Z')

function engagementItem(
  id: string,
  windows: SocialReadbackItem['windows'],
): SocialReadbackItem {
  return {
    id,
    kind: 'image_post',
    kind_label: '图文',
    platform_label: 'Facebook',
    published_at: '2026-11-10T10:00:00.000Z',
    published_at_display: '2026/11/10 23:00',
    story_sent: null,
    story_registered: null,
    windows,
    summary: null,
  }
}

function action(id: string, payload: Record<string, unknown>): PublishActionRow {
  return { id, executed_at: '2026-11-08T10:00:00.000Z', payload }
}

describe('buildGapItemsForClient', () => {
  it('skips windows still pending (including scheduled public time + measure_at)', () => {
    const due4 = new Date('2026-11-10T14:00:00.000Z').toISOString()
    const items = buildGapItemsForClient({
      clientId: CLIENT,
      clientName: 'Demo',
      now: new Date('2026-11-10T12:00:00.000Z'),
      panel: {
        items: [
          engagementItem('a1', [
            {
              hours: 4,
              title: '发后 4 小时',
              status: 'pending',
              status_label: '还没到点',
              metrics: [],
            },
            {
              hours: 72,
              title: '发后 72 小时',
              status: 'pending',
              status_label: '还没到点',
              metrics: [],
            },
          ]),
        ],
      },
      actions: [
        action('a1', {
          source: 'daily_plan',
          platform: 'facebook',
          published_at: '2026-11-08T10:00:00.000Z',
          scheduled_publish_time: '2026-11-10T10:00:00.000Z',
          measure_at: [
            { hours: 4, at: due4 },
            { hours: 72, at: '2026-11-13T10:00:00.000Z' },
          ],
        }),
      ],
      receipts: [],
    })
    expect(items).toHaveLength(0)
  })

  it('waits grace after due before missing receipt todo', () => {
    const due4 = new Date('2026-11-10T14:00:00.000Z').toISOString()
    const withinGrace = new Date(Date.parse(due4) + READBACK_GAP_GRACE_MS - 60_000)
    const items = buildGapItemsForClient({
      clientId: CLIENT,
      clientName: 'Demo',
      now: withinGrace,
      panel: {
        items: [
          engagementItem('a1', [
            {
              hours: 4,
              title: '发后 4 小时',
              status: 'missing',
              status_label: '过点没读到',
              metrics: [],
            },
          ]),
        ],
      },
      actions: [action('a1', { source: 'daily_plan', platform: 'facebook', measure_at: [{ hours: 4, at: due4 }] })],
      receipts: [],
    })
    expect(items).toHaveLength(0)
  })

  it('emits four gap categories', () => {
    const due4 = new Date(NOW.getTime() - READBACK_GAP_GRACE_MS - 5 * 60_000).toISOString()
    const panel = {
      items: [
        engagementItem('missing', [
          { hours: 4, title: '发后 4 小时', status: 'missing', status_label: '过点没读到', metrics: [] },
        ]),
        engagementItem('retry', [
          { hours: 4, title: '发后 4 小时', status: 'read', status_label: '已读', metrics: [] },
        ]),
        engagementItem('bad', [
          { hours: 4, title: '发后 4 小时', status: 'read', status_label: '已读', metrics: [] },
        ]),
        {
          id: 'story-1',
          kind: 'story' as const,
          kind_label: 'Story',
          platform_label: 'Facebook',
          published_at: '2026-11-09T08:00:00.000Z',
          published_at_display: '2026/11/09 21:00',
          story_sent: true,
          story_registered: true,
          windows: null,
          summary: null,
        },
      ],
    }
    const receipts: ReceiptRow[] = [
      {
        action_id: 'retry',
        window_hours: 4,
        status: 'retries_exhausted',
        measured_at: null,
        values: {},
        missing: {},
        reason: 'retries_exhausted',
      },
      {
        action_id: 'bad',
        window_hours: 4,
        status: 'unmeasurable',
        measured_at: nowIso(),
        values: {},
        missing: {},
        reason: 'permission_denied',
      },
    ]
    const items = buildGapItemsForClient({
      clientId: CLIENT,
      clientName: 'Demo',
      now: NOW,
      panel,
      actions: [
        action('missing', { source: 'daily_plan', platform: 'facebook', measure_at: [{ hours: 4, at: due4 }] }),
        action('retry', { source: 'daily_plan', platform: 'facebook', measure_at: [{ hours: 4, at: due4 }] }),
        action('bad', { source: 'daily_plan', platform: 'facebook', measure_at: [{ hours: 4, at: due4 }] }),
      ],
      receipts,
    })
    expect(items.map((i) => i.kind).sort()).toEqual([
      'social_post_readback_missing',
      'social_post_readback_retries_exhausted',
      'social_post_readback_unreadable',
      'social_story_readback_unsupported',
    ])
  })
})

function nowIso(): string {
  return NOW.toISOString()
}

vi.mock('@/lib/social/social-readback-load', () => ({
  defaultReadbackWindow: () => ({
    since: new Date('2026-10-01T00:00:00.000Z'),
    until: NOW,
  }),
  loadSocialReadbackBundle: vi.fn(),
}))

import { loadSocialReadbackBundle } from '@/lib/social/social-readback-load'

describe('pushSocialPostReadbackGapItems', () => {
  it('loads per client and appends gap items', async () => {
    vi.mocked(loadSocialReadbackBundle).mockResolvedValue({
      panel: { client_id: CLIENT, since: '', until: '', limit: 200, generated_at: NOW.toISOString(), items: [] },
      actions: [],
      receipts: [],
    })
    const items: ManualItem[] = []
    await pushSocialPostReadbackGapItems({} as never, items, NOW, () => 'Demo', [CLIENT])
    expect(loadSocialReadbackBundle).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ clientId: CLIENT }))
    expect(items).toEqual([])
  })
})
