'use client'

/**
 * ReputationIdentityPanel — 口碑监测身份配置（DataForSEO 计划 阶段 2）。
 *
 * 三块：客户自己的 GBP place_id / Tripadvisor 搜索词（旅游类）/
 * 竞品 GBP 身份列表（name + place_id）。每周口碑 cron 只对配了身份的
 * 客户跑 —— 没配 = 不花钱。
 *
 * Mirrors IndustryPanel.tsx 的加载/保存骨架。
 */

import { useState, useEffect, useCallback } from 'react'

interface Props {
  clientId: string
}

interface CompetitorGbpEntry {
  name: string
  place_id: string
}

interface IdentityState {
  gbp_place_id: string
  tripadvisor_keyword: string
  competitor_gbp: CompetitorGbpEntry[]
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; saved: IdentityState }

const EMPTY: IdentityState = { gbp_place_id: '', tripadvisor_keyword: '', competitor_gbp: [] }

export function ReputationIdentityPanel({ clientId }: Props) {
  const [state,   setState]   = useState<PanelState>({ phase: 'loading' })
  const [draft,   setDraft]   = useState<IdentityState>(EMPTY)
  const [saving,  setSaving]  = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [errMsg,  setErrMsg]  = useState<string | null>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/reputation-identity`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as {
        gbp_place_id: string | null
        tripadvisor_keyword: string | null
        competitor_gbp: CompetitorGbpEntry[]
      }
      const saved: IdentityState = {
        gbp_place_id: json.gbp_place_id ?? '',
        tripadvisor_keyword: json.tripadvisor_keyword ?? '',
        competitor_gbp: json.competitor_gbp ?? [],
      }
      setState({ phase: 'ready', saved })
      setDraft(saved)
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    setSaving(true)
    setErrMsg(null)
    try {
      const cleanedCompetitors = draft.competitor_gbp
        .map(e => ({ name: e.name.trim(), place_id: e.place_id.trim() }))
        .filter(e => e.name.length > 0 || e.place_id.length > 0)

      const incomplete = cleanedCompetitors.some(e => !e.name || !e.place_id)
      if (incomplete) {
        throw new Error('竞品条目要同时填名字和 place_id（不要的行请删掉）')
      }

      const res = await fetch(`/api/clients/${clientId}/reputation-identity`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gbp_place_id: draft.gbp_place_id.trim() || null,
          tripadvisor_keyword: draft.tripadvisor_keyword.trim() || null,
          competitor_gbp: cleanedCompetitors,
        }),
      })

      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(error ?? `HTTP ${res.status}`)
      }

      const saved: IdentityState = {
        gbp_place_id: draft.gbp_place_id.trim(),
        tripadvisor_keyword: draft.tripadvisor_keyword.trim(),
        competitor_gbp: cleanedCompetitors,
      }
      setState({ phase: 'ready', saved })
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

  const dirty = JSON.stringify(draft) !== JSON.stringify(state.saved)
  const nothingConfigured =
    !state.saved.gbp_place_id && !state.saved.tripadvisor_keyword && state.saved.competitor_gbp.length === 0

  const inputCls =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100'

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-3 text-sm text-slate-600">
        每周自动记录客户和竞品的 <strong>Google 评分 / 评论数 / 新评论</strong>。
        没配身份的客户不花一分监测钱。
      </p>

      {nothingConfigured && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          ⚠ 还没配任何身份 —— 这个客户的口碑监测处于关闭状态。
        </p>
      )}

      <label className="mb-1 block text-xs font-bold text-slate-700">
        客户 GBP place_id
        <span className="ml-1 font-normal text-slate-400">（Google 地图商家的精确身份，防同名店抓错）</span>
      </label>
      <input
        value={draft.gbp_place_id}
        onChange={e => setDraft(d => ({ ...d, gbp_place_id: e.target.value }))}
        placeholder="ChIJ…"
        className={inputCls}
      />

      <label className="mb-1 mt-3 block text-xs font-bold text-slate-700">
        Tripadvisor 搜索词
        <span className="ml-1 font-normal text-slate-400">（旅游类客户才填，如 &quot;CTS Tours New Zealand&quot;）</span>
      </label>
      <input
        value={draft.tripadvisor_keyword}
        onChange={e => setDraft(d => ({ ...d, tripadvisor_keyword: e.target.value }))}
        placeholder="留空 = 不拉 Tripadvisor"
        className={inputCls}
      />

      <div className="mb-1 mt-3 flex items-center justify-between">
        <label className="block text-xs font-bold text-slate-700">
          竞品 GBP 列表
          <span className="ml-1 font-normal text-slate-400">（名字 + place_id，一行一个竞品）</span>
        </label>
        <button
          onClick={() => setDraft(d => ({ ...d, competitor_gbp: [...d.competitor_gbp, { name: '', place_id: '' }] }))}
          className="rounded-lg border border-slate-300 bg-white px-2 py-0.5 text-xs font-bold text-slate-600 hover:border-cyan-300 hover:text-cyan-700"
        >
          + 加一行
        </button>
      </div>

      {draft.competitor_gbp.length === 0 && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">
          没配竞品 —— 只监测客户自己。
        </p>
      )}

      <div className="space-y-2">
        {draft.competitor_gbp.map((entry, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={entry.name}
              onChange={e => setDraft(d => ({
                ...d,
                competitor_gbp: d.competitor_gbp.map((x, j) => j === i ? { ...x, name: e.target.value } : x),
              }))}
              placeholder="竞品商家名"
              className={inputCls}
            />
            <input
              value={entry.place_id}
              onChange={e => setDraft(d => ({
                ...d,
                competitor_gbp: d.competitor_gbp.map((x, j) => j === i ? { ...x, place_id: e.target.value } : x),
              }))}
              placeholder="place_id (ChIJ…)"
              className={inputCls}
            />
            <button
              onClick={() => setDraft(d => ({
                ...d,
                competitor_gbp: d.competitor_gbp.filter((_, j) => j !== i),
              }))}
              className="shrink-0 rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-400 hover:border-red-300 hover:text-red-600"
              title="删除这行"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {errMsg && <p className="mt-2 text-xs text-red-600">⚠ {errMsg}</p>}

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
            onClick={() => setDraft(state.saved)}
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
        消费方：每周口碑快照 cron（评分/评论数/新评论落库）。找 place_id：Google 地图搜商家 →
        分享链接里的 ChIJ 开头一串，或用 Google 的 place ID finder。
      </p>
    </div>
  )
}
