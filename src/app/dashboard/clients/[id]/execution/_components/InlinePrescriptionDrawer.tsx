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
  me_auto:     { label: 'ME',   cls: 'bg-cyan-50 text-cyan-800 ring-1 ring-cyan-200' },
  fde_manual:  { label: 'FDE',  cls: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200' },
  third_party: { label: '第三方', cls: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200' },
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
  const gradeCls = overall == null ? 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'
    : overall >= 8 ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
    : overall >= 6 ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
    : 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'

  return (
    <div className="fixed inset-0 z-[90] flex justify-end">
      <button onClick={onClose} aria-label="关闭" className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm" />

      <div className="relative flex h-dvh w-full flex-col overflow-hidden border-l border-slate-200 bg-[#fbfcf7] shadow-2xl sm:w-[min(760px,100vw)] xl:w-[840px]">
        {/* Header */}
        <div className="flex shrink-0 items-start gap-3 border-b border-slate-200 bg-white px-5 py-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-cyan-200 bg-cyan-50 text-xl">{mode === 'supplement' ? '🧩' : '↻'}</span>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-800">Prescription Rail</p>
            <p className="text-lg font-black text-slate-950">{modeTitle}</p>
            <p className="line-clamp-2 text-sm font-semibold text-slate-500">对【{priorLabel}】· {modeHint}</p>
          </div>
          <button onClick={onClose} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-xl font-black text-slate-400 transition-colors hover:border-slate-300 hover:text-slate-700" aria-label="关闭">✕</button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
          {/* ── Step: form ── */}
          {step === 'form' && (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-black text-slate-700">
                  {goalLabel} <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={goal}
                  onChange={e => setGoal(e.target.value)}
                  rows={3}
                  placeholder={goalPlaceholder}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-black text-slate-700">
                  {budgetLabel} <span className="text-xs font-semibold text-slate-400">（可选）</span>
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-500">AUD $</span>
                  <input
                    type="number" min={0} max={50000} step={100}
                    value={budget}
                    onChange={e => setBudget(e.target.value)}
                    placeholder="0"
                    className="w-36 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                  />
                  <span className="text-xs font-semibold text-slate-400">/月</span>
                </div>
                <p className="mt-1 text-xs font-semibold text-slate-400">留空或填 0 = 本次调整不涉及额外预算</p>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-black text-slate-700">时间紧迫度</label>
                <div className="grid grid-cols-3 gap-2">
                  {URGENCY.map(o => (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => setUrgency(o.v)}
                      className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                        urgency === o.v
                          ? 'border-cyan-300 bg-cyan-50 text-cyan-800'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-cyan-200 hover:text-cyan-800'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-black text-slate-700">补充说明（可选）</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  placeholder="例：客户已有 HubSpot 账户、没有视频拍摄设备…"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
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
              <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-cyan-400 border-t-transparent" />
              <p className="text-sm font-black text-slate-950">诸葛亮正在{modeTitle}…</p>
              <p className="min-h-[1.5em] text-sm font-semibold text-slate-500">{progress ?? ''}</p>
              <p className="text-xs tabular-nums text-slate-400">
                已用时 {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')} · 通常 60–150 秒
              </p>
            </div>
          )}

          {/* ── Step: review ── */}
          {step === 'review' && content && (
            <div className="space-y-4">
              {/* 诸葛亮自评 */}
              {selfGrade && genMeta && (
                <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
                  <span className={`px-2.5 py-1 rounded-lg font-bold text-base tabular-nums ${gradeCls}`}>
                    {overall?.toFixed(1)} / 10
                  </span>
                  <div className="text-xs font-semibold text-slate-500">
                    诸葛亮自评 · ${genMeta.cost_usd.toFixed(3)} · {(genMeta.duration_ms / 1000).toFixed(0)}s
                  </div>
                </div>
              )}

              {/* 摘要 */}
              <div>
                <p className="mb-1 text-xs font-black uppercase tracking-wide text-cyan-800">
                  {mode === 'supplement' ? '补充摘要' : '修订摘要'}
                </p>
                <p className="text-sm font-semibold text-slate-700">{content.summary}</p>
              </div>

              {/* 新增动作（按 phase） */}
              {content.phases.map(phase => (
                <div key={phase.phase_number}>
                  <p className="mb-1.5 text-xs font-black text-slate-600">
                    Phase {phase.phase_number} · {phase.name}
                  </p>
                  <div className="space-y-1.5">
                    {phase.actions.map((a: PrescriptionAction) => {
                      const fb = FIX_BADGE[a.fix_type] ?? { label: a.fix_type, cls: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200' }
                      return (
                        <div key={a.id} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-3 text-xs">
                          <span className={`shrink-0 rounded px-1.5 py-0.5 font-black ${fb.cls}`}>{fb.label}</span>
                          <div className="flex-1 min-w-0">
                            <p className="font-black text-slate-950">{a.title}</p>
                            <p className="font-semibold text-slate-500">{a.description}</p>
                            {a.estimated_hours != null && (
                              <span className="font-semibold text-slate-400">⏱ {a.estimated_hours}h</span>
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
                  <p className="mb-1 text-xs font-black uppercase tracking-wide text-cyan-800">预算分配</p>
                  <div className="space-y-1">
                    {content.budget_allocation.map(b => (
                      <div key={b.dimension} className="flex justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                        <span className="font-semibold text-slate-600">{b.dimension}</span>
                        <span className="font-black text-slate-800">AUD ${b.amount_aud}（{b.percentage}%）</span>
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
        <div className="shrink-0 border-t border-slate-200 bg-white p-4">
          {step === 'form' && (
            <button
              onClick={() => void handleGenerate()}
              disabled={!goal.trim()}
              className="w-full rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-black text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              生成{modeTitle} →
            </button>
          )}
          {step === 'generating' && (
            <button disabled className="w-full rounded-lg bg-slate-100 px-4 py-2.5 text-sm font-black text-slate-400">
              诸葛亮工作中…
            </button>
          )}
          {step === 'review' && (
            <div className="flex gap-2">
              <button
                onClick={() => { setStep('form'); setContent(null); setSelfGrade(null) }}
                className="flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
              >
                重新生成
              </button>
              <button
                onClick={() => void handleApprove()}
                disabled={approving}
                className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-black text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
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
