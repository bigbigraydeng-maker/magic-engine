'use client'

/**
 * Ga4PropertyPanel — 选「同步哪一个 GA4 Property」。
 *
 * 首次连接时自动选了第一个（跟 GBP 账号选择器一样的 MVP 简化），这个账号下
 * 有不止一个 Property 时，在这里换。跟 GbpLocationPanel 不同的是没有跨客户
 * 互斥检查——见 ga4/property.ts 头部注释，同一个 Property 被多个 ME 客户看到
 * 是正常的业务结构（比如共享代理权限），不是数据冲突。
 */

import { useState, useEffect, useCallback } from 'react'

interface Props {
  clientId: string
}

interface PropertyOption {
  property: string
  display_name: string
}

interface Payload {
  connected: boolean
  current: string | null
  options: PropertyOption[]
  error?: 'needs_reauth' | 'google_unavailable'
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; data: Payload }

export function Ga4PropertyPanel({ clientId }: Props) {
  const [state, setState] = useState<PanelState>({ phase: 'loading' })
  const [choice, setChoice] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/ga4-properties`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as Payload
      setState({ phase: 'ready', data })
      setChoice(data.current ?? '')
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    setSaving(true)
    setErrMsg(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/ga4-properties`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property: choice }),
      })
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(error ?? `HTTP ${res.status}`)
      }
      setSavedAt(new Date().toLocaleTimeString())
      await load()
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

  const { data } = state

  if (!data.connected) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-600">
          还没连上 Google 网站数据 —— 先在上面完成连接，这里才会出现 Property 可选。
        </p>
      </div>
    )
  }

  if (data.error === 'needs_reauth') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-bold text-amber-800">连接失效了，需要重新连一次</p>
        <p className="mt-1 text-xs text-amber-700">
          在上面的「Google Analytics 4」重新连接后，这里会重新列出 Property。
        </p>
      </div>
    )
  }

  const dirty = choice !== (data.current ?? '')

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-3 text-sm text-slate-600">
        这个客户的流量归因会用下面选中的这个 Property 的数据。
        {data.current ? ' 已经选好了，一般不用动。' : ' 还没选。'}
      </p>

      {data.error === 'google_unavailable' && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          ⚠ 暂时问不到 Google（对方服务或权限问题），Property 列表拉不出来。稍后重试；已经选好的不受影响。
        </p>
      )}

      {data.options.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          这个 Google 账号名下没看到任何 GA4 Property。多半是客户还没建过 GA4，或者登错了账号。
        </p>
      ) : (
        <div className="space-y-2">
          {data.options.map((o) => (
            <label
              key={o.property}
              className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 transition ${
                choice === o.property
                  ? 'cursor-pointer border-cyan-400 bg-cyan-50'
                  : 'cursor-pointer border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <input
                type="radio"
                name="ga4-property"
                value={o.property}
                checked={choice === o.property}
                onChange={() => setChoice(o.property)}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block text-sm font-bold text-slate-800">{o.display_name}</span>
                <span className="block truncate text-xs text-slate-500">{o.property}</span>
              </span>
            </label>
          ))}
        </div>
      )}

      {errMsg && <p className="mt-2 text-xs text-red-600">⚠ {errMsg}</p>}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={!dirty || !choice || saving}
          className="rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {saving ? '保存中…' : '就用这一个'}
        </button>
        {dirty && !saving && (
          <button
            onClick={() => setChoice(data.current ?? '')}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            撤销修改
          </button>
        )}
        {!dirty && savedAt && (
          <span className="text-xs text-emerald-600">✓ 已保存（{savedAt}）</span>
        )}
      </div>
    </div>
  )
}
