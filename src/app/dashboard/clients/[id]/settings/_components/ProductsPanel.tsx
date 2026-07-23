'use client'

/**
 * ProductsPanel — 客户到底卖什么(master_briefs.products)。
 *
 * 内容工厂每写一条广告文案都会读它(brief-injector 渲染成「主力产品:名称(卖点)」
 * 送进 system prompt)。此前三个客户全是空的,AI 一直拿到「未设置」,只能靠内容支柱
 * 去推 —— 这正是「编出客户根本不卖的品类」的结构性根因。
 *
 * 沿用 SocialHandlesPanel 的 loading / error / ready 三态 + draft/保存 模式。
 */

import { useState, useEffect, useCallback } from 'react'

interface Props {
  clientId: string
}

interface Product {
  name: string
  usp: string
}

interface Payload {
  products: Product[]
  has_brief: boolean
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; data: Payload }

const MAX_PRODUCTS = 20
const same = (a: Product[], b: Product[]) =>
  a.length === b.length && a.every((p, i) => p.name === b[i].name && p.usp === b[i].usp)

export function ProductsPanel({ clientId }: Props) {
  const [state, setState] = useState<PanelState>({ phase: 'loading' })
  const [draft, setDraft] = useState<Product[]>([])
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/products`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as Payload
      setState({ phase: 'ready', data })
      setDraft(data.products)
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  const handleSave = async () => {
    setSaving(true)
    setErrMsg(null)
    try {
      // 名称为空的行直接不提交(后端也会丢,这里先做一遍免得用户以为存上了)
      const payload = draft.filter((p) => p.name.trim().length > 0)
      const res = await fetch(`/api/clients/${clientId}/products`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products: payload }),
      })
      const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setState((s) => (s.phase === 'ready' ? { phase: 'ready', data: { ...s.data, products: json.products } } : s))
      setDraft(json.products as Product[])
      setSavedAt(new Date().toLocaleTimeString('zh-CN'))
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (state.phase === 'loading') {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-cyan-600" />
        正在加载产品清单…
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p className="font-bold">加载失败</p>
        <p>{state.message}</p>
        <button onClick={load} className="mt-2 font-medium underline">重试</button>
      </div>
    )
  }

  const { data } = state
  const isDirty = !same(draft.filter((p) => p.name.trim()), data.products)
  const filled = data.products.length

  if (!data.has_brief) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        这个客户还没有启用中的品牌档案,产品清单挂在档案上。先建档再回来填。
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <p className="text-xs text-slate-500">
          客户<span className="font-medium text-slate-700">真实在卖</span>的东西。写广告文案时会逐条读给 AI ——
          <span className="font-medium text-slate-700">这里空着,AI 就只能靠猜</span>。
        </p>
        <span
          className={[
            'flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold',
            filled === 0
              ? 'border border-red-200 bg-red-50 text-red-700'
              : 'border border-emerald-200 bg-emerald-50 text-emerald-700',
          ].join(' ')}
        >
          {filled === 0 ? '未填 · AI 只能靠猜' : `${filled} 个产品`}
        </span>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 mb-4">
        <p className="text-xs text-amber-800">
          ⚠️ 只填<span className="font-bold">客户官网上有、或客户本人确认过</span>的产品。
          编一个客户不卖的品类进去,广告就会照着编出去 —— 这类事故出过。
        </p>
      </div>

      <div className="space-y-2">
        {draft.length === 0 && (
          <p className="text-sm text-slate-400 py-2">还没有产品。点下面「+ 添加产品」开始。</p>
        )}
        {draft.map((p, i) => (
          <div key={i} className="flex gap-2 items-start">
            <input
              type="text"
              value={p.name}
              onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              placeholder="产品名,例:SPC 复合地板"
              disabled={saving}
              className="w-2/5 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
            <input
              type="text"
              value={p.usp}
              onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, usp: e.target.value } : x)))}
              placeholder="一句话卖点,例:防水耐磨、自有供应链直供"
              disabled={saving}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
            <button
              type="button"
              onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
              disabled={saving}
              className="h-10 px-3 rounded-lg border border-slate-200 text-sm text-slate-400 hover:text-red-600 hover:border-red-200"
              aria-label="删除这个产品"
            >×</button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setDraft((d) => [...d, { name: '', usp: '' }])}
        disabled={saving || draft.length >= MAX_PRODUCTS}
        className="mt-3 text-sm font-medium text-cyan-700 hover:underline disabled:opacity-40"
      >+ 添加产品{draft.length >= MAX_PRODUCTS ? `(最多 ${MAX_PRODUCTS} 个)` : ''}</button>

      <div className="mt-5 flex items-center justify-between gap-3">
        <div className="text-xs text-slate-500">
          {savedAt && !isDirty && <span className="text-emerald-700">✓ 已保存 · {savedAt}</span>}
          {errMsg && <span className="text-red-700">⚠ {errMsg}</span>}
        </div>
        <button
          onClick={handleSave}
          disabled={!isDirty || saving}
          className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  )
}
