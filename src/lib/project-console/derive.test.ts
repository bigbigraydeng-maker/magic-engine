import { describe, expect, it } from 'vitest'
import { chainStep } from '@/lib/prescription-chain/steps'
import { CHAIN_STEP_IDS, type ChainStatus, type ChainStepId, type ChainStepState } from '@/lib/prescription-chain/types'
import { compareProjects, deriveProject } from './derive'
import type { ProjectFigures, ProjectInput } from './types'

const CLIENT = 'client-1'

function chain(states: Partial<Record<ChainStepId, ChainStepState>>, detail?: Partial<Record<ChainStepId, string>>): ChainStatus {
  return {
    prescriptionId: 'rx-1',
    snapshotStale: false,
    steps: CHAIN_STEP_IDS.map((id) => chainStep(id, states[id] ?? 'waiting', detail?.[id] ?? '需要人。')),
  }
}

function figures(over: Partial<ProjectFigures> = {}): ProjectFigures {
  return {
    monthlyBudget: null,
    budgetCurrency: null,
    metricLabel: null,
    targetValue: null,
    currentValue: null,
    dailyCapCents: null,
    partial: false,
    ...over,
  }
}

function input(over: Partial<ProjectInput> = {}): ProjectInput {
  return {
    clientId: CLIENT,
    clientName: '北岛旅行',
    goalId: 'goal-1',
    goalTitle: '这个月多接询盘',
    prescriptionId: 'rx-1',
    brandScan: 'confirmed',
    chain: chain({ inspect: 'done', measure: 'done', confirm: 'done', prescribe: 'done' }),
    pausedDraftPending: false,
    goLiveDraftIds: [],
    review: null,
    figures: figures(),
    ...over,
  }
}

describe('deriveProject', () => {
  it('stops at the brand scan when none is confirmed, and does not invent a chain or a budget', () => {
    const view = deriveProject(input({
      prescriptionId: null,
      goalId: null,
      goalTitle: null,
      brandScan: 'missing',
      chain: null,
      figures: figures({ monthlyBudget: null, targetValue: null }),
    }))
    expect(view.current).toMatchObject({ id: 'inspect', state: 'blocked' })
    expect(view.current.detail).toContain('还没有确认过的品牌扫描')
    expect(view.waiting).toMatchObject({ card: '去做品牌扫描', who: '内部同事' })
    expect(view.waiting?.href).toContain('/zhangqian')
    expect(view.numbers).toEqual([])
    expect(view.stages.find((stage) => stage.id === 'prescribe')?.state).toBe('waiting')
  })

  it('sends a confirmed scan with no prescription to 华佗, without marking measure done', () => {
    const view = deriveProject(input({ prescriptionId: null, chain: null, brandScan: 'confirmed' }))
    expect(view.current.id).toBe('prescribe')
    expect(view.waiting).toMatchObject({ card: '去跟华佗开方' })
    expect(view.waiting?.href).toContain('goal_id=goal-1')
    expect(view.stages.find((stage) => stage.id === 'measure')?.state).toBe('waiting')
    expect(view.stages.find((stage) => stage.id === 'confirm')?.state).toBe('waiting')
  })

  it('asks the prescription approver to agree, and does not call a later unread draft the current click', () => {
    const view = deriveProject(input({
      chain: chain({
        inspect: 'done',
        measure: 'done',
        confirm: 'done',
        prescribe: 'done',
        consent: 'active',
        draft: 'unread',
        launch: 'unread',
      }, { consent: '等内部账号点同意。' }),
    }))
    expect(view.current.id).toBe('prescribe')
    expect(view.showConsent).toBe(true)
    expect(view.waiting).toMatchObject({ card: '同意这张方', who: '能批处方的内部账号' })
  })

  it('names the go-live card when launch is waiting on a click, and keeps the draft id', () => {
    const view = deriveProject(input({
      chain: chain({
        inspect: 'done',
        measure: 'done',
        confirm: 'done',
        prescribe: 'done',
        consent: 'done',
        plan: 'done',
        creative: 'done',
        draft: 'done',
        launch: 'active',
      }, { launch: '等点开投。' }),
      goLiveDraftIds: ['draft-1'],
    }))
    expect(view.current.id).toBe('act')
    expect(view.waiting).toMatchObject({ card: '开投确认卡', who: '能点开投的人', href: '/dashboard/ad-approval' })
    expect(view.goLiveDraftIds).toEqual(['draft-1'])
    expect(view.goLiveUnread).toBe(false)
  })

  it('does not say there is no go-live card when the draft match failed', () => {
    const view = deriveProject(input({
      chain: chain({
        inspect: 'done',
        measure: 'done',
        confirm: 'done',
        prescribe: 'done',
        consent: 'done',
        plan: 'done',
        creative: 'done',
        draft: 'done',
        launch: 'active',
      }),
      goLiveDraftIds: 'unread',
    }))
    expect(view.goLiveDraftIds).toEqual([])
    expect(view.goLiveUnread).toBe(true)
    expect(view.waiting?.card).toBe('开投确认卡')
  })

  it('puts the paused draft card ahead of go-live', () => {
    const view = deriveProject(input({
      chain: chain({
        inspect: 'done',
        measure: 'done',
        confirm: 'done',
        prescribe: 'done',
        consent: 'done',
        plan: 'done',
        creative: 'done',
        draft: 'done',
        launch: 'active',
      }),
      pausedDraftPending: true,
      goLiveDraftIds: ['draft-1'],
    }))
    expect(view.waiting).toMatchObject({ card: '暂停草稿确认卡', who: '这个客户的负责人，或内部批准人' })
  })

  it('asks for a review after launch, then for a global admin to adopt a lesson', () => {
    const launched = chain({
      inspect: 'done',
      measure: 'done',
      confirm: 'done',
      prescribe: 'done',
      consent: 'done',
      plan: 'done',
      creative: 'done',
      draft: 'done',
      launch: 'done',
    })
    const before = deriveProject(input({ chain: launched, review: null }))
    expect(before.current.id).toBe('check')
    expect(before.waiting).toMatchObject({ card: '去看投放和复盘' })
    expect(before.stages.find((stage) => stage.id === 'tune')?.state).toBe('waiting')

    const after = deriveProject(input({ chain: launched, review: { createdAt: '2026-10-28T00:00:00.000Z' } }))
    expect(after.current.id).toBe('tune')
    expect(after.stages.find((stage) => stage.id === 'check')?.state).toBe('done')
    expect(after.waiting).toMatchObject({ card: '到广告引擎采纳候选经验', who: '全局管理员' })
  })

  it('shows only numbers that were read, and says so when the read failed', () => {
    const shown = deriveProject(input({
      figures: figures({
        monthlyBudget: 3700,
        budgetCurrency: 'NZD',
        metricLabel: '询盘',
        targetValue: 30,
        currentValue: null,
        dailyCapCents: 10000,
      }),
    }))
    expect(shown.numbers.map((item) => item.label)).toEqual(['每月预算', '目标（询盘）', '每天预算上限'])
    expect(shown.numbers.map((item) => item.value)).toEqual(['NZ$3,700.00', '30', 'NZ$100.00'])
    expect(shown.numbersNote).toBeNull()

    const missed = deriveProject(input({ figures: 'unread' }))
    expect(missed.numbers).toEqual([])
    expect(missed.numbersNote).toBe('关键数字这次没读到。')

    const partial = deriveProject(input({
      figures: figures({ monthlyBudget: 10, budgetCurrency: 'AUD', partial: true }),
    }))
    expect(partial.numbers).toEqual([{ label: '每月预算', value: 'A$10.00' }])
    expect(partial.numbersNote).toBe('有的数字这次没读到。')
  })

  it('does not treat an unread inspect step as finished', () => {
    const view = deriveProject(input({
      chain: chain({ inspect: 'unread' }),
    }))
    expect(view.current).toMatchObject({ id: 'inspect', state: 'unread', stateLabel: '读不到' })
    expect(view.waiting?.card).toContain('读不到')
  })

  it('does not call an existing prescription missing when the chain read fails', () => {
    const view = deriveProject(input({ chain: null, figures: 'unread' }))
    expect(view.current).toMatchObject({ id: 'inspect', state: 'unread' })
    expect(view.stages.every((stage) => stage.state === 'unread')).toBe(true)
    expect(view.stages.find((stage) => stage.id === 'prescribe')?.detail).not.toContain('还没开方')
    expect(view.showConsent).toBe(false)
  })

  it('sorts a project that needs a click ahead of one that does not', () => {
    const quiet = deriveProject(input({
      clientName: '甲',
      chain: chain({ prescribe: 'active' }, { prescribe: '正在开方。' }),
    }))
    const loud = deriveProject(input({ clientName: '乙', brandScan: 'missing', prescriptionId: null, chain: null }))
    expect(quiet.waiting).toBeNull()
    const ordered = [quiet, loud].sort(compareProjects).map((view) => view.clientName)
    expect(ordered).toEqual(['乙', '甲'])
  })
})
