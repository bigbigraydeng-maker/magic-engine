'use client'

import type { CatalogDepartureView, CatalogTourView } from './types'
import { priceText } from './catalog-format'
import { BRAND_SELECTED_BORDER_CLASS } from './catalog-brand'
import {
  compactPrice,
  nextDepartOn,
  shortTourName,
  type TourRegionGroup,
  type TourTierGroup,
} from './tour-list-helpers'

export const regionCollapseKey = (key: string): string => `r:${key}`
export const tierCollapseKey = (key: string): string => `t:${key}`

function Counts({ tours, departures }: { tours: number; departures: number }) {
  return (
    <span className="ml-auto shrink-0 text-xs font-semibold">
      {tours} 个团 · {departures} 个班期
    </span>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <span aria-hidden="true" className="w-3 shrink-0 text-xs">
      {open ? '▾' : '▸'}
    </span>
  )
}

interface TourRowProps {
  tour: CatalogTourView
  nameTitle: string
  changed: boolean
  selected: boolean
  nextDate: string | null
  onSelect: (tourId: string) => void
}

function TourRow({ tour, nameTitle, changed, selected, nextDate, onSelect }: TourRowProps) {
  const state = selected
    ? `${BRAND_SELECTED_BORDER_CLASS} bg-me-ivory`
    : 'border-me-charcoal/10 hover:bg-me-ivory/60'
  const inactive = tour.isActive === false
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        data-testid={`tour-row-${tour.id}`}
        onClick={() => onSelect(tour.id)}
        className={`ml-4 flex w-[calc(100%-1rem)] items-center gap-2 border-l-2 px-3 py-2 text-left ${state}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-me-charcoal">
            {shortTourName(tour.name, nameTitle)}
          </span>
          {changed || inactive ? (
            <span className="mt-0.5 flex flex-wrap gap-1">
              {changed ? (
                <span
                  title="有改动还没上架"
                  aria-label="有改动还没上架"
                  className="inline-flex items-center gap-1 rounded-full bg-[#DD6B20]/10 px-1.5 text-xs font-bold text-[#9C4A12]"
                >
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#DD6B20]" />
                  未上架改动
                </span>
              ) : null}
              {inactive ? (
                <span className="rounded-full bg-black/5 px-1.5 text-xs font-semibold text-me-charcoal/70">
                  停售
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-right text-xs font-semibold text-me-charcoal/70">
          <span className="block">{compactPrice(priceText(tour.displayPriceText))}</span>
          <span className="block">{nextDate ? `下一班 ${nextDate}` : '无固定班期'}</span>
        </span>
      </button>
    </li>
  )
}

export interface ListContext {
  collapsed: Set<string>
  /** A search or filter is on: show every hit, whatever was folded. */
  forceOpen: boolean
  changedTourIds: Set<string>
  departures: CatalogDepartureView[]
  today: string
  selectedId: string | null
  onToggle: (key: string) => void
  onSelect: (tourId: string) => void
}

function TierSection({ tier, ctx }: { tier: TourTierGroup; ctx: ListContext }) {
  const key = tierCollapseKey(tier.key)
  const open = ctx.forceOpen || !ctx.collapsed.has(key)
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${tier.title}（${tier.tours.length}）`}
        aria-disabled={ctx.forceOpen}
        onClick={() => {
          if (!ctx.forceOpen) ctx.onToggle(key)
        }}
        className="sticky top-10 z-10 ml-2 flex h-9 w-[calc(100%-0.5rem)] items-center gap-1.5 border-l-2 border-me-charcoal/40 bg-me-ivory px-3 text-left text-sm font-black text-me-charcoal hover:bg-[#F1EBDD]"
      >
        <Chevron open={open} />
        <span>{tier.title}</span>
        <span className="text-me-charcoal/70">（{tier.tours.length}）</span>
        <span className="ml-auto shrink-0 text-xs font-semibold text-me-charcoal/70">
          {tier.departureCount} 个班期
        </span>
      </button>
      {open ? (
        <ul className="py-1">
          {tier.tours.map(tour => (
            <TourRow
              key={tour.id}
              tour={tour}
              nameTitle={tier.nameTitle}
              changed={ctx.changedTourIds.has(tour.id)}
              selected={ctx.selectedId === tour.id}
              nextDate={nextDepartOn(ctx.departures, tour.id, ctx.today)}
              onSelect={ctx.onSelect}
            />
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function RegionSection({ region, ctx }: { region: TourRegionGroup; ctx: ListContext }) {
  const key = regionCollapseKey(region.key)
  const open = ctx.forceOpen || !ctx.collapsed.has(key)
  return (
    <section className="border-b border-black/10">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`系列 ${region.title}`}
        aria-disabled={ctx.forceOpen}
        onClick={() => {
          if (!ctx.forceOpen) ctx.onToggle(key)
        }}
        className="sticky top-0 z-20 flex h-10 w-full items-center gap-1.5 bg-me-charcoal px-3 text-left text-base font-black text-white hover:bg-me-charcoal/90"
      >
        <Chevron open={open} />
        <span>{region.title}</span>
        <Counts tours={region.tourCount} departures={region.departureCount} />
      </button>
      {open
        ? region.tiers.map(tier => <TierSection key={tier.key} tier={tier} ctx={ctx} />)
        : null}
    </section>
  )
}
