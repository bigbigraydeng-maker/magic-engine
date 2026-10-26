import { describe, expect, it } from 'vitest'

import type { StoryTally } from '../../story-lite/page-text'
import type { OverviewReel } from '../build'
import { groupReelWorks } from '../reel-works'
import { buildReelTodoSummary, buildTodoSummary, type TodoInput } from '../todo'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const NO_STORY_ISSUES: StoryTally = { total: 0, recordedSent: 0, overdue: 0, waiting: 0, blocked: 0, stopped: 0, unauthorised: 0 }

function reel(id: string, status: string, angle: string): OverviewReel {
  return { id, status, angle, created_at: '2026-10-20T00:00:00Z', published_at: null, permalink: null, video_state: null, music_file: null, template: 'postcard' }
}

function input(overrides: Partial<TodoInput> = {}): TodoInput {
  return { clientId: CLIENT, works: [], story: null, storyFailed: false, tally: NO_STORY_ISSUES, ...overrides }
}

describe('buildTodoSummary', () => {
  it('counts Reel works waiting for review and Reel works in trouble, with the entry link the page always had', () => {
    const works = groupReelWorks([reel('1', 'in_review', 'One: a'), reel('2', 'in_review', 'Two: a'), reel('3', 'review_rejected', 'Three: a'), reel('4', 'approved', 'Four: a')])
    const summary = buildTodoSummary(input({ works }))
    expect(summary.total).toBe(3)
    expect(summary.items.map((i) => [i.id, i.count, i.cta])).toEqual([
      ['reel_review', 2, '去视频工厂看 / 点通过'],
      ['reel_problem', 1, '去视频工厂看'],
    ])
    expect(summary.items[0].href).toBe(`/dashboard/factory?client=${CLIENT}`)
    expect(summary.unknown).toEqual([])
  })

  it('a Story week nobody authorised, and a newer waiting week, each need one click on the Story page', () => {
    const story = { title: '第3周', state: 'DRAFT' as const, itemCount: 3, newerDraftTitle: null }
    const draft = buildTodoSummary(input({ story }))
    expect(draft.items.map((i) => i.id)).toEqual(['story_authorize'])
    expect(draft.items[0].href).toBe(`/dashboard/clients/${CLIENT}/story`)
    const newer = buildTodoSummary(input({ story: { ...story, state: 'AUTHORIZED', newerDraftTitle: '第4周' } }))
    expect(newer.items.map((i) => i.id)).toEqual(['story_newer_draft'])
    const empty = buildTodoSummary(input({ story: { ...story, itemCount: 0 } }))
    expect(empty.total).toBe(0)
  })

  it('blocked and missed Stories are counted one by one', () => {
    const summary = buildTodoSummary(input({ tally: { ...NO_STORY_ISSUES, total: 5, blocked: 2, overdue: 1 } }))
    expect(summary.items.map((i) => [i.id, i.count])).toEqual([
      ['story_blocked', 2],
      ['story_overdue', 1],
    ])
    expect(summary.total).toBe(3)
  })

  it('a part that could not be read is reported as unknown, never counted as nothing to do', () => {
    const failedReels = buildTodoSummary(input({ works: null }))
    expect(failedReels).toMatchObject({ total: 0, unknown: ['视频'] })
    const failedBoth = buildTodoSummary(input({ works: null, storyFailed: true }))
    expect(failedBoth.unknown).toEqual(['视频', 'Story'])
    const works = groupReelWorks([reel('1', 'in_review', 'One: a')])
    const partial = buildTodoSummary(input({ works, storyFailed: true }))
    expect(partial).toMatchObject({ total: 1, unknown: ['Story'] })
  })

  it('nothing waiting and everything readable gives a clean zero', () => {
    expect(buildTodoSummary(input())).toEqual({ total: 0, items: [], unknown: [] })
  })
})

describe('buildReelTodoSummary (the 短视频 tab)', () => {
  it('counts only the Reel part, with the same entries as the overview', () => {
    const works = groupReelWorks([reel('1', 'in_review', 'One: a'), reel('2', 'publish_failed', 'Two: a'), reel('3', 'approved', 'Three: a')])
    const summary = buildReelTodoSummary(CLIENT, works)
    expect(summary.total).toBe(2)
    expect(summary.items.map((i) => [i.id, i.count, i.cta, i.href])).toEqual([
      ['reel_review', 1, '去视频工厂看 / 点通过', `/dashboard/factory?client=${CLIENT}`],
      ['reel_problem', 1, '去视频工厂看', `/dashboard/factory?client=${CLIENT}`],
    ])
    expect(summary.unknown).toEqual([])
  })

  it('a failed Reel read is unknown, not zero; nothing waiting is a clean zero', () => {
    expect(buildReelTodoSummary(CLIENT, null)).toEqual({ total: 0, items: [], unknown: ['视频'] })
    expect(buildReelTodoSummary(CLIENT, [])).toEqual({ total: 0, items: [], unknown: [] })
  })
})
