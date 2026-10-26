'use client'

import { useEffect, useState } from 'react'
import type { CatalogDepartureView, CatalogTourView } from './types'
import type { PublishChange } from '@/lib/tour-catalog/publish-contract'
import { TourEditor } from './TourEditor'
import { DeparturesEditor } from './DeparturesEditor'
import { CompletenessCard } from './CompletenessCard'
import { ChangeLog } from './ChangeLog'
import { TourSummary } from './TourSummary'
import { TourSalesLine } from './TourSalesLine'
import { priceText, upcomingCount, savedAsDraftText } from './catalog-format'
import { useCatalogUi, useChannelsConnected } from './catalog-context'
import {
  draftChangeLine,
  groupTitle,
  regionTitle,
  shortTourName,
  sortByRisk,
  tierTitle,
} from './tour-list-helpers'

export interface TourDetailPaneProps {
  clientId: string
  tour: CatalogTourView | null
  /** Departures of THIS tour only. */
  departures: CatalogDepartureView[]
  /** Not-yet-published changes of THIS tour only. */
  changes: PublishChange[]
  /** A save happened: the parent re-reads the catalog and the publish status. */
  onChanged: () => void
  onDirtyChange: (dirty: boolean) => void
  /** Narrow screens: go back to the list. */
  onBack: () => void
  onOpenPublish: () => void
  /** True once the publish status says the draft equals what is published. */
  inSync?: boolean
  /** Draft revision of the publish status; moves after every save. */
  draftVersion?: number | null
}

export function TourDetailPane(props: TourDetailPaneProps): JSX.Element {
  if (props.tour === null) {
    return (
      <div className="rounded-xl border border-dashed border-black/10 bg-white p-10 text-center">
        <p className="text-sm font-semibold text-me-charcoal/55">从左边选一个团</p>
      </div>
    )
  }
  return <TourDetail {...props} tour={props.tour} />
}

function Breadcrumb({ tour }: { tour: CatalogTourView }): JSX.Element {
  const shortName = shortTourName(tour.name, groupTitle(tour.destination, tour.tier))
  return (
    <nav
      aria-label="当前位置"
      data-testid="tour-breadcrumb"
      className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-me-charcoal/70"
    >
      <span>{regionTitle(tour.destination)}</span>
      <span aria-hidden="true">›</span>
      <span>{tierTitle(tour.tier)}</span>
      <span aria-hidden="true">›</span>
      <span aria-current="page" className="text-me-charcoal">
        {shortName}
      </span>
    </nav>
  )
}

function DetailHeader(props: {
  tour: CatalogTourView
  departures: CatalogDepartureView[]
}): JSX.Element {
  const { tour, departures } = props
  return (
    <div className="space-y-1">
      <Breadcrumb tour={tour} />
      <h2 className="font-display text-lg font-black text-me-charcoal">{tour.name}</h2>
      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-me-charcoal/55">
        <span>{priceText(tour.displayPriceText)}</span>
        <span>·</span>
        <span>即将出发 {upcomingCount(departures)} 个班期</span>
        {tour.soldOut === true ? (
          <span
            data-testid="sold-out-badge"
            className="rounded-full bg-[#C2453A]/10 px-2 py-0.5 text-xs font-bold text-[#C2453A]"
          >
            整团售罄
          </span>
        ) : null}
        {tour.isActive === false ? (
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-bold text-me-charcoal/55">
            停售
          </span>
        ) : null}
        {!tour.managesDepartures ? (
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-bold text-me-charcoal/55">
            不管理班期
          </span>
        ) : null}
      </div>
    </div>
  )
}

function UnpublishedBox(props: { changes: PublishChange[] }): JSX.Element | null {
  const { changes } = props
  const connected = useChannelsConnected()
  if (changes.length === 0) return null
  const sorted = sortByRisk(changes)
  return (
    <div
      data-testid="unpublished-box"
      className="rounded-lg border border-[#B7791F]/30 bg-[#B7791F]/10 p-3"
    >
      <p className="text-sm font-black text-[#B7791F]">这个团有 {changes.length} 处改动还没上架</p>
      <ul className="mt-1 space-y-0.5">
        {sorted.map((change, index) => (
          <li
            key={`${change.kind}-${change.field ?? ''}-${change.departOn ?? ''}-${index}`}
            data-risk={change.risk}
            className={
              change.risk === 'high'
                ? 'break-all text-sm font-black text-[#C2453A]'
                : 'break-all text-sm font-semibold text-me-charcoal/70'
            }
          >
            {draftChangeLine(change, connected)}
          </li>
        ))}
      </ul>
    </div>
  )
}

interface DirtyReport {
  setTourDirty: (dirty: boolean) => void
  setDepDirty: (dirty: boolean) => void
}

function useDirtyReport(onDirtyChange: (dirty: boolean) => void): DirtyReport {
  const [tourDirty, setTourDirty] = useState(false)
  const [depDirty, setDepDirty] = useState(false)

  useEffect(() => {
    onDirtyChange(tourDirty || depDirty)
  }, [tourDirty, depDirty, onDirtyChange])

  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  return { setTourDirty, setDepDirty }
}

function SavedNotice(props: { onOpenPublish: () => void }): JSX.Element {
  const { onOpenPublish } = props
  const { channelsConnected, canPublish } = useCatalogUi()
  return (
    <p role="status" className="text-sm font-black text-[#456F35]">
      {savedAsDraftText(channelsConnected)}{' '}
      <button type="button" onClick={onOpenPublish} className="ml-2 underline">
        {canPublish ? '去上架' : '请 Magic Engine 上架'}
      </button>
    </p>
  )
}

interface TourEditSectionProps {
  clientId: string
  tour: CatalogTourView
  editing: boolean
  onStartEdit: () => void
  onSaved: () => void
  onCancel: () => void
  onDirtyChange: (dirty: boolean) => void
}

function TourEditSection(props: TourEditSectionProps): JSX.Element {
  const { clientId, tour, editing, onStartEdit, onSaved, onCancel, onDirtyChange } = props
  if (editing) {
    return (
      <TourEditor
        clientId={clientId}
        tour={tour}
        onSaved={onSaved}
        onCancel={onCancel}
        onDirtyChange={onDirtyChange}
      />
    )
  }
  return (
    <button
      type="button"
      onClick={onStartEdit}
      className="rounded-lg border border-black/10 bg-white px-3 py-1 text-sm font-semibold text-me-charcoal hover:bg-me-ivory"
    >
      编辑这个团
    </button>
  )
}

function TourDetail(props: TourDetailPaneProps & { tour: CatalogTourView }): JSX.Element {
  const { clientId, tour, departures, changes, onChanged, onDirtyChange, onBack, onOpenPublish } =
    props
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState(false)
  const { siteDomain } = useCatalogUi()
  const { setTourDirty, setDepDirty } = useDirtyReport(onDirtyChange)
  const inSync = props.inSync === true

  // Published (or the draft went back to what is published): "saved, not published yet" is no longer true.
  useEffect(() => {
    if (inSync) setSaved(false)
  }, [inSync, props.draftVersion])

  // The editor is gone after save / cancel, so whatever it held is no longer pending.
  const closeEditor = () => {
    setEditing(false)
    setTourDirty(false)
  }

  const refreshKey = [tour.updatedAt ?? '', ...departures.map(d => d.updatedAt ?? '')].join('|')

  return (
    <div className="space-y-4 rounded-xl border border-black/10 bg-white p-5 shadow-sm">
      <button
        type="button"
        data-testid="detail-back"
        onClick={onBack}
        className="scroll-mt-4 text-xs font-bold text-me-charcoal/55 hover:text-me-ochre lg:hidden"
      >
        ← 返回列表
      </button>

      <DetailHeader tour={tour} departures={departures} />

      {editing ? null : <TourSummary tour={tour} domain={siteDomain ?? null} />}

      {editing ? null : <TourSalesLine clientId={clientId} tourId={tour.id} />}

      <UnpublishedBox changes={changes} />

      {editing ? null : <CompletenessCard tour={tour} departureCount={departures.length} />}

      {saved && !inSync ? <SavedNotice onOpenPublish={onOpenPublish} /> : null}

      <TourEditSection
        clientId={clientId}
        tour={tour}
        editing={editing}
        onStartEdit={() => setEditing(true)}
        onSaved={() => {
          closeEditor()
          setSaved(true)
          onChanged()
        }}
        onCancel={closeEditor}
        onDirtyChange={setTourDirty}
      />

      <h3 className="font-display font-black text-me-charcoal">出发班期</h3>
      <DeparturesEditor
        clientId={clientId}
        tourId={tour.id}
        departures={departures}
        onChanged={() => {
          setSaved(true)
          onChanged()
        }}
        onDirtyChange={setDepDirty}
      />

      <ChangeLog clientId={clientId} tourId={tour.id} refreshKey={refreshKey} />
    </div>
  )
}
