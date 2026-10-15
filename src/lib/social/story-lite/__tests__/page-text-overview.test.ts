import { describe, expect, it } from 'vitest'
import {
  tallyStoryItems,
  describeStoryHeadline,
  describeOverviewItemStatus,
  describeReelHeadline,
  describeVarietyLine,
  nzDateKey,
} from '../page-text'
import type { LiteItemStatus } from '../types'

const NOW = new Date('2026-10-14T02:00:00Z')

interface Item {
  status: LiteItemStatus
  slot_at: string
}

describe('tallyStoryItems', () => {
  it('counts each status bucket for an authorized pack', () => {
    const items: Item[] = [
      { status: 'SENT', slot_at: '2026-10-13T00:00:00Z' },
      { status: 'PENDING', slot_at: '2026-10-14T01:00:00Z' },
      { status: 'PENDING', slot_at: '2026-10-15T00:00:00Z' },
      { status: 'BLOCKED', slot_at: '2026-10-16T00:00:00Z' },
      { status: 'MISSED', slot_at: '2026-10-13T00:00:00Z' },
      { status: 'UNKNOWN_OUTCOME', slot_at: '2026-10-13T00:00:00Z' },
    ]
    expect(tallyStoryItems(items, 'AUTHORIZED', NOW)).toEqual({
      total: 6,
      recordedSent: 1,
      overdue: 2,
      waiting: 1,
      blocked: 2,
      stopped: 0,
    })
  })

  it('counts pending items as stopped when the pack is revoked', () => {
    const items: Item[] = [
      { status: 'PENDING', slot_at: '2026-10-14T01:00:00Z' },
      { status: 'PENDING', slot_at: '2026-10-15T00:00:00Z' },
    ]
    const tally = tallyStoryItems(items, 'REVOKED', NOW)
    expect(tally.stopped).toBe(2)
    expect(tally.overdue).toBe(0)
    expect(tally.waiting).toBe(0)
  })
})

describe('describeStoryHeadline', () => {
  it('renders the full headline for a mixed tally', () => {
    const tally = tallyStoryItems(
      [
        { status: 'SENT', slot_at: '2026-10-13T00:00:00Z' },
        { status: 'PENDING', slot_at: '2026-10-14T01:00:00Z' },
        { status: 'PENDING', slot_at: '2026-10-15T00:00:00Z' },
        { status: 'BLOCKED', slot_at: '2026-10-16T00:00:00Z' },
        { status: 'MISSED', slot_at: '2026-10-13T00:00:00Z' },
        { status: 'UNKNOWN_OUTCOME', slot_at: '2026-10-13T00:00:00Z' },
      ],
      'AUTHORIZED',
      NOW,
    )
    expect(describeStoryHeadline(tally)).toBe(
      'Story：本周 6 条 · 库里记为已发 1 · 已过点没发出 2 · 待发 1 · 被拦 2',
    )
  })

  it('says there is nothing scheduled when the total is zero', () => {
    expect(
      describeStoryHeadline({
        total: 0,
        recordedSent: 0,
        overdue: 0,
        waiting: 0,
        blocked: 0,
        stopped: 0,
      }),
    ).toBe('Story：本周没有排 Story')
  })

  it('appends the stopped part only when stopped is greater than zero', () => {
    const text = describeStoryHeadline({
      total: 4,
      recordedSent: 1,
      overdue: 0,
      waiting: 1,
      blocked: 0,
      stopped: 2,
    })
    expect(text.endsWith(' · 已停或授权过期不会发 2')).toBe(true)
  })
})

describe('describeOverviewItemStatus', () => {
  it('labels a recorded sent item', () => {
    expect(
      describeOverviewItemStatus('SENT', 'AUTHORIZED', '2026-10-13T00:00:00Z', NOW),
    ).toBe('库里记为已发')
  })

  it('flags a pending item whose slot has passed in an authorized pack', () => {
    expect(
      describeOverviewItemStatus('PENDING', 'AUTHORIZED', '2026-10-14T01:00:00Z', NOW),
    ).toBe('已过点，没发出（库里仍是待发）')
  })

  it('labels a pending item whose slot is in the future', () => {
    expect(
      describeOverviewItemStatus('PENDING', 'AUTHORIZED', '2026-10-15T00:00:00Z', NOW),
    ).toBe('等待发布')
  })

  it('labels a pending item in a revoked pack as stopped', () => {
    expect(
      describeOverviewItemStatus('PENDING', 'REVOKED', '2026-10-14T01:00:00Z', NOW),
    ).toBe('已停，不会发')
  })
})

describe('wording never claims something was sent without the recorded qualifier', () => {
  it('keeps every produced string free of a bare sent claim', () => {
    const tally = tallyStoryItems(
      [
        { status: 'SENT', slot_at: '2026-10-13T00:00:00Z' },
        { status: 'PENDING', slot_at: '2026-10-14T01:00:00Z' },
        { status: 'PENDING', slot_at: '2026-10-15T00:00:00Z' },
        { status: 'BLOCKED', slot_at: '2026-10-16T00:00:00Z' },
        { status: 'MISSED', slot_at: '2026-10-13T00:00:00Z' },
        { status: 'UNKNOWN_OUTCOME', slot_at: '2026-10-13T00:00:00Z' },
      ],
      'AUTHORIZED',
      NOW,
    )
    const strings: string[] = [
      describeStoryHeadline(tally),
      describeStoryHeadline({
        total: 0,
        recordedSent: 0,
        overdue: 0,
        waiting: 0,
        blocked: 0,
        stopped: 0,
      }),
      describeStoryHeadline({
        total: 4,
        recordedSent: 1,
        overdue: 0,
        waiting: 1,
        blocked: 0,
        stopped: 2,
      }),
      describeOverviewItemStatus('SENT', 'AUTHORIZED', '2026-10-13T00:00:00Z', NOW),
      describeOverviewItemStatus('PENDING', 'AUTHORIZED', '2026-10-14T01:00:00Z', NOW),
      describeOverviewItemStatus('PENDING', 'AUTHORIZED', '2026-10-15T00:00:00Z', NOW),
      describeOverviewItemStatus('PENDING', 'REVOKED', '2026-10-14T01:00:00Z', NOW),
      describeReelHeadline([]),
      describeReelHeadline([
        { status: 'in_review', published_at: null },
        { status: 'in_review', published_at: null },
        { status: 'published', published_at: '2026-10-13T00:00:00Z' },
      ]),
      describeVarietyLine({ same_track_max: 0, price_screen_count: 0, total: 0 }).text,
      describeVarietyLine({ same_track_max: 1, price_screen_count: 1, total: 4 }).text,
      describeVarietyLine({ same_track_max: 2, price_screen_count: 0, total: 4 }).text,
      describeVarietyLine({ same_track_max: 1, price_screen_count: 2, total: 5 }).text,
      describeVarietyLine({ same_track_max: 1, price_screen_count: 1, total: 3 }).text,
      describeVarietyLine({ same_track_max: 0, price_screen_count: 0, total: 4 }).text,
    ]
    const bareSent = /(?<!库里记为)已发/
    for (const text of strings) {
      expect(text).not.toMatch(bareSent)
    }
  })
})

describe('describeReelHeadline', () => {
  it('says there is nothing to look at when there are no reels', () => {
    expect(describeReelHeadline([])).toBe('Reel：现在没有可看的 Reel')
  })

  it('counts reels in review and recorded uploads', () => {
    expect(
      describeReelHeadline([
        { status: 'in_review', published_at: null },
        { status: 'in_review', published_at: null },
        { status: 'published', published_at: '2026-10-13T00:00:00Z' },
      ]),
    ).toBe('Reel：在审 2 · 库里记为已上传 1（平台状态未核）')
  })
})

describe('describeVarietyLine', () => {
  it('says there is nothing to count when the total is zero', () => {
    expect(describeVarietyLine({ same_track_max: 0, price_screen_count: 0, total: 0 })).toEqual({
      text: '最近的 Reel：没有 Reel，不统计',
      warn: false,
    })
  })

  it('does not warn for a single track and a low price screen share', () => {
    const result = describeVarietyLine({ same_track_max: 1, price_screen_count: 1, total: 4 })
    expect(result.warn).toBe(false)
    expect(result.text).toBe('最近 4 条 Reel：同一首 BGM 最多出现 1 次；价格屏 1/4')
  })

  it('warns when the same track appears twice', () => {
    const result = describeVarietyLine({ same_track_max: 2, price_screen_count: 0, total: 4 })
    expect(result.warn).toBe(true)
    expect(result.text.endsWith('（规则见放行规则文档）')).toBe(true)
  })

  it('warns when price screens exceed one third of the total', () => {
    expect(describeVarietyLine({ same_track_max: 1, price_screen_count: 2, total: 5 }).warn).toBe(true)
  })

  it('does not warn when price screens are exactly one third of the total', () => {
    expect(describeVarietyLine({ same_track_max: 1, price_screen_count: 1, total: 3 }).warn).toBe(false)
  })

  it('says the track was not read when the max is zero', () => {
    expect(
      describeVarietyLine({ same_track_max: 0, price_screen_count: 0, total: 4 }).text,
    ).toContain('BGM 未读到')
  })
})

describe('nzDateKey', () => {
  it('changes the New Zealand day at 11:00 UTC during daylight saving', () => {
    expect(nzDateKey('2026-10-18T10:59:00Z')).toBe('2026-10-18')
    expect(nzDateKey('2026-10-18T11:01:00Z')).toBe('2026-10-19')
  })
})
