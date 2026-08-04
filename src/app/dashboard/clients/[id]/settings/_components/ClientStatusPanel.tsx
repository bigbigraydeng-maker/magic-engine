'use client'

/**
 * ClientStatusPanel — FDE/PM-managed clients.client_status.
 *
 * 真客户闸门（DataForSEO 接入计划 阶段 0）：只有 active 的客户会进
 * 周期性监测 cron（关键词快照 / AI 可见度 / SEO 盯梢 / 每周 blog…）。
 * prospect（调研档案，默认）和 archived 不花任何监测钱。
 *
 * Mirrors IndustryPanel.tsx.
 */

import { useState, useEffect, useCallback } from 'react'
import { CLIENT_STATUS_OPTIONS } from '@/lib/clients/client-status'
import type { ClientStatus } from '@/types/magic-engine'

interface Props {
  clientId: string
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; clientStatus: ClientStatus }

export function ClientStatusPanel({ clientId }: Props) {
  const [state,   setState]   = useState<PanelState>({ phase: 'loading' })
  const [draft,   setDraft]   = useState<ClientStatus>('prospect')
  const [saving,  setSaving]  = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [errMsg,  setErrMsg]  = useState<string | null>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/client-status`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { client_status } = (await res.json()) as { client_status: ClientStatus }
      setState({ phase: 'ready', clientStatus: client_status })
      setDraft(client_status)
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
      const res = await fetch(`/api/clients/${clientId}/client-status`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ client_status: draft }),
      })

      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(error ?? `HTTP ${res.status}`)
      }

      const { client_status: saved } = (await res.json()) as { client_status: ClientStatus }
      setState({ phase: 'ready', clientStatus: saved })
      setDraft(saved)
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

  const dirty = draft !== state.clientStatus

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-3 text-sm text-slate-600">
        决定这个客户<strong>进不进周期性监测</strong>（关键词排名、AI 可见度、SEO 盯梢、每周 Blog 等）。
        只有「真客户」会花监测钱；调研档案一分不花。
      </p>

      {state.clientStatus !== 'active' && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          ⚠ 当前不是真客户 —— 所有周期性监测都跳过这个客户。签约后记得改成「真客户」。
        </p>
      )}

      <div className="space-y-2">
        {CLIENT_STATUS_OPTIONS.map(o => (
          <label
            key={o.value}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition ${
              draft === o.value
                ? 'border-cyan-400 bg-cyan-50'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <input
              type="radio"
              name="client-status"
              value={o.value}
              checked={draft === o.value}
              onChange={() => setDraft(o.value)}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="block text-sm font-bold text-slate-800">{o.label}</span>
              <span className="block text-xs text-slate-500">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>

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
            onClick={() => setDraft(state.clientStatus)}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            撤销修改
          </button>
        )}
        {!dirty && savedAt && (
          <span className="text-xs text-emerald-600">✓ 已保存（{savedAt}）</span>
        )}
      </div>

      <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
        消费方：keyword-snapshots-weekly · ai-tracker-weekly · seo-patrol-daily ·
        site-audit-weekly · flywheel-seo-weekly · blog-weekly · anomaly-detector，
        以及 DataForSEO 接入计划阶段 1-4 的全部新监测。张骞 Discovery 一次性调用不受影响。
      </p>
    </div>
  )
}
