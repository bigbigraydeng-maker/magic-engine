'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CatalogDepartureView, CatalogTourView } from './types'
import { todayIso } from './catalog-format'
import { RegionSection, type ListContext } from './TourListGroups'
import {
  TOUR_FILTERS,
  filterTours,
  groupToursByRegion,
  type TourFilter,
} from './tour-list-helpers'

export const NO_MATCH_TEXT = '没有符合条件的团'
export const NEVER_PUBLISHED_EMPTY_TEXT = '还没上架过，所有团都还没上架。'

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
        className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal placeholder:text-me-charcoal/70 focus:outline-none focus:ring-2 focus:ring-me-ochre/40"
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

const collapseStorageKey = (clientId: string) => `tour-catalog:list-collapsed:${clientId}`

function readCollapsed(clientId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(collapseStorageKey(clientId))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeCollapsed(clientId: string, keys: Set<string>): void {
  try {
    window.localStorage.setItem(collapseStorageKey(clientId), JSON.stringify([...keys]))
  } catch {
    // storage blocked: folding still works for this visit
  }
}

interface TourListState {
  query: string
  filter: TourFilter
  collapsed: Set<string>
  setQuery: (value: string) => void
  setFilter: (value: TourFilter) => void
  toggle: (key: string) => void
}

function useTourListState(clientId: string): TourListState {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<TourFilter>('all')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  // Read after mount so server and first client render agree.
  useEffect(() => {
    const stored = readCollapsed(clientId)
    // Same content: keep the old Set so mount causes no extra render.
    setCollapsed(prev =>
      prev.size === stored.size && [...stored].every(key => prev.has(key)) ? prev : stored,
    )
  }, [clientId])

  const toggle = (key: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      writeCollapsed(clientId, next)
      return next
    })
  }

  return { query, filter, collapsed, setQuery, setFilter, toggle }
}

export function TourListPane(props: {
  clientId: string
  tours: CatalogTourView[]
  departures: CatalogDepartureView[]
  changedTourIds: string[]
  selectedId: string | null
  onSelect: (tourId: string) => void
  /** Nothing has ever been published: "changed since publish" has no meaning yet. */
  neverPublished?: boolean
}) {
  const { tours, departures, changedTourIds, selectedId, onSelect } = props
  const { query, filter, collapsed, setQuery, setFilter, toggle } = useTourListState(props.clientId)
  const emptyText =
    props.neverPublished === true && filter === 'changed' ? NEVER_PUBLISHED_EMPTY_TEXT : NO_MATCH_TEXT

  const today = todayIso()
  const regions = useMemo(
    () =>
      groupToursByRegion(
        filterTours(tours, { query, filter, changedTourIds, departures, today }),
        departures,
      ),
    [tours, query, filter, changedTourIds, departures, today],
  )
  const ctx: ListContext = {
    collapsed,
    forceOpen: query.trim() !== '' || filter !== 'all',
    changedTourIds: new Set(changedTourIds),
    departures,
    today,
    selectedId,
    onToggle: toggle,
    onSelect,
  }

  return (
    <div className="flex max-h-[calc(100vh-14rem)] min-h-[20rem] flex-col rounded-xl border border-black/10 bg-white shadow-sm">
      <ListToolbar
        query={query}
        filter={filter}
        onQueryChange={setQuery}
        onFilterChange={setFilter}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {regions.length === 0 ? (
          <p className="p-4 text-sm font-semibold text-me-charcoal/70">{emptyText}</p>
        ) : (
          regions.map(region => <RegionSection key={region.key} region={region} ctx={ctx} />)
        )}
      </div>
    </div>
  )
}
