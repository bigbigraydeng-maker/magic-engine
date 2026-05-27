'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ScoreGauge } from '@/components/diagnostic/ScoreGauge'
import { DiagnosticFindingCard } from '@/components/diagnostic/DiagnosticFindingCard'
import { useDiagnosticStatus } from './_hooks/use-diagnostic-status'
import type { DiagnosticRun, DiagnosticFinding, DiagnosticDimension } from '@/types/diagnostic'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LatestResponse {
  success: boolean
  run: DiagnosticRun
  findings: DiagnosticFinding[]
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

const VALID_DIMENSIONS: DiagnosticDimension[] = [
  'seo', 'ai_visibility', 'social', 'reputation', 'competitor',
]

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

function DimensionFilterTabs({
  active,
  onChange,
}: {
  active: DiagnosticDimension | 'all'
  onChange: (dim: DiagnosticDimension | 'all') => void
}) {
  const tabs: Array<{ key: DiagnosticDimension | 'all'; label: string }> = [
    { key: 'all', label: '全部' },
    ...VALID_DIMENSIONS.map(d => ({ key: d, label: DIMENSION_LABELS[d] })),
  ]

  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map(tab => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            active === tab.key
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DiagnosticPage() {
  const params = useParams()
  const clientId = params.id as string

  const [run, setRun] = useState<DiagnosticRun | null>(null)
  const [findings, setFindings] = useState<DiagnosticFinding[]>([])
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const [pageLoading, setPageLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [isLaunching, setIsLaunching] = useState(false)
  const [dimFilter, setDimFilter] = useState<DiagnosticDimension | 'all'>('all')
  const [isDocxLoading, setIsDocxLoading] = useState(false)

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
      }
    } catch (e) {
      setPageError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setPageLoading(false)
    }
  }, [clientId])

  useEffect(() => { void fetchLatest() }, [fetchLatest])

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

  const visibleFindings = findings.filter(f => {
    if (dismissedIds.has(f.id)) return false
    if (dimFilter === 'all') return true
    return f.dimension === dimFilter
  })

  const dimensionScores = (run?.dimension_scores ?? {}) as Partial<Record<DiagnosticDimension, number | null>>

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
              {run?.completed_at && (
                <p className="text-xs text-gray-400 mt-0.5">
                  上次运行：{new Date(run.completed_at).toLocaleString('zh-CN', { timeZone: 'Pacific/Auckland' })}
                </p>
              )}
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

        {/* Score grid — 2×3 */}
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
                  <div key={dim} className="flex flex-col items-center gap-1">
                    <ScoreGauge
                      score={raw === undefined ? null : raw}
                      dimension={DIMENSION_LABELS[dim]}
                      loading={isRunning && raw === undefined}
                    />
                    {raw === null && (
                      <Link
                        href={`/dashboard/clients/${clientId}/${DIMENSION_CONFIG_ANCHOR[dim]}`}
                        className="text-xs text-indigo-500 hover:text-indigo-700 hover:underline"
                      >
                        立即配置 →
                      </Link>
                    )}
                  </div>
                )
              })}
            </div>
            {run?.overall_score != null && (
              <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">综合得分</span>
                <ScoreGauge score={run.overall_score} />
              </div>
            )}
          </section>
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
              <DimensionFilterTabs active={dimFilter} onChange={setDimFilter} />
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
