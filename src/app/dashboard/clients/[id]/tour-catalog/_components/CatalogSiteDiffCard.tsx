'use client'

import { useState } from 'react'
import type { SiteDiffEntry, SiteDiffResponse } from '@/lib/tour-catalog/catalog-contract'

export const SITE_DIFF_INTRO =
  '读入之后、官网接通之前，两边都可能被改。接通那天，这里应该是完全一致。'
export const SITE_DIFF_ERROR_TEXTS: Record<string, string> = {
  no_domain: '这个客户还没登记官网域名',
  feed_unavailable: '暂时读不到官网的数据，请稍后再试',
}
export const SITE_DIFF_FAILED_TEXT = '比对失败'
export const DIFF_PAGE_SIZE = 50

const CLIP_MAX = 120

export function clip(value: string | null | undefined): string {
  if (value === null || value === undefined) return '（无）'
  // An empty value would read as a gap in the line ("官网  ｜ 目录 …"): name it.
  if (value.trim() === '') return '（空）'
  if (value.length > CLIP_MAX) return `${value.slice(0, CLIP_MAX)}…`
  return value
}

interface DiffState {
  result: SiteDiffResponse | null
  error: string | null
  loading: boolean
  visible: number
  run: () => Promise<void>
  showMore: () => void
}

function normalize(data: SiteDiffResponse): SiteDiffResponse {
  return {
    websiteTours: data.websiteTours ?? 0,
    catalogTours: data.catalogTours ?? 0,
    onlyOnWebsite: data.onlyOnWebsite ?? [],
    onlyInCatalog: data.onlyInCatalog ?? [],
    differences: data.differences ?? [],
    notes: data.notes ?? [],
  }
}

function useSiteDiff(clientId: string): DiffState {
  const [result, setResult] = useState<SiteDiffResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [visible, setVisible] = useState(DIFF_PAGE_SIZE)

  async function run(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/tour-catalog/site-diff`)
      if (!res.ok) {
        let code: string | undefined
        try {
          const body = (await res.json()) as { error?: string }
          code = body.error
        } catch {
          code = undefined
        }
        setError((code ? SITE_DIFF_ERROR_TEXTS[code] : undefined) ?? SITE_DIFF_FAILED_TEXT)
        setResult(null)
        return
      }
      const data = (await res.json()) as SiteDiffResponse
      setResult(normalize(data))
      setVisible(DIFF_PAGE_SIZE)
    } catch {
      setError(SITE_DIFF_FAILED_TEXT)
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  function showMore(): void {
    setVisible((v) => v + DIFF_PAGE_SIZE)
  }

  return { result, error, loading, visible, run, showMore }
}

function DiffSummary({ result }: { result: SiteDiffResponse }) {
  const k = result.differences.length + result.onlyOnWebsite.length + result.onlyInCatalog.length
  const same = k === 0
  const text = same
    ? `官网 ${result.websiteTours} 个团，目录 ${result.catalogTours} 个团，完全一致`
    : `官网 ${result.websiteTours} 个团，目录 ${result.catalogTours} 个团，共 ${k} 处不同`
  return (
    <p
      data-testid="site-diff-summary"
      className="font-black"
      style={{ color: same ? '#456F35' : '#1A1A1A' }}
    >
      {text}
    </p>
  )
}

function DiffNotes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null
  return (
    <div
      data-testid="site-diff-notes"
      className="rounded-lg border border-[#B7791F]/30 bg-[#B7791F]/10 p-3"
    >
      <p className="font-black text-[#B7791F]">
        有 {notes.length} 条官网数据没能读懂，比对结果不完整
      </p>
      <ul className="mt-1 space-y-0.5">
        {notes.map((note, index) => (
          <li key={`note-${index}`} className="break-all text-xs">
            {note}
          </li>
        ))}
      </ul>
    </div>
  )
}

function NameList({
  testId,
  heading,
  names,
}: {
  testId: string
  heading: string
  names: string[]
}) {
  if (names.length === 0) return null
  return (
    <div data-testid={testId}>
      <p className="font-semibold">{heading}</p>
      <ul className="list-disc pl-5">
        {names.map((name, index) => (
          <li key={`${testId}-${index}`} className="break-all text-xs">
            {name}
          </li>
        ))}
      </ul>
    </div>
  )
}

function groupByTour(entries: SiteDiffEntry[]): { tourName: string; entries: SiteDiffEntry[] }[] {
  const groups: { tourName: string; entries: SiteDiffEntry[] }[] = []
  for (const entry of entries) {
    const existing = groups.find((g) => g.tourName === entry.tourName)
    if (existing) {
      existing.entries.push(entry)
    } else {
      groups.push({ tourName: entry.tourName, entries: [entry] })
    }
  }
  return groups
}

function DiffGroups({ entries }: { entries: SiteDiffEntry[] }) {
  const groups = groupByTour(entries)
  return (
    <>
      {groups.map((group) => (
        <div key={group.tourName} data-testid="diff-group">
          <p className="font-black text-me-charcoal">{group.tourName}</p>
          <ul className="space-y-1">
            {group.entries.map((entry, index) => (
              <li
                key={`${group.tourName}-${index}`}
                className="break-all text-xs text-me-charcoal/80"
              >
                {`${entry.fieldLabel}：官网 ${clip(entry.website)} ｜ 目录 ${clip(entry.catalog)}`}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  )
}

function DiffResult({ state }: { state: DiffState }) {
  const result = state.result
  if (!result) return null
  const shown = result.differences.slice(0, state.visible)
  return (
    <div data-testid="site-diff-result" className="mt-4 space-y-3 text-sm">
      <DiffSummary result={result} />
      <DiffNotes notes={result.notes} />
      <NameList
        testId="only-on-website"
        heading={`只在官网有的团（${result.onlyOnWebsite.length} 个）：`}
        names={result.onlyOnWebsite}
      />
      <NameList
        testId="only-in-catalog"
        heading={`只在目录有的团（${result.onlyInCatalog.length} 个）：`}
        names={result.onlyInCatalog}
      />
      <DiffGroups entries={shown} />
      {result.differences.length > state.visible ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={state.showMore}
            className="rounded-lg border border-black/10 bg-white px-3 py-1 text-sm font-semibold text-me-charcoal hover:bg-me-ivory"
          >
            显示更多
          </button>
          <span className="text-xs text-me-charcoal/60">
            已显示 {state.visible} / {result.differences.length} 条
          </span>
        </div>
      ) : null}
    </div>
  )
}

export function CatalogSiteDiffCard(props: { clientId: string }): JSX.Element {
  const state = useSiteDiff(props.clientId)
  return (
    <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black text-me-charcoal">和官网现在的内容比一下</h2>
      <p className="mt-1 text-xs text-me-charcoal/60">{SITE_DIFF_INTRO}</p>
      <button
        type="button"
        onClick={() => void state.run()}
        disabled={state.loading}
        className="mt-3 rounded-lg border border-black/10 bg-white px-3 py-1 text-sm font-semibold text-me-charcoal hover:bg-me-ivory disabled:opacity-40"
      >
        {state.loading ? '正在比对…' : '开始比对'}
      </button>
      {state.error ? (
        <p role="alert" className="mt-3 text-sm font-semibold text-[#C2453A]">
          {state.error}
        </p>
      ) : null}
      <DiffResult state={state} />
    </section>
  )
}
