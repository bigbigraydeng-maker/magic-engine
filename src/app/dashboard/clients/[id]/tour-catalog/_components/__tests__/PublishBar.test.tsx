import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PublishBar } from '../PublishBar'
import type { PublishPreviewResponse } from '@/lib/tour-catalog/publish-contract'

function makePreview(overrides: Partial<PublishPreviewResponse>): PublishPreviewResponse {
  return {
    publishedVersion: 3,
    publishedAt: '2026-10-01T02:00:00Z',
    publishedBy: 'a@b.c',
    draftVersion: 9,
    firstPublish: false,
    changes: [],
    changedTourIds: [],
    highRiskCount: 0,
    sellable: { before: 5, after: 5, needsCountConfirm: false },
    afterRevert: null,
    firstPublishRows: [],
    diffHash: 'h',
    ...overrides,
  }
}

function renderBar(overrides: Partial<Parameters<typeof PublishBar>[0]> = {}) {
  const onOpenPublish = vi.fn()
  const onRetry = vi.fn()
  render(
    <PublishBar
      preview={null}
      loading={false}
      error={null}
      onOpenPublish={onOpenPublish}
      onRetry={onRetry}
      {...overrides}
    />,
  )
  return { onOpenPublish, onRetry }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PublishBar', () => {
  it('shows the never-published state', () => {
    const { onOpenPublish } = renderBar({
      preview: makePreview({ firstPublish: true, publishedVersion: 0 }),
    })
    expect(screen.getByText('还没上架过 · 外面还看不到这份目录')).toBeInTheDocument()
    const button = screen.getByRole('button', { name: '查看并上架' })
    expect(button).not.toBeDisabled()
    fireEvent.click(button)
    expect(onOpenPublish).toHaveBeenCalled()
  })

  it('shows pending changes with a high-risk pill', () => {
    const changes = [
      {
        kind: 'tour_field' as const,
        tourId: 't1',
        tourName: 'X',
        field: 'displayPriceText',
        fieldLabel: '展示价',
        before: '1',
        after: '2',
        risk: 'high' as const,
      },
      {
        kind: 'tour_field' as const,
        tourId: 't1',
        tourName: 'X',
        field: 'title',
        fieldLabel: '标题',
        before: 'a',
        after: 'b',
        risk: 'normal' as const,
      },
    ]
    renderBar({ preview: makePreview({ changes, highRiskCount: 1 }) })
    expect(screen.getByText(/有 2 处改动还没上架 · 客人现在看到的是第 3 版（/)).toBeInTheDocument()
    expect(screen.getByText('其中 1 处涉及价格或班期')).toBeInTheDocument()
  })

  it('omits the pill when there is no high risk', () => {
    const changes = [
      {
        kind: 'tour_field' as const,
        tourId: 't1',
        tourName: 'X',
        field: 'title',
        fieldLabel: '标题',
        before: 'a',
        after: 'b',
        risk: 'normal' as const,
      },
    ]
    renderBar({ preview: makePreview({ changes, highRiskCount: 0 }) })
    expect(screen.queryByText(/涉及价格或班期/)).not.toBeInTheDocument()
  })

  it('shows the in-sync state with a disabled button', () => {
    renderBar({ preview: makePreview({}) })
    expect(screen.getByText(/已上架第 3 版/)).toBeInTheDocument()
    expect(screen.getByText(/草稿和对外内容一致/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看并上架' })).toBeDisabled()
    expect(screen.getByLabelText('上架状态')).toHaveAttribute('data-tone', 'ok')
  })

  it('shows the after-revert warning as one paragraph', () => {
    const change = {
      kind: 'tour_field' as const,
      tourId: 't1',
      tourName: 'X',
      field: 'displayPriceText',
      fieldLabel: '展示价',
      before: '1',
      after: '2',
      risk: 'high' as const,
    }
    renderBar({
      preview: makePreview({
        afterRevert: { toVersion: 2 },
        changes: [change, { ...change, field: 'title', fieldLabel: '标题', risk: 'normal' as const }],
        highRiskCount: 1,
      }),
    })
    const bar = screen.getByLabelText('上架状态')
    expect(bar).toHaveAttribute('data-tone', 'danger')
    const paragraphs = bar.querySelectorAll('p')
    expect(paragraphs).toHaveLength(1)
    const text = paragraphs[0].textContent ?? ''
    expect(text).toMatch(/^客人现在看到的是第 3 版（内容换回了第 2 版，\d+月\d+日 \d{2}:\d{2}）。/)
    expect(text).toContain(
      '草稿和它有 2 处不同，其中 1 处涉及价格或班期。请先把草稿里的错改掉；直接上架会把当时换掉的内容重新发出去。',
    )
    expect(text).not.toContain('仍是')
    expect(screen.getByRole('button', { name: '查看并上架' })).not.toBeDisabled()
  })

  it('after a revert, leaves out the price clause when nothing risky differs', () => {
    renderBar({
      preview: makePreview({
        afterRevert: { toVersion: 2 },
        changes: [
          {
            kind: 'tour_field' as const,
            tourId: 't1',
            tourName: 'X',
            field: 'title',
            fieldLabel: '标题',
            before: 'a',
            after: 'b',
            risk: 'normal' as const,
          },
        ],
      }),
    })
    expect(screen.getByText(/草稿和它有 1 处不同。请先把草稿里的错改掉/)).toBeInTheDocument()
    expect(screen.queryByText(/涉及价格或班期/)).not.toBeInTheDocument()
  })

  it('after a revert with the draft already fixed, says there is nothing to publish', () => {
    renderBar({ preview: makePreview({ afterRevert: { toVersion: 2 } }) })
    expect(screen.getByText(/草稿和它已经一致，没有需要上架的改动。/)).toBeInTheDocument()
    expect(screen.getByLabelText('上架状态')).toHaveAttribute('data-tone', 'danger')
    expect(screen.getByRole('button', { name: '查看并上架' })).toBeDisabled()
  })

  it('shows loading and error states', () => {
    renderBar({ preview: null })
    expect(screen.getByText('正在读取上架状态…')).toBeInTheDocument()
  })

  it('shows the error state with a retry button', () => {
    const { onRetry } = renderBar({ preview: null, error: '网络错误' })
    expect(screen.getByText(/读不到上架状态：网络错误/)).toBeInTheDocument()
    const retry = screen.getByRole('button', { name: '重试' })
    fireEvent.click(retry)
    expect(onRetry).toHaveBeenCalled()
  })
})
