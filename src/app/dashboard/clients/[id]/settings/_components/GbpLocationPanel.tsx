'use client'

/**
 * GbpLocationPanel — 选「发到哪一家门店」。
 *
 * 自动认门店认不出时（一个 Google 账号挂多家店），这里是人来指定的地方。
 * 没有这个界面就只能去改数据库 —— CLAUDE.md 明令禁止让运营碰库。
 */

import { useState, useEffect, useCallback } from 'react'

interface Props {
  clientId: string
}

interface LocationOption {
  location_name: string
  title: string | null
  website: string | null
  taken_by_other_client: boolean
}

interface Payload {
  connected: boolean
  current: string | null
  options: LocationOption[]
  error?: 'needs_reauth' | 'google_unavailable'
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; data: Payload }

export function GbpLocationPanel({ clientId }: Props) {
  const [state, setState] = useState<PanelState>({ phase: 'loading' })
  const [choice, setChoice] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/gbp/locations`)
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
      const res = await fetch(`/api/clients/${clientId}/gbp/locations`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location_name: choice }),
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
          还没连上 Google 商家页 —— 先在上面完成连接，这里才会出现门店可选。
        </p>
      </div>
    )
  }

  if (data.error === 'needs_reauth') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-bold text-amber-800">连接失效了，需要重新连一次</p>
        <p className="mt-1 text-xs text-amber-700">
          在上面的「Google 商家页」重新连接后，这里会重新列出门店。
        </p>
      </div>
    )
  }

  const dirty = choice !== (data.current ?? '')

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-3 text-sm text-slate-600">
        这个客户的内容会发到下面选中的那一家门店。
        {data.current
          ? ' 已经选好了，一般不用动。'
          : ' 还没选 —— 在选好之前，我们一条内容都不会发。'}
      </p>

      {data.error === 'google_unavailable' && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          ⚠ 暂时问不到 Google（对方服务或权限问题），门店列表拉不出来。稍后重试；已经选好的不受影响。
        </p>
      )}

      {data.options.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          这个 Google 账号名下没看到任何门店。多半是连接时登错了账号 —— 换成客户老板的账号重连一次。
        </p>
      ) : (
        <div className="space-y-2">
          {data.options.map((o) => (
            <label
              key={o.location_name}
              className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 transition ${
                o.taken_by_other_client
                  ? 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-60'
                  : choice === o.location_name
                    ? 'cursor-pointer border-cyan-400 bg-cyan-50'
                    : 'cursor-pointer border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <input
                type="radio"
                name="gbp-location"
                value={o.location_name}
                checked={choice === o.location_name}
                disabled={o.taken_by_other_client}
                onChange={() => setChoice(o.location_name)}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block text-sm font-bold text-slate-800">
                  {o.title ?? '(没有名字)'}
                </span>
                <span className="block truncate text-xs text-slate-500">
                  {o.website ?? '没填网址'}
                </span>
                {o.taken_by_other_client && (
                  <span className="mt-0.5 block text-xs font-bold text-slate-500">
                    已经绑给另一个客户了，不能共用
                  </span>
                )}
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
          {saving ? '保存中…' : '就发这一家'}
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
