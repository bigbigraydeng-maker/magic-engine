import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  APPROVE_CONFIRM_TEXT,
  APPROVE_SPEND_REMINDER,
  ManualDraftBanner,
  PrescriberLine,
  PrescriptionReviewActions,
  REJECT_BUTTON_LABEL,
  REJECT_CONFIRM_TEXT,
} from '../review-actions'

describe('处方审阅确认', () => {
  it('does not approve until the confirm step is accepted', async () => {
    const onApprove = vi.fn()
    const onReject = vi.fn()
    const user = userEvent.setup()
    render(
      <PrescriptionReviewActions onApprove={onApprove} onReject={onReject} isApproving={false} />,
    )

    await user.click(screen.getByRole('button', { name: '✓ 批准并生成执行计划' }))
    expect(onApprove).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: '确认批准' })).toHaveTextContent(APPROVE_CONFIRM_TEXT)
    expect(screen.getByRole('alertdialog', { name: '确认批准' })).toHaveTextContent(APPROVE_SPEND_REMINDER)
    expect(APPROVE_SPEND_REMINDER).toBe('提醒：这份处方里 Agent 给的账户和日预算只是建议，批准处方不等于批准花钱；花钱要另外在计划页批准计划、在审批页点开广告。')
    expect(APPROVE_CONFIRM_TEXT).not.toContain('看板上会出现待办')
    expect(APPROVE_CONFIRM_TEXT).toContain('按阶段排好')

    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(onApprove).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '✓ 批准并生成执行计划' }))
    await user.click(screen.getByRole('button', { name: '确定批准' }))
    expect(onApprove).toHaveBeenCalledTimes(1)
    expect(onReject).not.toHaveBeenCalled()
  })

  it('labels 要求修改 as setting rejected, and waits for confirm', async () => {
    const onApprove = vi.fn()
    const onReject = vi.fn()
    const user = userEvent.setup()
    render(
      <PrescriptionReviewActions onApprove={onApprove} onReject={onReject} isApproving={false} />,
    )

    await user.click(screen.getByRole('button', { name: REJECT_BUTTON_LABEL }))
    expect(onReject).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: '确认标为已拒绝' })).toHaveTextContent(REJECT_CONFIRM_TEXT)
    expect(screen.getByRole('alertdialog', { name: '确认标为已拒绝' })).not.toHaveTextContent('批准处方不等于批准花钱')
    expect(REJECT_BUTTON_LABEL).toContain('已拒绝')

    await user.click(screen.getByRole('button', { name: '确定标为已拒绝' }))
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onApprove).not.toHaveBeenCalled()
  })
})

describe('开方人与人工草稿提示', () => {
  it('shows the prescriber', () => {
    render(<PrescriberLine agentName="广告 Agent" />)
    expect(screen.getByText('广告 Agent')).toBeInTheDocument()
    expect(screen.getByText(/开方人/)).toBeInTheDocument()
  })

  it('hides the line when the prescriber is unknown', () => {
    const { container } = render(<PrescriberLine agentName={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('says approving a manual draft records stages under the goal', () => {
    render(<ManualDraftBanner show />)
    expect(screen.getByRole('status')).toHaveTextContent('未批准')
    expect(screen.getByRole('status')).toHaveTextContent('按阶段排好')
    expect(screen.getByRole('status')).not.toHaveTextContent('看板上会出现待办')
    expect(screen.getByRole('status')).not.toHaveTextContent('看板上的待办')
  })
})
