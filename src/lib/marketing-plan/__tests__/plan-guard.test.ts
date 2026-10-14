import { describe, expect, it } from 'vitest'
import {
  canWriteTasksToPlan,
  filterUndispatched,
  isPlanContentLocked,
  isRevertToDraft,
  lockedFieldsTouched,
  planTaskKey,
} from '../plan-guard'
import type { PlanTask } from '../types'

const task = (title: string, due: string): PlanTask => ({
  kind: 'blog_article', title, description: 'd', due_date: due,
})

describe('isPlanContentLocked / canWriteTasksToPlan', () => {
  it.each([
    ['draft', false, false],
    ['approved', true, true],
    ['completed', true, false],
    ['archived', false, false],
  ] as const)('%s → locked=%s, canWriteTasks=%s', (status, locked, canWrite) => {
    expect(isPlanContentLocked(status)).toBe(locked)
    expect(canWriteTasksToPlan(status)).toBe(canWrite)
  })
})

describe('isRevertToDraft', () => {
  it('approved/completed → draft 才算退回草稿', () => {
    expect(isRevertToDraft('approved', 'draft')).toBe(true)
    expect(isRevertToDraft('completed', 'draft')).toBe(true)
  })
  it('草稿保存草稿、没传状态、改成别的状态都不算', () => {
    expect(isRevertToDraft('draft', 'draft')).toBe(false)
    expect(isRevertToDraft('approved', undefined)).toBe(false)
    expect(isRevertToDraft('approved', 'archived')).toBe(false)
  })
})

describe('lockedFieldsTouched', () => {
  it('只统计内容字段，改标题不算', () => {
    expect(lockedFieldsTouched({})).toEqual([])
    expect(lockedFieldsTouched({ plan_data: {}, start_date: 'x', end_date: 'y' }))
      .toEqual(['plan_data', 'start_date', 'end_date'])
  })
})

describe('filterUndispatched', () => {
  it('已派过的（标题+截止日相同）跳过，其余保留并带原下标', () => {
    const tasks = [task('A', '2026-10-20'), task('B', '2026-10-21'), task('C', '2026-10-22')]
    const existing = new Set([planTaskKey('B', '2026-10-21', 'blog_article')])
    const out = filterUndispatched(tasks, existing)
    expect(out.map(o => o.task.title)).toEqual(['A', 'C'])
    expect(out.map(o => o.index)).toEqual([0, 2])
  })
  it('标题相同但截止日不同算两张', () => {
    const tasks = [task('A', '2026-10-20'), task('A', '2026-10-27')]
    expect(filterUndispatched(tasks, new Set())).toHaveLength(2)
  })
  it('同一批里完全重复的只派一次', () => {
    const tasks = [task('A', '2026-10-20'), task('A', '2026-10-20')]
    expect(filterUndispatched(tasks, new Set())).toHaveLength(1)
  })
  it('全部派过 → 空', () => {
    const tasks = [task('A', '2026-10-20')]
    expect(filterUndispatched(tasks, new Set([planTaskKey('A', '2026-10-20', 'blog_article')]))).toEqual([])
  })
  it('标题首尾空格不影响去重', () => {
    expect(planTaskKey(' A ', '2026-10-20')).toBe(planTaskKey('A', '2026-10-20'))
  })
})

describe('planTaskKey — 类型与平台参与去重', () => {
  it('同天同标题、不同平台 → 不同的键', () => {
    expect(planTaskKey('A', '2026-10-20', 'social_post', 'facebook')).not.toBe(planTaskKey('A', '2026-10-20', 'social_post', 'instagram'))
  })
})
