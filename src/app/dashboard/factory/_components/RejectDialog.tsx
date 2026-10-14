'use client'

import { useEffect, useState } from 'react'
import type { ContentCheckItemKey } from '@/lib/social/content-review'
import {
  REJECT_REASON_KEYS,
  REJECT_REASON_LABEL,
  buildQualityRejectPayload,
  buildBudgetRejectPayload,
} from './rejectPayload'

// Reject dialog for the review inbox: either "quality" (pick reasons + note)
// or "budget" (set a new spend cap). Mirrors the confirming dialog in ReviewInbox.

interface RejectDialogProps {
  mode: 'quality' | 'budget'
  orderNo: string
  busy: boolean
  error: string | null
  onSubmit: (payload: Record<string, unknown>) => void
  onClose: () => void
  onModeChange?: (mode: 'quality' | 'budget') => void
}

function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null
  return <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 text-red-700 text-sm">{message}</div>
}

function QualityBody({
  selected,
  onToggle,
  freeText,
  onFreeText,
}: {
  selected: ContentCheckItemKey[]
  onToggle: (key: ContentCheckItemKey) => void
  freeText: string
  onFreeText: (value: string) => void
}) {
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        {REJECT_REASON_KEYS.map((key) => (
          <label
            key={key}
            className={`flex items-center gap-1.5 px-3 h-11 rounded-full border text-xs cursor-pointer focus-within:ring-2 focus-within:ring-slate-400 ${selected.includes(key) ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={selected.includes(key)}
              onChange={() => onToggle(key)}
            />
            {REJECT_REASON_LABEL[key] ?? key}
          </label>
        ))}
      </div>
      <textarea
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        rows={3}
        aria-label="补充说明"
        placeholder="补充说明(可不写,但最好说清哪一秒、哪里不对)"
        value={freeText}
        onChange={(e) => onFreeText(e.target.value)}
      />
      <p className="mt-2 text-xs text-slate-500">打回后这条作废,你的理由会交回工厂重做。不会发布任何东西。</p>
    </>
  )
}

function BudgetBody({ raw, onRaw }: { raw: string; onRaw: (value: string) => void }) {
  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm text-slate-500">$</span>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.5"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="新的投放预算(美元)"
          aria-label="新的投放预算(美元)"
          value={raw}
          onChange={(e) => onRaw(e.target.value)}
        />
      </div>
      <p className="text-xs text-slate-500">上限 $50。改的是这条的投放预算,片子仍留在待审里,不会发布。</p>
    </>
  )
}

export function RejectDialog({ mode, orderNo, busy, error, onSubmit, onClose, onModeChange }: RejectDialogProps) {
  const [selected, setSelected] = useState<ContentCheckItemKey[]>([])
  const [freeText, setFreeText] = useState('')
  const [budgetRaw, setBudgetRaw] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const toggle = (key: ContentCheckItemKey) =>
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))

  const submit = () => {
    setLocalError(null)
    const result = mode === 'quality'
      ? buildQualityRejectPayload(selected, freeText)
      : buildBudgetRejectPayload(budgetRaw)
    if (!result.ok) {
      setLocalError(result.error)
      return
    }
    onSubmit(result.payload)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const title = mode === 'quality' ? '打回 · 画面有问题' : '打回 · 预算不合适'
  const submitLabel = mode === 'quality' ? '确认打回' : '确认调整预算'

  return (
    <div className="fixed inset-0 z-40 bg-black/45 grid place-items-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reject-dialog-title"
        className="bg-white rounded-xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-4">
          <p id="reject-dialog-title" className="font-medium text-slate-900">{title}</p>
          <span className="text-xs text-slate-400 font-mono">{orderNo}</span>
        </div>

        {onModeChange && (
          <div className="mb-4 flex gap-2" role="tablist" aria-label="打回类型">
            {([['quality', '画面有问题'], ['budget', '只改预算(不打回)']] as const).map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => onModeChange(m)}
                className={`px-3 h-11 rounded-lg text-sm border ${mode === m ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200'}`}
              >{label}</button>
            ))}
          </div>
        )}

        {mode === 'quality' ? (
          <QualityBody selected={selected} onToggle={toggle} freeText={freeText} onFreeText={setFreeText} />
        ) : (
          <BudgetBody raw={budgetRaw} onRaw={setBudgetRaw} />
        )}

        <div className="mt-4">
          <ErrorBox message={localError ?? error} />
        </div>

        <div className="flex gap-3">
          <button
            onClick={submit}
            disabled={busy}
            className="flex-1 h-10 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
          >{busy ? '处理中…' : submitLabel}</button>
          <button onClick={onClose} className="px-5 h-10 rounded-lg border border-slate-200 text-sm">再想想</button>
        </div>
      </div>
    </div>
  )
}
