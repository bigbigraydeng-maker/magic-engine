import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderConnected as render } from './render-connected'
import type {
  PublishChange,
  PublishPreviewResponse,
  PublishRequest,
} from '@/lib/tour-catalog/publish-contract'
import { PublishDialog } from '../PublishDialog'
import { CatalogUiProvider } from '../catalog-context'

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

function renderDialog(
  preview: PublishPreviewResponse,
  fetchMock: ReturnType<typeof vi.fn>,
  incompleteNewTours: Array<{ tourId: string; tourName: string; missing: string[] }> = [],
) {
  vi.stubGlobal('fetch', fetchMock)
  const onRefresh = vi.fn()
  const onClose = vi.fn()
  const onPublished = vi.fn()
  const utils = render(
    <PublishDialog
      clientId="c1"
      preview={preview}
      incompleteNewTours={incompleteNewTours}
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

  it('explains what the red rows mean above the change list', () => {
    renderDialog(makePreview({ changes: [normalChange, highRiskChange], highRiskCount: 1 }), vi.fn())
    const legend = screen.getByText(/价格、班期、是否在售这类客人会直接看到并据此下单的内容/)
    expect(legend.textContent).toBe('标红 = 价格、班期、是否在售这类客人会直接看到并据此下单的内容')
    const firstGroup = screen.getByText('Deep Trench')
    expect(legend.compareDocumentPosition(firstGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('on a first publish that needs the count typed, uses first-publish wording and blocks a wrong number', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, version: 1 }))
    renderDialog(
      makePreview({
        firstPublish: true,
        publishedVersion: 0,
        changes: [],
        sellable: { before: 0, after: 0, needsCountConfirm: true },
        firstPublishRows: [
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
    expect(
      screen.getByText('这是第一次上架：上架后对外可售的团共 0 个。请输入这个数字确认。'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/会从 0 个变成/)).toBeNull()

    const input = screen.getByLabelText('输入上架后的可售团数')
    const submit = screen.getByRole('button', { name: '确认上架' })
    expect(submit).toBeDisabled()

    fireEvent.change(input, { target: { value: '3' } })
    expect(submit).toBeDisabled()
    fireEvent.click(submit)
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '0' } })
    expect(submit).not.toBeDisabled()
    fireEvent.click(submit)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(readBody(fetchMock).confirmSellableCount).toBe(0)
  })

  it('keeps the from-A-to-B wording when it is not the first publish', () => {
    renderDialog(
      makePreview({ sellable: { before: 5, after: 2, needsCountConfirm: true } }),
      vi.fn(),
    )
    expect(screen.getByText('上架后对外可售的团会从 5 个变成 2 个')).toBeInTheDocument()
    expect(screen.queryByText(/这是第一次上架/)).toBeNull()
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

describe('PublishDialog contributors and wording', () => {
  it('lists how many accounts contributed how many changes, and that everything goes out together', () => {
    const preview = {
      ...makePreview(),
      contributors: [
        { actorLabel: 'amy@example.test', changes: 3 },
        { actorLabel: 'bob@example.test', changes: 1 },
      ],
    }
    renderDialog(preview, vi.fn())
    const line = screen.getByTestId('publish-contributors')
    expect(line.textContent).toBe(
      '这次包含 2 个账号的修改：amy@example.test 3 处、bob@example.test 1 处。上架会把所有人还没上架的修改一起发出去。',
    )
  })

  it('shows no contributors line when the preview has none', () => {
    renderDialog(makePreview(), vi.fn())
    expect(screen.queryByTestId('publish-contributors')).toBeNull()
    renderDialog({ ...makePreview(), contributors: [] } as PublishPreviewResponse, vi.fn())
    expect(screen.queryByTestId('publish-contributors')).toBeNull()
  })

  it('channels not connected: the subtitle does not say customers will see it on the website', () => {
    vi.stubGlobal('fetch', vi.fn())
    render(
      <CatalogUiProvider value={{ channelsConnected: false, canPublish: true }}>
        <PublishDialog clientId="c1" preview={makePreview()} onRefresh={vi.fn()} onClose={vi.fn()} onPublished={vi.fn()} />
      </CatalogUiProvider>,
    )
    expect(
      screen.getByText(
        '上架后，已上架的目录会变成下面这样（官网等渠道目前还没有接通，不会跟着变）。这次会把所有人还没上架的改动一起发出去。',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/客人在官网等地方看到的内容/)).toBeNull()
  })
})

describe('PublishDialog: system is not an account', () => {
  function line(contributors: Array<{ actorLabel: string; changes: number }>): string | null {
    renderDialog({ ...makePreview(), contributors }, vi.fn())
    return screen.queryByTestId('publish-contributors')?.textContent ?? null
  }

  it('counts only real accounts and reports system read-ins separately', () => {
    expect(
      line([
        { actorLabel: 'amy@example.test', changes: 3 },
        { actorLabel: '系统', changes: 54 },
      ]),
    ).toBe(
      '这次包含 1 个账号的修改：amy@example.test 3 处，另有系统读入 54 处。上架会把所有人还没上架的修改一起发出去。',
    )
  })

  it('with only system records, no account is counted at all', () => {
    expect(line([{ actorLabel: '系统', changes: 54 }])).toBe(
      '这次的修改是系统读入的 54 处。上架会把所有人还没上架的修改一起发出去。',
    )
  })
})

describe('PublishDialog small things', () => {
  it('says which number to type once a wrong one was entered, and nothing before typing', () => {
    renderDialog(
      makePreview({ sellable: { before: 5, after: 2, needsCountConfirm: true } }),
      vi.fn(),
    )
    expect(screen.queryByText('数字不对，应该输入 2')).toBeNull()
    const input = screen.getByLabelText('输入上架后的可售团数')
    fireEvent.change(input, { target: { value: '5' } })
    expect(screen.getByRole('alert').textContent).toBe('数字不对，应该输入 2')
    fireEvent.change(input, { target: { value: ' 2 ' } })
    expect(screen.queryByText('数字不对，应该输入 2')).toBeNull()
  })

  it('the 关闭 button never wraps', () => {
    renderDialog(makePreview(), vi.fn())
    expect(screen.getByRole('button', { name: '关闭' }).className).toContain('whitespace-nowrap')
  })

  it('channels not connected: nothing in the dialog says 对外 or 客人', () => {
    vi.stubGlobal('fetch', vi.fn())
    const preview = makePreview({
      firstPublish: true,
      publishedVersion: 0,
      changes: [],
      sellable: { before: 0, after: 1, needsCountConfirm: true },
      firstPublishRows: [
        { tourId: 't1', tourName: 'Coral Loop', displayPriceText: null, upcomingDepartures: 0, nextDepartOn: null, sellable: true },
      ],
    })
    render(
      <CatalogUiProvider value={{ channelsConnected: false, canPublish: true }}>
        <PublishDialog clientId="c1" preview={preview} onRefresh={vi.fn()} onClose={vi.fn()} onPublished={vi.fn()} />
      </CatalogUiProvider>,
    )
    expect(
      screen.getByText('这是第一次上架：上架后可售的团共 1 个。请输入这个数字确认。'),
    ).toBeInTheDocument()
    expect(screen.getByText('首次上架：共 1 个团，其中 1 个可售')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '是否可售' })).toBeInTheDocument()
    expect(screen.getByRole('dialog').textContent).not.toMatch(/对外|客人/)
  })

  it('channels not connected: the red-row legend and the after-revert tick do not mention customers', () => {
    vi.stubGlobal('fetch', vi.fn())
    render(
      <CatalogUiProvider value={{ channelsConnected: false, canPublish: true }}>
        <PublishDialog
          clientId="c1"
          preview={makePreview({ afterRevert: { toVersion: 2 } })}
          onRefresh={vi.fn()}
          onClose={vi.fn()}
          onPublished={vi.fn()}
        />
      </CatalogUiProvider>,
    )
    expect(screen.getByLabelText(/我知道上一次是把已上架的内容换回了第 2 版/)).toBeInTheDocument()
    expect(screen.getByRole('dialog').textContent).not.toMatch(/对外|客人/)
  })

  it('blocks publishing a new tour that is not filled in until the box is ticked', () => {
    const fetchMock = vi.fn()
    renderDialog(makePreview(), fetchMock, [
      { tourId: 't-new', tourName: 'China Unveiled', missing: ['主图', '常见问题（至少 3 条）'] },
    ])
    expect(screen.getByTestId('incomplete-new-tours').textContent).toContain('China Unveiled：缺 主图、常见问题（至少 3 条）')
    const submit = screen.getByRole('button', { name: '确认上架' })
    expect(submit).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /这些新团还没补齐/ }))
    expect(submit).toBeEnabled()
  })

  it('shows no warning when every new tour is filled in', () => {
    renderDialog(makePreview(), vi.fn(), [])
    expect(screen.queryByTestId('incomplete-new-tours')).toBeNull()
    expect(screen.getByRole('button', { name: '确认上架' })).toBeEnabled()
  })
})
