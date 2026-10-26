import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmationCard } from '../ConfirmationCard'

const base = {
  what: '记下要不要调每周预算',
  account: '测试广告账户',
  amount: '每天一百新西兰元',
  date: '下周一',
  scope: '只记这一张卡，不改广告',
  expiresLabel: '请在 10月27日 13:30（新西兰时间）前点。过了要重新出一张。',
  statusLine: '还没人点。',
  onConfirm: vi.fn(),
  onDecline: vi.fn(),
}

describe('ConfirmationCard', () => {
  it('shows the plain facts and only the two buttons', () => {
    render(<ConfirmationCard {...base} confirmEnabled declineEnabled blockedReason={null} />)
    expect(screen.getByText('记下要不要调每周预算')).toBeInTheDocument()
    expect(screen.getByText('测试广告账户')).toBeInTheDocument()
    expect(screen.getByText('每天一百新西兰元')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '不做' })).toBeEnabled()
    expect(screen.getAllByRole('button')).toHaveLength(2)
    expect(document.body.textContent ?? '').not.toContain('{')
    expect(document.body.textContent ?? '').not.toMatch(/[0-9a-f]{64}/)
  })

  it('greys out confirm and shows the reason when a hard check failed', () => {
    render(
      <ConfirmationCard
        {...base}
        confirmEnabled={false}
        declineEnabled
        blockedReason="花费：已经超了今天的上限"
      />,
    )
    expect(screen.getByRole('button', { name: '确认' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '不做' })).toBeEnabled()
    expect(screen.getByText('花费：已经超了今天的上限')).toBeInTheDocument()
  })
})
