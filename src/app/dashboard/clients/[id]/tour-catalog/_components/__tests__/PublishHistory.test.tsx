import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { renderConnected as render } from './render-connected'
import { PublishHistory } from '../PublishHistory'
import { CatalogUiProvider } from '../catalog-context'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>

function routeFetch(routes: Array<[RegExp, Handler]>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    for (const [pattern, handler] of routes) {
      if (pattern.test(url)) return handler(url, init)
    }
    throw new Error(`unexpected fetch ${url}`)
  })
}

const historyFixture = {
  versions: [
    {
      version: 7,
      createdAt: '2026-10-05T02:00:00Z',
      publishedBy: 'ray@x.test',
      note: '换回旧价',
      sourceVersion: 4,
      changeCount: 3,
      highRiskCount: 1,
      isCurrent: true,
    },
    {
      version: 6,
      createdAt: '2026-10-04T02:00:00Z',
      publishedBy: 'amy@x.test',
      note: '',
      sourceVersion: null,
      changeCount: 2,
      highRiskCount: 0,
      isCurrent: false,
    },
    {
      version: 4,
      createdAt: '2026-10-01T02:00:00Z',
      publishedBy: 'amy@x.test',
      note: '首发',
      sourceVersion: null,
      changeCount: 5,
      highRiskCount: 0,
      isCurrent: false,
    },
  ],
}

const revertPreviewFixture = {
  targetVersion: 4,
  publishedVersion: 7,
  changes: [
    {
      kind: 'tour_field',
      tourId: 't1',
      tourName: 'Coral Loop',
      field: 'displayPriceText',
      fieldLabel: '展示价',
      before: 'NZD $5,299',
      after: 'NZD $4,999',
      risk: 'high',
    },
  ],
  highRiskCount: 1,
  keptStatuses: [
    {
      tourName: 'Deep Trench',
      departOn: '2999-05-13',
      currentStatus: '已关闭（现在对外已没有这个班期）',
      oldStatus: '可订',
    },
  ],
  sellable: { before: 5, after: 5, needsCountConfirm: false },
  diffHash: 'rh-1',
}

function historyCalls(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter(c => /history/.test(String(c[0]))).length
}

function findPost(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.find(
    c => (c[1] as RequestInit | undefined)?.method === 'POST',
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PublishHistory', () => {
  it('renders rows with the right labels and buttons', async () => {
    const fetchMock = routeFetch([
      [/publish\/history/, () => jsonResponse(historyFixture)],
    ])
    vi.stubGlobal('fetch', fetchMock)

    render(<PublishHistory clientId="c1" refreshKey={0} onReverted={() => {}} />)

    const row7 = await screen.findByTestId('publish-version-7')
    expect(within(row7).getByText('第 7 版（文字和价格同第 4 版）')).toBeInTheDocument()
    expect(within(row7).getByText('当前对外')).toBeInTheDocument()
    expect(within(row7).getByText('改动 3 处')).toBeInTheDocument()
    expect(within(row7).getByText('「换回旧价」')).toBeInTheDocument()
    expect(within(row7).getByText('ray@x.test 换回')).toBeInTheDocument()
    expect(within(row7).queryByText(/ray@x\.test 上架/)).toBeNull()
    expect(
      within(row7).queryByRole('button', { name: '把对外内容换回这一版' }),
    ).toBeNull()

    const row6 = screen.getByTestId('publish-version-6')
    expect(within(row6).getByText('第 6 版')).toBeInTheDocument()
    expect(within(row6).getByText('amy@x.test 上架')).toBeInTheDocument()
    expect(within(row6).getByText('历史')).toBeInTheDocument()
    expect(
      within(row6).getByRole('button', { name: '把对外内容换回这一版' }),
    ).toBeInTheDocument()
  })

  it('shows the empty message', async () => {
    const fetchMock = routeFetch([
      [/publish\/history/, () => jsonResponse({ versions: [] })],
    ])
    vi.stubGlobal('fetch', fetchMock)

    render(<PublishHistory clientId="c1" refreshKey={0} onReverted={() => {}} />)

    expect(await screen.findByText('还没有上架记录')).toBeInTheDocument()
  })

  it('shows an error when the history request fails', async () => {
    const fetchMock = routeFetch([
      [/publish\/history/, () => jsonResponse({}, 500)],
    ])
    vi.stubGlobal('fetch', fetchMock)

    render(<PublishHistory clientId="c1" refreshKey={0} onReverted={() => {}} />)

    expect(await screen.findByText('读不到上架记录，请稍后再试')).toBeInTheDocument()
  })

  it('runs the revert flow', async () => {
    const onReverted = vi.fn()
    const fetchMock = routeFetch([
      [/publish\/history/, () => jsonResponse(historyFixture)],
      [/publish\/revert\?version=4/, () => jsonResponse(revertPreviewFixture)],
      [/publish\/revert$/, () => jsonResponse({ ok: true, version: 4 })],
    ])
    vi.stubGlobal('fetch', fetchMock)

    render(<PublishHistory clientId="c1" refreshKey={0} onReverted={onReverted} />)

    const row4 = await screen.findByTestId('publish-version-4')
    fireEvent.click(
      within(row4).getByRole('button', { name: '把对外内容换回这一版' }),
    )

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(c => /publish\/revert\?version=4/.test(String(c[0]))),
    ).toBe(true)

    expect(
      screen.getByText('这只会把客人看到的内容换回第 4 版。'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        '你的草稿不会变；下次上架前请先改掉草稿里的错，否则会再发出去。',
      ),
    ).toBeInTheDocument()

    expect(
      await screen.findByText('展示价：NZD $5,299 → NZD $4,999'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        '下面这些班期不会跟着换回旧状态：满团、取消是真实情况，换回去会让客人订到已经没有的位置。',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '出团日' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '换回后（保持现在的）' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '那一版当时的' })).toBeInTheDocument()
    expect(screen.queryByText('出发日')).toBeNull()
    expect(screen.getByText('Deep Trench')).toBeInTheDocument()
    expect(screen.getByText('2999-05-13')).toBeInTheDocument()
    // The server already sends plain-Chinese status text: shown as is, no second mapping.
    expect(screen.getByText('已关闭（现在对外已没有这个班期）')).toBeInTheDocument()
    expect(screen.getByText('可订')).toBeInTheDocument()

    const confirm = screen.getByRole('button', { name: '确认换回这一版' })
    expect(confirm).toBeDisabled()

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /我已核对上面标红的 1 处价格和班期改动/,
      }),
    )
    expect(confirm).not.toBeDisabled()

    fireEvent.click(confirm)

    await waitFor(() => expect(onReverted).toHaveBeenCalledTimes(1))

    const post = findPost(fetchMock)
    expect(post).toBeTruthy()
    expect(String(post?.[0])).toMatch(/\/publish\/revert$/)
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({
      version: 4,
      publishedVersion: 7,
      diffHash: 'rh-1',
      acknowledgeHighRisk: true,
      confirmSellableCount: null,
    })

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(historyCalls(fetchMock)).toBe(2))
  })

  it('requires the sellable count when needed', async () => {
    const preview = {
      ...revertPreviewFixture,
      changes: [],
      highRiskCount: 0,
      keptStatuses: [],
      sellable: { before: 9, after: 0, needsCountConfirm: true },
    }
    const fetchMock = routeFetch([
      [/publish\/history/, () => jsonResponse(historyFixture)],
      [/publish\/revert\?version=4/, () => jsonResponse(preview)],
      [/publish\/revert$/, () => jsonResponse({ ok: true, version: 4 })],
    ])
    vi.stubGlobal('fetch', fetchMock)

    render(<PublishHistory clientId="c1" refreshKey={0} onReverted={() => {}} />)

    const row4 = await screen.findByTestId('publish-version-4')
    fireEvent.click(
      within(row4).getByRole('button', { name: '把对外内容换回这一版' }),
    )

    const confirm = await screen.findByRole('button', { name: '确认换回这一版' })
    expect(confirm).toBeDisabled()

    fireEvent.change(screen.getByLabelText('输入上架后的可售团数'), {
      target: { value: '0' },
    })
    expect(confirm).not.toBeDisabled()

    fireEvent.click(confirm)

    await waitFor(() => expect(findPost(fetchMock)).toBeTruthy())
    const post = findPost(fetchMock)
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({
      version: 4,
      publishedVersion: 7,
      diffHash: 'rh-1',
      acknowledgeHighRisk: false,
      confirmSellableCount: 0,
    })
  })

  it('handles a stale revert response', async () => {
    const onReverted = vi.fn()
    const fetchMock = routeFetch([
      [/publish\/history/, () => jsonResponse(historyFixture)],
      [/publish\/revert\?version=4/, () => jsonResponse(revertPreviewFixture)],
      [/publish\/revert$/, () => jsonResponse({ error: 'stale' }, 409)],
    ])
    vi.stubGlobal('fetch', fetchMock)

    render(<PublishHistory clientId="c1" refreshKey={0} onReverted={onReverted} />)

    const row4 = await screen.findByTestId('publish-version-4')
    fireEvent.click(
      within(row4).getByRole('button', { name: '把对外内容换回这一版' }),
    )

    await screen.findByText('展示价：NZD $5,299 → NZD $4,999')
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /我已核对上面标红的 1 处价格和班期改动/,
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: '确认换回这一版' }))

    expect(
      await screen.findByText('你查看之后又有人改了内容，已为你刷新，请重新核对'),
    ).toBeInTheDocument()

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(c =>
          /publish\/revert\?version=4/.test(String(c[0])),
        ).length,
      ).toBe(2),
    )
    expect(onReverted).not.toHaveBeenCalled()
  })

  it('shows the already-current error', async () => {
    const fetchMock = routeFetch([
      [/publish\/history/, () => jsonResponse(historyFixture)],
      [/publish\/revert\?version=4/, () => jsonResponse(revertPreviewFixture)],
      [/publish\/revert$/, () => jsonResponse({ error: 'already_current' }, 400)],
    ])
    vi.stubGlobal('fetch', fetchMock)

    render(<PublishHistory clientId="c1" refreshKey={0} onReverted={() => {}} />)

    const row4 = await screen.findByTestId('publish-version-4')
    fireEvent.click(
      within(row4).getByRole('button', { name: '把对外内容换回这一版' }),
    )

    await screen.findByText('展示价：NZD $5,299 → NZD $4,999')
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /我已核对上面标红的 1 处价格和班期改动/,
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: '确认换回这一版' }))

    expect(
      await screen.findByText('这一版就是客人现在看到的内容，不用换'),
    ).toBeInTheDocument()
  })

  it('reloads when refreshKey changes', async () => {
    const fetchMock = routeFetch([
      [/publish\/history/, () => jsonResponse(historyFixture)],
    ])
    vi.stubGlobal('fetch', fetchMock)

    const { rerender } = render(
      <PublishHistory clientId="c1" refreshKey={0} onReverted={() => {}} />,
    )

    await screen.findByTestId('publish-version-7')
    expect(historyCalls(fetchMock)).toBe(1)

    rerender(<PublishHistory clientId="c1" refreshKey={1} onReverted={() => {}} />)

    await waitFor(() => expect(historyCalls(fetchMock)).toBe(2))
  })
})

describe('PublishHistory by context', () => {
  async function renderWith(ui: { channelsConnected: boolean; canPublish: boolean }) {
    vi.stubGlobal('fetch', routeFetch([[/publish\/history/, () => jsonResponse(historyFixture)]]))
    render(
      <CatalogUiProvider value={ui}>
        <PublishHistory clientId="c1" refreshKey={0} onReverted={() => {}} />
      </CatalogUiProvider>,
    )
    await screen.findByTestId('publish-version-6')
  }

  it('people who cannot publish see the versions but no revert button', async () => {
    await renderWith({ channelsConnected: true, canPublish: false })
    expect(screen.getByTestId('publish-version-6')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '把对外内容换回这一版' })).toBeNull()
  })

  it('channels not connected: labels the live version as published, not as what customers see', async () => {
    await renderWith({ channelsConnected: false, canPublish: true })
    expect(within(screen.getByTestId('publish-version-7')).getByText('当前已上架')).toBeInTheDocument()
    expect(screen.getByText('每上架一次记一版。标着「当前已上架」的是现在已上架的那一版。')).toBeInTheDocument()
    expect(screen.queryByText(/客人看到的永远是/)).toBeNull()
  })
})

describe('PublishHistory wording', () => {
  const firstEver = {
    versions: [
      { version: 2, createdAt: '2026-10-05T02:00:00Z', publishedBy: 'amy@x.test', note: '', sourceVersion: null, changeCount: 0, highRiskCount: 0, isCurrent: true },
      { version: 1, createdAt: '2026-10-01T02:00:00Z', publishedBy: 'amy@x.test', note: '', sourceVersion: null, changeCount: 0, highRiskCount: 0, isCurrent: false },
    ],
  }
  const revertPreview = {
    targetVersion: 1,
    publishedVersion: 2,
    changes: [],
    highRiskCount: 0,
    keptStatuses: [{ tourName: 'Coral Loop', departOn: '2027-05-13', currentStatus: '已满团', oldStatus: '可订' }],
    sellable: { before: 2, after: 2, needsCountConfirm: false },
    diffHash: 'h',
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function renderUnconnected() {
    vi.stubGlobal(
      'fetch',
      routeFetch([
        [/publish\/history/, () => jsonResponse(firstEver)],
        [/publish\/revert/, () => jsonResponse(revertPreview)],
      ]),
    )
    render(
      <CatalogUiProvider value={{ channelsConnected: false, canPublish: true }}>
        <PublishHistory clientId="c1" refreshKey={0} onReverted={() => {}} />
      </CatalogUiProvider>,
    )
    await screen.findByTestId('publish-version-1')
  }

  it('the very first publish reads 首次上架, not 改动 0 处', async () => {
    await renderUnconnected()
    const first = within(screen.getByTestId('publish-version-1'))
    expect(first.getByText('首次上架')).toBeInTheDocument()
    expect(first.queryByText(/改动 0 处/)).toBeNull()
    // a later version with nothing changed still says how many
    expect(within(screen.getByTestId('publish-version-2')).getByText('改动 0 处')).toBeInTheDocument()
  })

  it('channels not connected: the revert button and its dialog talk about what is published', async () => {
    await renderUnconnected()
    expect(screen.queryByRole('button', { name: '把对外内容换回这一版' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '把已上架的内容换回这一版' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: '把已上架的内容换回第 1 版' })).toBeInTheDocument()
    expect(within(dialog).getByText('这只会把已上架的内容换回第 1 版。')).toBeInTheDocument()
    await within(dialog).findByText('换回后，已上架的内容会有这些变化')
    expect(within(dialog).getByText(/换回去会把已经没有的位置重新标成可订/)).toBeInTheDocument()
    expect(dialog.textContent).not.toMatch(/对外|客人/)
  })
})
