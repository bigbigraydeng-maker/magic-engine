'use client'

import { useCallback, useEffect, useState } from 'react'

type WinnerState = 'needs_check' | 'needs_confirm' | 'confirmed' | 'unusable'
type ProgramCheckState = 'passed' | 'needs_human' | 'failed'
type Decision = 'approved' | 'rejected'
type Role = 'magic_lab' | 'client_staff'

interface Performance {
  spend: number | null
  results: number | null
  cost_per_result: number | null
  ctr_pct: number | null
  period: string | null
}

interface ProgramCheck {
  state: ProgramCheckState
  at: string
  reason: string | null
}

interface DecisionRecord {
  decision: Decision
  by: string
  role: Role
  at: string
}

interface WinnerItem {
  id: string
  state: WinnerState
  reason: string | null
  hook: string
  middle: string
  cta: string
  tags: string[]
  performance: Performance
  frames: string[]
  program_check: ProgramCheck | null
  decision: DecisionRecord | null
}

interface WinnersResponse {
  winners: WinnerItem[]
  pm_only: boolean
  pm_only_unsynced: boolean
  viewer_role: Role
}

const REASON_LABELS: Record<string, string> = {
  not_active: '已退役',
  performance_unreadable: '数据读不出',
  program_check_not_passed: '程序复核没通过，现在不能用',
  confirmer_not_authorized: '之前点认的人现在没有权限（或这个客户已改成只认 PM），请 PM 重新认',
  result_type_unknown: '不知道这条按什么结果算，没法比',
  pm_decision_rejected: '已被点了不认',
  receipt_invalid: '确认记录对不上，请 PM 重新认',
  cost_per_result_missing: '缺每个结果的成本，没法排序',
}

const STATE_BADGES: Record<WinnerState, { label: string; className: string }> = {
  needs_check: { label: '待复核', className: 'bg-slate-100 text-slate-700' },
  needs_confirm: { label: '等你认', className: 'bg-amber-100 text-amber-800' },
  confirmed: { label: '已认', className: 'bg-emerald-100 text-emerald-800' },
  unusable: { label: '不可用', className: 'bg-red-100 text-red-700' },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function isWinnerState(value: unknown): value is WinnerState {
  return value === 'needs_check' || value === 'needs_confirm' || value === 'confirmed' || value === 'unusable'
}

function isProgramCheckState(value: unknown): value is ProgramCheckState {
  return value === 'passed' || value === 'needs_human' || value === 'failed'
}

function isDecision(value: unknown): value is Decision {
  return value === 'approved' || value === 'rejected'
}

function isRole(value: unknown): value is Role {
  return value === 'magic_lab' || value === 'client_staff'
}

function parsePerformance(value: unknown): Performance {
  if (!isRecord(value)) {
    return { spend: null, results: null, cost_per_result: null, ctr_pct: null, period: null }
  }
  return {
    spend: readNumber(value.spend),
    results: readNumber(value.results),
    cost_per_result: readNumber(value.cost_per_result),
    ctr_pct: readNumber(value.ctr_pct),
    period: readString(value.period),
  }
}

function parseProgramCheck(value: unknown): ProgramCheck | null {
  if (!isRecord(value) || !isProgramCheckState(value.state)) return null
  return {
    state: value.state,
    at: readString(value.at) ?? '',
    reason: readString(value.reason),
  }
}

function parseDecision(value: unknown): DecisionRecord | null {
  if (!isRecord(value) || !isDecision(value.decision) || !isRole(value.role)) return null
  return {
    decision: value.decision,
    by: readString(value.by) ?? '',
    role: value.role,
    at: readString(value.at) ?? '',
  }
}

function parseWinner(value: unknown): WinnerItem | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !isWinnerState(value.state)) return null
  return {
    id: value.id,
    state: value.state,
    reason: readString(value.reason),
    hook: readString(value.hook) ?? '',
    middle: readString(value.middle) ?? '',
    cta: readString(value.cta) ?? '',
    tags: readStringArray(value.tags),
    performance: parsePerformance(value.performance),
    frames: readStringArray(value.frames),
    program_check: parseProgramCheck(value.program_check),
    decision: parseDecision(value.decision),
  }
}

function parseWinners(json: unknown): WinnersResponse | null {
  if (!isRecord(json) || !Array.isArray(json.winners)) return null
  const winners = json.winners
    .map(parseWinner)
    .filter((item): item is WinnerItem => item !== null)
  return {
    winners,
    pm_only: json.pm_only === true,
    pm_only_unsynced: json.pm_only_unsynced === true,
    viewer_role: isRole(json.viewer_role) ? json.viewer_role : 'client_staff',
  }
}

function readError(json: unknown, fallback: string): string {
  if (isRecord(json) && typeof json.error === 'string') return json.error
  return fallback
}

function formatMoney(value: number | null): string {
  return value === null ? '—' : value.toFixed(2)
}

function formatResults(value: number | null): string {
  return value === null ? '—' : String(Math.round(value))
}

function formatPct(value: number | null): string {
  return value === null ? '—' : value.toFixed(2)
}

const CHECK_REASON_LABELS: Record<string, string> = {
  source_video_unavailable: '拿不到原视频',
}

/** 复核原因写成人话；没登记的原样显示 */
function checkReasonLabel(reason: string | null): string {
  if (!reason) return '原因没记下'
  return CHECK_REASON_LABELS[reason] ?? reason
}

function reasonLabel(reason: string | null): string {
  if (!reason) return '不可用'
  return REASON_LABELS[reason] ?? reason
}

function StatusBadge({ winner }: { winner: WinnerItem }) {
  const badge = STATE_BADGES[winner.state]
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>{badge.label}</span>
      {winner.state === 'confirmed' && winner.decision && (
        <span className="text-xs text-slate-500">
          · {winner.decision.role === 'client_staff' ? '员工确认' : 'Magic Lab 确认'} · {winner.decision.by}
        </span>
      )}
      {winner.state === 'unusable' && (
        <span className="text-xs text-red-700">{reasonLabel(winner.reason)}</span>
      )}
      {winner.state === 'needs_confirm' && winner.reason !== 'pm_decision_missing' && (
        <span className="text-xs text-amber-800">{reasonLabel(winner.reason)}</span>
      )}
    </div>
  )
}

function FramesRow({ frames }: { frames: string[] }) {
  if (frames.length === 0) {
    return <p className="text-xs text-slate-500">截图还没传上来</p>
  }
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {frames.map((src, index) => (
        <img
          key={`${src}-${index}`}
          src={src}
          alt={`第 ${index + 1} 张截图`}
          loading="lazy"
          className="h-40 w-auto rounded border border-slate-200"
        />
      ))}
    </div>
  )
}

function PerformanceLine({ performance }: { performance: Performance }) {
  return (
    <p className="text-xs text-slate-500">
      期间 {performance.period ?? '未记录'} · 花费 NZ${formatMoney(performance.spend)} · 结果{' '}
      {formatResults(performance.results)} 个 · 每个 NZ${formatMoney(performance.cost_per_result)} · 点击率{' '}
      {formatPct(performance.ctr_pct)}%
    </p>
  )
}

function TextBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="whitespace-pre-wrap text-sm text-slate-800">{text || '（空）'}</p>
    </div>
  )
}

interface DecisionButtonsProps {
  submitting: boolean
  onDecide: (decision: Decision) => void
}

function DecisionButtons({ submitting, onDecide }: DecisionButtonsProps) {
  const approveDisabled = submitting
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onDecide('approved')}
          disabled={approveDisabled}
          className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
        >
          认
        </button>
        <button
          onClick={() => onDecide('rejected')}
          disabled={submitting}
          className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          不认
        </button>
      </div>
      <p className="text-xs text-slate-500">不发布、不花钱；只决定工厂以后照不照它做。</p>
    </div>
  )
}

interface WinnerCardProps {
  winner: WinnerItem
  onDecided: (message: string, pmOnlyFailed: boolean) => void
}

function WinnerCard({ winner, onDecided }: WinnerCardProps) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const showButtons = winner.state === 'needs_confirm' || winner.state === 'confirmed'

  const decide = async (decision: Decision) => {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/factory/winners/${encodeURIComponent(winner.id)}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      })
      const json: unknown = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(readError(json, `提交失败 (${res.status})`))
      const receipt = isRecord(json) && isRecord(json.receipt) ? json.receipt : null
      const by = receipt ? readString(receipt.by) : null
      onDecided(`已记下：${decision === 'approved' ? '认' : '不认'}，记录人 ${by ?? '（未知）'}`, receipt?.pm_only_failed === true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <article className="space-y-3 rounded-lg border border-slate-200 p-3">
      <StatusBadge winner={winner} />

      {winner.program_check && winner.program_check.state !== 'passed' && (
        <p className="text-xs text-amber-800">
          复核没完成：{checkReasonLabel(winner.program_check.reason)}，这条现在不能用
        </p>
      )}

      <FramesRow frames={winner.frames} />

      <div className="space-y-2">
        <TextBlock label="开头" text={winner.hook} />
        <TextBlock label="中间" text={winner.middle} />
        <TextBlock label="结尾" text={winner.cta} />
      </div>

      <PerformanceLine performance={winner.performance} />

      {winner.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {winner.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              {tag}
            </span>
          ))}
        </div>
      )}

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {showButtons && (
        <DecisionButtons submitting={submitting} onDecide={(decision) => void decide(decision)} />
      )}
    </article>
  )
}

export function CurrentWinnerPanel({ clientId }: { clientId: string | null }) {
  const [data, setData] = useState<WinnersResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pmOnlyFailed, setPmOnlyFailed] = useState(false)

  const load = useCallback(async () => {
    if (!clientId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/factory/winners?client=${encodeURIComponent(clientId)}`)
      const json: unknown = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(readError(json, `加载失败 (${res.status})`))
      const parsed = parseWinners(json)
      if (!parsed) throw new Error('加载失败：返回格式异常')
      setData(parsed)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    void load()
  }, [load])

  if (!clientId) return null

  const onDecided = (message: string, failed: boolean) => {
    setSuccess(message)
    if (failed) setPmOnlyFailed(true)
    void load()
  }
  const showUnsynced = pmOnlyFailed || data?.pm_only_unsynced === true

  return (
    <section id="current-winner">
      <h2 className="text-base font-semibold text-slate-800">当前广告样板（赢家）</h2>
      <p className="mt-1 text-xs text-slate-500">
        认了以后，视频工厂给这个客户做新广告片时会照它的样子做。没人认之前，工厂一律不用它。
      </p>

      {data?.pm_only && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          这个客户目前只有 Magic Lab 内部账号能点「认」。
        </p>
      )}

      {showUnsynced && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          「只认 PM」没有写进客户设置（这条赢家本身已按只认 PM 处理），请联系开发
        </p>
      )}

      {success && (
        <p className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{success}</p>
      )}
      {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {loading && <p className="mt-2 text-sm text-slate-500">加载中…</p>}

      {!loading && data && data.winners.length === 0 && !error && (
        <p className="mt-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
          这个客户还没有记录在案的广告样板。
        </p>
      )}

      {data && data.winners.length > 0 && (
        <div className="mt-3 space-y-3">
          {data.winners.map((winner) => (
            <WinnerCard key={winner.id} winner={winner} onDecided={onDecided} />
          ))}
        </div>
      )}
    </section>
  )
}
