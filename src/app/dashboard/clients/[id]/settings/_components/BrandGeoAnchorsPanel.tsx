'use client'

/**
 * BrandGeoAnchorsPanel — FDE-managed geo anchor list.
 *
 * Single write entry for clients.brand_geo_anchors. Consumed by
 * @/lib/ai-tracker/client-brand-match.ts:admissibleClientIdentifiers.
 *
 * Why it exists: an alias can be the group name a foreign sibling trades
 * under too. CTS Tours NZ's alias "china travel service" also names "China
 * Travel Service (Australia) Pty Ltd", so 15 Australian answers were
 * credited to a NZ-only client. With anchors configured, alias-only evidence
 * needs one of these words in the answer.
 *
 * Mirrors BrandAliasesPanel.tsx.
 */

import { useState, useEffect, useCallback } from 'react'

interface Props {
  clientId: string
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error';   message: string }
  | { phase: 'ready';   anchors: string[] }

const MAX_ANCHORS = 20

export function BrandGeoAnchorsPanel({ clientId }: Props) {
  const [state,   setState]   = useState<PanelState>({ phase: 'loading' })
  const [draft,   setDraft]   = useState('')
  const [saving,  setSaving]  = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [errMsg,  setErrMsg]  = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/brand-geo-anchors`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { anchors } = (await res.json()) as { anchors?: string[] }
      const list = anchors ?? []
      setState({ phase: 'ready', anchors: list })
      setDraft(list.join('\n'))
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
    setWarnings([])
    try {
      const anchors = draft
        .split(/\r?\n/)
        .map(a => a.trim())
        .filter(a => a.length > 0)

      const res = await fetch(`/api/clients/${clientId}/brand-geo-anchors`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ anchors }),
      })

      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(error ?? `HTTP ${res.status}`)
      }

      const { anchors: saved, warnings: warn } = (await res.json()) as {
        anchors: string[]
        warnings?: string[]
      }
      setState({ phase: 'ready', anchors: saved })
      setDraft(saved.join('\n'))
      setSavedAt(new Date().toLocaleTimeString())
      setWarnings(warn ?? [])
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

  const currentCount = draft.split(/\r?\n/).filter(a => a.trim().length > 0).length
  const dirty        = draft.trim() !== state.anchors.join('\n').trim()

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        <p className="font-bold">什么时候要填这一栏</p>
        <p className="mt-1">
          客户的某个「品牌词别名」是同集团通名、海外分公司也叫这个名字时才填。
          填了之后：AI 回答里<strong>只靠别名</strong>认出客户的，必须同时出现下面任意一个地名，才算「客户被提到」。
          客户的正式品牌名和官网域名<strong>永远不受这条限制</strong>。
        </p>
        <p className="mt-1">
          留空 = 这条规则不生效，判定跟以前完全一样。
        </p>
        <p className="mt-2 border-t border-amber-200 pt-2">
          <strong>这个功能救不了哪种情况：</strong>如果客户的<strong>正式品牌名本身</strong>就是那个通名
          （比如客户就叫「China Travel Service」），或者<strong>官网域名主体</strong>就是通名
          （比如 chinatravelservice.co.nz），这道闸门管不着它们 —— 因为正式名和域名按设计永远放行。
          那种情况要改的是客户的正式名称，不是这一栏。
        </p>
      </div>

      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-sm text-slate-600">
          每行一个地名（客户自己的市场），最多 {MAX_ANCHORS} 个。保存后统一小写、合并多余空白、去重。
          英文至少 2 个字母，<strong>中文 / 日文 / 韩文地名至少 3 个字</strong>（「澳洲」这种两字词匹配不到，会被拒绝保存）。
        </p>
        <span className={`text-xs font-bold ${currentCount > MAX_ANCHORS ? 'text-red-600' : 'text-slate-500'}`}>
          {currentCount} / {MAX_ANCHORS}
        </span>
      </div>

      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        placeholder={'new zealand\nnz\naotearoa\nauckland'}
        rows={Math.max(5, Math.min(12, currentCount + 1))}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
      />

      {errMsg && (
        <p className="mt-2 text-xs text-red-600">⚠ {errMsg}</p>
      )}

      {warnings.map(w => (
        <p key={w} className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">💡 {w}</p>
      ))}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={!dirty || saving || currentCount > MAX_ANCHORS}
          className="rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        {dirty && !saving && (
          <button
            onClick={() => setDraft(state.anchors.join('\n'))}
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
        按整词匹配 AI 回答原文（所以 <code className="rounded bg-slate-100 px-1">nz</code> 不会被
        <code className="rounded bg-slate-100 px-1">bonza</code> 命中）。
        消费方：AI 可见度「客户排第几」判定（<code className="rounded bg-slate-100 px-1">client_brand_rank</code>）、
        周报品牌排行合并、诊断分实时探针。
      </p>
    </div>
  )
}
