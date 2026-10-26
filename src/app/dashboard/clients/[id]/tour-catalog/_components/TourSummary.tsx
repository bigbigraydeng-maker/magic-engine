'use client'

import { useState } from 'react'
import type { CatalogTourView } from './types'
import { ImagePlaceholder, ImageThumb } from './ImageThumb'
import { priceText } from './catalog-format'

export const HIGHLIGHTS_SHOWN = 5

function SummaryFacts({ tour }: { tour: CatalogTourView }) {
  const galleryCount = (tour.gallery ?? []).length
  return (
    <p data-testid="summary-facts" className="text-sm font-semibold text-me-charcoal/70">
      {`${tour.durationText || '天数未填'} · ${priceText(tour.displayPriceText)} · 图集 ${galleryCount} 张`}
    </p>
  )
}

function SummaryDescription({ tour }: { tour: CatalogTourView }) {
  const text = tour.shortDescription
  if (!text) {
    return <p className="text-sm text-me-charcoal/60">还没有简介</p>
  }
  return <p className="max-w-prose break-words text-sm text-me-charcoal">{text}</p>
}

function SummaryHighlights({ highlights }: { highlights: string[] }) {
  const [expanded, setExpanded] = useState(false)
  if (highlights.length === 0) return null
  const rest = highlights.length - HIGHLIGHTS_SHOWN
  const shown = expanded ? highlights : highlights.slice(0, HIGHLIGHTS_SHOWN)
  return (
    <div>
      <ul
        data-testid="summary-highlights"
        className="max-w-prose list-disc space-y-0.5 pl-5 text-sm text-me-charcoal"
      >
        {shown.map((item, index) => (
          <li key={`highlight-${index}`} className="break-words">
            {item}
          </li>
        ))}
      </ul>
      {rest > 0 ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-xs font-semibold text-me-charcoal/60 underline"
        >
          {expanded ? '收起' : `展开其余 ${rest} 条`}
        </button>
      ) : null}
    </div>
  )
}

function SummaryHero({ tour, domain }: { tour: CatalogTourView; domain: string | null }) {
  if (tour.heroImage) {
    return (
      <ImageThumb size="lg" src={tour.heroImage} alt={`${tour.name} 主图`} domain={domain} />
    )
  }
  return <ImagePlaceholder size="lg" text="还没有主图" />
}

export function TourSummary(props: { tour: CatalogTourView; domain: string | null }): JSX.Element {
  const { tour, domain } = props
  return (
    <div data-testid="tour-summary" className="flex flex-col gap-3 sm:flex-row">
      <SummaryHero tour={tour} domain={domain} />
      <div className="min-w-0 flex-1 space-y-2">
        <SummaryFacts tour={tour} />
        <SummaryDescription tour={tour} />
        <SummaryHighlights highlights={tour.highlights ?? []} />
      </div>
    </div>
  )
}
