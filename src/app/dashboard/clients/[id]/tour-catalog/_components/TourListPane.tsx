'use client'

import { useMemo, useState } from 'react'
import type { CatalogDepartureView, CatalogTourView } from './types'
import { priceText, todayIso } from './catalog-format'
import {
  TOUR_FILTERS,
  compactPrice,
  filterTours,
  groupTours,
  nextDepartOn,
  shortTourName,
  type TourFilter,
  type TourGroup,
} from './tour-list-helpers'

interface ListToolbarProps {
  query: string
  filter: TourFilter
  onQueryChange: (value: string) => void
  onFilterChange: (value: TourFilter) => void
}

function ListToolbar({ query, filter, onQueryChange, onFilterChange }: ListToolbarProps) {
  return (
    <div className="border-b border-black/10 p-3">
      <input
        type="search"
        aria-label="按团名搜索"
        placeholder="搜索团名"
        value={query}
        onChange={e => onQueryChange(e.target.value)}
        className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal placeholder:text-me-charcoal/40 focus:outline-none focus:ring-2 focus:ring-me-ochre/40"
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {TOUR_FILTERS.map(f => {
          const active = f.id === filter
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={active}
              onClick={() => onFilterChange(f.id)}
              className={
                active
                  ? 'rounded-lg bg-me-charcoal px-2.5 py-1 text-xs font-black text-white'
                  : 'rounded-lg border border-black/10 bg-white px-2.5 py-1 text-xs font-semibold text-me-charcoal hover:bg-me-ivory'
              }
            >
              {f.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface TourRowProps {
  tour: CatalogTourView
  groupTitle: string
  changed: boolean
  selected: boolean
  nextDate: string | null
  onSelect: (tourId: string) => void
}

function TourRow({ tour, groupTitle, changed, selected, nextDate, onSelect }: TourRowProps) {
  const base = 'flex w-full items-center gap-2 border-l-4 px-3 py-2 text-left'
  const state = selected
    ? 'border-me-ochre bg-me-ivory'
    : 'border-transparent hover:bg-me-ivory/60'
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        data-testid={`tour-row-${tour.id}`}
        onClick={() => onSelect(tour.id)}
        className={`${base} ${state}`}
      >
        {changed ? (
          <span
            title="有改动还没上架"
            aria-label="有改动还没上架"
            className="h-2 w-2 shrink-0 rounded-full bg-[#DD6B20]"
          />
        ) : null}
        <span className="truncate font-black text-me-charcoal">
          {shortTourName(tour.name, groupTitle)}
        </span>
        {tour.isActive === false ? (
          <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-xs font-semibold text-me-charcoal/55">
            停售
          </span>
        ) : null}
        <span className="ml-auto shrink-0 text-right text-xs font-semibold text-me-charcoal/55">
          <span className="block">{compactPrice(priceText(tour.displayPriceText))}</span>
          <span className="block">{nextDate ? `下一班 ${nextDate}` : '无固定班期'}</span>
        </span>
      </button>
    </li>
  )
}

interface GroupSectionProps {
  group: TourGroup
  collapsed: boolean
  changedTourIds: string[]
  departures: CatalogDepartureView[]
  today: string
  selectedId: string | null
  onToggle: (key: string) => void
  onSelect: (tourId: string) => void
}

function GroupSection({
  group,
  collapsed,
  changedTourIds,
  departures,
  today,
  selectedId,
  onToggle,
  onSelect,
}: GroupSectionProps) {
  const changed = new Set(changedTourIds)
  return (
    <div>
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={() => onToggle(group.key)}
        className="flex w-full items-center gap-1 px-3 py-2 text-left text-sm font-black text-me-charcoal hover:bg-me-ivory/60"
      >
        <span>{group.title}</span>
        <span className="text-me-charcoal/55">（{group.tours.length}）</span>
      </button>
      {collapsed ? null : (
        <ul>
          {group.tours.map(tour => (
            <TourRow
              key={tour.id}
              tour={tour}
              groupTitle={group.title}
              changed={changed.has(tour.id)}
              selected={selectedId === tour.id}
              nextDate={nextDepartOn(departures, tour.id, today)}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

interface GroupListProps {
  groups: TourGroup[]
  collapsed: Set<string>
  changedTourIds: string[]
  departures: CatalogDepartureView[]
  today: string
  selectedId: string | null
  onToggle: (key: string) => void
  onSelect: (tourId: string) => void
}

function GroupList({
  groups,
  collapsed,
  changedTourIds,
  departures,
  today,
  selectedId,
  onToggle,
  onSelect,
}: GroupListProps) {
  if (groups.length === 0) {
    return <p className="p-4 text-sm font-semibold text-me-charcoal/55">没有符合条件的团</p>
  }
  return (
    <>
      {groups.map(group => (
        <GroupSection
          key={group.key}
          group={group}
          collapsed={collapsed.has(group.key)}
          changedTourIds={changedTourIds}
          departures={departures}
          today={today}
          selectedId={selectedId}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      ))}
    </>
  )
}

interface TourListState {
  query: string
  filter: TourFilter
  collapsed: Set<string>
  setQuery: (value: string) => void
  setFilter: (value: TourFilter) => void
  toggle: (key: string) => void
}

function useTourListState(): TourListState {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<TourFilter>('all')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  const toggle = (key: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return { query, filter, collapsed, setQuery, setFilter, toggle }
}

export function TourListPane(props: {
  tours: CatalogTourView[]
  departures: CatalogDepartureView[]
  changedTourIds: string[]
  selectedId: string | null
  onSelect: (tourId: string) => void
}) {
  const { tours, departures, changedTourIds, selectedId, onSelect } = props
  const { query, filter, collapsed, setQuery, setFilter, toggle } = useTourListState()

  const today = todayIso()
  const groups = useMemo(
    () => groupTours(filterTours(tours, { query, filter, changedTourIds, departures, today })),
    [tours, query, filter, changedTourIds, departures, today],
  )

  return (
    <div className="flex max-h-[calc(100vh-14rem)] min-h-[20rem] flex-col rounded-xl border border-black/10 bg-white shadow-sm">
      <ListToolbar
        query={query}
        filter={filter}
        onQueryChange={setQuery}
        onFilterChange={setFilter}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <GroupList
          groups={groups}
          collapsed={collapsed}
          changedTourIds={changedTourIds}
          departures={departures}
          today={today}
          selectedId={selectedId}
          onToggle={toggle}
          onSelect={onSelect}
        />
      </div>
    </div>
  )
}
