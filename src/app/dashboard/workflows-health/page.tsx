'use client'

/**
 * 工作流健康度总览 —— ops 内部看板。
 *
 * 存在理由（2026-09-23 事故）：`ad_health_narratives` 断更 3 天没人察觉，
 * 因为——
 *   · `daily-cron-digest` 邮件只报"最近 24 小时 status='failed'"
 *   · ads-health 看板只服务单客户，看不到"背后管子在不在"
 *   · 没有一个"工作流本身"的总览
 * 这个页面把 registry 里全部登记的任务 + 它们的下游产出对账一屏摆出来。
 *
 * 只读 /api/workflows-health，服务端 60s 缓存。判断和写全在 checkCronHealth 里。
 */

import React, { useEffect, useState } from 'react'
import Link from 'next/link'

// ─── 类型（跟 /api/workflows-health 契约对齐） ─────────────────────────────

interface JobHealthEntry {
  service: string
  state: 'blind' | 'never_ran' | 'overdue' | 'unknown_schedule'
  detail?: string
  hoursSince?: number
}

interface SilentSuccessEntry {
  service: string
  jobName: string
  table: string
  lastRowAt: string | null
  hoursSince: number | null
  freshnessHours: number
  detail: string
}

interface HealthReport {
  checkedAt: string
  total: number
  blind: JobHealthEntry[]
  neverRan: JobHealthEntry[]
  overdue: JobHealthEntry[]
  unknown: JobHealthEntry[]
  failing: { service: string; lastError: string | null }[]
  stuck: { service: string; startedAt: string; minutesRunning: number }[]
  silentSuccess: SilentSuccessEntry[]
}

interface ApiResponse {
  success: boolean
  report?: HealthReport
  summary?: string
  error?: string
}

// ─── 颜色（照 ads-health 的 VERDICT_META 结构 · 板桥 "颜色即结论"） ───────

type Tone = 'alert' | 'watch' | 'healthy'

const TONE_META: Record<Tone, { dot: string; tint: string; text: string; label: string }> = {
  alert:   { label: '该动手了', dot: 'bg-red-500',    tint: 'bg-red-50 border-red-200',       text: 'text-red-700' },
  watch:   { label: '留意',     dot: 'bg-amber-500',  tint: 'bg-amber-50 border-amber-200',   text: 'text-amber-700' },
  healthy: { label: '健康',     dot: 'bg-emerald-500', tint: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700' },
}

/**
 * 每一类问题的口径。alert = 明确有事、必须看；watch = 观测缺口，别慌但要补。
 *
 * `silentSuccess` 定 alert，不定 watch —— 2026-09-23 事故就是把"跑成了但没写"
 * 当成"跑成了"放过去，红灯是这件事本身要说的话。
 */
const PROBLEM_KINDS: Array<{
  key: keyof Pick<HealthReport, 'silentSuccess' | 'overdue' | 'failing' | 'stuck' | 'neverRan' | 'blind' | 'unknown'>
  label: string
  tone: Tone
  hint: string
}> = [
  { key: 'silentSuccess', label: '跑成了但没写出东西', tone: 'alert', hint: '任务状态显示成功，但它声明的下游表没新行 — 多半是上游数据源断了' },
  { key: 'overdue',       label: '该跑没跑',           tone: 'alert', hint: '按调度早该跑一次了，超过宽限期没动静' },
  { key: 'failing',       label: '在报错',             tone: 'alert', hint: '最近一次跑就是 failed 状态' },
  { key: 'stuck',         label: '跑到一半卡死',       tone: 'alert', hint: '状态还挂着 running、超过一小时没写结束时间 — 容器被杀那种' },
  { key: 'neverRan',      label: '从来没跑过',         tone: 'alert', hint: '按顺序查：Render 服务在不在 → 运行历史 → 代码 startCronRun' },
  { key: 'blind',         label: '查不出跑没跑',       tone: 'watch', hint: '接口代码没写运行记录 — 需要给它接上 startCronRun' },
  { key: 'unknown',       label: '调度看不懂',         tone: 'watch', hint: 'schedule 表达式 parser 不认识，人工看一眼' },
]

function overallTone(report: HealthReport): Tone {
  const alerts = report.silentSuccess.length + report.overdue.length + report.failing.length
                + report.stuck.length + report.neverRan.length
  if (alerts > 0) return 'alert'
  const watches = report.blind.length + report.unknown.length
  if (watches > 0) return 'watch'
  return 'healthy'
}

// ─── 小卡片：每条问题一行 ────────────────────────────────────────────────

function ProblemRow({ title, subtitle, detail }: { title: string; subtitle?: string; detail: string }) {
  return (
    <div className="border-b border-gray-100 py-2.5 last:border-0">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-sm text-gray-800">{title}</span>
        {subtitle && <span className="text-xs text-gray-400">{subtitle}</span>}
      </div>
      <p className="mt-0.5 text-xs text-gray-600 leading-relaxed">{detail}</p>
    </div>
  )
}

// ─── 主页 ────────────────────────────────────────────────────────────────

export default function WorkflowsHealthPage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/workflows-health')
      .then(r => r.json())
      .then((json: ApiResponse) => {
        if (!alive) return
        if (!json.success) setError(json.error ?? '加载失败')
        else setData(json)
      })
      .catch(() => alive && setError('加载失败'))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [])

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <Link href="/dashboard" className="text-sm text-gray-400 hover:text-gray-600">
          ← 返回
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-gray-800">工作流健康度</h1>
        <p className="text-sm text-gray-400">
          全部定时任务 + Inngest 工作流的自检报告 · 每 60 秒刷一次 · 只读不动
        </p>
      </div>

      {loading && <div className="text-gray-400 text-sm py-12 text-center">加载中…</div>}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          加载出错：{error}
        </div>
      )}

      {!loading && !error && data?.report && (
        <ReportView report={data.report} summary={data.summary ?? ''} />
      )}
    </div>
  )
}

function ReportView({ report, summary }: { report: HealthReport; summary: string }) {
  const tone = overallTone(report)
  const meta = TONE_META[tone]
  const checkedAt = new Date(report.checkedAt).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })

  return (
    <>
      {/* 一句话结论 —— 板桥优先：颜色本身是结论 */}
      <div className={`rounded-xl border p-5 mb-6 ${meta.tint}`}>
        <div className="flex items-center gap-2.5">
          <span className={`inline-block w-3 h-3 rounded-full ${meta.dot}`} />
          <span className={`text-lg font-semibold ${meta.text}`}>{summary}</span>
        </div>
        <p className="mt-1.5 text-xs text-gray-400">检查时间 {checkedAt}</p>
      </div>

      {/* 分组展示：每种病态一个卡 */}
      <div className="space-y-4">
        {PROBLEM_KINDS.map(({ key, label, tone, hint }) => {
          const items = report[key] as unknown[]
          if (items.length === 0) return null
          const kindMeta = TONE_META[tone]
          return (
            <div key={key} className={`rounded-xl border p-4 ${kindMeta.tint}`}>
              <div className="flex items-baseline gap-2 mb-2">
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${kindMeta.dot}`} />
                <h2 className={`font-semibold ${kindMeta.text}`}>{label}</h2>
                <span className="text-sm text-gray-400 tabular-nums">{items.length}</span>
              </div>
              <p className="text-xs text-gray-500 mb-3">{hint}</p>

              <div className="bg-white rounded-lg px-3">
                {key === 'silentSuccess' && (report.silentSuccess).map((s, i) => (
                  <ProblemRow
                    key={`${s.service}-${s.table}-${i}`}
                    title={s.service}
                    subtitle={`→ ${s.table} · 阈值 ${s.freshnessHours}h`}
                    detail={s.detail}
                  />
                ))}
                {key === 'failing' && (report.failing).map((f, i) => (
                  <ProblemRow
                    key={`${f.service}-${i}`}
                    title={f.service}
                    detail={f.lastError ?? '最近一次跑 status=failed，但没记 error_message'}
                  />
                ))}
                {key === 'stuck' && (report.stuck).map((s, i) => (
                  <ProblemRow
                    key={`${s.service}-${i}`}
                    title={s.service}
                    subtitle={`已运行 ${s.minutesRunning} 分钟`}
                    detail={`最近一次挂着 running 状态没写结束时间，从 ${new Date(s.startedAt).toLocaleString('zh-CN')} 起。多半是容器被杀导致 catch 没执行到`}
                  />
                ))}
                {(key === 'overdue' || key === 'neverRan' || key === 'blind' || key === 'unknown') &&
                  (report[key] as JobHealthEntry[]).map((h, i) => (
                    <ProblemRow
                      key={`${h.service}-${i}`}
                      title={h.service}
                      subtitle={h.hoursSince ? `已 ${h.hoursSince.toFixed(1)}h 没动静` : undefined}
                      detail={h.detail ?? ''}
                    />
                  ))}
              </div>
            </div>
          )
        })}

        {tone === 'healthy' && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-8 text-center">
            <p className="text-sm text-emerald-700">{report.total} 个自动任务全部正常</p>
            <p className="text-xs text-emerald-600 mt-1">没有该报的问题</p>
          </div>
        )}
      </div>

      <p className="mt-8 text-xs text-gray-300 text-center">
        数据来源 cron_run_logs + 各下游表 max(updated_at) · 只查本仓 Supabase，不打外部 API
      </p>
    </>
  )
}
