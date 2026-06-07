'use client'

/**
 * MetaAdAccountPanel — FDE-managed Meta (Facebook) ad account binding.
 *
 * Single write entry for clients.meta_ad_account_id. Consumed by
 *   - Meta Ads daily sync cron (flywheel metrics)
 *   - Manual sync endpoint
 *   - MetaAdsAdapter diagnostic adapter
 *
 * BUG-FMT-S04 — closes the only "must open Supabase" gap in the ads pillar.
 * Mirrors BrandAliasesPanel.tsx but with a single text field instead of a list.
 */

import { useCallback, useEffect, useState } from 'react'

interface Props {
  clientId: string
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error';   message: string }
  | { phase: 'ready';   adAccountId: string | null }

export function MetaAdAccountPanel({ clientId }: Props) {
  const [state,   setState]   = useState<PanelState>({ phase: 'loading' })
  const [draft,   setDraft]   = useState('')
  const [saving,  setSaving]  = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [errMsg,  setErrMsg]  = useState<string | null>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/meta-ad-account`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { ad_account_id } = (await res.json()) as { ad_account_id?: string | null }
      const value = ad_account_id ?? null
      setState({ phase: 'ready', adAccountId: value })
      setDraft(value ?? '')
    } catch (err) {
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    setSaving(true)
    setErrMsg(null)
    try {
      const trimmed = draft.trim()
      const res = await fetch(`/api/clients/${clientId}/meta-ad-account`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ad_account_id: trimmed.length === 0 ? null : trimmed }),
      })

      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(error ?? `HTTP ${res.status}`)
      }

      const { ad_account_id } = (await res.json()) as { ad_account_id: string | null }
      setState({ phase: 'ready', adAccountId: ad_account_id })
      setDraft(ad_account_id ?? '')
      setSavedAt(new Date().toLocaleTimeString())
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (state.phase === 'loading') {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-400">加载中...</p>
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-bold text-red-700">加载失败</p>
        <p className="mt-1 text-xs text-red-600">{state.message}</p>
        <button
          onClick={load}
          className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-100"
        >
          重试
        </button>
      </div>
    )
  }

  const dirty = draft.trim() !== (state.adAccountId ?? '').trim()

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-3 text-sm text-slate-600">
        填入 Meta 广告账户 ID，格式 <code className="rounded bg-slate-100 px-1 text-xs">act_数字</code>。
        只填数字也行，系统会自动加 <code className="rounded bg-slate-100 px-1 text-xs">act_</code> 前缀。
      </p>

      <input
        type="text"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        placeholder="act_2775766642787274"
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
      />

      {errMsg && (
        <p className="mt-2 text-xs text-red-600">⚠ {errMsg}</p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        {dirty && !saving && (
          <button
            onClick={() => setDraft(state.adAccountId ?? '')}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            撤销修改
          </button>
        )}
        {!dirty && savedAt && (
          <span className="text-xs text-emerald-600">✓ 已保存（{savedAt}）</span>
        )}
        {!dirty && !savedAt && state.adAccountId === null && (
          <span className="text-xs text-slate-400">未绑定</span>
        )}
      </div>

      <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
        在 Meta Ads Manager 左上账户切换器找到，复制完整 ID（含 <code className="rounded bg-slate-100 px-1">act_</code> 前缀）。
        绑定后下一次 cron（每日 03:00 UTC）会自动同步广告花费 / CTR / ROAS 到 ME 飞轮。
      </p>
    </div>
  )
}
