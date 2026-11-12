import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DeliveryView } from '@/lib/marketing-plan/promo/stage-evidence'
import { DeliveryStageCard } from '../DeliveryStageCard'

function view(stage: DeliveryView['stage'], canPropose = false): DeliveryView {
  return {
    stage,
    stage_label: stage === 'steady' ? '稳住' : '试投',
    goal: '按已经证明的比例做',
    ratio_text: '比例只是提醒',
    switch_text: '不改预算',
    can_propose: canPropose,
    draft_note: null,
    ladder_note: '先广后窄',
    rungs: [{ title: '广泛', detail: '先广', suggested: true }],
  }
}

describe('投放阶段按钮', () => {
  it('已批准且还不是稳住时，确认后只标为稳住', async () => {
    const onMark = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<DeliveryStageCard view={view('test', true)} busy={false} canAct onMark={onMark} onPropose={vi.fn()} actionsOnly />)
    await userEvent.click(screen.getByRole('button', { name: '标为稳住' }))
    expect(window.confirm).toHaveBeenCalledWith('只改阶段，不改预算和上限')
    expect(onMark).toHaveBeenCalledWith('steady')
    expect(screen.getByRole('button', { name: '生成放量草稿' })).toBeInTheDocument()
  })

  it('点生成放量草稿要先过确认弹窗', async () => {
    const onPropose = vi.fn()
    render(<DeliveryStageCard view={view('test', true)} busy={false} canAct onPropose={onPropose} onMark={vi.fn()} actionsOnly />)
    await userEvent.click(screen.getByRole('button', { name: '生成放量草稿' }))
    expect(onPropose).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '生成草稿' }))
    expect(onPropose).toHaveBeenCalledOnce()
  })

  it('取消确认就不改', async () => {
    const onMark = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<DeliveryStageCard view={view(null)} busy={false} canAct onMark={onMark} actionsOnly />)
    await userEvent.click(screen.getByRole('button', { name: '标为稳住' }))
    expect(onMark).not.toHaveBeenCalled()
  })

  it('已经稳住时，按钮是改回试投', async () => {
    const onMark = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<DeliveryStageCard view={view('steady')} busy={false} canAct onMark={onMark} actionsOnly />)
    await userEvent.click(screen.getByRole('button', { name: '改回试投' }))
    expect(onMark).toHaveBeenCalledWith('test')
    expect(screen.queryByRole('button', { name: '标为稳住' })).not.toBeInTheDocument()
  })

  it('计划还没批准就不给这两个按钮', () => {
    render(<DeliveryStageCard view={view('test', true)} busy={false} canAct={false} onMark={vi.fn()} onPropose={vi.fn()} actionsOnly />)
    expect(screen.queryByRole('button', { name: '标为稳住' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '生成放量草稿' })).not.toBeInTheDocument()
  })
})
