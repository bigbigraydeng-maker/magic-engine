import { describe, expect, it } from 'vitest'
import { assessGoalForBlankDraft, buildBlankDraftInsert, readBlankDraftGoalId } from '../blank-draft'

const draftGoal = {
  id: 'goal-draft',
  title: 'CTS11月China Tour推广',
  status: 'draft',
  period_start: '2026-10-25',
  period_end: '2026-11-30',
}

describe('空白草稿计划的插入行', () => {
  it('草稿目标可以挂上，推广结构是空的，状态固定为草稿', () => {
    const built = buildBlankDraftInsert('client-1', draftGoal)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.row.status).toBe('draft')
    expect(built.row.approved_at).toBeNull()
    expect(built.row.title).toBe('CTS11月China Tour推广')
    expect(built.row.plan_data.tasks).toEqual([])
    expect(built.row.plan_data).not.toHaveProperty('promo')
    expect(built.row.generation_meta).toEqual({ blank_draft: { goal_id: 'goal-draft' } })
    expect(JSON.stringify(built.row)).not.toContain('春节后促销')
  })

  it('进行中的目标也可以挂', () => {
    const built = buildBlankDraftInsert('client-1', { ...draftGoal, status: 'active' })
    expect(built.ok).toBe(true)
  })

  it.each(['expired', 'archived'])('%s 目标不能用来建新草稿', (status) => {
    const built = buildBlankDraftInsert('client-1', { ...draftGoal, status })
    expect(built.ok).toBe(false)
  })

  it('没有标题、或迁移占位标题，不能建', () => {
    expect(assessGoalForBlankDraft({ ...draftGoal, title: '  ' }).ok).toBe(false)
    expect(assessGoalForBlankDraft({ ...draftGoal, title: '[Migration] Unassigned Backlog' }).ok).toBe(false)
    expect(assessGoalForBlankDraft(null).ok).toBe(false)
  })

  it('从 generation_meta 读回创建时挂上的目标', () => {
    expect(readBlankDraftGoalId({ blank_draft: { goal_id: 'goal-draft' } })).toBe('goal-draft')
    expect(readBlankDraftGoalId(null)).toBe('')
    expect(readBlankDraftGoalId({})).toBe('')
  })
})
