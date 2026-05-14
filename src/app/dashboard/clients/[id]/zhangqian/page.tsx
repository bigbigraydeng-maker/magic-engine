'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'

import type {
  ClientDiscoveryRow,
  DiscoveryJob,
} from '@/lib/zhangqian/types'
import {
  BusinessCard,
  KeywordsCard,
  CompetitorsCard,
  SocialCard,
  GbpCard,
  ReviewPlatformsCard,
  AiVisibilityCard,
  ActionPlanCard,
  DiagnosisCard,
  NotesCard,
} from './cards'

// ─── Constants ────────────────────────────────────────────────────────────────

const API_KEY = process.env.NEXT_PUBLIC_INTERNAL_API_KEY ?? ''

// ─── Page state type ──────────────────────────────────────────────────────────

type PageState = 'idle' | 'running' | 'reviewing' | 'confirmed'

// ─── API response shapes ──────────────────────────────────────────────────────

interface LatestResponse {
  success: boolean
  discovery: ClientDiscoveryRow | null
  error?: string
}

interface DiscoverResponse {
  success: boolean
  job_id: string
  error?: string
}

interface StatusResponse {
  success: boolean
  job: DiscoveryJob
  error?: string
}

interface ConfirmResponse {
  success: boolean
  error?: string
}

// ─── DispatchPanel ────────────────────────────────────────────────────────────

function DispatchPanel({
  onDispatch,
  isDispatching,
  hasExisting,
}: {
  onDispatch: () => void
  isDispatching: boolean
  hasExisting: boolean
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[420px] bg-white rounded-xl border border-gray-200 p-12 text-center">
      <div className="text-5xl mb-4">🗺️</div>
      <h2 className="text-xl font-semibold text-gray-900 mb-2">派遣张骞</h2>
      <p className="text-sm text-gray-500 mb-2 max-w-sm">
        仅需一个域名，张骞将自动生成品牌健康诊断报告
      </p>
      <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs text-amber-700 font-medium mb-6">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        预计费用 ~$1.00 / 约3分钟
      </div>
      <button
        onClick={onDispatch}
        disabled={isDispatching}
        className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isDispatching ? (
          <>
            <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
            派遣中…
          </>
        ) : hasExisting ? '重新运行' : '开始发现'}
      </button>
    </div>
  )
}

// ─── ProgressPanel ────────────────────────────────────────────────────────────

function ProgressPanel({ note, elapsedSec }: { note: string | null; elapsedSec: number }) {
  const mins = Math.floor(elapsedSec / 60)
  const secs = elapsedSec % 60
  const elapsed = mins > 0
    ? `${mins}分${String(secs).padStart(2, '0')}秒`
    : `${secs}秒`

  return (
    <div className="flex flex-col items-center justify-center min-h-[420px] bg-gray-50 rounded-xl border border-gray-200 p-12 text-center gap-6">
      <div className="relative w-16 h-16">
        <span className="absolute inset-0 rounded-full border-4 border-indigo-100" />
        <span className="absolute inset-0 rounded-full border-4 border-indigo-600 border-t-transparent animate-spin" />
        <span className="absolute inset-0 flex items-center justify-center text-2xl">🗺️</span>
      </div>
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-1">张骞正在探索…</h2>
        <p className="text-sm text-gray-500 max-w-xs mx-auto min-h-[2.5rem]">
          {note ?? '正在启动…'}
        </p>
      </div>
      <div className="text-xs text-gray-400 tabular-nums">
        已用时 {elapsed}
      </div>
    </div>
  )
}

// ─── DiscoveryReviewCards ─────────────────────────────────────────────────────

function DiscoveryReviewCards({
  discovery,
  onConfirm,
  isConfirming,
}: {
  discovery: ClientDiscoveryRow
  onConfirm: () => void
  isConfirming: boolean
}) {
  const p = discovery.payload
  return (
    <div className="space-y-5">
      {/* Meta bar */}
      <div className="flex flex-wrap gap-3 text-xs text-gray-500">
        <span>域名: <strong className="text-gray-700">{discovery.domain}</strong></span>
        <span>费用: <strong className="text-gray-700">${discovery.cost_usd.toFixed(3)}</strong></span>
        <span>工具调用: <strong className="text-gray-700">{discovery.tool_calls}</strong></span>
        <span>生成时间: <strong className="text-gray-700">
          {new Date(discovery.generated_at).toLocaleString('zh-CN', { timeZone: 'Pacific/Auckland' })}
        </strong></span>
      </div>

      {/* Diagnosis card — full width at top */}
      {p.diagnosis && (
        <DiagnosisCard diagnosis={p.diagnosis} />
      )}

      {/* Cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BusinessCard discovery={discovery} />
        <KeywordsCard keywords={p.seed_keywords} semrushSnapshot={p.semrush_snapshot} />
        <CompetitorsCard competitors={p.competitors} />
        <AiVisibilityCard
          questions={p.ai_tracker_questions}
          visibilityResults={p.ai_visibility_results}
        />
        <SocialCard socials={p.social_profiles} />
        <GbpCard gbp={p.gbp} />
        <ReviewPlatformsCard platforms={p.review_platforms} />
      </div>

      {/* Action plan — full width */}
      {p.diagnosis?.actions && (
        <ActionPlanCard actions={p.diagnosis.actions} />
      )}

      {p.notes && <NotesCard notes={p.notes} />}

      {/* Confirm button */}
      <div className="flex justify-end pt-2">
        <button
          onClick={onConfirm}
          disabled={isConfirming}
          className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-6 py-3 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isConfirming ? (
            <>
              <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              导入中…
            </>
          ) : '✓ 确认发现，前往生成处方 →'}
        </button>
      </div>
    </div>
  )
}

// ─── ConfirmedBanner ─────────────────────────────────────────────────────────

function ConfirmedBanner({
  clientId,
  onRerun,
}: {
  clientId: string
  onRerun: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[200px] bg-white rounded-xl border border-green-200 p-8 text-center">
      <div className="text-4xl mb-3">✅</div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1">发现结果已确认 — 播种完成</h2>
      <p className="text-sm text-gray-500 mb-5 max-w-sm">
        品牌健康数据已导入客户档案。下一步：基于诊断生成个性化处方。
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={onRerun}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
        >
          重新运行发现
        </button>
        <Link
          href={`/dashboard/clients/${clientId}/prescription/new`}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
        >
          生成处方 →
        </Link>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ZhangqianPage() {
  const params = useParams()
  const clientId = params.id as string
  const router = useRouter()

  const [pageState, setPageState] = useState<PageState>('idle')
  const [discovery, setDiscovery] = useState<ClientDiscoveryRow | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [progressNote, setProgressNote] = useState<string | null>(null)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [pageLoading, setPageLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [isDispatching, setIsDispatching] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(0)

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${API_KEY}`,
  }

  // ── Fetch latest ────────────────────────────────────────────────────────────

  const fetchLatest = useCallback(async () => {
    setPageLoading(true)
    setPageError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/zhangqian/latest`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      })
      if (res.status === 404) {
        setDiscovery(null)
        setPageState('idle')
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: LatestResponse = await res.json()
      if (data.success && data.discovery) {
        setDiscovery(data.discovery)
        setPageState(data.discovery.confirmed_at ? 'confirmed' : 'reviewing')
      } else {
        setDiscovery(null)
        setPageState('idle')
      }
    } catch (e) {
      setPageError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setPageLoading(false)
    }
  }, [clientId])

  useEffect(() => { void fetchLatest() }, [fetchLatest])

  // ── Polling cleanup ─────────────────────────────────────────────────────────

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null }
  }, [])

  useEffect(() => () => stopPolling(), [stopPolling])

  // ── Poll status ─────────────────────────────────────────────────────────────

  const startPolling = useCallback((jid: string) => {
    startTimeRef.current = Date.now()
    setElapsedSec(0)
    elapsedRef.current = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/clients/${clientId}/zhangqian/status?job_id=${encodeURIComponent(jid)}`,
          { headers: { Authorization: `Bearer ${API_KEY}` } },
        )
        if (!res.ok) return
        const data: StatusResponse = await res.json()
        if (!data.success) return
        const job = data.job
        if (job.progress_note) setProgressNote(job.progress_note)
        if (job.status === 'completed') {
          stopPolling()
          await fetchLatest()
        } else if (job.status === 'failed') {
          stopPolling()
          setPageError(job.error_message ?? '发现失败，请重试')
          setPageState('idle')
        }
      } catch {
        // non-fatal polling error
      }
    }

    void poll()
    pollRef.current = setInterval(() => { void poll() }, 3000)
  }, [clientId, fetchLatest, stopPolling])

  // ── Dispatch ────────────────────────────────────────────────────────────────

  const handleDispatch = async () => {
    setIsDispatching(true)
    setPageError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/zhangqian/discover`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: DiscoverResponse = await res.json()
      if (!data.success) throw new Error(data.error ?? '派遣失败')
      setJobId(data.job_id)
      setProgressNote(null)
      setPageState('running')
      startPolling(data.job_id)
    } catch (e) {
      setPageError(e instanceof Error ? e.message : '派遣失败')
    } finally {
      setIsDispatching(false)
    }
  }

  // ── Confirm ─────────────────────────────────────────────────────────────────

  const handleConfirm = async () => {
    setIsConfirming(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/zhangqian/confirm`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ confirmed_by: 'user' }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: ConfirmResponse = await res.json()
      if (!data.success) throw new Error(data.error ?? '确认失败')
      // Redirect to prescription flow — seeding is complete, time to generate the treatment plan
      router.push(`/dashboard/clients/${clientId}/prescription/new`)
    } catch (e) {
      setPageError(e instanceof Error ? e.message : '确认失败')
    } finally {
      setIsConfirming(false)
    }
  }

  const handleRerun = () => {
    setDiscovery(null)
    setPageState('idle')
    setPageError(null)
    setJobId(null)
  }

  // ─── Loading skeleton ──────────────────────────────────────────────────────

  if (pageLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 animate-pulse">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="h-7 w-48 bg-gray-200 rounded" />
          <div className="h-96 rounded-xl bg-gray-200" />
        </div>
      </div>
    )
  }

  // ─── Render ────────────────────────────────────────────────────────────────

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
              <h1 className="text-lg font-semibold text-gray-900">张骞发现</h1>
              {discovery?.generated_at && (
                <p className="text-xs text-gray-400 mt-0.5">
                  上次运行：{new Date(discovery.generated_at).toLocaleString('zh-CN', { timeZone: 'Pacific/Auckland' })}
                </p>
              )}
            </div>
          </div>

          {/* Header re-run button when reviewing */}
          {pageState === 'reviewing' && (
            <button
              onClick={() => void handleDispatch()}
              disabled={isDispatching}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              重新运行
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Error banner */}
        {pageError && (
          <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-center justify-between gap-3">
            <span>{pageError}</span>
            <button onClick={() => setPageError(null)} className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
          </div>
        )}

        {/* State views */}
        {pageState === 'idle' && (
          <DispatchPanel
            onDispatch={() => void handleDispatch()}
            isDispatching={isDispatching}
            hasExisting={discovery !== null}
          />
        )}

        {pageState === 'running' && (
          <ProgressPanel note={progressNote} elapsedSec={elapsedSec} />
        )}

        {pageState === 'reviewing' && discovery && (
          <DiscoveryReviewCards
            discovery={discovery}
            onConfirm={() => void handleConfirm()}
            isConfirming={isConfirming}
          />
        )}

        {pageState === 'confirmed' && (
          <div className="space-y-5">
            <ConfirmedBanner clientId={clientId} onRerun={handleRerun} />
            {discovery && (
              <DiscoveryReviewCards
                discovery={discovery}
                onConfirm={() => void handleConfirm()}
                isConfirming={isConfirming}
              />
            )}
          </div>
        )}
      </div>

      {/* Suppress unused variable warning for jobId in future use */}
      {jobId && false && <span />}
    </div>
  )
}
