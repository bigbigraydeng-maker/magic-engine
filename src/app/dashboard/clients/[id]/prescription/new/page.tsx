'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { PrescriptionContent, PrescriptionIntake, DiagnosticDimension, PrescriptionAction, Prescription, PrescriptionStatus } from '@/types/diagnostic'
import type { ClientDiscoveryRow } from '@/lib/zhangqian/types'
import type { SelfGrade, HuatuoGenerationMeta, TrendSummaryLite, SelfGradeWeakness, SelfGradeDimension } from '@/lib/huatuo/types'
import { coerceWeaknesses } from '@/lib/huatuo/weakness-utils'
import { shouldAutoRestoreLatestDraft } from './restore-guards'

// DAPE Week 2 W4 — Goal 一对一 + 版本化所需的轻量 row 类型
interface MinimalGoal {
  id: string
  title: string
  intent: string
  sub_type: string | null
  period_start: string
  period_end: string
}

interface PrescriptionVersionItem {
  id: string
  version: number
  status: PrescriptionStatus
  created_at: string
  approved_at: string | null
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const URGENCY_OPTIONS: Array<{ value: PrescriptionIntake['timeline_urgency']; label: string; desc: string }> = [
  { value: 'immediate',  label: '⚡ 即刻',   desc: '1–2 周内启动' },
  { value: 'short_term', label: '📅 短期',   desc: '1–3 个月' },
  { value: 'long_term',  label: '🗓️ 长期',  desc: '3–6 个月' },
]

const DIMENSION_OPTIONS: Array<{ value: DiagnosticDimension; label: string }> = [
  { value: 'seo',           label: 'SEO' },
  { value: 'ai_visibility', label: 'AI 可见度' },
  { value: 'social',        label: '社媒' },
  { value: 'reputation',    label: '口碑' },
  { value: 'competitor',    label: '竞品' },
  { value: 'ads',           label: '广告' },
]

const CRISIS_COLOR: Record<string, string> = {
  'TYPE_E 声誉陷阱': 'bg-red-50 border-red-200 text-red-800',
  'TYPE_D 数字缺失': 'bg-orange-50 border-orange-200 text-orange-800',
  'TYPE_B 社媒空洞': 'bg-yellow-50 border-yellow-200 text-yellow-800',
  'TYPE_A AI不可见': 'bg-purple-50 border-purple-200 text-purple-800',
}

type Step = 1 | 2 | 3

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StepIndicator({ current }: { current: Step }) {
  const steps = [
    { n: 1, label: '填写意向' },
    { n: 2, label: '生成处方' },
    { n: 3, label: '审阅批准' },
  ]
  return (
    <div className="flex items-center gap-0 mb-6">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
            current === s.n ? 'bg-indigo-600 text-white' :
            current > s.n  ? 'bg-green-100 text-green-700' :
                             'bg-gray-100 text-gray-500'
          }`}>
            {current > s.n ? '✓' : s.n}
            <span className="hidden sm:inline">{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={`w-8 h-0.5 ${current > s.n ? 'bg-green-300' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

function ScoreChip({ label, value }: { label: string; value: number }) {
  const color = value >= 60 ? 'bg-green-100 text-green-700' :
                value >= 40 ? 'bg-yellow-100 text-yellow-700' :
                              'bg-red-100 text-red-700'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${color}`}>
      {label} {value}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function NewPrescriptionPage() {
  const params       = useParams()
  const router       = useRouter()
  const searchParams = useSearchParams()
  const clientId     = params.id as string

  // 补充/修订模式：URL 带 ?supplement_of=<id> 或 ?revise=<id>
  const supplementOf = searchParams.get('supplement_of')
  const reviseOf     = searchParams.get('revise')
  const priorMode: 'supplement' | 'revision' | null =
    supplementOf ? 'supplement' : reviseOf ? 'revision' : null
  const priorId = supplementOf ?? reviseOf

  // DAPE W4: URL 可带 ?goal_id=<id> 预选 Goal (从 Goal 详情页"新开处方"按钮跳过来)
  const initialGoalId = searchParams.get('goal_id')

  // Discovery source (Zhangqian)
  const [discovery, setDiscovery]             = useState<ClientDiscoveryRow | null>(null)
  const [discoveryLoading, setDiscoveryLoading] = useState(true)
  const [discoveryId, setDiscoveryId]         = useState<string | null>(null)

  // DAPE W4: 处方跟 Goal 一对一
  const [activeGoals, setActiveGoals]   = useState<MinimalGoal[]>([])
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(initialGoalId)
  const [goalsLoading, setGoalsLoading] = useState(true)
  // 该 Goal 下所有处方版本 (供版本切换 UI)
  const [versionList, setVersionList]   = useState<PrescriptionVersionItem[]>([])
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null)

  const [step, setStep] = useState<Step>(1)

  // Intake form state
  const [businessGoal, setBusinessGoal]     = useState('')
  const [urgency, setUrgency]               = useState<PrescriptionIntake['timeline_urgency']>('short_term')
  const [budget, setBudget]                 = useState<number>(3000)
  const [priorityDims, setPriorityDims]     = useState<DiagnosticDimension[]>([])
  const [notes, setNotes]                   = useState('')

  // Generation state
  const [isGenerating, setIsGenerating]       = useState(false)
  const [generateError, setGenerateError]     = useState<string | null>(null)
  const [prescriptionId, setPrescriptionId]   = useState<string | null>(null)
  const [content, setContent]                 = useState<PrescriptionContent | null>(null)
  const [selfGrade, setSelfGrade]             = useState<SelfGrade | null>(null)
  const [genMeta, setGenMeta]                 = useState<HuatuoGenerationMeta | null>(null)
  const [trendSummary, setTrendSummary]       = useState<TrendSummaryLite | null>(null)
  // 处方状态 — approved 时切只读，禁用精修/批准
  const [prescriptionStatus, setPrescriptionStatus] = useState<PrescriptionStatus | null>(null)

  // Approval state
  const [isApproving, setIsApproving]   = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)

  // Refine state (P8.10.S3 让华佗精修)
  const [isRefining, setIsRefining]     = useState(false)
  const [refineError, setRefineError]   = useState<string | null>(null)
  // 精修结果横幅 — 显示在主内容区，桌面/移动端都能看到
  const [refineBanner, setRefineBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  // 人工修改建议（每次精修可选注入，作为最高优先级反馈）
  const [humanComments, setHumanComments] = useState('')
  // 移动端「我的建议」抽屉开关
  const [mobileFeedbackOpen, setMobileFeedbackOpen] = useState(false)

  // 异步生成进度（华佗后台执行时实时更新）
  const [progressNote, setProgressNote] = useState<string | null>(null)
  const [elapsedSec, setElapsedSec]     = useState(0)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 清理定时器
  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current)
    if (elapsedRef.current) clearInterval(elapsedRef.current)
  }, [])

  // 安全网：万一 step=3 但 content 还是 null（缓存/竞态/其他原因），主动重拉一次
  useEffect(() => {
    if (step !== 3 || content !== null || !prescriptionId) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/prescription/${prescriptionId}`, {
          cache: 'no-store',
        })
        if (!res.ok || cancelled) return
        const data = await res.json() as { prescription: Prescription }
        const p = data.prescription
        if (cancelled || !p.content) return
        setContent(p.content)
        const sg = (p as Prescription & { self_grade?: SelfGrade }).self_grade
        if (sg) setSelfGrade(sg)
        const meta = (p as Prescription & { generation_meta?: HuatuoGenerationMeta & { trend_summary?: TrendSummaryLite } }).generation_meta
        if (meta) {
          setGenMeta(meta)
          if (meta.trend_summary) setTrendSummary(meta.trend_summary)
        }
      } catch (err) {
        console.warn('[prescription safety-fetch] failed', err)
      }
    })()
    return () => { cancelled = true }
  }, [step, content, prescriptionId, clientId])

  // ── 不再用轮询；SSE 流式响应由 readHuatuoStream 处理 ────────────────────

  // ── Load Zhangqian discovery on mount ─────────────────────────────────────
  useEffect(() => {
    void (async () => {
      setDiscoveryLoading(true)
      try {
        const res = await fetch(`/api/clients/${clientId}/zhangqian/latest`)
        if (!res.ok) return
        const data = await res.json() as { success: boolean; discovery: ClientDiscoveryRow }
        if (data.success && data.discovery?.confirmed_at) {
          setDiscovery(data.discovery)
          setDiscoveryId(data.discovery.id)
          // Pre-fill crisis type as a note hint
          const crisis = data.discovery.payload?.diagnosis?.crisis_type
          if (crisis) {
            setNotes(`诊断危机类型：${crisis}`)
          }
        }
      } finally {
        setDiscoveryLoading(false)
      }
    })()
  }, [clientId])

  // ── DAPE W4: Load active Goals 列表 (供 Step 1 Goal selector) ──────────────
  useEffect(() => {
    void (async () => {
      setGoalsLoading(true)
      try {
        // 复用 P32 多 Goal API (/active-list 返回所有 active goals)
        const res = await fetch(`/api/clients/${clientId}/goals/active-list`, { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json() as { goals?: MinimalGoal[] }
        const list = data.goals ?? []
        setActiveGoals(list)
        // 如果 URL 没指定 goal_id 且客户唯一 active goal → 自动选
        if (!initialGoalId && list.length === 1) {
          setSelectedGoalId(list[0].id)
        }
      } catch (err) {
        console.warn('[prescription/new] load active goals failed', err)
      } finally {
        setGoalsLoading(false)
      }
    })()
    // 只在 mount 时加载, initialGoalId 不会变
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  // ── DAPE W4: 选 Goal 后加载该 Goal 下所有处方版本 ──────────────────────────
  useEffect(() => {
    if (!selectedGoalId) {
      setVersionList([])
      setActiveVersionId(null)
      return
    }
    void (async () => {
      try {
        const res = await fetch(`/api/goals/${selectedGoalId}/prescriptions`, { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json() as {
          prescriptions?: PrescriptionVersionItem[]
          active_prescription_id?: string | null
        }
        setVersionList(data.prescriptions ?? [])
        setActiveVersionId(data.active_prescription_id ?? null)
      } catch (err) {
        console.warn('[prescription/new] load versions failed', err)
      }
    })()
  }, [selectedGoalId])

  // ── 加载最近一份草稿处方（防止用户刚生成完刷新页面就丢失结果）─────────────
  // 补充/修订模式不自动恢复草稿 —— 用户是来新建增量/修订版的
  // DAPE W4: 带 selectedGoalId filter, 仅恢复该 Goal 下的最新版
  //
  // 🚨 P0 FIX (BUG-FMT-W4-1): approved 处方不该自动跳 Step 3
  // 原因: latest-draft API 返回包括 approved 在内的所有非废弃处方 (DB 状态判断需要)
  // 但 /prescription/new 路由的语义是"新建处方"——若客户已有 approved 处方就自动跳 Step 3
  // 审阅页, 会卡住 W4 新加的 Goal selector, 用户根本进不来新建流程。
  // 修法: 客户端 guard — approved 不自动跳, 让用户在 Step 1 选 Goal 重新生成 (或新版本)
  // 同时保留对 draft/generating/failed 的自动恢复 (用户工作中断后回来继续)
  useEffect(() => {
    if (priorMode) return
    void (async () => {
      try {
        const url = selectedGoalId
          ? `/api/clients/${clientId}/prescriptions/latest-draft?goal_id=${selectedGoalId}`
          : `/api/clients/${clientId}/prescriptions/latest-draft`
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json() as { prescription?: Prescription }
        const p = data.prescription
        // 🚨 P0 GUARD: approved 处方不自动跳 Step 3 (BUG-FMT-W4-1)
        // approved 是已锁定的处方, 用户来 /prescription/new 是想新建另一版, 不是看已批准的
        // 想看 approved 应去 /dashboard/clients/[id]/execution
        // shouldAutoRestoreLatestDraft 集中处理: content/step/isGenerating/approved 四道闸 (见 restore-guards.ts)
        if (!shouldAutoRestoreLatestDraft({ step, isGenerating, prescription: p })) return
        if (!p) return  // TS narrowing — guard 内部已检
        setPrescriptionId(p.id)
        setPrescriptionStatus(p.status)
        setContent(p.content)
        const sg = (p as Prescription & { self_grade?: SelfGrade }).self_grade
        if (sg) setSelfGrade(sg)
        const meta = (p as Prescription & { generation_meta?: HuatuoGenerationMeta & { trend_summary?: TrendSummaryLite } }).generation_meta
        if (meta) {
          setGenMeta(meta)
          if (meta.trend_summary) setTrendSummary(meta.trend_summary)
        }
        setStep(3)
      } catch {/* 找不到草稿就保持表单 */}
    })()
    // 跟 selectedGoalId 联动 — 切 Goal 后会自动加载该 Goal 下最新版
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, selectedGoalId])

  // ── Generate prescription (SSE 流式) ──────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    setIsGenerating(true)
    setGenerateError(null)
    setProgressNote('连接诸葛亮…')
    const startTime = Date.now()
    setElapsedSec(0)
    if (elapsedRef.current) clearInterval(elapsedRef.current)
    elapsedRef.current = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)

    try {
      const intake: PrescriptionIntake = {
        business_goal:       businessGoal,
        timeline_urgency:    urgency,
        monthly_budget_aud:  budget,
        priority_dimensions: priorityDims,
        notes:               notes || null,
      }
      // 补充/修订模式优先 —— 从原处方 derive discovery，body 只带关系字段
      // DAPE W4: 普通生成必传 goal_id (一对一); 补充/修订模式从原处方继承不必传
      const body: Record<string, unknown> =
        priorMode === 'supplement' ? { supplement_of: priorId, intake } :
        priorMode === 'revision'   ? { revise: priorId, intake } :
        discoveryId                ? { discovery_id: discoveryId, intake, goal_id: selectedGoalId } :
                                     { intake, goal_id: selectedGoalId }

      const res = await fetch(`/api/clients/${clientId}/prescription/generate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        cache:   'no-store',
      })

      // 非 200 = 同步校验阶段就失败（404/422 等），不是流
      if (!res.ok) {
        let errText = `HTTP ${res.status}`
        try {
          const errBody = await res.json() as { error?: string }
          if (errBody?.error) errText = `${errText} — ${errBody.error}`
        } catch {/* */}
        throw new Error(errText)
      }

      // 流式读取 — 任何错误（包括服务端 SSE error 事件）都通过 onError 上报
      let streamErr: string | null = null
      const ok = await readHuatuoStream(res, {
        onStarted: (id) => setPrescriptionId(id),
        onProgress: (note) => setProgressNote(note),
        onDone: (payload) => {
          setContent(payload.content)
          setSelfGrade(payload.self_grade ?? null)
          if (payload.meta) {
            setGenMeta(payload.meta)
            if (payload.meta.trend_summary) setTrendSummary(payload.meta.trend_summary)
            if (payload.trend_summary) setTrendSummary(payload.trend_summary)
          }
          setPrescriptionStatus('draft')
          setStep(3)
        },
        onError: (err) => { streamErr = err },
      })

      if (streamErr) {
        // 处方生成失败的情况——回到表单
        setGenerateError(streamErr)
        setStep(1)
      } else if (!ok) {
        setGenerateError('诸葛亮流意外关闭，请刷新页面查看处方状态')
        setStep(1)
      }
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : '处方生成失败')
      setStep(1)
    } finally {
      setIsGenerating(false)
      setProgressNote(null)
      if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null }
    }
  }, [businessGoal, urgency, budget, priorityDims, notes, discoveryId, clientId, priorMode, priorId, selectedGoalId])

  // ── Approve prescription ──────────────────────────────────────────────────
  const handleApprove = async () => {
    if (!prescriptionId) return
    setIsApproving(true)
    setApproveError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/prescription/${prescriptionId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status: 'approved' }),
      })
      // 409 = 已经批准过 → 自愈：切到已批准态并跳转看板
      if (res.status === 409) {
        setPrescriptionStatus('approved')
        router.push(`/dashboard/clients/${clientId}/execution`)
        return
      }
      if (!res.ok) {
        let errText = `HTTP ${res.status}`
        try {
          const errBody = await res.json() as { error?: string }
          if (errBody?.error) errText = `${errText} — ${errBody.error}`
        } catch {/* */}
        throw new Error(errText)
      }
      setPrescriptionStatus('approved')
      router.push(`/dashboard/clients/${clientId}/execution`)
    } catch (e) {
      setApproveError(e instanceof Error ? e.message : '批准失败')
    } finally {
      setIsApproving(false)
    }
  }

  /**
   * 精修。返回 true=成功 / false=失败。
   * 结果通过 refineBanner（主内容区醒目横幅）反馈，桌面/移动端都能看到。
   */
  const handleRefine = async (): Promise<boolean> => {
    if (!prescriptionId) return false
    setIsRefining(true)
    setRefineError(null)
    setRefineBanner(null)
    setProgressNote('连接诸葛亮…')
    const prevOverall = selfGrade?.overall ?? null
    const startTime = Date.now()
    setElapsedSec(0)
    if (elapsedRef.current) clearInterval(elapsedRef.current)
    elapsedRef.current = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)

    let succeeded = false
    try {
      const res = await fetch(`/api/clients/${clientId}/prescription/${prescriptionId}/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ human_comments: humanComments.trim() || undefined }),
        cache: 'no-store',
      })

      // 409 = 处方已批准，无法再精修 → 自愈：切到已批准态
      if (res.status === 409) {
        setPrescriptionStatus('approved')
        setRefineBanner({ kind: 'error', text: '处方已批准，无法再精修 — 请前往执行看板' })
        return false
      }
      if (!res.ok) {
        let errText = `HTTP ${res.status}`
        try {
          const errBody = await res.json() as { error?: string }
          if (errBody?.error) errText = `${errText} — ${errBody.error}`
        } catch {/* */}
        throw new Error(errText)
      }

      // 用对象包裹避免 TS 闭包内变异的 never 收窄问题
      const captured: { streamErr: string | null; newOverall: number | null } = {
        streamErr: null,
        newOverall: null,
      }
      const ok = await readHuatuoStream(res, {
        onStarted: () => {/* prescriptionId 已知，不更新 */},
        onProgress: (note) => setProgressNote(note),
        onDone: (payload) => {
          setContent(payload.content)
          setSelfGrade(payload.self_grade ?? null)
          captured.newOverall = payload.self_grade?.overall ?? null
          if (payload.meta) {
            setGenMeta(payload.meta)
            if (payload.meta.trend_summary) setTrendSummary(payload.meta.trend_summary)
            if (payload.trend_summary) setTrendSummary(payload.trend_summary)
          }
          setPrescriptionStatus('draft')
        },
        onError: (err) => { captured.streamErr = err },
      })

      if (captured.streamErr) {
        setRefineError(captured.streamErr)
        setRefineBanner({ kind: 'error', text: captured.streamErr })
      } else if (!ok) {
        const msg = '诸葛亮流意外关闭 — 处方可能已在后台更新，请刷新页面查看'
        setRefineError(msg)
        setRefineBanner({ kind: 'error', text: msg })
      } else {
        succeeded = true
        const nv = captured.newOverall
        const delta = prevOverall != null && nv != null
          ? `评分 ${prevOverall.toFixed(1)} → ${nv.toFixed(1)}`
          : (nv != null ? `当前评分 ${nv.toFixed(1)}/10` : '处方已更新')
        setRefineBanner({ kind: 'success', text: `✓ 精修完成 — ${delta}` })
        setHumanComments('')   // 成功后清空意见框
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '精修失败'
      setRefineError(msg)
      setRefineBanner({ kind: 'error', text: msg })
    } finally {
      setIsRefining(false)
      setProgressNote(null)
      if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null }
    }
    return succeeded
  }

  const handleReject = async () => {
    if (!prescriptionId) return
    await fetch(`/api/clients/${clientId}/prescription/${prescriptionId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ status: 'rejected', rejection_note: '用户要求重新生成' }),
    })
    setStep(1)
    setContent(null)
    setPrescriptionId(null)
  }

  const toggleDimension = (dim: DiagnosticDimension) => {
    setPriorityDims(prev =>
      prev.includes(dim) ? prev.filter(d => d !== dim) : [...prev, dim]
    )
  }

  // 处方已批准 → 切只读态：隐藏精修卡 + 批准/拒绝按钮，改为"前往执行看板"
  const isApproved = prescriptionStatus === 'approved'

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <Link
            href={`/dashboard/clients/${clientId}`}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            返回
          </Link>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">
              {priorMode === 'supplement' ? '补充处方' : priorMode === 'revision' ? '修订处方' : '生成处方'}
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">
              {priorMode === 'supplement'
                ? '为已有处方生成增量动作 — 原处方与执行进度不受影响'
                : priorMode === 'revision'
                  ? '为方向需调整的处方生成 v2 — 批准后原处方归档，已完成动作保留'
                  : '基于品牌健康发现，由 Strategy Engine 生成三阶段营销方案'}
            </p>
          </div>
        </div>
      </div>

      <div className={`mx-auto px-6 py-6 ${step === 3 ? 'max-w-3xl lg:max-w-6xl' : 'max-w-3xl'}`}>
        <StepIndicator current={step} />

        {/* 补充/修订模式提示横幅 */}
        {priorMode && (
          <div className={`mb-4 rounded-xl border p-3.5 text-sm ${
            priorMode === 'supplement'
              ? 'border-blue-200 bg-blue-50 text-blue-800'
              : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}>
            {priorMode === 'supplement'
              ? '🧩 补充模式：诸葛亮会读取原处方的全部动作和执行进度，只生成"还缺的"新动作，不重复已有内容。原处方与已完成的工作不受任何影响。'
              : '↻ 修订模式：诸葛亮会基于原处方 + 执行进度生成完整的修订版（v2）。已完成的动作会被承接。批准这份修订后，原处方将归档为"已被取代"。'}
          </div>
        )}

        {/* ── Discovery Context Card (步骤 1/2 显示在顶部；步骤 3 移到左列内部) ── */}
        {step !== 3 && !discoveryLoading && discovery && (
          <DiscoveryContextCard discovery={discovery} />
        )}

        {/* ── No discovery warning (步骤 1/2) ──────────────────────────── */}
        {step !== 3 && !discoveryLoading && !discovery && (
          <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <p className="font-semibold mb-1">⚠️ 尚无确认的发现报告</p>
            <p className="text-xs">
              建议先运行
              <Link href={`/dashboard/clients/${clientId}/zhangqian`} className="underline mx-1">
                张骞发现
              </Link>
              再生成处方，以获得最精准的诊断依据。
            </p>
          </div>
        )}

        {/* ── Step 1: Intent Form ────────────────────────────────────────── */}
        {step === 1 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
            <h2 className="font-semibold text-gray-900">填写业务意向</h2>

            {/* DAPE W4: Goal 选择器 — 处方跟 Goal 一对一 */}
            {!priorMode && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  关联 Goal <span className="text-red-500">*</span>
                  <span className="ml-2 text-xs font-normal text-gray-400">
                    (DAPE 处方跟 Goal 一对一)
                  </span>
                </label>
                {goalsLoading ? (
                  <div className="text-sm text-gray-400 py-2">加载客户 Goal 列表…</div>
                ) : activeGoals.length === 0 ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    ⚠️ 该客户暂无 active Goal —{' '}
                    <Link href={`/dashboard/clients/${clientId}/goal/new`} className="underline">
                      先创建一个 Goal
                    </Link>
                    {' '}再生成处方。
                  </div>
                ) : (
                  <div className="space-y-2">
                    {activeGoals.map(g => {
                      const periodWeeks = Math.round(
                        (new Date(g.period_end).getTime() - new Date(g.period_start).getTime())
                          / (7 * 24 * 60 * 60 * 1000),
                      )
                      return (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => setSelectedGoalId(g.id)}
                          className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
                            selectedGoalId === g.id
                              ? 'border-indigo-400 bg-indigo-50'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <div className="text-sm font-medium text-gray-900">{g.title}</div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {g.intent}{g.sub_type ? ` / ${g.sub_type}` : ''} · {periodWeeks} 周 ({g.period_start.slice(5)} → {g.period_end.slice(5)})
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
                {selectedGoalId && versionList.length > 0 && (
                  <div className="mt-2 text-xs text-gray-500">
                    该 Goal 已有 {versionList.length} 版处方 (最新 v{versionList[0]?.version}, status={versionList[0]?.status})
                  </div>
                )}
              </div>
            )}

            {/* Business goal */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                业务目标 <span className="text-red-500">*</span>
              </label>
              <textarea
                value={businessGoal}
                onChange={e => setBusinessGoal(e.target.value)}
                rows={3}
                placeholder="例：在 6 个月内将新西兰新客户增长 30%，主攻 SEO 和 AI 可见度"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>

            {/* Timeline urgency */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                时间紧迫度 <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {URGENCY_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setUrgency(opt.value)}
                    className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      urgency === opt.value
                        ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    <div className="text-xs font-semibold">{opt.label}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Monthly budget */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                月度预算（AUD）<span className="text-red-500">*</span>
              </label>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 text-sm">AUD $</span>
                <input
                  type="number"
                  min={500}
                  max={50000}
                  step={500}
                  value={budget}
                  onChange={e => setBudget(Number(e.target.value))}
                  className="w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
                <span className="text-xs text-gray-400">/月</span>
              </div>
            </div>

            {/* Priority dimensions */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                优先维度（可多选，留空表示全部）
              </label>
              <div className="flex flex-wrap gap-2">
                {DIMENSION_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleDimension(opt.value)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      priorityDims.includes(opt.value)
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                补充说明（可选）
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                placeholder="例：目前已有博客团队，希望处方聚焦自动化工具"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>

            {generateError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {generateError}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                onClick={() => { setStep(2); void handleGenerate() }}
                disabled={!businessGoal.trim() || budget <= 0 || (!priorMode && !selectedGoalId && activeGoals.length > 0)}
                className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title={!priorMode && !selectedGoalId && activeGoals.length > 0 ? '请先关联一个 Goal' : ''}
              >
                生成处方 →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: 异步生成中（带进度+计时）─────────────────────────────── */}
        {step === 2 && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center space-y-4">
            <div className="animate-spin w-10 h-10 border-4 border-indigo-400 border-t-transparent rounded-full mx-auto" />
            <h2 className="font-semibold text-gray-900">诸葛亮正在开方…</h2>
            <p className="text-sm text-gray-500 min-h-[1.5em]">
              {progressNote ?? '正在基于品牌健康数据和行业基准生成处方'}
            </p>
            <p className="text-xs text-gray-400 tabular-nums">
              已用时 {Math.floor(elapsedSec / 60)}:{String(elapsedSec % 60).padStart(2, '0')}
              {' · '}通常 60–150 秒
            </p>
            {generateError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {generateError}
                <button onClick={() => setStep(1)} className="ml-2 underline">返回修改</button>
              </div>
            )}
          </div>
        )}

        {/* ── Step 3: 处方审阅（双栏布局：左侧处方 + 右侧悬浮"我的建议") ── */}
        {step === 3 && content && (
          <div className="lg:grid lg:grid-cols-3 lg:gap-6">
            {/* ─── 左栏：处方内容（移动端全宽；已批准时占满 3 列） ─── */}
            <div className={`space-y-4 ${isApproved ? 'lg:col-span-3' : 'lg:col-span-2'}`}>
            {/* DAPE W4: 版本切换 chips — 该 Goal 下所有处方版本 */}
            {selectedGoalId && versionList.length >= 1 && (
              <VersionSwitcher
                versions={versionList}
                currentId={prescriptionId}
                activeApprovedId={activeVersionId}
                clientId={clientId}
              />
            )}

            {/* 已批准横幅 — 只读态，引导去执行看板 */}
            {isApproved && (
              <div className="rounded-xl border border-green-200 bg-green-50 p-4 flex items-center gap-3">
                <span className="text-2xl shrink-0">✅</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-green-900">此处方已批准</p>
                  <p className="text-xs text-green-700">处方已锁定，不能再精修或修改。执行计划已生成。</p>
                </div>
                <Link
                  href={`/dashboard/clients/${clientId}/execution`}
                  className="shrink-0 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 transition-colors"
                >
                  前往执行看板 →
                </Link>
              </div>
            )}

            {/* 精修结果横幅 — 桌面/移动端都能看到（不依赖抽屉/sidebar） */}
            {refineBanner && (
              <div className={`rounded-xl border p-3.5 flex items-start gap-2.5 ${
                refineBanner.kind === 'success'
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : 'border-red-200 bg-red-50 text-red-700'
              }`}>
                <span className="text-lg shrink-0">
                  {refineBanner.kind === 'success' ? '🎉' : '⚠️'}
                </span>
                <p className="text-sm flex-1 font-medium">{refineBanner.text}</p>
                <button
                  onClick={() => setRefineBanner(null)}
                  className="shrink-0 text-lg leading-none opacity-50 hover:opacity-100"
                  aria-label="关闭"
                >
                  ×
                </button>
              </div>
            )}

            {/* 诊断依据 — 步骤 3 移到左栏内部 */}
            {!discoveryLoading && discovery && (
              <DiscoveryContextCard discovery={discovery} />
            )}

            {/* 华佗自评卡 — 只显示评分 + 薄弱点。精修在「我的修改建议」卡触发 */}
            {selfGrade && genMeta && (
              <HuatuoMetaCard selfGrade={selfGrade} meta={genMeta} />
            )}

            {/* 历史趋势卡 — 让用户看到 target_value 是基于真实历史锚定 */}
            {trendSummary && trendSummary.has_data && (
              <TrendCard summary={trendSummary} />
            )}

            {/* Summary */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-900 mb-2">处方摘要</h2>
              <p className="text-sm text-gray-600">{content.summary}</p>
            </div>

            {/* Budget allocation */}
            {content.budget_allocation.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">预算分配</h3>
                <div className="space-y-2">
                  {content.budget_allocation.map(b => (
                    <div key={b.dimension} className="flex items-center gap-3">
                      <span className="w-20 text-xs text-gray-500">{b.dimension}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-2">
                        <div
                          className="bg-indigo-500 h-2 rounded-full"
                          style={{ width: `${b.percentage}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-gray-700 w-24 text-right">
                        AUD ${b.amount_aud} ({b.percentage}%)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Phases — DAPE W4: 动态 N 阶段, 每阶段对应 1 个派生 Initiative */}
            {content.phases.map(phase => (
              <div key={phase.phase_number} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-start gap-3 mb-3">
                  <span className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center shrink-0">
                    {phase.phase_number}
                  </span>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900">{phase.name}</h3>
                    <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-gray-400">
                      <span>{phase.duration_weeks} 周</span>
                      {phase.initiative_seed && (
                        <>
                          <span>·</span>
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
                              phase.initiative_seed.initiative_type === 'unassigned'
                                ? 'bg-gray-100 text-gray-600'
                                : 'bg-purple-100 text-purple-700'
                            }`}
                            title="批准处方时自动派生为 Initiative (Phase 31 三层骨架)"
                          >
                            🎯 {phase.initiative_seed.initiative_type.replace(/_/g, ' ')}
                          </span>
                          {phase.initiative_seed.posture && (
                            <span className="text-gray-500">{phase.initiative_seed.posture}</span>
                          )}
                          {phase.initiative_seed.budget_percent != null && (
                            <span className="text-gray-500">{phase.initiative_seed.budget_percent}% 预算</span>
                          )}
                        </>
                      )}
                    </div>
                    {phase.initiative_seed?.hypothesis && (
                      <p className="mt-1.5 text-xs text-gray-600 leading-relaxed italic">
                        💡 {phase.initiative_seed.hypothesis}
                      </p>
                    )}
                  </div>
                </div>
                <div className="space-y-3 pl-10">
                  {phase.actions.map(action => (
                    <ActionRow key={action.id} action={action} />
                  ))}
                </div>
              </div>
            ))}

            {/* KPI targets — 含 realism_confidence 和 timeframe */}
            {content.kpi_targets.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  KPI 目标
                  <span className="ml-2 text-xs font-normal text-gray-400 normal-case">
                    （绿/黄/红 = 现实性置信度）
                  </span>
                </h3>
                <div className="space-y-2.5">
                  {content.kpi_targets.map((kpi, i) => {
                    const conf = kpi.realism_confidence
                    const confDot =
                      conf == null ? 'bg-gray-300' :
                      conf >= 0.7  ? 'bg-green-400' :
                      conf >= 0.4  ? 'bg-yellow-400' :
                                     'bg-red-400'
                    return (
                      <div key={i} className="flex items-start gap-2.5">
                        <span
                          className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${confDot}`}
                          title={conf != null ? `现实性置信度 ${(conf * 100).toFixed(0)}%` : '无置信度数据'}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="text-sm text-gray-800">{kpi.metric}</span>
                            <span className="text-sm font-medium text-indigo-700 shrink-0 tabular-nums">
                              {kpi.current_value != null ? `${kpi.current_value} → ` : ''}
                              <strong>{kpi.target_value}</strong> {kpi.unit}
                            </span>
                          </div>
                          {kpi.timeframe && (
                            <p className="text-xs text-gray-400 mt-0.5">⏱ {kpi.timeframe}</p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Approval buttons — 批准/拒绝。已批准时改为"前往执行看板" */}
            {approveError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {approveError}
              </div>
            )}

            {isApproved ? (
              <div className="pt-2 pb-20 lg:pb-2">
                <Link
                  href={`/dashboard/clients/${clientId}/execution`}
                  className="block w-full rounded-lg bg-green-600 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-green-700 transition-colors"
                >
                  ✓ 处方已批准 — 前往执行看板 →
                </Link>
              </div>
            ) : (
              <div className="flex gap-3 pt-2 pb-20 lg:pb-2">
                <button
                  onClick={() => void handleReject()}
                  className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  要求修改
                </button>
                <button
                  onClick={() => void handleApprove()}
                  disabled={isApproving}
                  className="flex-1 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isApproving ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                      处理中…
                    </span>
                  ) : '✓ 批准并生成执行计划'}
                </button>
              </div>
            )}
            </div>
            {/* ─── 右栏：sticky"我的修改建议"（仅桌面 lg+，已批准则隐藏） ─── */}
            {!isApproved && (
              <aside className="hidden lg:block lg:col-span-1">
                <div className="sticky top-20">
                  <HumanFeedbackCard
                    comments={humanComments}
                    setComments={setHumanComments}
                    onRefine={handleRefine}
                    isRefining={isRefining}
                    refineError={refineError}
                    progress={isRefining ? (progressNote ?? '排队中…') : null}
                    elapsedSec={isRefining ? elapsedSec : null}
                    passes={genMeta?.passes ?? 1}
                  />
                </div>
              </aside>
            )}
          </div>
        )}
      </div>

      {/* ─── 移动端：浮动按钮 + 底部抽屉（lg 以下，已批准则隐藏） ─── */}
      {step === 3 && content && !isApproved && (
        <MobileFeedbackSheet
          isOpen={mobileFeedbackOpen}
          onOpen={() => setMobileFeedbackOpen(true)}
          onClose={() => setMobileFeedbackOpen(false)}
          comments={humanComments}
          setComments={setHumanComments}
          onRefine={async () => {
            const ok = await handleRefine()
            // 仅成功时关抽屉；失败保持打开让用户看到错误并重试
            if (ok) setMobileFeedbackOpen(false)
          }}
          isRefining={isRefining}
          refineError={refineError}
          progress={isRefining ? (progressNote ?? '排队中…') : null}
          elapsedSec={isRefining ? elapsedSec : null}
          passes={genMeta?.passes ?? 1}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SSE 流式响应读取器（华佗 P8.10.S3）
// ---------------------------------------------------------------------------

interface HuatuoStreamHandlers {
  onStarted?: (prescriptionId: string) => void
  onProgress?: (note: string) => void
  onDone: (payload: {
    prescription_id: string
    content: PrescriptionContent
    self_grade?: SelfGrade
    meta?: HuatuoGenerationMeta & { trend_summary?: TrendSummaryLite }
    trend_summary?: TrendSummaryLite
  }) => void
  onError: (error: string) => void
}

/**
 * 读取华佗 SSE 流。返回 true=完成 false=流意外关闭未收到 done。
 *
 * 事件格式（每条 SSE）：
 *   data: {"type":"started","prescription_id":"..."}
 *   data: {"type":"progress","note":"..."}
 *   data: {"type":"done","content":...,"self_grade":...,...}
 *   data: {"type":"error","error":"..."}
 *
 * 心跳行（: heartbeat）会被忽略。
 */
async function readHuatuoStream(res: Response, handlers: HuatuoStreamHandlers): Promise<boolean> {
  const reader = res.body?.getReader()
  if (!reader) return false

  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let sawDoneOrError = false
  let streamError: string | null = null   // 把 error 事件存起来，结束后再上报

  outer: while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE 事件以 \n\n 分隔
    let sepIdx: number
    while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, sepIdx)
      buffer = buffer.slice(sepIdx + 2)

      // 解析每行
      const lines = rawEvent.split('\n')
      let dataPayload: string | null = null
      for (const line of lines) {
        if (line.startsWith(':')) continue          // comment / heartbeat
        if (line.startsWith('data:')) {
          dataPayload = line.slice(5).trimStart()
        }
      }
      if (!dataPayload) continue

      // JSON.parse 失败时仅记日志、跳过——绝不影响 handler 调用
      let parsed: { type: string } & Record<string, unknown>
      try {
        parsed = JSON.parse(dataPayload) as { type: string } & Record<string, unknown>
      } catch (err) {
        console.warn('[huatuo stream] bad event JSON', dataPayload, err)
        continue
      }

      // Handler 调用在 try/catch 外，避免吞掉 handler 内部抛出
      switch (parsed.type) {
        case 'started':
          handlers.onStarted?.(parsed.prescription_id as string)
          break
        case 'progress':
          handlers.onProgress?.((parsed.note as string) ?? '')
          break
        case 'done':
          sawDoneOrError = true
          handlers.onDone(parsed as unknown as Parameters<HuatuoStreamHandlers['onDone']>[0])
          break
        case 'error':
          sawDoneOrError = true
          streamError = (parsed.error as string) ?? '未知错误'
          break outer  // 立即跳出所有循环
      }
    }
  }

  // 流结束后再上报错误（避免在循环中 throw 影响后续清理）
  if (streamError) {
    handlers.onError(streamError)
    return false
  }
  return sawDoneOrError
}

// ---------------------------------------------------------------------------
// 华佗 自评卡 — 显示在审阅页顶部，让 FDE 一眼看到处方质量
// ---------------------------------------------------------------------------

const GRADE_LABELS: Record<keyof SelfGrade['dimensions'], string> = {
  realism:          '现实性',
  completeness:     '完整性',
  fde_actionability:'FDE可执行性',
  roi_alignment:    'ROI合理性',
  prioritization:   '优先级',
  resource_match:   '资源匹配',
  innovation:       '创新性',
}

function HuatuoMetaCard({
  selfGrade,
  meta,
}: {
  selfGrade: SelfGrade
  meta: HuatuoGenerationMeta
}) {
  // 点击维度 chip 筛选下方待改进项；再点一次清除
  const [activeDim, setActiveDim] = useState<SelfGradeDimension | null>(null)

  // 把 weaknesses 按维度分组。coerceWeaknesses 会以「文字前缀」为最可信来源
  // 纠正 Claude 填错的 dimension 字段，并剥掉冗余前缀（兼容旧 DB string[] 格式）。
  const weaknessesByDim = ((): Record<SelfGradeDimension, SelfGradeWeakness[]> => {
    const groups = {} as Record<SelfGradeDimension, SelfGradeWeakness[]>
    for (const w of coerceWeaknesses(selfGrade.weaknesses)) {
      ;(groups[w.dimension] ??= []).push(w)
    }
    return groups
  })()

  const overall = selfGrade.overall
  const gradeColor =
    overall >= 8 ? 'text-green-700 bg-green-50 border-green-200' :
    overall >= 6 ? 'text-amber-700 bg-amber-50 border-amber-200' :
                   'text-red-700 bg-red-50 border-red-200'
  const gradeLabel =
    overall >= 8 ? '高质量' :
    overall >= 6 ? '可接受' :
                   '需注意'

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className={`px-3 py-1.5 rounded-lg border font-bold text-lg tabular-nums shrink-0 ${gradeColor}`}>
          {overall.toFixed(1)} / 10
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">
            诸葛亮自评：{gradeLabel}
            {meta.passes >= 2 && (
              <span className="ml-2 text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                ✓ 经过 {meta.passes - 1} 轮精修
              </span>
            )}
          </p>
          <p className="text-xs text-gray-400">
            {meta.passes === 1 ? '一次过关' : `共 ${meta.passes} 轮生成`}
            {' · '}
            ${meta.cost_usd.toFixed(3)}
            {' · '}
            {(meta.duration_ms / 1000).toFixed(1)}s
            {meta.industry_category_used && ` · 行业 ${meta.industry_category_used}`}
          </p>
        </div>
      </div>

      {/* 7 维评分网格 — 可点击，点击筛选下方对应维度的待改进项 */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 mb-3">
        {(Object.keys(GRADE_LABELS) as SelfGradeDimension[]).map(key => {
          const v = selfGrade.dimensions[key] ?? 0
          const wkCount = weaknessesByDim[key]?.length ?? 0
          const isActive = activeDim === key
          const color =
            v >= 8 ? 'bg-green-100 text-green-700' :
            v >= 6 ? 'bg-amber-100 text-amber-700' :
                     'bg-red-100 text-red-700'
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActiveDim(isActive ? null : key)}
              className={`relative rounded-md px-2 py-1.5 text-center transition-all ${color} ${
                isActive ? 'ring-2 ring-indigo-500 ring-offset-1' : 'hover:opacity-80'
              }`}
              title={wkCount > 0 ? `${wkCount} 条待改进项 — 点击查看` : '该维度无明显问题'}
            >
              <div className="text-[10px] uppercase tracking-wide opacity-75">{GRADE_LABELS[key]}</div>
              <div className="text-sm font-bold tabular-nums">{v}</div>
              {wkCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-gray-700 text-white text-[9px] font-bold flex items-center justify-center">
                  {wkCount}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* 处方待改进项（华佗自检）— 按维度分组 */}
      {selfGrade.weaknesses && selfGrade.weaknesses.length > 0 && (
        <div className="border-t border-gray-100 pt-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              处方待改进项 · 诸葛亮自检
              <span className="ml-1.5 normal-case text-gray-400 font-normal">
                （指<strong>本方案</strong>的问题，不是客户企业的问题）
              </span>
            </p>
            {activeDim && (
              <button
                onClick={() => setActiveDim(null)}
                className="text-xs text-indigo-600 hover:text-indigo-800"
              >
                清除筛选 ✕
              </button>
            )}
          </div>

          {/* 按维度分组渲染（activeDim 有值时只显示该组） */}
          <div className="space-y-2.5">
            {(Object.keys(GRADE_LABELS) as SelfGradeDimension[])
              .filter(dim => (activeDim ? dim === activeDim : true))
              .filter(dim => (weaknessesByDim[dim]?.length ?? 0) > 0)
              .map(dim => (
                <div
                  key={dim}
                  className={`rounded-lg p-2.5 ${
                    activeDim === dim ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'bg-gray-50'
                  }`}
                >
                  <p className="text-xs font-semibold text-gray-700 mb-1">
                    {GRADE_LABELS[dim]}
                    <span className="ml-1.5 text-gray-400 font-normal">
                      （得分 {selfGrade.dimensions[dim] ?? 0}/10）
                    </span>
                  </p>
                  <ul className="text-xs text-gray-600 space-y-1">
                    {weaknessesByDim[dim].map((w, i) => {
                      const sevDot =
                        w.severity === 'high'   ? 'text-red-500' :
                        w.severity === 'medium' ? 'text-amber-500' :
                                                  'text-gray-400'
                      const sevLabel =
                        w.severity === 'high'   ? '严重' :
                        w.severity === 'medium' ? '中等' :
                                                  '轻微'
                      return (
                        <li key={i} className="flex gap-1.5">
                          <span className={`shrink-0 ${sevDot}`} title={sevLabel}>●</span>
                          <span>{w.text}</span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
          </div>

          {/* activeDim 选中但该维度无问题 */}
          {activeDim && (weaknessesByDim[activeDim]?.length ?? 0) === 0 && (
            <div className="rounded-lg bg-green-50 p-2.5 text-xs text-green-700">
              ✓ {GRADE_LABELS[activeDim]}（{selfGrade.dimensions[activeDim] ?? 0}/10）— 该维度无明显问题
            </div>
          )}
        </div>
      )}

      {/* 精修说明 */}
      {selfGrade.improvements_made && selfGrade.improvements_made.length > 0 && (
        <div className="border-t border-gray-100 pt-3 mt-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
            本轮针对性修复
          </p>
          <ul className="text-xs text-gray-600 space-y-1">
            {selfGrade.improvements_made.map((w, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-green-500 shrink-0">✓</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// HumanFeedbackCard — FDE/顾问写人工意见，触发基于人类经验的精修
// ---------------------------------------------------------------------------

function HumanFeedbackCard({
  comments,
  setComments,
  onRefine,
  isRefining,
  refineError,
  progress,
  elapsedSec,
  passes,
  compact = false,
}: {
  comments: string
  setComments: (s: string) => void
  onRefine: () => void
  isRefining: boolean
  refineError: string | null
  progress: string | null
  elapsedSec: number | null
  passes: number
  compact?: boolean
}) {
  const maxRefines = 5
  const refinesUsed = Math.max(0, passes - 1)
  const refinesLeft = Math.max(0, maxRefines - refinesUsed)
  const exhausted = refinesLeft <= 0

  const containerCls = compact
    ? 'bg-white p-0'                                          // 移动端抽屉内：无外框
    : 'bg-white rounded-xl border-2 border-indigo-100 p-5'    // 桌面 sticky：完整卡

  return (
    <div className={containerCls}>
      <div className={`flex items-start justify-between gap-3 ${compact ? 'mb-2' : 'mb-3'}`}>
        {!compact && (
          <div className="flex items-center gap-2.5">
            <span className="text-xl">👤</span>
            <div>
              <p className="text-sm font-semibold text-gray-900">我的修改建议</p>
              <p className="text-xs text-gray-400">
                FDE / 顾问的人类经验作为<strong className="text-indigo-700">最高优先级反馈</strong>注入诸葛亮
              </p>
            </div>
          </div>
        )}
        {compact && (
          <p className="text-xs text-gray-500 flex-1">
            FDE / 顾问的人类经验作为<strong className="text-indigo-700">最高优先级反馈</strong>注入诸葛亮
          </p>
        )}
        <div className="text-xs text-gray-400 shrink-0 tabular-nums">
          已精修 {refinesUsed}/{maxRefines}
        </div>
      </div>

      <textarea
        value={comments}
        onChange={e => setComments(e.target.value)}
        rows={compact ? 6 : 8}
        placeholder={`例：

1. 总工时还是偏高，把第二阶段博客频率从每周 2 篇降到每周 1 篇
2. 客户没有视频拍摄设备，删掉 Reels 系列动作或改用 AI 视频工具
3. CRM 选 HubSpot 免费版，不要 Mailchimp（客户已有 HubSpot 账户）
4. AI 引用率目标 18% 太乐观，调到 10%`}
        disabled={isRefining || exhausted}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:bg-gray-50 disabled:text-gray-400"
      />

      {refineError && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
          精修失败：{refineError}
        </div>
      )}

      {isRefining && (
        <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 p-2.5 text-xs text-indigo-700 flex items-center gap-2">
          <span className="animate-spin w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full" />
          <span className="flex-1">{progress ?? '诸葛亮精修中…'}</span>
          {elapsedSec != null && (
            <span className="tabular-nums text-indigo-500">
              {Math.floor(elapsedSec / 60)}:{String(elapsedSec % 60).padStart(2, '0')}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mt-3 gap-3">
        <p className="text-xs text-gray-400 flex-1">
          {exhausted
            ? `已达 ${maxRefines} 轮精修上限，请批准或要求重新生成。`
            : comments.trim()
              ? '✓ 诸葛亮将明确采纳上述意见'
              : '留空也可触发精修（诸葛亮仅根据 AI 自评薄弱点修复）'}
        </p>
        <button
          onClick={onRefine}
          disabled={isRefining || exhausted}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isRefining ? '精修中…' : comments.trim() ? '🔄 基于我的意见再精修' : '🔄 让诸葛亮再精修一次'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// MobileFeedbackSheet — 移动端浮动按钮 + 底部抽屉（lg 以下显示）
// ---------------------------------------------------------------------------

function MobileFeedbackSheet({
  isOpen,
  onOpen,
  onClose,
  comments,
  setComments,
  onRefine,
  isRefining,
  refineError,
  progress,
  elapsedSec,
  passes,
}: {
  isOpen: boolean
  onOpen: () => void
  onClose: () => void
  comments: string
  setComments: (s: string) => void
  onRefine: () => void
  isRefining: boolean
  refineError: string | null
  progress: string | null
  elapsedSec: number | null
  passes: number
}) {
  const hasComments = comments.trim().length > 0

  // 锁定 body 滚动（抽屉打开时）
  useEffect(() => {
    if (!isOpen) return
    const orig = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = orig }
  }, [isOpen])

  return (
    <>
      {/* 浮动按钮 — 固定在右下角，lg 以下显示 */}
      {!isOpen && (
        <button
          onClick={onOpen}
          className="lg:hidden fixed bottom-4 right-4 z-30 inline-flex items-center gap-2 rounded-full bg-indigo-600 text-white px-4 py-3 shadow-lg hover:bg-indigo-700 transition-colors"
          aria-label="打开修改建议"
        >
          <span className="text-base">👤</span>
          <span className="text-sm font-semibold">
            {hasComments ? `修改建议（${comments.trim().split(/\n/).filter(Boolean).length} 条）` : '我的修改建议'}
          </span>
          {isRefining && (
            <span className="animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full ml-1" />
          )}
        </button>
      )}

      {/* 底部抽屉 + 背景遮罩 */}
      {isOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex flex-col justify-end">
          {/* 背景遮罩 */}
          <button
            onClick={onClose}
            aria-label="关闭"
            className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"
          />
          {/* 抽屉本体 — 底部上滑 */}
          <div className="relative bg-white rounded-t-2xl shadow-2xl max-h-[85vh] flex flex-col animate-slide-up">
            {/* 顶部 handle + 关闭 */}
            <div className="flex items-center justify-between px-5 pt-3 pb-2 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <span className="text-lg">👤</span>
                <h3 className="text-sm font-semibold text-gray-900">我的修改建议</h3>
              </div>
              <button
                onClick={onClose}
                className="rounded-md text-gray-400 hover:text-gray-700 px-2 py-1"
              >
                ✕
              </button>
            </div>
            {/* 内容（可滚动） */}
            <div className="flex-1 overflow-y-auto p-4">
              <HumanFeedbackCard
                comments={comments}
                setComments={setComments}
                onRefine={onRefine}
                isRefining={isRefining}
                refineError={refineError}
                progress={progress}
                elapsedSec={elapsedSec}
                passes={passes}
                compact
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// TrendCard — SEMrush 12 月历史趋势（华佗 P8.10.S3.2 真实数据锚点）
// ---------------------------------------------------------------------------

const TRAJECTORY_STYLE: Record<TrendSummaryLite['trajectory'], { icon: string; label: string; cls: string }> = {
  rising:    { icon: '📈', label: '上升',  cls: 'bg-green-50 border-green-200 text-green-800' },
  flat:      { icon: '➡️', label: '平稳',  cls: 'bg-gray-50 border-gray-200 text-gray-700' },
  declining: { icon: '📉', label: '下降',  cls: 'bg-red-50 border-red-200 text-red-800' },
  no_data:   { icon: '—',  label: '无数据', cls: 'bg-gray-50 border-gray-200 text-gray-500' },
}

function TrendCard({ summary }: { summary: TrendSummaryLite }) {
  const tj = TRAJECTORY_STYLE[summary.trajectory]
  const growthCells: Array<{ label: string; value: number | null }> = [
    { label: '近 3 月',  value: summary.growth_pct_3m },
    { label: '近 6 月',  value: summary.growth_pct_6m },
    { label: '12 月首尾', value: summary.growth_pct_12m },
  ]

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">
            SEMrush 历史流量趋势
          </p>
          <p className="text-xs text-gray-400">
            过去 {summary.data_points} 个月 · 诸葛亮已用作 KPI 锚点
          </p>
        </div>
        <span className={`shrink-0 text-xs font-semibold border rounded-full px-2.5 py-1 ${tj.cls}`}>
          {tj.icon} {tj.label}
        </span>
      </div>

      {/* 关键指标行 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <MetricCell
          label={`最近月（${summary.latest?.month ?? ''}）`}
          value={summary.latest?.organic_traffic.toLocaleString() ?? '—'}
          unit="次/月有机流量"
        />
        <MetricCell
          label="月均流量"
          value={summary.monthly_avg_traffic?.toLocaleString() ?? '—'}
          unit="次/月"
        />
        <MetricCell
          label={`最早月（${summary.earliest?.month ?? ''}）`}
          value={summary.earliest?.organic_traffic.toLocaleString() ?? '—'}
          unit="次/月"
        />
        <MetricCell
          label="最近关键词数"
          value="—"
          unit="个"
        />
      </div>

      {/* 增长率 chip 行 */}
      <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100">
        <span className="text-xs text-gray-500">实际增长率：</span>
        {growthCells.map(c => {
          const v = c.value
          const cls =
            v == null  ? 'bg-gray-100 text-gray-500' :
            v >= 10    ? 'bg-green-100 text-green-700' :
            v <= -10   ? 'bg-red-100 text-red-700' :
                         'bg-amber-100 text-amber-700'
          return (
            <span key={c.label} className={`text-xs font-medium rounded-full px-2.5 py-0.5 tabular-nums ${cls}`}>
              {c.label} {v == null ? '数据不足' : `${v >= 0 ? '+' : ''}${v}%`}
            </span>
          )
        })}
      </div>
    </div>
  )
}

function MetricCell({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-gray-400 truncate">{label}</div>
      <div className="text-base font-bold text-gray-900 tabular-nums leading-tight">{value}</div>
      <div className="text-[10px] text-gray-400 mt-0.5">{unit}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ActionRow — 一个 action 的丰富展示（含 FDE 字段）
// ---------------------------------------------------------------------------

const MODULE_LABEL: Record<string, string> = {
  seo_engine:        'SEO引擎',
  social_matrix:     '社媒矩阵',
  ads_intelligence:  '广告',
  insight_reports:   '数据报告',
  manual:            '手工执行',
}

function ActionRow({ action }: { action: PrescriptionAction }) {
  const fixTypeBadge =
    action.fix_type === 'me_auto'    ? { label: 'ME', cls: 'bg-blue-100 text-blue-700' } :
    action.fix_type === 'fde_manual' ? { label: 'FDE', cls: 'bg-purple-100 text-purple-700' } :
                                       { label: '第三方', cls: 'bg-gray-100 text-gray-600' }

  const impactDot =
    action.impact === 'high'   ? 'bg-green-500' :
    action.impact === 'medium' ? 'bg-amber-500' :
                                 'bg-gray-300'

  return (
    <div className="border border-gray-100 rounded-lg p-3 hover:border-gray-200 transition-colors">
      <div className="flex items-start gap-2 mb-2">
        <span className={`mt-0.5 text-xs px-2 py-0.5 rounded font-medium shrink-0 ${fixTypeBadge.cls}`}>
          {fixTypeBadge.label}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <p className="text-sm font-medium text-gray-900">{action.title}</p>
            <span className={`w-1.5 h-1.5 rounded-full ${impactDot}`} title={`影响：${action.impact}`} />
            {action.module && (
              <span className="text-[10px] uppercase tracking-wide text-indigo-600 bg-indigo-50 rounded px-1.5 py-0.5">
                {MODULE_LABEL[action.module] ?? action.module}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1 leading-relaxed">{action.description}</p>
        </div>
      </div>

      {/* FDE 元数据行 */}
      {(action.estimated_hours != null || action.required_skills?.length || action.measurement_method) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500 pl-8 pt-1.5 border-t border-gray-50">
          {action.estimated_hours != null && (
            <span>⏱ <strong className="text-gray-700">{action.estimated_hours}h</strong></span>
          )}
          {action.required_skills && action.required_skills.length > 0 && (
            <span>🛠 {action.required_skills.join(' / ')}</span>
          )}
          {action.measurement_method && (
            <span title={action.measurement_method} className="truncate max-w-[300px]">
              📏 {action.measurement_method}
            </span>
          )}
          {action.dependencies && action.dependencies.length > 0 && (
            <span className="text-amber-600">↳ 依赖 {action.dependencies.length} 项</span>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// DAPE W4 — VersionSwitcher: Goal 下所有处方版本 chips (v1/v2/v3 滚动)
// ---------------------------------------------------------------------------

function VersionSwitcher({
  versions,
  currentId,
  activeApprovedId,
  clientId,
}: {
  versions: PrescriptionVersionItem[]
  currentId: string | null
  activeApprovedId: string | null
  clientId: string
}) {
  if (versions.length === 0) return null

  // 按 version DESC 排
  const sorted = [...versions].sort((a, b) => b.version - a.version)

  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-3.5">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div>
          <p className="text-xs font-semibold text-indigo-900 uppercase tracking-wide">
            处方版本历史
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            DAPE: 同一 Goal 下处方可以滚动迭代 v1 → v2 → v3
          </p>
        </div>
        {activeApprovedId && (
          <span className="text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
            当前生效: v{sorted.find(v => v.id === activeApprovedId)?.version ?? '?'}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {sorted.map(v => {
          const isCurrent = v.id === currentId
          const isActive = v.id === activeApprovedId
          const statusCls =
            v.status === 'approved' && isActive ? 'bg-green-600 text-white' :
            v.status === 'approved'             ? 'bg-green-100 text-green-700' :
            v.status === 'draft'                ? 'bg-amber-100 text-amber-800' :
            v.status === 'superseded'           ? 'bg-gray-200 text-gray-500' :
            v.status === 'rejected'             ? 'bg-red-100 text-red-700' :
                                                   'bg-gray-100 text-gray-600'
          const ringCls = isCurrent ? 'ring-2 ring-indigo-500 ring-offset-1' : ''
          const statusLabel =
            v.status === 'approved' && isActive ? '✓ 当前' :
            v.status === 'approved'             ? '✓ 已批' :
            v.status === 'draft'                ? '草稿' :
            v.status === 'superseded'           ? '已归档' :
            v.status === 'rejected'             ? '已拒' :
                                                   v.status
          return (
            <Link
              key={v.id}
              href={`/dashboard/clients/${clientId}/prescription/new?prescription_id=${v.id}`}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all ${statusCls} ${ringCls} hover:opacity-90`}
              title={`v${v.version} · ${v.status} · ${new Date(v.created_at).toLocaleDateString()}`}
            >
              <span className="font-bold tabular-nums">v{v.version}</span>
              <span className="opacity-75">·</span>
              <span>{statusLabel}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Discovery Context Card (shown above the form when Zhangqian data exists)
// ---------------------------------------------------------------------------

function DiscoveryContextCard({ discovery }: { discovery: ClientDiscoveryRow }) {
  const diag = discovery.payload?.diagnosis
  const scores = diag?.scores
  const crisisType = diag?.crisis_type ?? null
  const crisisCls = crisisType ? CRISIS_COLOR[crisisType] : null

  return (
    <div className="mb-5 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">诊断依据 — 张骞发现</p>
          <p className="text-sm text-gray-700 font-medium">{discovery.payload?.business?.name ?? discovery.domain}</p>
          {diag?.key_finding && (
            <p className="text-xs text-gray-500 mt-0.5">{diag.key_finding}</p>
          )}
        </div>
        {crisisType && crisisCls && (
          <span className={`shrink-0 text-xs font-semibold border rounded-full px-2.5 py-1 ${crisisCls}`}>
            {crisisType.split(' ')[1] ?? crisisType}
          </span>
        )}
      </div>
      {scores && (
        <div className="flex flex-wrap gap-1.5">
          <ScoreChip label="SEO" value={scores.seo} />
          <ScoreChip label="社媒" value={scores.social} />
          <ScoreChip label="口碑" value={scores.reputation} />
          <ScoreChip label="AI可见" value={scores.ai_visibility} />
          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold bg-gray-100 text-gray-700">
            综合 {scores.overall}
          </span>
        </div>
      )}
    </div>
  )
}
