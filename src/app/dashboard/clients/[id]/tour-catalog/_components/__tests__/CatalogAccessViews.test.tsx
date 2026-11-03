/**
 * What each kind of person sees on the whole page: a client's own staff (client_editor) and a
 * Magic Engine admin (me_admin). The page only reads `permissions` from the snapshot; hiding is
 * convenience, the server refuses on its own.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { TourCatalogClient } from '../TourCatalogClient'
import { IMPORT_BY_ME_TEXT, UNSAVED_BLOCKS_PUBLISH_TEXT } from '../CatalogWorkspace'
import { EMPTY_CATALOG_TEXT, NO_ACCESS_TEXT } from '../page-notices'
import type { CatalogSnapshotResponse, CatalogTourView } from '../types'
import type { PublishPreviewResponse } from '@/lib/tour-catalog/publish-contract'
import type {
  CatalogPermissions,
  CatalogSettings,
  PublishRequestView,
} from '@/lib/tour-catalog/catalog-contract'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

const ADMIN: CatalogPermissions = {
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
}

const EDITOR: CatalogPermissions = {
  ...ADMIN,
  edit_site: false,
  import: false,
  aliases: false,
  seed: false,
  publish: false,
  manage_members: false,
  manage_settings: false,
}

const NEUTRAL: CatalogSettings = {
  logoUrl: null,
  brandPrimary: null,
  brandSecondary: null,
  channelsConnected: false,
  imageHosts: [],
}

function makeTour(id: string, name: string): CatalogTourView {
  return {
    id,
    slug: id,
    destination: 'atlantis',
    tier: 'gold',
    name,
    displayPriceText: 'From NZD $5,299 per person',
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
  }
}

function editorSnapshot(overrides: Partial<CatalogSnapshotResponse> = {}): CatalogSnapshotResponse {
  return {
    tours: [makeTour('t1', 'Atlantis Gold — Coral Loop'), makeTour('t2', 'Atlantis Gold — Deep Trench')],
    departures: [],
    domain: 'example.test',
    clientName: 'Atlantis Travel',
    viewer: { email: 'amy@example.test', role: 'client_editor' },
    permissions: EDITOR,
    settings: NEUTRAL,
    pendingPublishRequest: null,
    ...overrides,
  }
}

function adminSnapshot(overrides: Partial<CatalogSnapshotResponse> = {}): CatalogSnapshotResponse {
  return editorSnapshot({
    aliases: [],
    batches: [],
    viewer: { email: 'admin@example.test', role: 'me_admin' },
    permissions: ADMIN,
    ...overrides,
  })
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

const REQUEST: PublishRequestView = {
  id: 'r1',
  requestedBy: 'amy@example.test',
  note: '改了两个团的天数',
  createdAt: '2026-10-10T03:30:00Z',
  draftVersion: 9,
}

const HISTORY = {
  versions: [
    { version: 3, createdAt: '2026-10-01T02:00:00Z', publishedBy: 'Magic Engine 团队', note: '', sourceVersion: null, changeCount: 2, highRiskCount: 0, isCurrent: true },
    { version: 2, createdAt: '2026-09-20T02:00:00Z', publishedBy: 'Magic Engine 团队', note: '', sourceVersion: null, changeCount: 1, highRiskCount: 0, isCurrent: false },
  ],
}

interface Routes {
  snapshot?: () => Response
  preview?: () => Response
  requestPost?: (init?: RequestInit) => Response
  settingsPut?: (init?: RequestInit) => Response
}

function installFetch(routes: Routes = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (/\/tour-catalog$/.test(url)) return (routes.snapshot ?? (() => jsonResponse(editorSnapshot())))()
    if (/\/tour-catalog\/publish$/.test(url)) return (routes.preview ?? (() => jsonResponse(makePreview())))()
    if (/\/publish-requests$/.test(url) && method === 'POST') {
      return (routes.requestPost ?? (() => jsonResponse({ request: REQUEST })))(init)
    }
    if (/\/publish\/history$/.test(url)) return jsonResponse(HISTORY)
    if (/\/tour-catalog\/settings$/.test(url) && method === 'PUT') {
      return (routes.settingsPut ?? (() => jsonResponse({ settings: NEUTRAL })))(init)
    }
    if (/\/tour-catalog\/members/.test(url)) return jsonResponse({ members: [] })
    if (/\/tour-catalog\/tours\/[^/]+$/.test(url) && method === 'PATCH') {
      return jsonResponse({ tour: makeTour('t1', 'Renamed') })
    }
    if (/\/tour-catalog\/changes$/.test(url)) {
      return jsonResponse({
        changes: [
          { id: 'c1', createdAt: '2026-10-10T03:30:00Z', actorLabel: 'amy@example.test', source: 'manual', tourId: 't1', tourName: 'Coral Loop', summary: '天数：10 Days → 12 Days' },
        ],
      })
    }
    return jsonResponse({})
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

type FetchMock = ReturnType<typeof installFetch>

function calls(fetchMock: FetchMock, pattern: RegExp, method = 'GET') {
  return fetchMock.mock.calls.filter(
    c => pattern.test(String(c[0])) && ((c[1] as RequestInit | undefined)?.method ?? 'GET') === method,
  )
}

async function renderReady(routes?: Routes) {
  const fetchMock = installFetch(routes)
  render(<TourCatalogClient clientId="c1" />)
  await screen.findByRole('tablist')
  return fetchMock
}

const tabNames = () => screen.getAllByRole('tab').map(t => t.textContent)

beforeEach(() => {
  vi.restoreAllMocks()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('client_editor view', () => {
  it('has no import / aliases / settings tabs, and says who imports departure sheets', async () => {
    await renderReady()
    expect(tabNames()).toEqual(['团', '修改记录', '上架记录'])
    expect(screen.getByText(IMPORT_BY_ME_TEXT)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '谁可以用团目录' })).toBeNull()
  })

  it('offers 请 Magic Engine 上架 instead of 查看并上架', async () => {
    await renderReady()
    expect(screen.getByRole('button', { name: '请 Magic Engine 上架' })).not.toBeDisabled()
    expect(screen.queryByRole('button', { name: '查看并上架' })).toBeNull()
  })

  it('cannot ask when nothing is waiting to be published', async () => {
    await renderReady({ preview: () => jsonResponse(makePreview({ changes: [], changedTourIds: [] })) })
    expect(screen.getByRole('button', { name: '请 Magic Engine 上架' })).toBeDisabled()
  })

  it('sends the request with the note and then shows that Magic Engine was told', async () => {
    const fetchMock = await renderReady()
    fireEvent.click(screen.getByRole('button', { name: '请 Magic Engine 上架' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByText('提交后，Magic Engine 团队会核对并上架。你还可以继续修改。')).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('这次改了什么（选填）'), {
      target: { value: '改了两个团的天数' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: '提交' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const post = calls(fetchMock, /\/publish-requests$/, 'POST')
    expect(post).toHaveLength(1)
    expect(String(post[0][0])).toBe('/api/clients/c1/tour-catalog/publish-requests')
    expect(JSON.parse(String((post[0][1] as RequestInit).body))).toEqual({ note: '改了两个团的天数' })
    // never the publish route
    expect(calls(fetchMock, /\/tour-catalog\/publish$/, 'POST')).toHaveLength(0)

    const notice = await screen.findByTestId('publish-request-notice')
    expect(notice.textContent).toMatch(
      /^已通知 Magic Engine 团队 · 2026年10月\d+日 \d{2}:\d{2}。还没上架，对方核对后会上架。$/,
    )
  })

  it('blocks the request while a tour has unsaved edits, with the existing reminder', async () => {
    await renderReady()
    fireEvent.click(screen.getByRole('button', { name: '编辑这个团' }))
    fireEvent.change(screen.getByDisplayValue('Atlantis Gold — Coral Loop'), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: '请 Magic Engine 上架' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText(UNSAVED_BLOCKS_PUBLISH_TEXT)).toBeInTheDocument()
  })

  it('echoes a request that is already open', async () => {
    await renderReady({ snapshot: () => jsonResponse(editorSnapshot({ pendingPublishRequest: REQUEST })) })
    const notice = await screen.findByTestId('publish-request-notice')
    expect(notice.textContent).toMatch(
      /^已通知 Magic Engine 团队 · 2026年10月\d+日 \d{2}:\d{2}。还没上架，对方核对后会上架。$/,
    )
  })

  it('says a newer note can be sent when the draft moved on after the request', async () => {
    await renderReady({
      snapshot: () =>
        jsonResponse(editorSnapshot({ pendingPublishRequest: { ...REQUEST, draftVersion: 5 } })),
    })
    const notice = await screen.findByTestId('publish-request-notice')
    expect(notice.textContent).toMatch(/。还没上架；之后又有新的修改，可以再提交一次更新说明。$/)
  })

  it('has no revert button in the publish history', async () => {
    await renderReady()
    fireEvent.click(screen.getByRole('tab', { name: '上架记录' }))
    await screen.findByTestId('publish-version-2')
    expect(screen.queryByRole('button', { name: /换回这一版/ })).toBeNull()
  })

  it('explains an empty catalog instead of offering to read the website in', async () => {
    installFetch({ snapshot: () => jsonResponse(editorSnapshot({ tours: [] })) })
    render(<TourCatalogClient clientId="c1" />)
    await screen.findByText(EMPTY_CATALOG_TEXT)
    expect(screen.queryByRole('button', { name: '读入网站上现有的团' })).toBeNull()
    expect(screen.queryByRole('tablist')).toBeNull()
    // the header is still there
    expect(screen.getByRole('heading', { name: '团目录' })).toBeInTheDocument()
  })

  it('shows the catalog-wide change feed', async () => {
    const fetchMock = await renderReady()
    fireEvent.click(screen.getByRole('tab', { name: '修改记录' }))
    const row = await screen.findByTestId('change-row-c1')
    expect(row.textContent).toMatch(/2026年10月/)
    expect(within(row).getByText('手动')).toBeInTheDocument()
    expect(calls(fetchMock, /\/tour-catalog\/changes$/)).toHaveLength(1)
  })
})

describe('me_admin view', () => {
  it('sees every tab and the normal publish button', async () => {
    await renderReady({ snapshot: () => jsonResponse(adminSnapshot()) })
    expect(tabNames()).toEqual(['团', '修改记录', '上架记录', '出团表导入', '叫法对照', '设置'])
    expect(screen.getByRole('button', { name: '查看并上架' })).toBeInTheDocument()
    expect(screen.queryByText(IMPORT_BY_ME_TEXT)).toBeNull()
  })

  it('is told who asked for a publish, when, and why', async () => {
    await renderReady({ snapshot: () => jsonResponse(adminSnapshot({ pendingPublishRequest: REQUEST })) })
    const notice = await screen.findByTestId('publish-request-notice')
    expect(notice.textContent).toMatch(
      /^amy@example\.test 在 2026年10月\d+日 \d{2}:\d{2} 请你上架：改了两个团的天数$/,
    )
  })

  it('keeps the revert button in the publish history', async () => {
    await renderReady({ snapshot: () => jsonResponse(adminSnapshot()) })
    fireEvent.click(screen.getByRole('tab', { name: '上架记录' }))
    const row = await screen.findByTestId('publish-version-2')
    expect(within(row).getByRole('button', { name: '把已上架的内容换回这一版' })).toBeInTheDocument()
  })

  it('re-reads the catalog after saving settings, and the header follows', async () => {
    let saved = false
    const branded: CatalogSettings = {
      logoUrl: 'https://example.test/logo.png',
      brandPrimary: '#336699',
      brandSecondary: null,
      channelsConnected: false,
      imageHosts: [],
    }
    const fetchMock = await renderReady({
      snapshot: () => jsonResponse(adminSnapshot(saved ? { settings: branded } : {})),
      settingsPut: () => {
        saved = true
        return jsonResponse({ settings: branded })
      },
    })
    expect(screen.getByTestId('catalog-header')).toHaveAttribute('data-branded', 'false')
    expect(screen.getByTestId('catalog-brand-scope').style.getPropertyValue('--tc-brand')).toBe('')

    fireEvent.click(screen.getByRole('tab', { name: '设置' }))
    expect(screen.getByRole('heading', { name: '谁可以用团目录' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('logo 地址'), { target: { value: branded.logoUrl } })
    fireEvent.change(screen.getByLabelText('主色'), { target: { value: '#336699' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(screen.getByTestId('catalog-header')).toHaveAttribute('data-branded', 'true'),
    )
    expect(calls(fetchMock, /\/tour-catalog$/).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByTestId('catalog-brand-scope').style.getPropertyValue('--tc-brand')).toBe('#336699')
    expect(screen.getByRole('img', { name: 'Atlantis Travel' })).toHaveAttribute('src', branded.logoUrl)
  })
})

describe('honest wording follows the channels switch', () => {
  it('while nothing reads the catalog: says what is published, never what customers see', async () => {
    await renderReady()
    const bar = screen.getByRole('region', { name: '上架状态' })
    expect(bar.textContent).toMatch(/有 1 处改动还没上架 · 已上架的是第 3 版/)
    expect(document.body.textContent).not.toMatch(/客人现在看到的是/)
    expect(screen.getByTestId('beta-note').textContent).toMatch(/不会改动官网、广告和邮件/)

    fireEvent.click(screen.getByRole('button', { name: '编辑这个团' }))
    fireEvent.change(screen.getByDisplayValue('Atlantis Gold — Coral Loop'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getAllByRole('button', { name: '保存' })[0])
    await screen.findByText(/已存为草稿，还没上架/)
    expect(document.body.textContent).not.toMatch(/客人还看不到/)
  })

  it('once channels are connected: the original wording comes back', async () => {
    await renderReady({
      snapshot: () => jsonResponse(editorSnapshot({ settings: { ...NEUTRAL, channelsConnected: true } })),
    })
    const bar = screen.getByRole('region', { name: '上架状态' })
    expect(bar.textContent).toMatch(/有 1 处改动还没上架 · 客人现在看到的是第 3 版/)
    expect(screen.getByTestId('beta-note').textContent).toMatch(/官网等渠道会按这里的内容更新/)

    fireEvent.click(screen.getByRole('button', { name: '编辑这个团' }))
    fireEvent.change(screen.getByDisplayValue('Atlantis Gold — Coral Loop'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getAllByRole('button', { name: '保存' })[0])
    await screen.findByText(/已存为草稿，客人还看不到/)
  })
})

describe('whole-page states', () => {
  it('shows a skeleton while loading, then the signed-in account in the header', async () => {
    installFetch()
    render(<TourCatalogClient clientId="c1" />)
    expect(screen.getByTestId('catalog-skeleton')).toHaveAttribute('aria-busy', 'true')
    await screen.findByRole('tablist')
    expect(screen.queryByTestId('catalog-skeleton')).toBeNull()
    expect(screen.getByText('你正以 amy@example.test 登录，修改记在这个账号名下')).toBeInTheDocument()
    expect(screen.getByTestId('beta-badge')).toHaveTextContent('Beta')
  })

  it('explains a failed load in plain words and retries', async () => {
    let attempt = 0
    installFetch({
      snapshot: () => {
        attempt += 1
        return attempt === 1 ? jsonResponse({ error: 'some_internal_code' }, 500) : jsonResponse(editorSnapshot())
      },
    })
    render(<TourCatalogClient clientId="c1" />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/团目录暂时打不开/)
    expect(alert.textContent).not.toMatch(/some_internal_code|HTTP|500/)
    fireEvent.click(within(alert).getByRole('button', { name: '重试' }))
    await screen.findByRole('tablist')
  })

  it('tells someone who is not on the list, in Chinese', async () => {
    installFetch({ snapshot: () => jsonResponse({ error: 'Forbidden' }, 403) })
    render(<TourCatalogClient clientId="c1" />)
    expect((await screen.findByTestId('catalog-page-notice')).textContent).toBe(NO_ACCESS_TEXT)
    expect(document.body.textContent).not.toMatch(/Forbidden/)
    // an explanation, not an alarm: no red box, nothing to retry
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  })

  it('losing access while the page is open shows the same calm card, not a red error', async () => {
    let allowed = true
    await renderReady({
      snapshot: () =>
        allowed ? jsonResponse(adminSnapshot()) : jsonResponse({ error: 'Forbidden' }, 403),
    })
    allowed = false
    // any save makes the page re-read the catalog
    fireEvent.click(screen.getByRole('button', { name: '编辑这个团' }))
    fireEvent.change(screen.getByDisplayValue('Atlantis Gold — Coral Loop'), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect((await screen.findByTestId('catalog-page-notice')).textContent).toBe(NO_ACCESS_TEXT)
    expect(screen.queryByText('团目录暂时打不开')).toBeNull()
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  })

  it('a signed-out answer asks to refresh and sign in again', async () => {
    installFetch({ snapshot: () => jsonResponse({ error: 'Unauthorized' }, 401) })
    render(<TourCatalogClient clientId="c1" />)
    expect((await screen.findByTestId('catalog-page-notice')).textContent).toBe(
      '登录已过期，请刷新页面重新登录',
    )
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  })

  it('an answer without permissions is treated as look-only, and nothing reads undefined', async () => {
    const { tours, departures, domain } = editorSnapshot()
    await renderReady({ snapshot: () => jsonResponse({ tours, departures, domain }) })
    expect(tabNames()).toEqual(['团', '修改记录', '上架记录'])
    expect(screen.queryByRole('button', { name: '查看并上架' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'AI 助手' })).toBeNull()
    expect(screen.getByTestId('catalog-header')).toHaveAttribute('data-branded', 'false')
    expect(document.body.textContent).not.toMatch(/undefined|null/)
  })
})

describe('narrow screens', () => {
  const scrollIntoView = vi.fn()
  const originalWidth = window.innerWidth

  beforeEach(() => {
    scrollIntoView.mockClear()
    Element.prototype.scrollIntoView = scrollIntoView
  })

  afterEach(() => {
    window.innerWidth = originalWidth
  })

  it('picking a tour on a phone brings the top of its detail (the back link) into view', async () => {
    window.innerWidth = 375
    await renderReady({ snapshot: () => jsonResponse(adminSnapshot()) })
    expect(scrollIntoView).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('tour-row-t2'))
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))
    expect(scrollIntoView.mock.instances[0]).toBe(screen.getByTestId('detail-back'))
  })

  it('on a wide screen both columns are visible, so nothing scrolls', async () => {
    window.innerWidth = 1440
    await renderReady({ snapshot: () => jsonResponse(adminSnapshot()) })
    fireEvent.click(screen.getByTestId('tour-row-t2'))
    await screen.findByRole('heading', { name: 'Atlantis Gold — Deep Trench' })
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})


describe('site-facing fields by role (whole page)', () => {
  const RICH = {
    ...makeTour('t1', 'Atlantis Gold — Coral Loop'),
    heroImage: '/images/hero.jpg',
    gallery: ['/images/a.jpg'],
    tags: ['reef'],
    rating: 4.4,
  }
  const EXTRA = { tours: [RICH], imagePool: ['/images/hero.jpg', '/images/a.jpg', '/images/b.jpg'] }

  it('client staff: hero joined to the registered domain, no site groups, pick-only images', async () => {
    installFetch({ snapshot: () => jsonResponse(editorSnapshot(EXTRA)) })
    render(<TourCatalogClient clientId="c1" />)
    const hero = await screen.findByAltText('Atlantis Gold — Coral Loop 主图')
    expect(hero).toHaveAttribute('src', 'https://example.test/images/hero.jpg')

    fireEvent.click(screen.getByText('编辑这个团'))
    expect(document.querySelector('[data-group="images"]')).not.toBeNull()
    for (const id of ['faqs', 'search', 'reviews']) {
      expect(document.querySelector(`[data-group="${id}"]`)).toBeNull()
    }
    expect(screen.getByTestId('site-fields-note')).toBeInTheDocument()
    expect(screen.getByTestId('staff-images-notice')).toBeInTheDocument()
    expect(screen.queryByLabelText('填入新的图片地址')).toBeNull()

    // the pool reaches the picker: one image is not in the gallery yet... hero.jpg and b.jpg
    fireEvent.click(within(screen.getByTestId('gallery')).getByText('从已有图片里选'))
    expect(screen.getAllByLabelText(/^选这张图片/)).toHaveLength(2)
  })

  it('Magic Engine admin: all groups, the new-address box, and host suggestions in settings', async () => {
    installFetch({
      snapshot: () =>
        jsonResponse(
          adminSnapshot({ ...EXTRA, imageHostSuggestions: [{ host: 'images.unsplash.com', count: 26 }] }),
        ),
    })
    render(<TourCatalogClient clientId="c1" />)
    await screen.findByAltText('Atlantis Gold — Coral Loop 主图')
    fireEvent.click(screen.getByText('编辑这个团'))
    for (const id of ['basics', 'images', 'itinerary', 'inclusions', 'faqs', 'search', 'reviews']) {
      expect(document.querySelector(`[data-group="${id}"]`)).not.toBeNull()
    }
    expect(screen.getByLabelText('填入新的图片地址')).toBeInTheDocument()
    expect(screen.queryByTestId('site-fields-note')).toBeNull()
    fireEvent.click(screen.getByText('取消'))

    fireEvent.click(screen.getByRole('tab', { name: '设置' }))
    expect(await screen.findByTestId('image-host-suggestions')).toHaveTextContent('images.unsplash.com（26 张）')
    expect(screen.getByRole('button', { name: '开始比对' })).toBeInTheDocument()
  })

  it('the tour list carries no thumbnails', async () => {
    installFetch({ snapshot: () => jsonResponse(editorSnapshot(EXTRA)) })
    render(<TourCatalogClient clientId="c1" />)
    await screen.findByAltText('Atlantis Gold — Coral Loop 主图')
    expect(screen.getByTestId('tour-list-col').querySelectorAll('img')).toHaveLength(0)
  })
})
