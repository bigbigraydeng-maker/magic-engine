import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  APPROVE_CONFIRM_TEXT,
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

  it('warns that approving a manual draft creates board tasks', () => {
    render(<ManualDraftBanner show />)
    expect(screen.getByRole('status')).toHaveTextContent('未批准')
    expect(screen.getByRole('status')).toHaveTextContent('待办')
  })
})
