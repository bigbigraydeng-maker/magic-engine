import { describe, expect, it } from 'vitest'
import { matchDrafts } from './draft-match'
import type { DraftRow, PlanFact, PoolFact } from './types'

function plan(over: Partial<PlanFact>): PlanFact {
  return {
    id: 'plan-1',
    status: 'approved',
    createdAt: '2026-10-20T00:00:00.000Z',
    goalId: 'goal-1',
    adsStepCount: 1,
    creativeRefs: ['video-1'],
    ...over,
  }
}

function row(over: Partial<DraftRow>): DraftRow {
  return { id: 'a-1', status: 'awaiting_approval', executionItemId: null, creativeIds: ['video-1'], ...over }
}

const pool: PoolFact[] = [
  { ref: 'video-1', status: 'approved', aliasRefs: ['post-1'], promoWindow: null },
  { ref: 'video-2', status: 'approved', aliasRefs: [], promoWindow: null },
]

const base = { itemIds: new Set<string>(), goalId: 'goal-1', pool }

describe('matchDrafts', () => {
  it('finds a draft whose creative the prescription plan names, with no execution item', () => {
    const result = matchDrafts({ ...base, rows: [row({})], plans: { read: 'ok', value: [plan({})] } })
    expect(result).toEqual({ read: 'ok', value: [{ status: 'awaiting_approval' }] })
  })

  it('matches through a pool alias', () => {
    const result = matchDrafts({
      ...base,
      rows: [row({ creativeIds: ['post-1'], status: 'active' })],
      plans: { read: 'ok', value: [plan({})] },
    })
    expect(result).toEqual({ read: 'ok', value: [{ status: 'active' }] })
  })

  it('says unread, not "no draft", when nothing matches', () => {
    const result = matchDrafts({
      ...base,
      rows: [row({ creativeIds: ['video-9'] })],
      plans: { read: 'ok', value: [plan({})] },
    })
    expect(result).toEqual({ read: 'unread' })
  })

  it('says unread when the plan cannot be read or has no linked plan', () => {
    expect(matchDrafts({ ...base, rows: [row({})], plans: { read: 'unread' } })).toEqual({ read: 'unread' })
    expect(matchDrafts({ ...base, rows: [row({})], plans: { read: 'ok', value: [] } })).toEqual({ read: 'unread' })
    expect(matchDrafts({ ...base, goalId: null, rows: [row({})], plans: { read: 'ok', value: [plan({})] } }))
      .toEqual({ read: 'unread' })
  })

  it('keeps several drafts of the same prescription that share one creative', () => {
    const result = matchDrafts({
      ...base,
      rows: [row({ id: 'a-1', status: 'awaiting_approval' }), row({ id: 'a-2', status: 'active' })],
      plans: { read: 'ok', value: [plan({})] },
    })
    expect(result).toEqual({ read: 'ok', value: [{ status: 'awaiting_approval' }, { status: 'active' }] })
  })

  it('does not attribute a draft whose creative another goal plan also names', () => {
    const other = plan({ id: 'plan-2', goalId: 'goal-2', creativeRefs: ['video-1'] })
    const result = matchDrafts({ ...base, rows: [row({})], plans: { read: 'ok', value: [plan({}), other] } })
    expect(result).toEqual({ read: 'unread' })
  })

  it('ignores archived plans of other goals when checking for sharing', () => {
    const other = plan({ id: 'plan-2', goalId: 'goal-2', status: 'archived' })
    const result = matchDrafts({ ...base, rows: [row({})], plans: { read: 'ok', value: [plan({}), other] } })
    expect(result.read).toBe('ok')
  })

  it('still uses the old execution item link', () => {
    const result = matchDrafts({
      ...base,
      itemIds: new Set(['item-1']),
      rows: [row({ creativeIds: [], executionItemId: 'item-1', status: 'blocked' })],
      plans: { read: 'unread' },
    })
    expect(result).toEqual({ read: 'ok', value: [{ status: 'blocked' }] })
  })
})
