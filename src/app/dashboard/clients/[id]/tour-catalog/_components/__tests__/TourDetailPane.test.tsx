import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, within, render as renderPlain } from '@testing-library/react'
import { renderConnected as render } from './render-connected'
import { TourDetailPane } from '../TourDetailPane'
import type { CatalogDepartureView, CatalogTourView } from '../types'
import type { PublishChange } from '@/lib/tour-catalog/publish-contract'
import { CatalogUiProvider } from '../catalog-context'

vi.mock('../TourEditor', () => ({
  TourEditor: (props: {
    onSaved: (t: unknown) => void
    onCancel: () => void
    onDirtyChange?: (d: boolean) => void
  }) => (
    <div data-testid="tour-editor">
      <button type="button" onClick={() => props.onDirtyChange?.(true)}>
        mock-dirty
      </button>
      <button type="button" onClick={() => props.onSaved({})}>
        mock-save
      </button>
      <button type="button" onClick={props.onCancel}>
        mock-cancel
      </button>
    </div>
  ),
}))

vi.mock('../DeparturesEditor', () => ({
  DeparturesEditor: (props: { onChanged: () => void; onDirtyChange?: (d: boolean) => void }) => (
    <div data-testid="departures-editor">
      <button type="button" onClick={() => props.onDirtyChange?.(true)}>
        mock-dep-dirty
      </button>
      <button type="button" onClick={props.onChanged}>
        mock-dep-save
      </button>
    </div>
  ),
}))

vi.mock('../ChangeLog', () => ({ ChangeLog: () => <div data-testid="change-log" /> }))

const TOUR: CatalogTourView = {
  id: 't1',
  slug: 's',
  destination: 'atlantis',
  tier: 'gold',
  name: 'Atlantis Gold — Coral Loop',
  displayPriceText: 'From NZD $5,299 per person',
  isActive: false,
  managesDepartures: false,
  updatedAt: '2026-01-01T00:00:00Z',
}

const DEPARTURES: CatalogDepartureView[] = []

const CHANGES: PublishChange[] = [
  {
    kind: 'tour_field',
    tourId: 't1',
    tourName: 'Coral Loop',
    field: 'durationText',
    fieldLabel: '天数',
    before: '10 Days',
    after: '12 Days',
    risk: 'normal',
  },
  {
    kind: 'tour_field',
    tourId: 't1',
    tourName: 'Coral Loop',
    field: 'displayPriceText',
    fieldLabel: '展示价',
    before: 'NZD $4,999',
    after: 'NZD $5,299',
    risk: 'high',
  },
]

function renderPane(overrides: {
  tour?: CatalogTourView | null
  changes?: PublishChange[]
  onChanged?: () => void
  onDirtyChange?: (d: boolean) => void
  onBack?: () => void
  onOpenPublish?: () => void
} = {}) {
  const onChanged = overrides.onChanged ?? vi.fn()
  const onDirtyChange = overrides.onDirtyChange ?? vi.fn()
  const onBack = overrides.onBack ?? vi.fn()
  const onOpenPublish = overrides.onOpenPublish ?? vi.fn()
  const utils = render(
    <TourDetailPane
      clientId="c1"
      tour={overrides.tour === undefined ? TOUR : overrides.tour}
      departures={DEPARTURES}
      changes={overrides.changes ?? CHANGES}
      onChanged={onChanged}
      onDirtyChange={onDirtyChange}
      onBack={onBack}
      onOpenPublish={onOpenPublish}
    />,
  )
  return { ...utils, onChanged, onDirtyChange, onBack, onOpenPublish }
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('TourDetailPane', () => {
  it('shows the placeholder when no tour is selected', () => {
    renderPane({ tour: null })
    expect(screen.getByText('从左边选一个团')).toBeInTheDocument()
  })

  it('shows the header with name, price and status pills', () => {
    renderPane()
    expect(screen.getByText('Atlantis Gold — Coral Loop')).toBeInTheDocument()
    expect(screen.getByText('From NZD $5,299 per person')).toBeInTheDocument()
    expect(screen.getByText('停售')).toBeInTheDocument()
    expect(screen.getByText('不管理班期')).toBeInTheDocument()
    expect(screen.queryByText('已下架')).not.toBeInTheDocument()
  })

  it('lists unpublished changes with high risk first', () => {
    renderPane()
    expect(screen.getByText('这个团有 2 处改动还没上架')).toBeInTheDocument()
    expect(
      screen.getByText('展示价：对外现在 NZD $4,999 → 草稿 NZD $5,299'),
    ).toBeInTheDocument()
    expect(screen.getByText('天数：对外现在 10 Days → 草稿 12 Days')).toBeInTheDocument()
    const box = screen.getByTestId('unpublished-box')
    const items = within(box).getAllByRole('listitem')
    expect(items[0]).toHaveAttribute('data-risk', 'high')
  })

  it('hides the unpublished box when there are no changes', () => {
    renderPane({ changes: [] })
    expect(screen.queryByTestId('unpublished-box')).not.toBeInTheDocument()
  })

  it('opens the editor and reports dirty state', () => {
    const { onDirtyChange } = renderPane()
    fireEvent.click(screen.getByText('编辑这个团'))
    expect(screen.getByTestId('tour-editor')).toBeInTheDocument()
    fireEvent.click(screen.getByText('mock-dirty'))
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    fireEvent.click(screen.getByText('mock-cancel'))
    expect(screen.queryByTestId('tour-editor')).not.toBeInTheDocument()
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  })

  it('closes the editor and shows the saved notice after a save', () => {
    const { onChanged, onOpenPublish } = renderPane()
    fireEvent.click(screen.getByText('编辑这个团'))
    fireEvent.click(screen.getByText('mock-save'))
    expect(onChanged).toHaveBeenCalled()
    expect(screen.queryByTestId('tour-editor')).not.toBeInTheDocument()
    expect(screen.getByText('已存为草稿，客人还看不到')).toBeInTheDocument()
    fireEvent.click(screen.getByText('去上架'))
    expect(onOpenPublish).toHaveBeenCalled()
  })

  it('shows the saved notice after a departure save and reports dep dirty', () => {
    const { onChanged, onDirtyChange } = renderPane()
    fireEvent.click(screen.getByText('mock-dep-save'))
    expect(onChanged).toHaveBeenCalled()
    expect(screen.getByText('已存为草稿，客人还看不到')).toBeInTheDocument()
    fireEvent.click(screen.getByText('mock-dep-dirty'))
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  })

  it('calls onBack from the back button', () => {
    const { onBack } = renderPane()
    fireEvent.click(screen.getByText('← 返回列表'))
    expect(onBack).toHaveBeenCalled()
  })

  it('reports not dirty on unmount', () => {
    const onDirtyChange = vi.fn()
    const { unmount } = renderPane({ onDirtyChange })
    unmount()
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  })
})

describe('TourDetailPane wording by context', () => {
  function renderIn(ui: { channelsConnected: boolean; canPublish: boolean }) {
    const onOpenPublish = vi.fn()
    render(
      <CatalogUiProvider value={ui}>
        <TourDetailPane
          clientId="c1"
          tour={TOUR}
          departures={DEPARTURES}
          changes={[]}
          onChanged={vi.fn()}
          onDirtyChange={vi.fn()}
          onBack={vi.fn()}
          onOpenPublish={onOpenPublish}
        />
      </CatalogUiProvider>,
    )
    return onOpenPublish
  }

  it('channels not connected: the saved notice says 还没上架', () => {
    renderIn({ channelsConnected: false, canPublish: true })
    fireEvent.click(screen.getByText('mock-dep-save'))
    expect(screen.getByText('已存为草稿，还没上架')).toBeInTheDocument()
    expect(screen.queryByText(/客人还看不到/)).toBeNull()
  })

  it('people who cannot publish get 请 Magic Engine 上架 after a save', () => {
    const onOpenPublish = renderIn({ channelsConnected: false, canPublish: false })
    fireEvent.click(screen.getByText('mock-dep-save'))
    expect(screen.queryByText('去上架')).toBeNull()
    fireEvent.click(screen.getByText('请 Magic Engine 上架'))
    expect(onOpenPublish).toHaveBeenCalled()
  })
})

describe('TourDetailPane saved notice goes away once published', () => {
  function pane(extra: { inSync: boolean; draftVersion: number; changes?: PublishChange[] }) {
    return (
      <CatalogUiProvider value={{ channelsConnected: false, canPublish: true }}>
        <TourDetailPane
          clientId="c1"
          tour={TOUR}
          departures={DEPARTURES}
          changes={extra.changes ?? []}
          onChanged={vi.fn()}
          onDirtyChange={vi.fn()}
          onBack={vi.fn()}
          onOpenPublish={vi.fn()}
          inSync={extra.inSync}
          draftVersion={extra.draftVersion}
        />
      </CatalogUiProvider>
    )
  }

  it('shows after a save, disappears when the draft equals what is published, and stays gone', () => {
    const { rerender } = render(pane({ inSync: false, draftVersion: 9 }))
    fireEvent.click(screen.getByText('mock-dep-save'))
    expect(screen.getByText('已存为草稿，还没上架')).toBeInTheDocument()
    // published: the status now says draft and published are the same
    rerender(pane({ inSync: true, draftVersion: 9 }))
    expect(screen.queryByText('已存为草稿，还没上架')).toBeNull()
    expect(screen.queryByText('去上架')).toBeNull()
    // somebody edits another tour later: this tour was not saved again, so no notice comes back
    rerender(pane({ inSync: false, draftVersion: 10 }))
    expect(screen.queryByText('已存为草稿，还没上架')).toBeNull()
  })

  it('a save made right after a publish shows the notice once the status has caught up', () => {
    const { rerender } = render(pane({ inSync: true, draftVersion: 9 }))
    fireEvent.click(screen.getByText('mock-dep-save'))
    rerender(pane({ inSync: false, draftVersion: 10 }))
    expect(screen.getByText('已存为草稿，还没上架')).toBeInTheDocument()
  })

  it('channels not connected: the pending box says 已上架, never 对外', () => {
    render(pane({ inSync: false, draftVersion: 9, changes: CHANGES }))
    const box = screen.getByTestId('unpublished-box')
    expect(box.textContent).toContain('已上架 ')
    expect(box.textContent).not.toMatch(/对外|客人/)
  })
})

describe('TourDetailPane read-only summary', () => {
  function paneWith(tour: CatalogTourView, siteDomain: string | null = 'example.test') {
    return renderPlain(
      <CatalogUiProvider value={{ channelsConnected: false, canPublish: false, siteDomain }}>
        <TourDetailPane
          clientId="c1"
          tour={tour}
          departures={DEPARTURES}
          changes={[]}
          onChanged={vi.fn()}
          onDirtyChange={vi.fn()}
          onBack={vi.fn()}
          onOpenPublish={vi.fn()}
        />
      </CatalogUiProvider>,
    )
  }

  const FULL: CatalogTourView = {
    ...TOUR,
    isActive: true,
    managesDepartures: true,
    heroImage: '/images/hero.jpg',
    gallery: ['/images/a.jpg', '/images/b.jpg'],
    durationText: '12 Days',
    shortDescription: 'A loop around the reef',
    highlights: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7'],
  }

  it('shows the hero thumbnail, days, price, intro, gallery count above the departures', () => {
    paneWith(FULL)
    const summary = screen.getByTestId('tour-summary')
    const hero = within(summary).getByAltText('Atlantis Gold — Coral Loop 主图')
    expect(hero).toHaveAttribute('src', 'https://example.test/images/hero.jpg')
    expect(within(summary).getByTestId('summary-facts')).toHaveTextContent(
      '12 Days · From NZD $5,299 per person · 图集 2 张',
    )
    expect(within(summary).getByText('A loop around the reef')).toBeInTheDocument()
    // before the departures, not after
    const departures = screen.getByTestId('departures-editor')
    expect(summary.compareDocumentPosition(departures) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('folds highlights after the first five', () => {
    paneWith(FULL)
    const list = screen.getByTestId('summary-highlights')
    expect(within(list).getAllByRole('listitem')).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: '展开其余 2 条' }))
    expect(within(list).getAllByRole('listitem')).toHaveLength(7)
  })

  it('says so when there is no hero image, and renders no image', () => {
    const { container } = paneWith(TOUR)
    expect(within(screen.getByTestId('tour-summary')).getByText('还没有主图')).toBeInTheDocument()
    expect(container.querySelectorAll('img')).toHaveLength(0)
  })

  it('a site-path hero with no registered domain is a placeholder, never a guessed address', () => {
    const { container } = paneWith(FULL, null)
    expect(container.querySelectorAll('img')).toHaveLength(0)
    expect(within(screen.getByTestId('tour-summary')).getByText('站内图片')).toBeInTheDocument()
  })

  it('marks a sold-out tour in red, and only then', () => {
    paneWith({ ...FULL, soldOut: true })
    const badge = screen.getByTestId('sold-out-badge')
    expect(badge).toHaveTextContent('整团售罄')
    expect(badge.className).toContain('text-[#C2453A]')
  })

  it('no sold-out mark on a tour that is not sold out', () => {
    paneWith(FULL)
    expect(screen.queryByTestId('sold-out-badge')).toBeNull()
  })

  it('the summary gives way to the editor while editing and comes back on cancel', () => {
    paneWith(FULL)
    fireEvent.click(screen.getByText('编辑这个团'))
    expect(screen.queryByTestId('tour-summary')).toBeNull()
    fireEvent.click(screen.getByText('mock-cancel'))
    expect(screen.getByTestId('tour-summary')).toBeInTheDocument()
  })
})
