import { describe, expect, it } from 'vitest'

import type { StoryTally } from '../../story-lite/page-text'
import { describeStoryChips, describeStoryItemState, describeStoryPackLine } from '../story-view'

const EMPTY: StoryTally = { total: 0, recordedSent: 0, overdue: 0, waiting: 0, blocked: 0, stopped: 0, unauthorised: 0 }
const NOW = new Date('2026-10-14T00:00:00Z')

describe('describeStoryChips', () => {
  it('lists only non-empty counts, what needs a person first', () => {
    const chips = describeStoryChips({ ...EMPTY, total: 8, unauthorised: 1, blocked: 2, overdue: 1, waiting: 2, recordedSent: 1, stopped: 1 })
    expect(chips.map((c) => `${c.label} ${c.count}`)).toEqual(['还没授权 1', '被拦或出错 2', '过点没发出 1', '待发 2', '已发出（未核对） 1', '已停或授权过期 1'])
    expect(describeStoryChips(EMPTY)).toEqual([])
  })

  it('"sent" always says it has not been checked against Facebook', () => {
    const sent = describeStoryChips({ ...EMPTY, total: 1, recordedSent: 1 })[0]
    expect(sent.label).toBe('已发出（未核对）')
    expect(sent.hint).toContain('还没有逐条和 Facebook 主页核对')
  })
})

describe('describeStoryItemState', () => {
  it('a sent Story is never called plainly sent', () => {
    expect(describeStoryItemState('SENT', 'AUTHORIZED', '2026-10-13T00:00:00Z', NOW)).toBe('已发出（未核对 Facebook）')
  })

  it('a waiting Story in a week nobody authorised says it will not go out', () => {
    expect(describeStoryItemState('PENDING', 'DRAFT', '2026-10-15T00:00:00Z', NOW)).toBe('还没授权，不会发')
  })

  it('a waiting Story past its time (after the grace period) says it did not go out, in plain words', () => {
    expect(describeStoryItemState('PENDING', 'AUTHORIZED', '2026-10-13T00:00:00Z', NOW)).toBe('已过点，没发出（系统里仍是待发）')
    expect(describeStoryItemState('PENDING', 'AUTHORIZED', '2026-10-13T23:55:00Z', NOW)).toBe('等待发布')
  })

  it('stopped or expired weeks and the other states keep their plain wording', () => {
    expect(describeStoryItemState('PENDING', 'REVOKED', '2026-10-15T00:00:00Z', NOW)).toBe('已停，不会发')
    expect(describeStoryItemState('PENDING', 'EXPIRED', '2026-10-15T00:00:00Z', NOW)).toBe('授权已过期，不会发')
    expect(describeStoryItemState('BLOCKED', 'AUTHORIZED', '2026-10-15T00:00:00Z', NOW)).toBe('检查没通过，没发')
    expect(describeStoryItemState('UNKNOWN_OUTCOME', 'AUTHORIZED', '2026-10-15T00:00:00Z', NOW)).toContain('请到 Facebook 主页核对')
  })
})

describe('describeStoryPackLine', () => {
  it('says which week is in play, whether it is authorised and until when; a failed read is never "no pack"', () => {
    expect(describeStoryPackLine(null, true)).toBe('现在读不到 Story 周包，不知道是否已授权。')
    expect(describeStoryPackLine(null, false)).toBe('没有进行中的 Story 周包。')
    expect(describeStoryPackLine({ title: '第3周', state: 'DRAFT', expires_at: null }, false)).toBe('「第3周」还没授权。')
    expect(describeStoryPackLine({ title: '第3周', state: 'AUTHORIZED', expires_at: '2026-10-20T08:00:00Z' }, false)).toBe('「第3周」已授权（10月20日 周二前有效）。')
  })
})
