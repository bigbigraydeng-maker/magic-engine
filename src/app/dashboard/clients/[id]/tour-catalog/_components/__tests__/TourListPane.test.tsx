import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { TourListPane } from '../TourListPane'
import {
  compactPrice,
  titleCase,
  groupTitle,
  shortTourName,
  changeLine,
  draftChangeLine,
  groupChangesByTour,
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

beforeEach(() => {
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
    expect(screen.getByRole('button', { name: /Atlantis Gold（2）/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Narnia（1）/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /New Zealand Budget（1）/ })).toBeInTheDocument()
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
    const header = screen.getByRole('button', { name: /Atlantis Gold（2）/ })
    fireEvent.click(header)
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('tour-row-t1')).not.toBeInTheDocument()
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
    expect(draftChangeLine(base)).toBe('展示价：对外现在 1000 → 草稿 2000')
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
