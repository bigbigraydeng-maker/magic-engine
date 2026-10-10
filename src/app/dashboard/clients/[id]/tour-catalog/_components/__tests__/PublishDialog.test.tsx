import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type {
  PublishChange,
  PublishPreviewResponse,
  PublishRequest,
} from '@/lib/tour-catalog/publish-contract'
import { PublishDialog } from '../PublishDialog'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

const normalChange: PublishChange = {
  kind: 'tour_field',
  tourId: 't1',
  tourName: 'Coral Loop',
  field: 'durationText',
  fieldLabel: '天数',
  before: '10 Days',
  after: '12 Days',
  risk: 'normal',
}

const highRiskChange: PublishChange = {
  kind: 'tour_field',
  tourId: 't2',
  tourName: 'Deep Trench',
  field: 'displayPriceText',
  fieldLabel: '展示价',
  before: 'NZD $4,999',
  after: null,
  risk: 'high',
}

function makePreview(overrides: Partial<PublishPreviewResponse> = {}): PublishPreviewResponse {
  return {
    publishedVersion: 3,
    publishedAt: '2026-10-01T02:00:00Z',
    publishedBy: 'a@b.c',
    draftVersion: 9,
    firstPublish: false,
    changes: [normalChange],
    changedTourIds: ['t1'],
    highRiskCount: 0,
    sellable: { before: 5, after: 5, needsCountConfirm: false },
    afterRevert: null,
    firstPublishRows: [],
    diffHash: 'hash-1',
    ...overrides,
  }
}

function renderDialog(preview: PublishPreviewResponse, fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock)
  const onRefresh = vi.fn()
  const onClose = vi.fn()
  const onPublished = vi.fn()
  const utils = render(
    <PublishDialog
      clientId="c1"
      preview={preview}
      onRefresh={onRefresh}
      onClose={onClose}
      onPublished={onPublished}
    />,
  )
  return { ...utils, onRefresh, onClose, onPublished }
}

function readBody(fetchMock: ReturnType<typeof vi.fn>): PublishRequest {
  const init = fetchMock.mock.calls[0][1] as RequestInit
  return JSON.parse(String(init.body)) as PublishRequest
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PublishDialog', () => {
  it('renders the dialog, focuses it, and closes on Escape', () => {
    const fetchMock = vi.fn()
    const { onClose } = renderDialog(makePreview(), fetchMock)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('上架前请核对')).toBeInTheDocument()
    expect(
      screen.getByText(
        '上架后，客人在官网等地方看到的内容会变成下面这样。这次会把所有人还没上架的改动一起发出去。',
      ),
    ).toBeInTheDocument()
    expect(dialog.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows change lines and orders high-risk groups first', () => {
    const fetchMock = vi.fn()
    renderDialog(
      makePreview({ changes: [normalChange, highRiskChange], highRiskCount: 1 }),
      fetchMock,
    )
    expect(screen.getByText('天数：10 Days → 12 Days')).toBeInTheDocument()
    expect(screen.getByText('展示价：NZD $4,999 → （无）')).toBeInTheDocument()
    const highItem = screen.getByText('展示价：NZD $4,999 → （无）')
    expect(highItem).toHaveAttribute('data-risk', 'high')
    const deep = screen.getByText('Deep Trench')
    const coral = screen.getByText('Coral Loop')
    const position = deep.compareDocumentPosition(coral)
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('requires the high-risk acknowledgement and posts the request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, version: 4 }))
    const { onPublished } = renderDialog(
      makePreview({ changes: [normalChange, highRiskChange], highRiskCount: 1 }),
      fetchMock,
    )
    const submit = screen.getByRole('button', { name: '确认上架' })
    expect(submit).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/我已核对上面标红的 1 处价格和班期改动/))
    expect(submit).not.toBeDisabled()
    fireEvent.change(screen.getByLabelText('这次改了什么（选填）'), {
      target: { value: 'price fix' },
    })
    fireEvent.click(submit)
    await waitFor(() => expect(onPublished).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/clients/c1/tour-catalog/publish')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    const body = readBody(fetchMock)
    expect(body.draftVersion).toBe(9)
    expect(body.publishedVersion).toBe(3)
    expect(body.diffHash).toBe('hash-1')
    expect(body.acknowledgeHighRisk).toBe(true)
    expect(body.acknowledgeAfterRevert).toBe(false)
    expect(body.confirmSellableCount).toBeNull()
    expect(body.note).toBe('price fix')
  })

  it('requires the after-revert acknowledgement', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, version: 4 }))
    renderDialog(makePreview({ afterRevert: { toVersion: 2 } }), fetchMock)
    const submit = screen.getByRole('button', { name: '确认上架' })
    expect(submit).toBeDisabled()
    fireEvent.click(
      screen.getByLabelText(
        /我知道上一次是把对外内容换回了第 2 版，这次上架会把当时换掉的内容重新发出去/,
      ),
    )
    expect(submit).not.toBeDisabled()
    fireEvent.click(submit)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(readBody(fetchMock).acknowledgeAfterRevert).toBe(true)
  })

  it('requires the sellable count confirmation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, version: 4 }))
    renderDialog(
      makePreview({ sellable: { before: 10, after: 4, needsCountConfirm: true } }),
      fetchMock,
    )
    expect(screen.getByText('上架后对外可售的团会从 10 个变成 4 个')).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: '确认上架' })
    expect(submit).toBeDisabled()
    const input = screen.getByLabelText('输入上架后的可售团数')
    fireEvent.change(input, { target: { value: '5' } })
    expect(submit).toBeDisabled()
    fireEvent.change(input, { target: { value: '4' } })
    expect(submit).not.toBeDisabled()
    fireEvent.click(submit)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(readBody(fetchMock).confirmSellableCount).toBe(4)
  })

  it('handles a stale response by refreshing and resetting acknowledgements', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'stale' }, 409))
    const { onRefresh, onPublished, rerender } = renderDialog(
      makePreview({ changes: [normalChange, highRiskChange], highRiskCount: 1 }),
      fetchMock,
    )
    fireEvent.click(screen.getByLabelText(/我已核对上面标红的 1 处价格和班期改动/))
    fireEvent.click(screen.getByRole('button', { name: '确认上架' }))
    await waitFor(() =>
      expect(
        screen.getByText('你查看之后又有人改了内容，已为你刷新，请重新核对'),
      ).toBeInTheDocument(),
    )
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(onPublished).not.toHaveBeenCalled()

    rerender(
      <PublishDialog
        clientId="c1"
        preview={makePreview({
          changes: [normalChange, highRiskChange],
          highRiskCount: 1,
          diffHash: 'hash-2',
        })}
        onRefresh={onRefresh}
        onClose={vi.fn()}
        onPublished={onPublished}
      />,
    )
    const checkbox = screen.getByLabelText(
      /我已核对上面标红的 1 处价格和班期改动/,
    ) as HTMLInputElement
    expect(checkbox.checked).toBe(false)
    expect(
      screen.getByText('你查看之后又有人改了内容，已为你刷新，请重新核对'),
    ).toBeInTheDocument()
  })

  it('shows the sentence for other error codes without refreshing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'nothing_to_publish' }, 400))
    const { onRefresh } = renderDialog(makePreview(), fetchMock)
    fireEvent.click(screen.getByRole('button', { name: '确认上架' }))
    await waitFor(() =>
      expect(
        screen.getByText('草稿和对外内容已经一致，没有需要上架的改动'),
      ).toBeInTheDocument(),
    )
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('renders the first-publish table', () => {
    const fetchMock = vi.fn()
    renderDialog(
      makePreview({
        firstPublish: true,
        publishedVersion: 0,
        changes: [],
        firstPublishRows: [
          {
            tourId: 't1',
            tourName: 'Coral Loop',
            displayPriceText: 'NZD $4,999',
            upcomingDepartures: 3,
            nextDepartOn: '2999-05-13',
            sellable: true,
          },
          {
            tourId: 't2',
            tourName: 'Deep Trench',
            displayPriceText: null,
            upcomingDepartures: 0,
            nextDepartOn: null,
            sellable: false,
          },
        ],
      }),
      fetchMock,
    )
    expect(screen.getByText('首次上架：共 2 个团，其中 1 个对外可售')).toBeInTheDocument()
    expect(screen.getByText('团名')).toBeInTheDocument()
    expect(screen.getByText('展示价')).toBeInTheDocument()
    expect(screen.getByText('未来班期数')).toBeInTheDocument()
    expect(screen.getByText('下一班')).toBeInTheDocument()
    expect(screen.getByText('是否对外可售')).toBeInTheDocument()
    expect(screen.getByText('2999-05-13')).toBeInTheDocument()
    expect(screen.getByText('无固定班期')).toBeInTheDocument()
    expect(screen.getByText('可售')).toBeInTheDocument()
    expect(screen.getByText('不可售')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认上架' })).not.toBeDisabled()
  })

  it('prevents double submission', async () => {
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>(() => {}))
    renderDialog(makePreview(), fetchMock)
    const submit = screen.getByRole('button', { name: '确认上架' })
    fireEvent.click(submit)
    fireEvent.click(submit)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const pending = screen.getByRole('button', { name: '正在上架…' })
    expect(pending).toBeDisabled()
  })

  it('disables submit when there is nothing to publish', () => {
    const fetchMock = vi.fn()
    renderDialog(makePreview({ changes: [] }), fetchMock)
    expect(screen.getByRole('button', { name: '确认上架' })).toBeDisabled()
  })
})
