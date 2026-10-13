'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CatalogChangeView, CatalogChangesResponse, ChangeSource } from '@/lib/tour-catalog/catalog-contract'
import { CHANGE_SOURCE_LABELS, CHANGE_SOURCES, SELF_REPORTED_TITLE } from './change-source'
import { formatDateTimeWithYear } from './catalog-format'

export const CHANGE_FEED_INTRO = '这里记录草稿的每一次修改；上架和换回旧版看「上架记录」。'
export const CHANGE_FEED_ERROR = '读不到修改记录，请稍后再试'

interface FeedState {
  changes: CatalogChangeView[]
  loading: boolean
  failed: boolean
  loaded: boolean
}

const INITIAL_STATE: FeedState = { changes: [], loading: true, failed: false, loaded: false }

function useChangeFeed(clientId: string, refreshKey: string | number | undefined): FeedState & { reload: () => void } {
  const [state, setState] = useState<FeedState>(INITIAL_STATE)
  const requestIdRef = useRef(0)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setState(prev => ({ ...prev, loading: true, failed: false }))

    const load = async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/tour-catalog/changes`)
        if (requestIdRef.current !== requestId) return
        if (!res.ok) {
          setState(prev => ({ ...prev, loading: false, failed: true }))
          return
        }
        const body = (await res.json().catch(() => ({}))) as Partial<CatalogChangesResponse>
        if (requestIdRef.current !== requestId) return
        if (!Array.isArray(body.changes)) {
          setState(prev => ({ ...prev, loading: false, failed: true }))
          return
        }
        setState({ changes: body.changes, loading: false, failed: false, loaded: true })
      } catch {
        if (requestIdRef.current !== requestId) return
        setState(prev => ({ ...prev, loading: false, failed: true }))
      }
    }

    void load()
  }, [clientId, refreshKey, reloadToken])

  const reload = useCallback(() => setReloadToken(token => token + 1), [])
  return { ...state, reload }
}

function distinctActors(changes: CatalogChangeView[]): string[] {
  const seen = new Set<string>()
  for (const change of changes) seen.add(change.actorLabel)
  return Array.from(seen).sort((a, b) => a.localeCompare(b))
}

function presentSources(changes: CatalogChangeView[]): ChangeSource[] {
  const seen = new Set<ChangeSource>()
  for (const change of changes) seen.add(change.source)
  return CHANGE_SOURCES.filter(source => seen.has(source))
}

function ChangeFilters(props: {
  actors: string[]
  sources: ChangeSource[]
  actor: string
  source: string
  onActor: (value: string) => void
  onSource: (value: string) => void
}) {
  const actorId = useId()
  const sourceId = useId()
  const selectClass =
    'rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal focus:outline-none focus:ring-2 focus:ring-me-ochre/40'
  return (
    <div className="flex flex-wrap gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={actorId} className="text-xs font-semibold text-me-charcoal/55">
          按人
        </label>
        <select id={actorId} className={selectClass} value={props.actor} onChange={e => props.onActor(e.target.value)}>
          <option value="">全部</option>
          {props.actors.map(actor => (
            <option key={actor} value={actor}>
              {actor}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={sourceId} className="text-xs font-semibold text-me-charcoal/55">
          按来源
        </label>
        <select id={sourceId} className={selectClass} value={props.source} onChange={e => props.onSource(e.target.value)}>
          <option value="">全部</option>
          {props.sources.map(source => (
            <option key={source} value={source}>
              {CHANGE_SOURCE_LABELS[source] ?? '系统'}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

function ChangeRow({ change }: { change: CatalogChangeView }) {
  return (
    <li
      data-testid={`change-row-${change.id}`}
      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-black/10 py-2 text-sm"
    >
      <span className="whitespace-nowrap text-me-charcoal/55">{formatDateTimeWithYear(change.createdAt)}</span>
      {change.actorLabel && change.actorLabel !== CHANGE_SOURCE_LABELS[change.source] ? (
        <span className="break-all font-black text-me-charcoal">{change.actorLabel}</span>
      ) : null}
      <span
        data-source={change.source}
        className="rounded-full border border-black/10 bg-me-ivory px-2 py-0.5 text-xs font-black text-me-charcoal/70"
      >
        {CHANGE_SOURCE_LABELS[change.source] ?? '系统'}
      </span>
      {change.source === 'assistant' ? (
        <span title={SELF_REPORTED_TITLE} className="text-[11px] font-semibold text-me-charcoal/55">
          自报
        </span>
      ) : null}
      {typeof change.tourName === 'string' && change.tourName !== '' ? (
        <span className="font-semibold text-me-charcoal">{change.tourName}</span>
      ) : null}
      <span className="min-w-0 break-all text-me-charcoal">{change.summary}</span>
    </li>
  )
}

function ChangeList({ changes }: { changes: CatalogChangeView[] }) {
  return (
    <ul className="mt-3">
      {changes.map(change => (
        <ChangeRow key={change.id} change={change} />
      ))}
    </ul>
  )
}

function FeedError(props: { onRetry: () => void }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <p role="alert" className="text-sm font-black text-[#C2453A]">
        {CHANGE_FEED_ERROR}
      </p>
      <button
        type="button"
        onClick={props.onRetry}
        className="rounded-lg border border-black/10 bg-white px-3 py-1 text-sm font-semibold text-me-charcoal hover:bg-me-ivory"
      >
        重试
      </button>
    </div>
  )
}

function FeedBody(props: {
  loading: boolean
  failed: boolean
  loaded: boolean
  changes: CatalogChangeView[]
  visible: CatalogChangeView[]
  actors: string[]
  sources: ChangeSource[]
  actor: string
  source: string
  onActor: (value: string) => void
  onSource: (value: string) => void
  onRetry: () => void
}) {
  const { loading, failed, loaded, changes, visible, actors, sources, actor, source, onActor, onSource, onRetry } = props
  const showFirstLoad = loading && !loaded && !failed
  const showFilters = !failed && changes.length > 0

  return (
    <>
      {showFirstLoad ? <p className="mt-3 text-sm text-me-charcoal/55">加载中…</p> : null}

      {failed ? <FeedError onRetry={onRetry} /> : null}

      {!failed && loaded && changes.length === 0 ? (
        <p className="mt-3 text-sm text-me-charcoal/55">还没有修改记录</p>
      ) : null}

      {showFilters ? (
        <div className="mt-4">
          <ChangeFilters
            actors={actors}
            sources={sources}
            actor={actor}
            source={source}
            onActor={onActor}
            onSource={onSource}
          />
        </div>
      ) : null}

      {!failed && changes.length > 0 && visible.length === 0 ? (
        <p className="mt-3 text-sm text-me-charcoal/55">没有符合条件的记录</p>
      ) : null}

      {!failed && visible.length > 0 ? <ChangeList changes={visible} /> : null}
    </>
  )
}

export function CatalogChangeFeed(props: { clientId: string; refreshKey?: string | number }): JSX.Element {
  const { changes, loading, failed, loaded, reload } = useChangeFeed(props.clientId, props.refreshKey)
  const [actor, setActor] = useState('')
  const [source, setSource] = useState('')

  const actors = useMemo(() => distinctActors(changes), [changes])
  const sources = useMemo(() => presentSources(changes), [changes])
  const visible = useMemo(
    () => changes.filter(c => (actor === '' || c.actorLabel === actor) && (source === '' || c.source === source)),
    [changes, actor, source],
  )

  return (
    <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm">
      <h2 className="font-display font-black text-me-charcoal">修改记录</h2>
      <p className="mt-1 text-sm text-me-charcoal/55">{CHANGE_FEED_INTRO}</p>

      <FeedBody
        loading={loading}
        failed={failed}
        loaded={loaded}
        changes={changes}
        visible={visible}
        actors={actors}
        sources={sources}
        actor={actor}
        source={source}
        onActor={setActor}
        onSource={setSource}
        onRetry={reload}
      />
    </section>
  )
}
