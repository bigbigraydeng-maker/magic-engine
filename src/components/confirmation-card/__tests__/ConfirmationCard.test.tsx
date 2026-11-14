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
    expect(screen.getAllByText('每天一百新西兰元').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('确认时会再核对一次，条件不成立就拒绝。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '不做' })).toBeEnabled()
    expect(screen.getAllByRole('button', { name: /^(确认|不做)$/ })).toHaveLength(2)
    expect(document.body.textContent ?? '').not.toContain('{')
    expect(document.body.textContent ?? '').not.toMatch(/[0-9a-f]{64}/)
  })

  it('shows add-creative detail instead of generic account rows', () => {
    render(
      <ConfirmationCard
        {...base}
        what="往这个广告组加一条图片广告"
        confirmEnabled
        declineEnabled
        blockedReason={null}
        addCreativeDetail={{
          imageUrl: 'https://project.example.supabase.co/storage/v1/object/public/content-factory/demo.jpg',
          imageFilename: 'demo.jpg',
          adName: '春季海报',
          headline: '标题',
          primaryText: '正文全文',
          ctaLabel: '了解更多',
          adSetLabel: '998877665544（组名未记录）',
          newAdStatusLabel: '先暂停',
          confirmSentence: '确认后：在这个广告组里新建一条暂停中的广告，用上面的图和文字；预算不变。',
        }}
      />,
    )
    expect(screen.getByText('春季海报')).toBeInTheDocument()
    expect(screen.getByText('正文全文')).toBeInTheDocument()
    expect(screen.getByText('加到哪个广告组：')).toBeInTheDocument()
    expect(screen.getByAltText('待加的图片预览')).toBeInTheDocument()
    expect(screen.queryByText('账户：')).not.toBeInTheDocument()
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
