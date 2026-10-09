'use client'

/**
 * 上传班期表 —— 把 CSV 里的班期导进系统。
 *
 * 流程:选文件 → 预览 → (处理提醒 / 记住叫法) → 确认导入。
 * 预览不会写库;只有点「确认导入」才真正落库。
 */

import { useState } from 'react'
import type {
  CatalogTourView,
  PreviewResponse,
  PreviewRejectedView,
  PreviewWarningView,
} from './types'

/** 拒绝原因的中文说法。未知的码原样显示。 */
const REASON_LABELS: Record<string, string> = {
  tour_not_found: '系统里找不到这个团',
  tour_ambiguous: '同时对上了多个团（例如高端款和普通款）',
  missing_tour_name: '缺团名',
  invalid_depart_date: '出团日期不对',
  missing_return_date: '缺返程日期',
  invalid_return_date: '返程日期不对',
  return_before_depart: '返程早于出团',
  invalid_status: '状态不对',
  formula_injection: '单元格以危险字符开头',
  invalid_capacity: '人数不对',
  conflicting_duplicate_rows: '同一天出现了互相矛盾的重复行',
}

/** 接口错误码的中文说法。未知的码原样显示。 */
const ERROR_LABELS: Record<string, string> = {
  duplicate_file: '这份文件已经导入过了',
  conflict: '导入时发现数据已被别人改过，整批没有写入，请重新预览',
  not_applicable: '这次导入现在不能再应用',
  warnings_not_acknowledged: '请先勾选「我已看过以上提醒」',
  preview_failed: '预览失败，请稍后重试',
  apply_failed: '导入失败，请稍后重试',
  plan_changed: '预览内容已经更新，请重新点一次预览再确认',
  request_too_large: '文件太大，不能超过 2MB',
  csv_required: '请先选择文件',
  alias_failed: '记住失败，请稍后重试',
  alias_taken: '这个叫法已经指向别的团',
}

function reasonLabel(code: string): string {
  return REASON_LABELS[code] ?? code
}

function errorLabel(code: string): string {
  return ERROR_LABELS[code] ?? code
}

type Phase =
  | { phase: 'idle' }
  | { phase: 'previewing' }
  | { phase: 'ready'; preview: PreviewResponse }
  | { phase: 'error'; message: string }

export function ImportPanel({
  clientId,
  tours,
  onChanged,
}: {
  clientId: string
  tours: CatalogTourView[]
  onChanged: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [state, setState] = useState<Phase>({ phase: 'idle' })
  const [ackWarnings, setAckWarnings] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState(false)

  // Clear the preview/result area but keep the「已导入」message visible.
  const clearPreview = () => {
    setState({ phase: 'idle' })
    setAckWarnings(false)
  }

  const handleFileChange = (next: File | null) => {
    setFile(next)
    setApplied(false)
    clearPreview()
  }

  const handlePreview = async () => {
    if (!file) return
    setApplied(false)
    setState({ phase: 'previewing' })
    try {
      const csv = await file.text()
      const res = await fetch(`/api/clients/${clientId}/tour-catalog/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv }),
      })
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(errorLabel(error ?? `HTTP ${res.status}`))
      }
      const preview = (await res.json()) as PreviewResponse
      setAckWarnings(false)
      setState({ phase: 'ready', preview })
    } catch (err) {
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const handleApply = async () => {
    if (state.phase !== 'ready') return
    const { batchId, planHash } = state.preview
    if (!batchId) return
    setApplying(true)
    try {
      const res = await fetch(
        `/api/clients/${clientId}/tour-catalog/batches/${batchId}/apply`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ acknowledgeWarnings: ackWarnings, planHash }),
        },
      )
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(errorLabel(error ?? `HTTP ${res.status}`))
      }
      setApplied(true)
      onChanged()
      clearPreview()
    } catch (err) {
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="space-y-5 rounded-xl border border-black/10 bg-white p-5 shadow-sm">
      <div>
        <h2 className="font-display font-black text-me-charcoal">上传班期表</h2>
        <p className="mt-1 text-sm font-semibold text-me-charcoal/55">
          选一份 CSV 文件，先预览看看会改什么，确认没问题再导入。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".csv"
          onChange={e => handleFileChange(e.target.files?.[0] ?? null)}
          className="text-sm font-semibold text-me-charcoal/70"
        />
        <button
          onClick={handlePreview}
          disabled={!file || state.phase === 'previewing'}
          className="rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white hover:bg-me-charcoal/85 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {state.phase === 'previewing' ? '正在预览…' : '预览'}
        </button>
      </div>

      {applied && (
        <p className="text-sm font-black text-[#5C8A4A]">已导入</p>
      )}

      {state.phase === 'error' && (
        <div className="rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/8 p-4">
          <p className="text-sm font-black text-[#C2453A]">出错了</p>
          <p className="mt-1 text-sm font-semibold text-me-charcoal/70">{state.message}</p>
        </div>
      )}

      {state.phase === 'ready' && (
        <PreviewBody
          clientId={clientId}
          tours={tours}
          preview={state.preview}
          ackWarnings={ackWarnings}
          onAckChange={setAckWarnings}
          applying={applying}
          onApply={handleApply}
        />
      )}
    </div>
  )
}

function PreviewBody({
  clientId,
  tours,
  preview,
  ackWarnings,
  onAckChange,
  applying,
  onApply,
}: {
  clientId: string
  tours: CatalogTourView[]
  preview: PreviewResponse
  ackWarnings: boolean
  onAckChange: (v: boolean) => void
  applying: boolean
  onApply: () => void
}) {
  const { summary, adds, updates, rejected, warnings, batchId } = preview
  const canApply =
    batchId !== null && (warnings.length === 0 || ackWarnings) && !applying

  return (
    <div className="space-y-5">
      <SummaryChips summary={summary} />

      {rejected.length > 0 && (
        <RejectedTable clientId={clientId} tours={tours} rejected={rejected} />
      )}

      {warnings.length > 0 && (
        <WarningsBox warnings={warnings} ackWarnings={ackWarnings} onAckChange={onAckChange} />
      )}

      {adds.length > 0 && <AddsTable tours={tours} adds={adds} />}
      {updates.length > 0 && <UpdatesTable tours={tours} updates={updates} />}

      {batchId === null ? (
        <p className="text-sm font-semibold text-me-charcoal/55">
          这份文件里没有可以导入的新内容
        </p>
      ) : (
        <div className="flex justify-end">
          <button
            onClick={onApply}
            disabled={!canApply}
            className="rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white hover:bg-me-charcoal/85 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {applying ? '正在导入…' : '确认导入'}
          </button>
        </div>
      )}
    </div>
  )
}

function SummaryChips({ summary }: { summary: PreviewResponse['summary'] }) {
  const chips: Array<{ label: string; value: number }> = [
    { label: '新增', value: summary.adds },
    { label: '更新', value: summary.updates },
    { label: '没变化', value: summary.unchanged },
    { label: '被拒绝', value: summary.rejected },
    { label: '需要留意', value: summary.warningCount },
  ]
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map(c => (
        <span
          key={c.label}
          className="rounded-full border border-black/10 bg-me-ivory px-3 py-1 text-xs font-black text-me-charcoal/70"
        >
          {c.label} {c.value} 个
        </span>
      ))}
    </div>
  )
}

/** Resolve a tour id to its display name, falling back to the id. */
function tourName(tours: CatalogTourView[], tourId: string): string {
  return tours.find(t => t.id === tourId)?.name ?? tourId
}

function RejectedTable({
  clientId,
  tours,
  rejected,
}: {
  clientId: string
  tours: CatalogTourView[]
  rejected: PreviewRejectedView[]
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-black/10">
      <table className="w-full text-sm">
        <thead className="border-b border-black/10 bg-me-ivory text-left text-[10px] font-black uppercase tracking-[.12em] text-me-charcoal/45">
          <tr>
            <th className="px-4 py-3">行号</th>
            <th className="px-4 py-3">团名</th>
            <th className="px-4 py-3">原因</th>
          </tr>
        </thead>
        <tbody>
          {rejected.map((r, i) => (
            <tr key={i} className="border-b border-black/5 last:border-0">
              <td className="px-4 py-3 font-semibold text-me-charcoal/70">{r.line}</td>
              <td className="px-4 py-3 font-semibold text-me-charcoal/70">
                {r.tourName ?? r.detail ?? '—'}
              </td>
              <td className="px-4 py-3">
                <span className="font-semibold text-[#C2453A]">{reasonLabel(r.reason)}</span>
                {(r.reason === 'tour_not_found' || r.reason === 'tour_ambiguous') &&
                  r.tourName && (
                    <AliasForm clientId={clientId} tours={tours} tourName={r.tourName} />
                  )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AliasForm({
  clientId,
  tours,
  tourName,
}: {
  clientId: string
  tours: CatalogTourView[]
  tourName: string
}) {
  const [tourId, setTourId] = useState(tours[0]?.id ?? '')
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!tourId) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/tour-catalog/aliases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias: tourName, tourId }),
      })
      if (res.status === 409) {
        setMessage(errorLabel('alias_taken'))
        return
      }
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(errorLabel(error ?? `HTTP ${res.status}`))
      }
      setMessage('已记住，请再点一次预览')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <select
        value={tourId}
        onChange={e => setTourId(e.target.value)}
        className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs font-semibold text-me-charcoal"
      >
        {tours.map(t => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <button
        onClick={handleSave}
        disabled={saving || !tourId}
        className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs font-black text-me-charcoal/70 hover:bg-me-ivory disabled:opacity-40"
      >
        记住这个叫法
      </button>
      {message && <span className="text-xs font-semibold text-me-charcoal/60">{message}</span>}
    </div>
  )
}

function WarningsBox({
  warnings,
  ackWarnings,
  onAckChange,
}: {
  warnings: PreviewWarningView[]
  ackWarnings: boolean
  onAckChange: (v: boolean) => void
}) {
  return (
    <div className="rounded-xl border border-me-ochre/30 bg-me-ochre/10 p-4">
      <p className="font-black text-me-ochre">请先看一眼这些提醒</p>
      <ul className="mt-2 space-y-1 text-sm font-semibold text-me-charcoal/70">
        {warnings.map((w, i) => (
          <li key={i}>{warningText(w)}</li>
        ))}
      </ul>
      <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-me-charcoal/70">
        <input
          type="checkbox"
          checked={ackWarnings}
          onChange={e => onAckChange(e.target.checked)}
        />
        我已看过以上提醒，其余班期保持不变
      </label>
    </div>
  )
}

function warningText(w: PreviewWarningView): string {
  if (w.kind === 'suspected_typo') {
    return `新增的 ${w.newDate} 离已有的 ${w.nearDate} 只差 ${w.days} 天，是不是日期写错了？`
  }
  return `库里还有 ${w.departOn} 这个班期，但文件里没提到它`
}

function AddsTable({
  tours,
  adds,
}: {
  tours: CatalogTourView[]
  adds: PreviewResponse['adds']
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-black/10">
      <table className="w-full text-sm">
        <thead className="border-b border-black/10 bg-me-ivory text-left text-[10px] font-black uppercase tracking-[.12em] text-me-charcoal/45">
          <tr>
            <th className="px-4 py-3">新增班期</th>
            <th className="px-4 py-3">出团日</th>
            <th className="px-4 py-3">返程日</th>
            <th className="px-4 py-3">状态</th>
          </tr>
        </thead>
        <tbody>
          {adds.map((a, i) => (
            <tr key={i} className="border-b border-black/5 last:border-0">
              <td className="px-4 py-3 font-semibold text-me-charcoal/70">
                {tourName(tours, a.tourId)}
              </td>
              <td className="px-4 py-3 font-semibold text-me-charcoal/70">{a.departOn}</td>
              <td className="px-4 py-3 font-semibold text-me-charcoal/70">{a.returnOn}</td>
              <td className="px-4 py-3 font-semibold text-me-charcoal/70">{a.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function UpdatesTable({
  tours,
  updates,
}: {
  tours: CatalogTourView[]
  updates: PreviewResponse['updates']
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-black/10">
      <table className="w-full text-sm">
        <thead className="border-b border-black/10 bg-me-ivory text-left text-[10px] font-black uppercase tracking-[.12em] text-me-charcoal/45">
          <tr>
            <th className="px-4 py-3">更新班期</th>
            <th className="px-4 py-3">出团日</th>
            <th className="px-4 py-3">返程日</th>
            <th className="px-4 py-3">状态</th>
          </tr>
        </thead>
        <tbody>
          {updates.map((u, i) => (
            <tr key={i} className="border-b border-black/5 last:border-0">
              <td className="px-4 py-3 font-semibold text-me-charcoal/70">
                {tourName(tours, u.tourId)}
              </td>
              <td className="px-4 py-3 font-semibold text-me-charcoal/70">{u.departOn}</td>
              <td className="px-4 py-3 font-semibold text-me-charcoal/70">
                {u.before.returnOn ?? '—'} → {u.after.returnOn}
              </td>
              <td className="px-4 py-3 font-semibold text-me-charcoal/70">
                {u.before.status} → {u.after.status}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
