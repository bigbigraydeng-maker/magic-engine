import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { TourCatalogClient } from '../TourCatalogClient'
import type { CatalogSnapshotResponse, CatalogTourView } from '../types'
import type { PublishPreviewResponse } from '@/lib/tour-catalog/publish-contract'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

type Handler = (url: string, init?: RequestInit) => Response

interface Routes {
  snapshot?: Handler
  preview?: Handler
  publishPost?: Handler
  history?: Handler
  tourPatch?: Handler
}

function makeTour(overrides: Partial<CatalogTourView> & { id: string; name: string }): CatalogTourView {
  return {
    slug: overrides.id,
    destination: 'atlantis',
    tier: 'gold',
    displayPriceText: null,
    isActive: true,
    managesDepartures: true,
    updatedAt: '2026-01-01T00:00:00Z',
    title: null,
    durationText: '10 Days',
    highlights: [],
    itinerary: [],
    inclusions: [],
    exclusions: [],
    tourCities: [],
    ...overrides,
  }
}

function makeSnapshot(): CatalogSnapshotResponse {
  return {
    tours: [
      makeTour({
        id: 't1',
        slug: 'coral',
        name: 'Atlantis Gold — Coral Loop',
        displayPriceText: 'From NZD $5,299 per person',
        isActive: true,
      }),
      makeTour({
        id: 't2',
        slug: 'trench',
        name: 'Atlantis Gold — Deep Trench',
        displayPriceText: null,
        isActive: false,
      }),
      makeTour({
        id: 't3',
        slug: 'lantern',
        destination: 'narnia',
        tier: 'unknown',
        name: 'Lantern Waste',
        isActive: true,
      }),
    ],
    departures: [
      {
        id: 'd1',
        tourId: 't1',
        departOn: '2999-05-13',
        returnOn: '2999-05-23',
        status: 'open',
        priceTextOverride: null,
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
    aliases: [{ aliasNorm: 'coral', tourId: 't1' }],
    batches: [],
    domain: 'example.test',
    // A Magic Engine admin on a catalog whose channels are connected: the original wording applies.
    clientName: 'Atlantis Travel',
    viewer: { email: 'admin@example.test', role: 'me_admin' },
    permissions: {
      view: true,
      edit: true,
      edit_site: true,
      assistant: true,
      request_publish: true,
      import: true,
      aliases: true,
      seed: true,
      publish: true,
      manage_members: true,
      manage_settings: true,
    },
    settings: { logoUrl: null, brandPrimary: null, brandSecondary: null, channelsConnected: true, imageHosts: [] },
    pendingPublishRequest: null,
  }
}

function makePreview(overrides: Partial<PublishPreviewResponse> = {}): PublishPreviewResponse {
  return {
    publishedVersion: 3,
    publishedAt: '2026-10-01T02:00:00Z',
    publishedBy: 'a@b.test',
    draftVersion: 9,
    firstPublish: false,
    changes: [
      {
        kind: 'tour_field',
        tourId: 't2',
        tourName: 'Atlantis Gold — Deep Trench',
        field: 'durationText',
        fieldLabel: '天数',
        before: '10 Days',
        after: '12 Days',
        risk: 'normal',
      },
    ],
    changedTourIds: ['t2'],
    highRiskCount: 0,
    sellable: { before: 2, after: 2, needsCountConfirm: false },
    afterRevert: null,
    firstPublishRows: [],
    diffHash: 'hash-1',
    ...overrides,
  }
}

function installFetch(routes: Routes = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (/\/tour-catalog$/.test(url)) {
      return (routes.snapshot ?? (() => jsonResponse(makeSnapshot())))(url, init)
    }
    if (/\/tour-catalog\/publish$/.test(url) && method === 'GET') {
      return (routes.preview ?? (() => jsonResponse(makePreview())))(url, init)
    }
    if (/\/tour-catalog\/publish$/.test(url) && method === 'POST') {
      return (routes.publishPost ?? (() => jsonResponse({ ok: true, version: 4 })))(url, init)
    }
    if (/\/publish\/history$/.test(url)) {
      return (routes.history ?? (() => jsonResponse({ versions: [] })))(url, init)
    }
    if (/\/tour-catalog\/tours\/[^/]+$/.test(url) && method === 'PATCH') {
      return (routes.tourPatch ?? (() => jsonResponse({ tour: makeSnapshot().tours[0] })))(url, init)
    }
    if (/\/changes/.test(url)) return jsonResponse({ changes: [] })
    return jsonResponse({})
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const countCalls = (
  fetchMock: ReturnType<typeof installFetch>,
  pattern: RegExp,
  method = 'GET',
) =>
  fetchMock.mock.calls.filter(
    c =>
      pattern.test(String(c[0])) &&
      ((c[1] as RequestInit | undefined)?.method ?? 'GET') === method,
  ).length

async function renderReady(routes?: Routes) {
  const fetchMock = installFetch(routes)
  render(<TourCatalogClient clientId="c1" />)
  await screen.findByRole('tablist')
  return fetchMock
}

async function makeDirty() {
  fireEvent.click(screen.getByRole('button', { name: '编辑这个团' }))
  const input = screen.getByDisplayValue('Atlantis Gold — Coral Loop')
  fireEvent.change(input, { target: { value: 'Changed name' } })
  return input
}

describe('TourCatalogClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders the AI assistant panel when tours exist', async () => {
    await renderReady()
    expect(screen.getAllByText('AI 助手').length).toBeGreaterThanOrEqual(1)
  })

  it('shows the seed panel and no tabs when the catalog is empty', async () => {
    installFetch({
      snapshot: () => jsonResponse({ ...makeSnapshot(), tours: [], departures: [] }),
    })
    render(<TourCatalogClient clientId="c1" />)
    await screen.findByText('还没有任何团')
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByRole('button', { name: '查看并上架' })).toBeNull()
  })

  it('renders every tab for an admin and switches panels', async () => {
    await renderReady()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map(t => t.textContent)).toEqual([
      '团',
      '修改记录',
      '上架记录',
      '出团表导入',
      '叫法对照',
      '设置',
    ])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false')
    expect(tabs[2]).toHaveAttribute('aria-selected', 'false')
    expect(tabs[3]).toHaveAttribute('aria-selected', 'false')

    const panelId = tabs[0].getAttribute('aria-controls')
    const panel = panelId ? document.getElementById(panelId) : null
    expect(panel).not.toBeNull()
    expect(panel).not.toHaveAttribute('hidden')

    fireEvent.click(screen.getByRole('tab', { name: '叫法对照' }))
    expect(screen.getByRole('tab', { name: '叫法对照' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '团' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('heading', { name: '已记住的叫法' })).toBeInTheDocument()
    expect(screen.queryByTestId('tour-row-t1')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: '上架记录' }))
    await screen.findByText('还没有上架记录')
  })

  it('groups tours by series and tier from the data', async () => {
    await renderReady()
    expect(screen.getByRole('button', { name: '系列 Atlantis' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gold（2）' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '系列 Narnia' })).toBeInTheDocument()
  })

  it('selects the first tour by default and switches on click', async () => {
    await renderReady()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Atlantis Gold — Coral Loop' }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('tour-row-t3'))
    expect(screen.getByRole('heading', { level: 2, name: 'Lantern Waste' })).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { level: 2, name: 'Atlantis Gold — Coral Loop' }),
    ).toBeNull()
  })

  it('shows a series > tier > tour breadcrumb above the detail', async () => {
    await renderReady()
    expect(screen.getByTestId('tour-breadcrumb')).toHaveTextContent('Atlantis›Gold›Coral Loop')
    fireEvent.click(screen.getByTestId('tour-row-t3'))
    expect(screen.getByTestId('tour-breadcrumb')).toHaveTextContent('Narnia›未分档›Lantern Waste')
  })

  it('shows the publish status bar and per-tour change markers', async () => {
    await renderReady()
    expect(screen.getByText(/有 1 处改动还没上架/)).toBeInTheDocument()

    const row2 = screen.getByTestId('tour-row-t2')
    expect(within(row2).getByLabelText('有改动还没上架')).toBeInTheDocument()
    expect(within(row2).getByText('停售')).toBeInTheDocument()

    const row1 = screen.getByTestId('tour-row-t1')
    expect(within(row1).queryByLabelText('有改动还没上架')).toBeNull()
    expect(within(row1).queryByText('停售')).toBeNull()

    fireEvent.click(row2)
    expect(screen.getByText('这个团有 1 处改动还没上架')).toBeInTheDocument()
    expect(screen.getByText('天数：对外现在 10 Days → 草稿 12 Days')).toBeInTheDocument()
    expect(screen.queryByText(/已下架/)).toBeNull()
  })

  it('guards an unsaved tour switch with a confirm', async () => {
    await renderReady()
    await makeDirty()

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByTestId('tour-row-t3'))
    expect(confirmSpy).toHaveBeenCalledWith('这个团有没保存的修改，离开会丢失。确定离开吗？')
    expect(
      screen.getByRole('heading', { level: 2, name: 'Atlantis Gold — Coral Loop' }),
    ).toBeInTheDocument()
    expect(screen.getByDisplayValue('Changed name')).toBeInTheDocument()

    confirmSpy.mockReturnValue(true)
    fireEvent.click(screen.getByTestId('tour-row-t3'))
    expect(screen.getByRole('heading', { level: 2, name: 'Lantern Waste' })).toBeInTheDocument()
  })

  it('does not confirm when nothing is unsaved', async () => {
    await renderReady()
    const confirmSpy = vi.spyOn(window, 'confirm')
    fireEvent.click(screen.getByTestId('tour-row-t3'))
    expect(screen.getByRole('heading', { level: 2, name: 'Lantern Waste' })).toBeInTheDocument()
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('guards an unsaved tab switch with a confirm', async () => {
    await renderReady()
    await makeDirty()

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('tab', { name: '出团表导入' }))
    expect(screen.getByRole('tab', { name: '团' })).toHaveAttribute('aria-selected', 'true')

    confirmSpy.mockReturnValue(true)
    fireEvent.click(screen.getByRole('tab', { name: '出团表导入' }))
    expect(screen.getByRole('tab', { name: '出团表导入' })).toHaveAttribute('aria-selected', 'true')
  })

  it('toggles the narrow-screen list/detail view and guards going back', async () => {
    await renderReady()
    fireEvent.click(screen.getByTestId('tour-row-t1'))
    expect(screen.getByTestId('tour-list-col')).toHaveClass('hidden')

    fireEvent.click(screen.getByRole('button', { name: '← 返回列表' }))
    expect(screen.getByTestId('tour-list-col')).not.toHaveClass('hidden')

    await makeDirty()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByTestId('tour-row-t1'))
    expect(screen.getByTestId('tour-list-col')).toHaveClass('hidden')
    fireEvent.click(screen.getByRole('button', { name: '← 返回列表' }))
    expect(screen.getByTestId('tour-list-col')).toHaveClass('hidden')
  })

  it('keeps the assistant panel mounted while the drawer is closed', async () => {
    await renderReady()
    const toggle = screen.getByRole('button', { name: 'AI 助手' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    const drawer = screen.getByTestId('assistant-drawer')
    expect(drawer).toHaveAttribute('data-open', 'false')
    expect(within(drawer).getByText('还没有对话，先说一句试试。')).toBeInTheDocument()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(drawer).toHaveAttribute('data-open', 'true')

    const textarea = within(drawer).getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: '收起助手' }))
    expect(drawer).toHaveAttribute('data-open', 'false')
    // aria-hidden while closed, so look it up by placeholder rather than by role.
    expect(within(drawer).getByPlaceholderText('用大白话告诉我要改什么…')).toHaveValue('hello')
  })

  it('does not open the publish dialog while a tour has unsaved edits, and says why', async () => {
    await renderReady()
    await makeDirty()
    const confirmSpy = vi.spyOn(window, 'confirm')
    const blockedText =
      '这个团还有没保存的修改。请先点「保存」或「取消」，再来上架——没保存的内容不会被上架。'

    fireEvent.click(screen.getByRole('button', { name: '查看并上架' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent(blockedText)
    expect(confirmSpy).not.toHaveBeenCalled()
    // Nothing was thrown away.
    expect(screen.getByDisplayValue('Changed name')).toBeInTheDocument()

    // Cancel the edit: the reminder goes, and publishing opens again.
    confirmSpy.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByText(blockedText)).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: '查看并上架' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('clears the unsaved reminder after a save, and 去上架 goes through the same check', async () => {
    await renderReady()
    await makeDirty()
    fireEvent.click(screen.getByRole('button', { name: '查看并上架' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/还有没保存的修改/)

    fireEvent.click(screen.getAllByRole('button', { name: '保存' })[0])
    await screen.findByText(/已存为草稿，客人还看不到/)
    expect(screen.queryByText(/还有没保存的修改/)).toBeNull()

    // Dirty again (through the editor), then try the "去上架" link in the saved notice.
    fireEvent.click(screen.getByRole('button', { name: '编辑这个团' }))
    fireEvent.change(screen.getByDisplayValue('Atlantis Gold — Coral Loop'), {
      target: { value: 'Again' },
    })
    fireEvent.click(screen.getByRole('button', { name: '去上架' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent(/还有没保存的修改/)
  })

  it('guards a browser refresh / close only while there are unsaved edits', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const beforeUnload = (spy: typeof addSpy | typeof removeSpy) =>
      spy.mock.calls.filter(c => c[0] === 'beforeunload')

    await renderReady()
    expect(beforeUnload(addSpy)).toHaveLength(0)

    await makeDirty()
    expect(beforeUnload(addSpy)).toHaveLength(1)
    expect(beforeUnload(removeSpy)).toHaveLength(0)

    const handler = beforeUnload(addSpy)[0][1] as (event: Event) => void
    const event = new Event('beforeunload', { cancelable: true })
    handler(event)
    expect(event.defaultPrevented).toBe(true)

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(beforeUnload(removeSpy)).toHaveLength(1))
    expect(beforeUnload(removeSpy)[0][1]).toBe(handler)
  })

  it('publishes and refreshes the status afterwards', async () => {
    let published = false
    const fetchMock = await renderReady({
      preview: () =>
        jsonResponse(
          published
            ? makePreview({ publishedVersion: 4, changes: [], changedTourIds: [] })
            : makePreview(),
        ),
      publishPost: () => {
        published = true
        return jsonResponse({ ok: true, version: 4 })
      },
    })

    fireEvent.click(screen.getByRole('button', { name: '查看并上架' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('上架前请核对')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认上架' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    const postCall = fetchMock.mock.calls.find(
      c =>
        /\/tour-catalog\/publish$/.test(String(c[0])) &&
        (c[1] as RequestInit | undefined)?.method === 'POST',
    )
    expect(postCall).toBeTruthy()
    const body = JSON.parse(String((postCall?.[1] as RequestInit).body)) as Record<string, unknown>
    expect(body.draftVersion).toBe(9)
    expect(body.publishedVersion).toBe(3)
    expect(body.diffHash).toBe('hash-1')

    await screen.findByText(/已上架第 4 版/)
    expect(countCalls(fetchMock, /\/tour-catalog\/publish$/, 'GET')).toBeGreaterThanOrEqual(2)
    expect(countCalls(fetchMock, /\/tour-catalog$/)).toBeGreaterThanOrEqual(2)
  })

  it('refreshes the publish status after saving a tour', async () => {
    const fetchMock = await renderReady()
    fireEvent.click(screen.getByRole('button', { name: '编辑这个团' }))
    const input = screen.getByDisplayValue('Atlantis Gold — Coral Loop')
    fireEvent.change(input, { target: { value: 'Renamed' } })

    fireEvent.click(screen.getAllByRole('button', { name: '保存' })[0])
    await waitFor(() =>
      expect(countCalls(fetchMock, /\/tour-catalog\/tours\/[^/]+$/, 'PATCH')).toBe(1),
    )
    await waitFor(() =>
      expect(countCalls(fetchMock, /\/tour-catalog\/publish$/, 'GET')).toBeGreaterThanOrEqual(2),
    )
    await screen.findByText(/已存为草稿，客人还看不到/)
  })

  it('shows the stale message when publishing is rejected', async () => {
    const fetchMock = await renderReady({
      publishPost: () => jsonResponse({ error: 'stale' }, 409),
    })
    fireEvent.click(screen.getByRole('button', { name: '查看并上架' }))
    fireEvent.click(screen.getByRole('button', { name: '确认上架' }))

    await screen.findByText('你查看之后又有人改了内容，已为你刷新，请重新核对')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(countCalls(fetchMock, /\/tour-catalog\/publish$/, 'GET')).toBeGreaterThanOrEqual(2)
  })

  it('shows a retry affordance when the publish status cannot be read', async () => {
    await renderReady({ preview: () => jsonResponse({ error: 'x' }, 500) })
    await screen.findByText(/读不到上架状态/)
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
    expect(screen.getByTestId('tour-row-t1')).toBeInTheDocument()
  })
})
