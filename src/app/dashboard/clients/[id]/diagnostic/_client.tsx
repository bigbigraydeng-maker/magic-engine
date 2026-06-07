'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ScoreGauge } from '@/components/diagnostic/ScoreGauge'
import { DimensionScoreCard, type BaselineInfo } from '@/components/diagnostic/DimensionScoreCard'
import { DiagnosticFindingCard } from '@/components/diagnostic/DiagnosticFindingCard'
import { useDiagnosticStatus } from './_hooks/use-diagnostic-status'
import { OVERALL_WEIGHTING_NOTE } from '@/lib/diagnostic/score-formula-explainer'
import { sanitiseLegacyScores } from '@/lib/diagnostic/legacy-score-sanitiser'
import type { DiagnosticRun, DiagnosticFinding, DiagnosticDimension } from '@/types/diagnostic'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NarrativeRow {
  id: string
  kind: 'competitor_market_structure' | 'competitor_benchmarking_path' | 'dimension_narrative' | 'score_explanation' | 'market_context'
  dimension: string | null
  narrative_md: string
  generated_at: string
}

interface LatestResponse {
  success: boolean
  run: DiagnosticRun
  findings: DiagnosticFinding[]
  /** DAPE W3 — synthesis narratives loaded alongside findings */
  narratives?: NarrativeRow[]
  error?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DIMENSION_LABELS: Record<DiagnosticDimension, string> = {
  seo:           'SEO',
  ai_visibility: 'AI 可见度',
  ads:           '广告',
  social:        '社媒',
  reputation:    '口碑',
  competitor:    '竞品',
}

// Routes to the most relevant connector/config page for each dimension
const DIMENSION_CONFIG_ANCHOR: Record<DiagnosticDimension, string> = {
  seo:           'connectors/gsc',
  ai_visibility: 'zhangqian',
  ads:           'connectors/google-ads',
  social:        'connectors/social',
  reputation:    'connectors/gbp',
  competitor:    'zhangqian',
}

const ALL_DIMENSIONS: DiagnosticDimension[] = [
  'seo', 'ai_visibility', 'social', 'reputation', 'competitor', 'ads',
]

// Default chip ordering when run.dimensions_requested is missing. Real chips
// come from the run itself so adding a new dimension doesn't require a UI edit.
const DEFAULT_CHIP_DIMENSIONS: DiagnosticDimension[] = [
  'seo', 'ai_visibility', 'ads', 'social', 'reputation', 'competitor',
]

// 魏征 H5: module-level baseline cache (per clientId, 5-min TTL).
// Without this, every dashboard re-render / client-switch round-trip would
// re-fetch /api/clients/[id]/diagnostic/baseline → supabase + fetchBenchmarks.
// FDE flipping between CTS and Oztop in the kanban would stack DB queries.
const BASELINE_CACHE_TTL_MS = 5 * 60 * 1000
const baselineCache = new Map<string, { at: number; data: Partial<Record<DiagnosticDimension, BaselineInfo>> }>()

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EmptyState({ onRun, isRunning }: { onRun: () => void; isRunning: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] bg-white rounded-xl border border-gray-200 p-12 text-center">
      <div className="text-5xl mb-4">🩺</div>
      <h2 className="text-lg font-semibold text-gray-900 mb-2">尚未运行诊断</h2>
      <p className="text-sm text-gray-500 mb-6 max-w-sm">
        运行首次全面诊断，获取 SEO、AI 可见度、社媒、口碑和竞品分析的综合评分。
      </p>
      <button
        onClick={onRun}
        disabled={isRunning}
        className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isRunning ? (
          <>
            <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
            正在运行…
          </>
        ) : '运行首次诊断'}
      </button>
    </div>
  )
}

/**
 * DAPE W3 — AI 大白话叙事卡（Synthesis narratives）。
 *
 * 渲染优先级（最相关 → 最次要）：
 *   1. score_explanation (target='overall') — 总分一句话
 *   2. dimension_narrative — 每个维度的中文大白话
 *   3. market_context — 行业上下文（无 dimension，运行时可选）
 *   4. competitor_market_structure / competitor_benchmarking_path — 竞品段
 *
 * 默认折叠维度卡（避免一屏全部展开），点 chevron 展开。Overall + market_context
 * 默认展开，因为是高优先信息。
 *
 * 客户/PM 视角：先看到一句"全局体检结论"，然后按需点开维度。
 * 老板看 PDF 等价于读完整报告（report-generator 已渲染相同 narratives）。
 */
function NarrativeSection({
  narratives,
  clientId,
  runId,
}: {
  narratives: NarrativeRow[]
  clientId: string
  runId: string
}) {
  const overall = narratives.find(
    n => n.kind === 'score_explanation' && n.dimension === 'overall',
  )
  const dimensionNarratives = narratives
    .filter(n => n.kind === 'dimension_narrative')
    .sort((a, b) => (a.dimension ?? '').localeCompare(b.dimension ?? ''))
  const market = narratives.find(n => n.kind === 'market_context')
  const competitorStructure = narratives.find(n => n.kind === 'competitor_market_structure')

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          AI 解读（大白话）
        </h2>
        <Link
          href={`/dashboard/clients/${clientId}/diagnostic/report?run_id=${runId}`}
          className="text-xs text-indigo-500 hover:text-indigo-700 hover:underline"
        >
          查看完整报告 →
        </Link>
      </div>

      <div className="space-y-3">
        {overall && (
          <NarrativeCard
            title="综合结论"
            body={overall.narrative_md}
            defaultOpen
            accent="indigo"
          />
        )}

        {dimensionNarratives.map(n => (
          <NarrativeCard
            key={n.id}
            title={(n.dimension && DIMENSION_LABELS[n.dimension as DiagnosticDimension]) ?? n.dimension ?? '其他'}
            body={n.narrative_md}
          />
        ))}

        {market && (
          <NarrativeCard
            title="行业背景"
            body={market.narrative_md}
            defaultOpen={dimensionNarratives.length === 0}
            accent="amber"
          />
        )}

        {competitorStructure && (
          <NarrativeCard
            title="竞品格局"
            body={competitorStructure.narrative_md}
          />
        )}
      </div>
    </section>
  )
}

/**
 * Strip leading H2 / ## heading from a synthesis narrative — the dimension
 * narrator emits "## SEO\n\n…" but our card already shows a Chinese label
 * in the header, so showing both is duplicate noise.
 */
function stripLeadingHeading(md: string): string {
  return md.replace(/^\s*#{1,3}\s+[^\n]+\n+/, '').trim()
}

function NarrativeCard({
  title,
  body,
  defaultOpen = false,
  accent = 'gray',
}: {
  title: string
  body: string
  defaultOpen?: boolean
  accent?: 'indigo' | 'amber' | 'gray'
}) {
  const [open, setOpen] = useState(defaultOpen)
  const accentClass =
    accent === 'indigo'
      ? 'border-indigo-200 bg-indigo-50/50'
      : accent === 'amber'
        ? 'border-amber-200 bg-amber-50/40'
        : 'border-gray-200 bg-white'
  const cleaned = stripLeadingHeading(body)

  return (
    <div className={`rounded-xl border ${accentClass}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-gray-800">{title}</span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-4 pb-4 -mt-1 text-sm text-gray-700 leading-relaxed whitespace-pre-line">
          {cleaned}
        </div>
      )}
    </div>
  )
}

// S15: dimensions come from the run itself (dimensions_requested), with a count
// badge per chip. Empty-count chips are kept but greyed/disabled so FDE can see
// "0 findings on AI 可见度" is a real signal rather than a missing tab.
function DimensionFilterTabs({
  active,
  onChange,
  dimensions,
  counts,
  totalCount,
}: {
  active: DiagnosticDimension | 'all'
  onChange: (dim: DiagnosticDimension | 'all') => void
  dimensions: DiagnosticDimension[]
  counts: Partial<Record<DiagnosticDimension, number>>
  totalCount: number
}) {
  const tabs: Array<{ key: DiagnosticDimension | 'all'; label: string; count: number }> = [
    { key: 'all', label: '全部', count: totalCount },
    ...dimensions.map(d => ({ key: d, label: DIMENSION_LABELS[d], count: counts[d] ?? 0 })),
  ]

  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map(tab => {
        const isActive = active === tab.key
        const isEmpty = tab.key !== 'all' && tab.count === 0
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            disabled={isEmpty && !isActive}
            data-testid={`filter-chip-${tab.key}`}
            data-count={tab.count}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              isActive
                ? 'bg-indigo-600 text-white'
                : isEmpty
                  ? 'bg-gray-50 text-gray-300 cursor-not-allowed'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <span>{tab.label}</span>
            <span
              className={`tabular-nums text-[10px] font-semibold rounded-full px-1.5 py-0.5 ${
                isActive
                  ? 'bg-white/20 text-white'
                  : isEmpty
                    ? 'bg-gray-100 text-gray-300'
                    : 'bg-white text-gray-500'
              }`}
            >
              {tab.count}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function DiagnosticClient() {
  const params = useParams()
  const clientId = params.id as string

  const [run, setRun] = useState<DiagnosticRun | null>(null)
  const [findings, setFindings] = useState<DiagnosticFinding[]>([])
  const [narratives, setNarratives] = useState<NarrativeRow[]>([])
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const [pageLoading, setPageLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [isLaunching, setIsLaunching] = useState(false)
  const [dimFilter, setDimFilter] = useState<DiagnosticDimension | 'all'>('all')
  const [isDocxLoading, setIsDocxLoading] = useState(false)
  const [baselines, setBaselines] = useState<Partial<Record<DiagnosticDimension, BaselineInfo>>>({})

  // Poll active run status while running
  const { status: pollStatus, run: polledRun } = useDiagnosticStatus(clientId, activeRunId)

  // When polling completes, refresh latest data
  useEffect(() => {
    if (pollStatus === 'completed') {
      setActiveRunId(null)
      void fetchLatest()
    }
    if (pollStatus === 'failed') {
      setActiveRunId(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollStatus])

  // Update run scores in real-time while polling
  useEffect(() => {
    if (polledRun && activeRunId) {
      setRun(prev => prev ? { ...prev, ...(polledRun as Partial<DiagnosticRun>) } : prev)
    }
  }, [polledRun, activeRunId])

  const fetchLatest = useCallback(async () => {
    setPageLoading(true)
    setPageError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/diagnostic/latest`)
      if (res.status === 404) {
        setRun(null)
        setFindings([])
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: LatestResponse = await res.json()
      if (data.success) {
        setRun(data.run)
        setFindings(data.findings ?? [])
        setNarratives(data.narratives ?? [])
      }
    } catch (e) {
      setPageError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setPageLoading(false)
    }
  }, [clientId])

  useEffect(() => { void fetchLatest() }, [fetchLatest])

  // Industry baselines for the "为什么是 X 分?" baseline-comparison row.
  // 魏征 H5: consult module-level cache first; only hit the API on cold/stale.
  useEffect(() => {
    let cancelled = false

    const cached = baselineCache.get(clientId)
    if (cached && Date.now() - cached.at < BASELINE_CACHE_TTL_MS) {
      setBaselines(cached.data)
      return
    }

    ;(async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/diagnostic/baseline`)
        if (!res.ok) return
        const data = (await res.json()) as {
          success: boolean
          baselines: Partial<Record<DiagnosticDimension, BaselineInfo>>
        }
        if (!cancelled && data.success) {
          setBaselines(data.baselines)
          baselineCache.set(clientId, { at: Date.now(), data: data.baselines })
        }
      } catch {
        // non-fatal: baseline absence renders as "暂无" in the card
      }
    })()
    return () => { cancelled = true }
  }, [clientId])

  const handleRunDiagnostic = async () => {
    setIsLaunching(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/diagnostic/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module: 'full' }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { run_id: string }
      setActiveRunId(data.run_id)
    } catch {
      // non-fatal: UI stays in current state
    } finally {
      setIsLaunching(false)
    }
  }

  const handleDownloadDocx = async () => {
    setIsDocxLoading(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/diagnostic/report/docx`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const cd = res.headers.get('Content-Disposition') ?? ''
      const match = /filename="([^"]+)"/.exec(cd)
      a.download = match?.[1] ?? 'diagnostic-report.docx'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setPageError(e instanceof Error ? e.message : '下载失败')
    } finally {
      setIsDocxLoading(false)
    }
  }

  const handleDismiss = (id: string) => {
    setDismissedIds(prev => new Set(Array.from(prev).concat(id)))
  }

  const isRunning = Boolean(activeRunId) || pollStatus === 'running'

  const livingFindings = findings.filter(f => !dismissedIds.has(f.id))

  const visibleFindings = livingFindings.filter(f => {
    if (dimFilter === 'all') return true
    return f.dimension === dimFilter
  })

  const rawDimensionScores = (run?.dimension_scores ?? {}) as Partial<Record<DiagnosticDimension, number | null>>

  // S15: chip dimensions come from the run itself so adding/removing a dimension
  // never requires a UI edit. Fall back to the default ordering if the run
  // pre-dates the dimensions_requested column.
  const requestedDimensions: DiagnosticDimension[] = (
    (run?.dimensions_requested as DiagnosticDimension[] | null | undefined) ?? DEFAULT_CHIP_DIMENSIONS
  ).filter((d): d is DiagnosticDimension => ALL_DIMENSIONS.includes(d))

  const findingCountByDim = livingFindings.reduce<Partial<Record<DiagnosticDimension, number>>>((acc, f) => {
    const dim = f.dimension as DiagnosticDimension
    acc[dim] = (acc[dim] ?? 0) + 1
    return acc
  }, {})

  // S09: dimensions explicitly returned null (data unavailable) — used to wire
  // the "立即配置 →" deeplink onto findings whose dimension was skipped, so the
  // SEO "未配置" card + the SEO finding "Target keywords not configured" point
  // FDE to the same Settings page rather than contradicting each other.
  const dimensionsSkipped: DiagnosticDimension[] = (run?.dimensions_skipped ?? []) as DiagnosticDimension[]
  const skippedSet = new Set<DiagnosticDimension>(dimensionsSkipped)

  // 魏征 H4 + 板桥 P0: legacy competitor=100 sanitiser.
  // Pre-PR-251 CompetitorCollector defaulted to score=100 when < 3 competitors
  // were found, instead of returning null. PM caught those legacy runs on the
  // live page ("竞品 100 健康是什么鬼"). Code fix already shipped, but the
  // historical runs still render green-100 until the FDE reruns.
  // Pure read-time guard, narrow to the exact bug fingerprint — see
  // lib/diagnostic/legacy-score-sanitiser.ts tests for boundary behaviour.
  const sanitised = sanitiseLegacyScores({
    rawScores: rawDimensionScores,
    dimensionsSkipped: skippedSet,
    findingCountByDim,
  })
  const dimensionScores = sanitised.scores
  const effectiveSkippedSet = sanitised.effectiveSkippedSet
  const fixDeeplinkFor = (dim: DiagnosticDimension): string | undefined => {
    if (!effectiveSkippedSet.has(dim)) return undefined
    return `/dashboard/clients/${clientId}/${DIMENSION_CONFIG_ANCHOR[dim]}`
  }

  // ---------------------------------------------------------------------------
  // Render states
  // ---------------------------------------------------------------------------

  if (pageLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 animate-pulse">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="h-7 w-48 bg-gray-200 rounded" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-24 rounded-xl bg-gray-200" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (pageError) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-5xl mx-auto">
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
            {pageError}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href={`/dashboard/clients/${clientId}`}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
              aria-label="返回客户页"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              返回
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">诊断报告</h1>
              {run?.completed_at && (() => {
                const ageDays = Math.floor((Date.now() - new Date(run.completed_at).getTime()) / 86_400_000)
                // 7-day threshold (was 3): diagnostic is a weekly/monthly cadence task,
                // a 3-day pill would create alarm fatigue and read like a system error.
                const isStale = ageDays >= 7
                return (
                  <p className="text-xs mt-0.5">
                    <span className="text-gray-400">
                      上次运行：{new Date(run.completed_at).toLocaleString('zh-CN', { timeZone: 'Pacific/Auckland' })}
                    </span>
                    {isStale && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                        {ageDays} 天未重跑 · 点右侧「运行新诊断」刷新
                      </span>
                    )}
                  </p>
                )
              })()}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {run && (
              <>
                <button
                  onClick={() => void handleDownloadDocx()}
                  disabled={isDocxLoading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isDocxLoading ? (
                    <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-gray-400 border-t-transparent rounded-full" />
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  )}
                  下载报告
                </button>
                <Link
                  href={`/dashboard/clients/${clientId}/diagnostic/report`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  查看完整报告 →
                </Link>
              </>
            )}
            <button
              onClick={() => void handleRunDiagnostic()}
              disabled={isRunning || isLaunching}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isRunning || isLaunching ? (
                <>
                  <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />
                  运行中…
                </>
              ) : run ? '运行新诊断' : '运行首次诊断'}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {/* Empty state */}
        {!run && !isRunning && (
          <EmptyState onRun={() => void handleRunDiagnostic()} isRunning={isLaunching} />
        )}

        {/* Running progress banner */}
        {isRunning && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 flex items-center gap-3">
            <span className="animate-spin w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full" />
            <div>
              <p className="text-sm font-semibold text-indigo-700">诊断进行中…</p>
              <p className="text-xs text-indigo-500">正在采集 SEO、AI 可见度、社媒、口碑和竞品数据</p>
            </div>
          </div>
        )}

        {/* Score grid — 2×3 with formula breakdowns (S14) */}
        {(run || isRunning) && (
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              综合评分
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {ALL_DIMENSIONS.map(dim => {
                // null = data not available; undefined = still loading
                const raw = dimensionScores[dim]
                return (
                  <DimensionScoreCard
                    key={dim}
                    dimension={dim}
                    dimensionLabel={DIMENSION_LABELS[dim]}
                    score={raw === undefined ? null : raw}
                    loading={isRunning && raw === undefined}
                    baseline={baselines[dim] ?? null}
                    configHref={
                      raw === null
                        ? `/dashboard/clients/${clientId}/${DIMENSION_CONFIG_ANCHOR[dim]}`
                        : undefined
                    }
                  />
                )
              })}
            </div>
            {run?.overall_score != null && (
              <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">综合得分</span>
                  <ScoreGauge score={run.overall_score} />
                </div>
                <p
                  data-testid="overall-weighting-note"
                  className="text-[11px] leading-relaxed text-gray-500"
                >
                  {OVERALL_WEIGHTING_NOTE}
                </p>
              </div>
            )}
          </section>
        )}

        {/* DAPE W3 — AI 大白话叙事 (synthesis narratives) */}
        {run && narratives.length > 0 && (
          <NarrativeSection narratives={narratives} clientId={clientId} runId={run.id} />
        )}

        {/* Findings */}
        {run && findings.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
                诊断发现 ({visibleFindings.length})
              </h2>
            </div>

            {/* Dimension filter tabs */}
            <div className="bg-white rounded-xl border border-gray-200 p-3 mb-4">
              <DimensionFilterTabs
                active={dimFilter}
                onChange={setDimFilter}
                dimensions={requestedDimensions}
                counts={findingCountByDim}
                totalCount={livingFindings.length}
              />
            </div>

            {/* Findings list */}
            <div className="space-y-3">
              {visibleFindings.length === 0 ? (
                <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
                  该维度暂无发现
                </div>
              ) : (
                visibleFindings.map(finding => (
                  <DiagnosticFindingCard
                    key={finding.id}
                    finding={finding}
                    onDismiss={handleDismiss}
                    configHref={fixDeeplinkFor(finding.dimension as DiagnosticDimension)}
                  />
                ))
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
