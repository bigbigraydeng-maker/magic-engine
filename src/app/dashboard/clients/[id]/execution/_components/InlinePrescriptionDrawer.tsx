'use client'

/**
 * 内联补充/修订处方抽屉（P8.10.S5）
 *
 * 直接在执行看板上完成补充/修订处方的全流程，不跳转到完整处方页：
 *   填表 → 生成（SSE 流）→ 审阅 → 批准 → 抽屉关闭，看板刷新
 *
 * 桌面：右侧 520px 抽屉；移动：全屏。
 */

import { useState, useCallback, useEffect } from 'react'
import type { PrescriptionContent, PrescriptionIntake, PrescriptionAction } from '@/types/diagnostic'
import type { SelfGrade, HuatuoGenerationMeta } from '@/lib/huatuo/types'
import { readHuatuoStream } from '@/lib/huatuo/stream-client'

type Mode = 'supplement' | 'revision'
type Step = 'form' | 'generating' | 'review'

interface Props {
  clientId: string
  mode: Mode
  priorPrescriptionId: string
  priorLabel: string          // 原处方组的标签，如 "原处方"
  onClose: () => void
  onApproved: () => void      // 批准成功 → 父组件刷新看板
}

const URGENCY: Array<{ v: PrescriptionIntake['timeline_urgency']; label: string }> = [
  { v: 'immediate',  label: '⚡ 即刻' },
  { v: 'short_term', label: '📅 短期' },
  { v: 'long_term',  label: '🗓️ 长期' },
]

const FIX_BADGE: Record<string, { label: string; cls: string }> = {
  me_auto:     { label: 'ME',   cls: 'bg-blue-100 text-blue-700' },
  fde_manual:  { label: 'FDE',  cls: 'bg-purple-100 text-purple-700' },
  third_party: { label: '第三方', cls: 'bg-gray-100 text-gray-600' },
}

export function InlinePrescriptionDrawer({
  clientId, mode, priorPrescriptionId, priorLabel, onClose, onApproved,
}: Props) {
  const [step, setStep] = useState<Step>('form')

  // 表单 — 预算可选（空 = 不涉及额外预算）
  const [goal, setGoal]       = useState('')
  const [budget, setBudget]   = useState<string>('')   // 字符串，空表示未填
  const [urgency, setUrgency] = useState<PrescriptionIntake['timeline_urgency']>('short_term')
  const [notes, setNotes]     = useState('')

  // 生成状态
  const [progress, setProgress]   = useState<string | null>(null)
  const [elapsed, setElapsed]     = useState(0)
  const [error, setError]         = useState<string | null>(null)
  const [prescriptionId, setPrescriptionId] = useState<string | null>(null)
  const [content, setContent]     = useState<PrescriptionContent | null>(null)
  const [selfGrade, setSelfGrade] = useState<SelfGrade | null>(null)
  const [genMeta, setGenMeta]     = useState<HuatuoGenerationMeta | null>(null)

  // 批准状态
  const [approving, setApproving] = useState(false)

  // body 滚动锁
  useEffect(() => {
    const orig = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = orig }
  }, [])

  const modeTitle  = mode === 'supplement' ? '补充处方' : '修订处方'
  const modeHint   = mode === 'supplement'
    ? '诸葛亮只生成"还缺的"增量动作，原处方与执行进度不受影响'
    : '诸葛亮生成完整修订版（v2），承接已完成的动作；批准后原处方归档'
  const goalLabel  = mode === 'supplement' ? '需要补充什么？' : '为什么要修订？新方向是什么？'
  const goalPlaceholder = mode === 'supplement'
    ? '例：客户决定也要做 LinkedIn B2B 内容，需要补充对应动作'
    : '例：客户预算砍半，需要聚焦最高 ROI 的动作，砍掉视频拍摄类'
  const budgetLabel = mode === 'supplement' ? '本次补充的月度增量预算' : '修订后月度预算'

  // ── 生成 ────────────────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!goal.trim()) return
    setStep('generating')
    setError(null)
    setProgress('连接诸葛亮…')
    const startTime = Date.now()
    setElapsed(0)
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000)

    try {
      const intake: PrescriptionIntake = {
        business_goal:       goal.trim(),
        timeline_urgency:    urgency,
        // 预算可选：空 → 0（华佗理解为"不涉及额外预算，在现有资源内完成"）
        monthly_budget_aud:  budget.trim() ? Math.max(0, Number(budget)) : 0,
        priority_dimensions: [],
        notes:               notes.trim() || null,
      }
      const body = mode === 'supplement'
        ? { supplement_of: priorPrescriptionId, intake }
        : { revise: priorPrescriptionId, intake }

      const res = await fetch(`/api/clients/${clientId}/prescription/generate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        cache:   'no-store',
      })
      if (!res.ok) {
        let msg = `HTTP ${res.status}`
        try {
          const eb = await res.json() as { error?: string }
          if (eb?.error) msg = `${msg} — ${eb.error}`
        } catch {/* */}
        throw new Error(msg)
      }

      let streamErr: string | null = null
      const ok = await readHuatuoStream(res, {
        onStarted:  (id) => setPrescriptionId(id),
        onProgress: (note) => setProgress(note),
        onDone: (payload) => {
          setPrescriptionId(payload.prescription_id)
          setContent(payload.content)
          setSelfGrade(payload.self_grade ?? null)
          if (payload.meta) setGenMeta(payload.meta)
        },
        onError: (err) => { streamErr = err },
      })

      if (streamErr) {
        setError(streamErr)
        setStep('form')
      } else if (!ok) {
        setError('诸葛亮流意外关闭，请重试')
        setStep('form')
      } else {
        setStep('review')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败')
      setStep('form')
    } finally {
      clearInterval(timer)
      setProgress(null)
    }
  }, [goal, urgency, budget, notes, mode, priorPrescriptionId, clientId])

  // ── 批准 ────────────────────────────────────────────────────────────────
  const handleApprove = useCallback(async () => {
    if (!prescriptionId) return
    setApproving(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/prescription/${prescriptionId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status: 'approved' }),
      })
      if (!res.ok) {
        let msg = `HTTP ${res.status}`
        try {
          const eb = await res.json() as { error?: string }
          if (eb?.error) msg = `${msg} — ${eb.error}`
        } catch {/* */}
        throw new Error(msg)
      }
      onApproved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '批准失败')
    } finally {
      setApproving(false)
    }
  }, [prescriptionId, clientId, onApproved, onClose])

  const overall = selfGrade?.overall ?? null
  const gradeCls = overall == null ? 'bg-gray-100 text-gray-600'
    : overall >= 8 ? 'bg-green-100 text-green-700'
    : overall >= 6 ? 'bg-amber-100 text-amber-700'
    : 'bg-red-100 text-red-700'

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button onClick={onClose} aria-label="关闭" className="absolute inset-0 bg-black/40" />

      <div className="relative bg-white w-full sm:w-[520px] h-full flex flex-col shadow-2xl">
        {/* Header */}
        <div className="shrink-0 border-b border-gray-200 px-5 py-3 flex items-center gap-3">
          <span className="text-xl">{mode === 'supplement' ? '🧩' : '↻'}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900">{modeTitle}</p>
            <p className="text-xs text-gray-400 truncate">对【{priorLabel}】· {modeHint}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg px-1" aria-label="关闭">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* ── Step: form ── */}
          {step === 'form' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {goalLabel} <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={goal}
                  onChange={e => setGoal(e.target.value)}
                  rows={3}
                  placeholder={goalPlaceholder}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {budgetLabel} <span className="text-xs font-normal text-gray-400">（可选）</span>
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 text-sm">AUD $</span>
                  <input
                    type="number" min={0} max={50000} step={100}
                    value={budget}
                    onChange={e => setBudget(e.target.value)}
                    placeholder="0"
                    className="w-36 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                  <span className="text-xs text-gray-400">/月</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">留空或填 0 = 本次调整不涉及额外预算</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">时间紧迫度</label>
                <div className="grid grid-cols-3 gap-2">
                  {URGENCY.map(o => (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => setUrgency(o.v)}
                      className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                        urgency === o.v
                          ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">补充说明（可选）</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  placeholder="例：客户已有 HubSpot 账户、没有视频拍摄设备…"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
              </div>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">{error}</div>
              )}
            </div>
          )}

          {/* ── Step: generating ── */}
          {step === 'generating' && (
            <div className="py-12 text-center space-y-3">
              <div className="animate-spin w-10 h-10 border-4 border-indigo-400 border-t-transparent rounded-full mx-auto" />
              <p className="text-sm font-medium text-gray-900">诸葛亮正在{modeTitle}…</p>
              <p className="text-sm text-gray-500 min-h-[1.5em]">{progress ?? ''}</p>
              <p className="text-xs text-gray-400 tabular-nums">
                已用时 {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')} · 通常 60–150 秒
              </p>
            </div>
          )}

          {/* ── Step: review ── */}
          {step === 'review' && content && (
            <div className="space-y-4">
              {/* 诸葛亮自评 */}
              {selfGrade && genMeta && (
                <div className="flex items-center gap-3 rounded-lg bg-gray-50 p-3">
                  <span className={`px-2.5 py-1 rounded-lg font-bold text-base tabular-nums ${gradeCls}`}>
                    {overall?.toFixed(1)} / 10
                  </span>
                  <div className="text-xs text-gray-500">
                    诸葛亮自评 · ${genMeta.cost_usd.toFixed(3)} · {(genMeta.duration_ms / 1000).toFixed(0)}s
                  </div>
                </div>
              )}

              {/* 摘要 */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  {mode === 'supplement' ? '补充摘要' : '修订摘要'}
                </p>
                <p className="text-sm text-gray-700">{content.summary}</p>
              </div>

              {/* 新增动作（按 phase） */}
              {content.phases.map(phase => (
                <div key={phase.phase_number}>
                  <p className="text-xs font-semibold text-gray-600 mb-1.5">
                    Phase {phase.phase_number} · {phase.name}
                  </p>
                  <div className="space-y-1.5">
                    {phase.actions.map((a: PrescriptionAction) => {
                      const fb = FIX_BADGE[a.fix_type] ?? { label: a.fix_type, cls: 'bg-gray-100 text-gray-600' }
                      return (
                        <div key={a.id} className="flex items-start gap-2 text-xs">
                          <span className={`shrink-0 px-1.5 py-0.5 rounded font-medium ${fb.cls}`}>{fb.label}</span>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900">{a.title}</p>
                            <p className="text-gray-500">{a.description}</p>
                            {a.estimated_hours != null && (
                              <span className="text-gray-400">⏱ {a.estimated_hours}h</span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}

              {/* 预算分配 */}
              {content.budget_allocation.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">预算分配</p>
                  <div className="space-y-1">
                    {content.budget_allocation.map(b => (
                      <div key={b.dimension} className="flex justify-between text-xs">
                        <span className="text-gray-600">{b.dimension}</span>
                        <span className="text-gray-700 font-medium">AUD ${b.amount_aud}（{b.percentage}%）</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">{error}</div>
              )}
            </div>
          )}
        </div>

        {/* Footer 按钮 */}
        <div className="shrink-0 border-t border-gray-200 p-4">
          {step === 'form' && (
            <button
              onClick={() => void handleGenerate()}
              disabled={!goal.trim()}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              生成{modeTitle} →
            </button>
          )}
          {step === 'generating' && (
            <button disabled className="w-full rounded-lg bg-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-400">
              诸葛亮工作中…
            </button>
          )}
          {step === 'review' && (
            <div className="flex gap-2">
              <button
                onClick={() => { setStep('form'); setContent(null); setSelfGrade(null) }}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
              >
                重新生成
              </button>
              <button
                onClick={() => void handleApprove()}
                disabled={approving}
                className="flex-1 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {approving ? '批准中…' : '✓ 批准并加入执行看板'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
