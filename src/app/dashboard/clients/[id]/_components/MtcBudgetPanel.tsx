'use client'

import { useState, useEffect, useCallback } from 'react'
import { DEFAULT_MONTHLY_MTC_CAP } from '@/lib/mtc/types'

interface SpendData {
  spend: number
  cap: number
  remaining: number
  pct: number
}

export function MtcBudgetPanel({ clientId }: { clientId: string }) {
  const [data, setData] = useState<SpendData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Inline edit state
  const [editCap, setEditCap] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState(false)

  const fetchSpend = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/mtc/monthly-spend`)
      if (!res.ok) throw new Error('加载失败')
      const json = (await res.json()) as SpendData
      setData(json)
      setEditCap(String(json.cap))
    } catch (e) {
      setError(e instanceof Error ? e.message : '未知错误')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { fetchSpend() }, [fetchSpend])

  async function handleSave() {
    const newCap = parseInt(editCap, 10)
    if (isNaN(newCap) || newCap <= 0) {
      setSaveError('请输入有效的正整数')
      return
    }
    setSaving(true)
    setSaveError(null)
    setSaveOk(false)
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthly_mtc_cap: newCap }),
      })
      if (!res.ok) {
        const json = await res.json() as { error?: string }
        throw new Error(json.error ?? '保存失败')
      }
      setSaveOk(true)
      // Refresh spend data to reflect new cap
      await fetchSpend()
      setTimeout(() => setSaveOk(false), 2000)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    setEditCap(String(DEFAULT_MONTHLY_MTC_CAP))
    setSaveOk(false)
    setSaveError(null)
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-cyan-800">AI 工厂月度预算</p>
        <p className="mt-3 text-sm text-slate-400">加载中…</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-100 bg-red-50 p-5 shadow-sm">
        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-red-700">AI 工厂月度预算</p>
        <p className="mt-2 text-sm text-red-600">{error ?? '数据加载失败'}</p>
      </div>
    )
  }

  const barColor =
    data.pct >= 100
      ? 'bg-red-500'
      : data.pct >= 80
      ? 'bg-amber-400'
      : 'bg-cyan-500'

  const pctClamped = Math.min(data.pct, 100)

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-[11px] font-black uppercase tracking-[0.14em] text-cyan-800">AI 工厂月度预算</p>

      {/* Usage bar */}
      <div className="mt-3">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-sm font-bold text-slate-700">
            本月已用{' '}
            <span className={data.pct >= 100 ? 'text-red-600' : data.pct >= 80 ? 'text-amber-600' : 'text-slate-950'}>
              {data.spend.toLocaleString()}
            </span>{' '}
            / {data.cap.toLocaleString()} MTC
          </span>
          <span className={`text-xs font-black ${data.pct >= 100 ? 'text-red-600' : data.pct >= 80 ? 'text-amber-600' : 'text-slate-400'}`}>
            {data.pct}%
          </span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${pctClamped}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-slate-400">
          剩余 {data.remaining.toLocaleString()} MTC
          {data.pct >= 100 && (
            <span className="ml-2 font-bold text-red-500">已超上限，AI 工厂已暂停</span>
          )}
          {data.pct >= 80 && data.pct < 100 && (
            <span className="ml-2 font-bold text-amber-500">接近上限，请注意</span>
          )}
        </p>
      </div>

      {/* Cap editor */}
      <div className="mt-4 border-t border-slate-100 pt-4">
        <label className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-500">
          月度上限（MTC）
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            value={editCap}
            onChange={e => { setEditCap(e.target.value); setSaveOk(false); setSaveError(null) }}
            className="w-32 rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-800 focus:border-cyan-400 focus:outline-none"
          />
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-black text-white transition hover:bg-cyan-700 disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存'}
          </button>
          {saveOk && (
            <span className="text-xs font-bold text-emerald-600">✓ 已保存</span>
          )}
        </div>
        {saveError && (
          <p className="mt-1 text-xs text-red-500">{saveError}</p>
        )}
        <button
          onClick={handleReset}
          className="mt-1.5 text-xs text-slate-400 underline hover:text-slate-600"
        >
          重置为默认（{DEFAULT_MONTHLY_MTC_CAP.toLocaleString()}）
        </button>
      </div>
    </div>
  )
}
