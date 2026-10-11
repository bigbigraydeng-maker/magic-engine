import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react'
import { TourListPane } from '../TourListPane'
import {
  compactPrice,
  titleCase,
  groupTitle,
  shortTourName,
  changeLine,
  draftChangeLine,
  groupChangesByTour,
  groupToursByRegion,
  regionTitle,
  tierTitle,
} from '../tour-list-helpers'
import type { CatalogDepartureView, CatalogTourView } from '../types'
import type { PublishChange } from '@/lib/tour-catalog/publish-contract'

const TOURS: CatalogTourView[] = [
  {
    id: 't1',
    slug: 'coral-loop',
    destination: 'atlantis',
    tier: 'gold',
    name: 'Atlantis Gold — Coral Loop',
    displayPriceText: '1000',
    isActive: true,
    managesDepartures: true,
  },
  {
    id: 't2',
    slug: 'deep-trench',
    destination: 'atlantis',
    tier: 'gold',
    name: 'Atlantis Gold — Deep Trench',
    displayPriceText: '2000',
    isActive: true,
    managesDepartures: true,
  },
  {
    id: 't3',
    slug: 'lantern-waste',
    destination: 'narnia',
    tier: 'unknown',
    name: 'Lantern Waste',
    displayPriceText: null,
    isActive: false,
    managesDepartures: true,
  },
  {
    id: 't4',
    slug: 'south-trail',
    destination: 'new-zealand',
    tier: 'budget',
    name: 'South Trail',
    displayPriceText: '3000',
    isActive: true,
    managesDepartures: true,
  },
]

const DEPARTURES: CatalogDepartureView[] = [
  {
    id: 'd1',
    tourId: 't1',
    departOn: '2999-05-13',
    returnOn: '2999-05-20',
    status: 'open',
    priceTextOverride: null,
  },
  {
    id: 'd2',
    tourId: 't2',
    departOn: '2000-01-01',
    returnOn: '2000-01-08',
    status: 'open',
    priceTextOverride: null,
  },
]

function renderPane(overrides: Partial<Parameters<typeof TourListPane>[0]> = {}) {
  const onSelect = vi.fn()
  render(
    <TourListPane
      clientId="c1"
      tours={TOURS}
      departures={DEPARTURES}
      changedTourIds={[]}
      selectedId={null}
      onSelect={onSelect}
      {...overrides}
    />,
  )
  return { onSelect }
}

function installMemoryStorage(): void {
  const store = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  })
}

beforeEach(() => {
  installMemoryStorage()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('TourListPane', () => {
  it('renders group titles from the data', () => {
    renderPane()
    // level 1: series (with counts), level 2: tier
    expect(screen.getByRole('button', { name: '系列 Atlantis' })).toHaveTextContent('2 个团 · 2 个班期')
    expect(screen.getByRole('button', { name: '系列 Narnia' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '系列 新西兰 New Zealand' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gold（2）' })).toHaveTextContent('2 个班期')
    expect(screen.getByRole('button', { name: '未分档（1）' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Budget（1）' })).toBeInTheDocument()
  })

  it('shows short names and hides the full name', () => {
    renderPane()
    expect(screen.getByText('Coral Loop')).toBeInTheDocument()
    expect(screen.queryByText('Atlantis Gold — Coral Loop')).not.toBeInTheDocument()
  })

  it('shows next departure and no-departure text, and 停售 for inactive', () => {
    renderPane()
    expect(screen.getByText('下一班 2999-05-13')).toBeInTheDocument()
    expect(screen.getAllByText('无固定班期').length).toBeGreaterThan(0)
    expect(within(screen.getByTestId('tour-row-t3')).getByText('停售')).toBeInTheDocument()
    expect(within(screen.getByTestId('tour-row-t1')).queryByText('停售')).toBeNull()
  })

  it('filters by search query', () => {
    renderPane()
    fireEvent.change(screen.getByLabelText('按团名搜索'), { target: { value: 'trench' } })
    expect(screen.getAllByTestId(/^tour-row-/)).toHaveLength(1)
    expect(screen.getByText('Deep Trench')).toBeInTheDocument()
  })

  it('applies each filter', () => {
    renderPane({ changedTourIds: ['t2'] })
    expect(screen.getAllByTestId(/^tour-row-/)).toHaveLength(4)

    fireEvent.click(screen.getByRole('button', { name: '有改动未上架' }))
    let rows = screen.getAllByTestId(/^tour-row-/)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveAttribute('data-testid', 'tour-row-t2')

    fireEvent.click(screen.getByRole('button', { name: '有班期' }))
    rows = screen.getAllByTestId(/^tour-row-/)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveAttribute('data-testid', 'tour-row-t1')

    fireEvent.click(screen.getByRole('button', { name: '停售' }))
    rows = screen.getAllByTestId(/^tour-row-/)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveAttribute('data-testid', 'tour-row-t3')
  })

  it('shows empty message when nothing matches', () => {
    renderPane()
    fireEvent.change(screen.getByLabelText('按团名搜索'), { target: { value: 'zzz' } })
    expect(screen.getByText('没有符合条件的团')).toBeInTheDocument()
  })

  it('calls onSelect and marks the selected row', () => {
    const { onSelect } = renderPane({ selectedId: 't1' })
    fireEvent.click(screen.getByTestId('tour-row-t2'))
    expect(onSelect).toHaveBeenCalledWith('t2')
    expect(screen.getByTestId('tour-row-t1')).toHaveAttribute('aria-current', 'true')
  })

  it('shows the orange dot only for changed tours', () => {
    renderPane({ changedTourIds: ['t2'] })
    expect(screen.getByLabelText('有改动还没上架')).toBeInTheDocument()
  })

  it('collapses a group', () => {
    renderPane()
    const header = screen.getByRole('button', { name: 'Gold（2）' })
    fireEvent.click(header)
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('tour-row-t1')).not.toBeInTheDocument()
    expect(screen.getByTestId('tour-row-t4')).toBeInTheDocument()
  })

  it('collapses a whole series and remembers it in this browser', () => {
    renderPane()
    fireEvent.click(screen.getByRole('button', { name: '系列 Atlantis' }))
    expect(screen.queryByTestId('tour-row-t1')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Gold（2）' })).not.toBeInTheDocument()
    expect(window.localStorage.getItem('tour-catalog:list-collapsed:c1')).toContain('r:atlantis')
    cleanup()
    renderPane()
    expect(screen.queryByTestId('tour-row-t1')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '系列 Atlantis' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('a search opens folded groups so hits are never hidden', () => {
    renderPane()
    fireEvent.click(screen.getByRole('button', { name: '系列 Atlantis' }))
    fireEvent.change(screen.getByLabelText('按团名搜索'), { target: { value: 'coral' } })
    expect(screen.getByTestId('tour-row-t1')).toBeInTheDocument()
  })

  it('clicking a header while a search forces groups open does not change the saved folding', () => {
    renderPane()
    fireEvent.change(screen.getByLabelText('按团名搜索'), { target: { value: 'coral' } })
    fireEvent.click(screen.getByRole('button', { name: '系列 Atlantis' }))
    fireEvent.click(screen.getByRole('button', { name: 'Gold（1）' }))
    expect(screen.getByTestId('tour-row-t1')).toBeInTheDocument()
    expect(window.localStorage.getItem('tour-catalog:list-collapsed:c1')).toBeNull()
    fireEvent.change(screen.getByLabelText('按团名搜索'), { target: { value: '' } })
    expect(screen.getByTestId('tour-row-t1')).toBeInTheDocument()
  })

  it('search also matches the series name', () => {
    renderPane()
    fireEvent.change(screen.getByLabelText('按团名搜索'), { target: { value: '新西兰' } })
    expect(screen.getAllByTestId(/^tour-row-/)).toHaveLength(1)
  })
})

describe('tour-list-helpers hierarchy', () => {
  it('groups series -> tier -> tours with counts', () => {
    const regions = groupToursByRegion(TOURS, DEPARTURES)
    expect(regions.map(r => r.title)).toEqual(['Atlantis', 'Narnia', '新西兰 New Zealand'])
    expect(regions[0].tourCount).toBe(2)
    expect(regions[0].departureCount).toBe(2)
    expect(regions[0].tiers[0].title).toBe('Gold')
    expect(regions[1].tiers[0].title).toBe('未分档')
  })

  it('regionTitle and tierTitle', () => {
    expect(regionTitle('china')).toBe('中国 China')
    expect(regionTitle('')).toBe('其他')
    expect(tierTitle('')).toBe('未分档')
    expect(tierTitle('Signature')).toBe('Signature')
  })
})

describe('tour-list-helpers', () => {
  it('titleCase', () => {
    expect(titleCase('china')).toBe('China')
    expect(titleCase('new-zealand')).toBe('New Zealand')
    expect(titleCase('new_zealand')).toBe('New Zealand')
    expect(titleCase('  ')).toBe('')
  })

  it('groupTitle', () => {
    expect(groupTitle('atlantis', 'gold')).toBe('Atlantis Gold')
    expect(groupTitle('narnia', 'unknown')).toBe('Narnia')
    expect(groupTitle('', '')).toBe('其他')
  })

  it('shortTourName', () => {
    expect(shortTourName('China Signature — Natural China', 'China Signature')).toBe('Natural China')
    expect(shortTourName('Atlantis Gold — Coral Loop', 'Atlantis Gold')).toBe('Coral Loop')
    expect(shortTourName('Lantern Waste', 'Narnia')).toBe('Lantern Waste')
    expect(shortTourName('Atlantis Gold —', 'Atlantis Gold')).toBe('Atlantis Gold —')
  })

  it('changeLine', () => {
    const base: PublishChange = {
      kind: 'tour_field',
      tourId: 't1',
      tourName: 'X',
      field: 'displayPriceText',
      fieldLabel: '展示价',
      before: null,
      after: '1000',
      risk: 'normal',
    }
    expect(changeLine(base)).toBe('展示价：（无） → 1000')
    expect(changeLine({ ...base, departOn: '2027-05-13', fieldLabel: '班期状态' })).toBe(
      '2027-05-13 班期状态：（无） → 1000',
    )
  })

  it('draftChangeLine', () => {
    const base: PublishChange = {
      kind: 'tour_field',
      tourId: 't1',
      tourName: 'X',
      field: 'displayPriceText',
      fieldLabel: '展示价',
      before: '1000',
      after: '2000',
      risk: 'normal',
    }
    expect(draftChangeLine(base, true)).toBe('展示价：对外现在 1000 → 草稿 2000')
    // nothing reads the catalog yet: say what is published, not what is outward
    expect(draftChangeLine(base, false)).toBe('展示价：已上架 1000 → 草稿 2000')
    expect(draftChangeLine({ ...base, departOn: '2027-05-13' }, false)).toBe(
      '2027-05-13 展示价：已上架 1000 → 草稿 2000',
    )
  })

  it('compactPrice keeps only the amount for a list row', () => {
    expect(compactPrice('From NZD $4,999 per person')).toBe('NZD $4,999')
    expect(compactPrice('NZD $4,999')).toBe('NZD $4,999')
    expect(compactPrice('价格待定')).toBe('价格待定')
  })

  it('groupChangesByTour puts high-risk groups first', () => {
    const mk = (tourId: string, risk: 'high' | 'normal'): PublishChange => ({
      kind: 'tour_field',
      tourId,
      tourName: tourId,
      field: 'f',
      fieldLabel: '字段',
      before: 'a',
      after: 'b',
      risk,
    })
    const groups = groupChangesByTour([
      mk('a', 'normal'),
      mk('b', 'normal'),
      mk('b', 'high'),
      mk('c', 'normal'),
    ])
    expect(groups.map(g => g.tourId)).toEqual(['b', 'a', 'c'])
    expect(groups[0].changes.map(c => c.risk)).toEqual(['high', 'normal'])
  })
})

describe('TourListPane 有改动未上架 before anything was published', () => {
  it('explains that nothing is published yet instead of "no match"', () => {
    renderPane({ neverPublished: true })
    fireEvent.click(screen.getByRole('button', { name: '有改动未上架' }))
    expect(screen.getByText('还没上架过，所有团都还没上架。')).toBeInTheDocument()
    expect(screen.queryByText('没有符合条件的团')).toBeNull()
  })

  it('keeps the plain empty line once something was published, and for other filters', () => {
    renderPane({ neverPublished: false })
    fireEvent.click(screen.getByRole('button', { name: '有改动未上架' }))
    expect(screen.getByText('没有符合条件的团')).toBeInTheDocument()
  })

  it('a search with no hit before the first publish is still just "no match"', () => {
    renderPane({ neverPublished: true })
    fireEvent.change(screen.getByLabelText('按团名搜索'), { target: { value: 'zzzz' } })
    expect(screen.getByText('没有符合条件的团')).toBeInTheDocument()
  })
})
