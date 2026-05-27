'use client'

/**
 * 三代理复盘抽屉（P8.10.S6）
 *
 * FDE 在执行看板顶部点「📋 复盘」打开。
 * 打开时加载历史复盘报告；点「跑一次新复盘」让张骞/华佗/鲁班三视角综合分析当前进度。
 * 桌面右侧滑出（宽一些 — 报告内容多），移动全屏。
 */

import { useState, useEffect, useCallback } from 'react'
import type {
  ProjectReview, ProjectReviewContent, ProgressHealth,
  DimensionReview, KpiReview, ReviewRecommendation,
} from '@/lib/review/types'

interface Props {
  clientId: string
  isOpen: boolean
  onClose: () => void
}

const DIMENSION_CN: Record<string, string> = {
  seo: 'SEO', ai_visibility: 'AI 可见度', ads: '广告',
  social: '社媒', reputation: '口碑', competitor: '竞争',
}

const HEALTH_STYLE: Record<ProgressHealth, { label: string; cls: string }> = {
  on_track:  { label: '进度正常', cls: 'bg-green-100 text-green-700 border-green-200' },
  at_risk:   { label: '存在风险', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  off_track: { label: '明显偏离', cls: 'bg-red-100 text-red-700 border-red-200' },
}

const DIM_STATUS_STYLE: Record<DimensionReview['status'], { label: string; cls: string }> = {
  good:        { label: '良好',   cls: 'text-green-700' },
  lagging:     { label: '滞后',   cls: 'text-amber-700' },
  not_started: { label: '未启动', cls: 'text-gray-400' },
}

const PRIORITY_STYLE: Record<ReviewRecommendation['priority'], { label: string; cls: string }> = {
  high:   { label: '高', cls: 'bg-red-100 text-red-700' },
  medium: { label: '中', cls: 'bg-amber-100 text-amber-700' },
  low:    { label: '低', cls: 'bg-gray-100 text-gray-600' },
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  } catch { return iso }
}

function ReviewReport({ content }: { content: ProjectReviewContent }) {
  const health = HEALTH_STYLE[content.progress_health] ?? HEALTH_STYLE.at_risk
  return (
    <div className="space-y-5">
      {/* 整体评估 */}
      <section>
        <div className="flex items-center gap-2 mb-1.5">
          <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${health.cls}`}>
            {health.label}
          </span>
        </div>
        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{content.overall_assessment}</p>
        <p className="mt-2 text-xs text-gray-500">
          <span className="font-medium text-gray-600">时间线：</span>{content.timeline_verdict}
        </p>
      </section>

      {/* 六维度复盘 */}
      <section>
        <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">六大维度</h4>
        <div className="space-y-1.5">
          {content.dimension_review.map((d: DimensionReview, i) => {
            const st = DIM_STATUS_STYLE[d.status] ?? DIM_STATUS_STYLE.lagging
            return (
              <div key={i} className="flex gap-2 text-sm">
                <span className="shrink-0 w-20 font-medium text-gray-700">{DIMENSION_CN[d.dimension] ?? d.dimension}</span>
                <span className={`shrink-0 w-12 font-medium ${st.cls}`}>{st.label}</span>
                <span className="text-gray-600 flex-1">{d.comment}</span>
              </div>
            )
          })}
        </div>
      </section>

      {/* KPI 复盘 */}
      {content.kpi_review.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">KPI 进度</h4>
          <div className="space-y-2">
            {content.kpi_review.map((k: KpiReview, i) => (
              <div key={i} className="rounded-lg border border-gray-200 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-gray-800">{k.metric}</span>
                  <span className={`shrink-0 text-xs font-semibold ${k.on_track ? 'text-green-600' : 'text-amber-600'}`}>
                    {k.on_track ? '✓ 在轨' : '⚠ 偏离'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  目标 {k.target} · 当前 {k.current_estimate}
                </p>
                <p className="mt-1 text-xs text-gray-600">{k.comment}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 卡点 */}
      {content.blockers.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">识别出的卡点</h4>
          <ul className="space-y-1">
            {content.blockers.map((b, i) => (
              <li key={i} className="text-sm text-gray-700 flex gap-1.5">
                <span className="text-red-400">●</span>{b}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 建议 */}
      <section>
        <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">下一步建议</h4>
        <div className="space-y-2">
          {content.recommendations.map((r: ReviewRecommendation, i) => {
            const ps = PRIORITY_STYLE[r.priority] ?? PRIORITY_STYLE.medium
            return (
              <div key={i} className="rounded-lg border border-gray-200 p-2.5">
                <div className="flex items-start gap-2">
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${ps.cls}`}>
                    {ps.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">{r.action}</p>
                    <p className="mt-0.5 text-xs text-gray-500">{r.rationale}</p>
                    {r.needs_prescription_change && (
                      <p className="mt-1 text-[11px] font-medium text-indigo-600">
                        ⟳ 需回到诸葛亮处方层处理（补充 / 修订处方）
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* 下次复盘 */}
      <section className="rounded-lg bg-gray-50 p-2.5">
        <p className="text-xs text-gray-500">
          <span className="font-medium text-gray-600">下次复盘：</span>{content.next_review_suggestion}
        </p>
      </section>
    </div>
  )
}

export function ProjectReviewDrawer({ clientId, isOpen, onClose }: Props) {
  const [reviews, setReviews] = useState<ProjectReview[]>([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/review`, {
          cache: 'no-store',
        })
        if (res.ok) {
          const data = await res.json() as { reviews: ProjectReview[] }
          setReviews(data.reviews ?? [])
          setActiveIdx(0)
        }
      } catch {/* 加载失败就空列表 */}
      finally { setLoading(false) }
    })()
  }, [isOpen, clientId])

  useEffect(() => {
    if (!isOpen) return
    const orig = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = orig }
  }, [isOpen])

  const handleRun = useCallback(async () => {
    if (running) return
    setRunning(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json() as {
        success: boolean; content?: ProjectReviewContent; summary?: string; error?: string
      }
      if (!res.ok || !data.success || !data.content) {
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      // 把新报告插到最前
      const fresh: ProjectReview = {
        id: `local-${Date.now()}`,
        client_id: clientId,
        status: 'completed',
        summary: data.summary ?? null,
        content: data.content,
        meta: null,
        error_message: null,
        created_at: new Date().toISOString(),
      }
      setReviews(prev => [fresh, ...prev])
      setActiveIdx(0)
    } catch (e) {
      setError(e instanceof Error ? e.message : '复盘失败，请重试')
    } finally {
      setRunning(false)
    }
  }, [running, clientId])

  if (!isOpen) return null

  const active = reviews[activeIdx]

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button onClick={onClose} aria-label="关闭" className="absolute inset-0 bg-black/40" />

      <div className="relative bg-white w-full sm:w-[560px] h-full flex flex-col shadow-2xl">
        {/* Header */}
        <div className="shrink-0 border-b border-gray-200 px-4 py-3 flex items-center gap-3">
          <span className="text-xl">📋</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900">三代理复盘</p>
            <p className="text-xs text-gray-400 truncate">张骞 / 华佗 / 鲁班 三视角综合分析项目进度</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg px-2" aria-label="关闭">
            ✕
          </button>
        </div>

        {/* 操作栏 */}
        <div className="shrink-0 border-b border-gray-100 px-4 py-2.5 flex items-center justify-between gap-3">
          <button
            onClick={() => void handleRun()}
            disabled={running}
            className="rounded-lg bg-indigo-600 text-white px-3.5 py-1.5 text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {running ? '复盘中…（约 20-40 秒）' : '＋ 跑一次新复盘'}
          </button>
          {reviews.length > 1 && (
            <select
              value={activeIdx}
              onChange={e => setActiveIdx(Number(e.target.value))}
              className="rounded-lg border border-gray-300 px-2 py-1 text-xs text-gray-700"
            >
              {reviews.map((r, i) => (
                <option key={r.id} value={i}>
                  {i === 0 ? '最新 · ' : ''}{fmtDate(r.created_at)}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* 报告区 */}
        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700 mb-3">
              {error}
            </div>
          )}

          {loading && (
            <p className="text-xs text-gray-400 text-center py-8">加载复盘历史…</p>
          )}

          {running && !active && (
            <div className="text-center py-10">
              <p className="text-3xl mb-2 animate-pulse">📋</p>
              <p className="text-sm text-gray-600">三代理正在综合分析项目进度…</p>
            </div>
          )}

          {!loading && !running && reviews.length === 0 && (
            <div className="text-center py-10 px-4">
              <p className="text-3xl mb-2">📋</p>
              <p className="text-sm text-gray-600 font-medium mb-1">还没有复盘报告</p>
              <p className="text-xs text-gray-400 leading-relaxed">
                点上方「跑一次新复盘」，让三代理基于原诊断、<br />
                处方 KPI、执行进度和工作日志，综合判断<br />
                项目进展得对不对、哪里要调整。
              </p>
            </div>
          )}

          {active?.content && <ReviewReport content={active.content} />}
        </div>
      </div>
    </div>
  )
}
