'use client'

/**
 * 客户跟进步骤配置。
 *
 * 运营在这里定「一个客人从进线到成交要走哪几步」，以及每一步之后
 * 系统该怎么对待他（继续发 / 先放一放 / 停止 / 转售后 / 结案）。
 *
 * 两条写死的约束（都是给非技术运营的）：
 *   · 只编中文名和顺序。系统内部的英文代号永不出现在界面上，改名也不动它，
 *     所以改名不会把历史记录改断。
 *   · 每一步显示当前有多少客人在里面。要删还有人的一步时，先把人挪走 ——
 *     界面直接给「挪到哪一步」的选择，不让运营自己一个个改。
 */

import { useCallback, useEffect, useState } from 'react'
import {
  MARKETING_ACTIONS,
  actionMeta,
  stageSuppressesWorklist,
  type MarketingAction,
  type PipelineStage,
} from '@/lib/crm/pipeline'

interface Props {
  clientId: string
}

interface Row extends PipelineStage {
  /** 新增的行还没有服务端 key，保存时由服务端生成。 */
  isNew?: boolean
  /** 前端本地行标识（新行没有 stageKey）。 */
  rowId: string
}

const TONE_CLASS: Record<string, string> = {
  go:       'border-emerald-200 bg-emerald-50 text-emerald-800',
  defer:    'border-amber-200 bg-amber-50 text-amber-800',
  stop:     'border-slate-200 bg-slate-100 text-slate-600',
  postsale: 'border-sky-200 bg-sky-50 text-sky-800',
  won:      'border-emerald-300 bg-emerald-100 text-emerald-900',
}

export function PipelineStagesPanel({ clientId }: Props) {
  const [rows, setRows]         = useState<Row[] | null>(null)
  const [loadErr, setLoadErr]   = useState<string | null>(null)
  const [saving, setSaving]     = useState(false)
  const [errMsg, setErrMsg]     = useState<string | null>(null)
  const [savedAt, setSavedAt]   = useState<string | null>(null)
  const [dirty, setDirty]       = useState(false)
  /** 删除拦截：这一步还有人，要先挪走。 */
  const [blocked, setBlocked]   = useState<{ stageKey: string; label: string; count: number; to: string } | null>(null)

  const load = useCallback(async () => {
    setLoadErr(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/pipeline-stages`)
      const json = (await res.json()) as { stages?: PipelineStage[]; error?: string }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setRows((json.stages ?? []).map((s) => ({ ...s, rowId: s.stageKey })))
      setDirty(false)
    } catch (err) {
      setLoadErr(err instanceof Error ? err.message : String(err))
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  const patch = (rowId: string, next: Partial<Row>) => {
    setRows((cur) => (cur ?? []).map((r) => (r.rowId === rowId ? { ...r, ...next } : r)))
    setDirty(true)
  }

  const move = (idx: number, dir: -1 | 1) => {
    setRows((cur) => {
      if (!cur) return cur
      const to = idx + dir
      if (to < 0 || to >= cur.length) return cur
      const next = [...cur]
      ;[next[idx], next[to]] = [next[to], next[idx]]
      return next
    })
    setDirty(true)
  }

  const addRow = () => {
    setRows((cur) => [
      ...(cur ?? []),
      {
        rowId: `new-${globalThis.crypto.randomUUID()}`,
        stageKey: '',
        label: '',
        sortOrder: 0,
        marketingAction: 'nurture' as MarketingAction,
        isTerminal: false,
        contactCount: 0,
        isNew: true,
      },
    ])
    setDirty(true)
  }

  const save = async () => {
    if (!rows) return
    setSaving(true)
    setErrMsg(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/pipeline-stages`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stages: rows.map((r, i) => ({
            stageKey: r.isNew ? null : r.stageKey,
            label: r.label.trim(),
            sortOrder: (i + 1) * 10,
            marketingAction: r.marketingAction,
            isTerminal: r.isTerminal,
          })),
        }),
      })
      const json = (await res.json()) as { stages?: PipelineStage[]; error?: string }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setRows((json.stages ?? []).map((s) => ({ ...s, rowId: s.stageKey })))
      setDirty(false)
      setSavedAt(new Date().toLocaleTimeString())
    } catch (err) {
      // 保存不是事务的：可能前几条已经落库。以服务端为准重新拉一次，
      // 否则用户再点一次保存会把已存进去的那几条重复新增一遍。
      setErrMsg(`${err instanceof Error ? err.message : String(err)}（已刷新成系统里的最新状态，请检查后重试）`)
      await load()
    } finally {
      setSaving(false)
    }
  }

  /** 删一步。带人的先要求挪走（reassignTo）。 */
  const removeStage = async (row: Row, reassignTo?: string) => {
    if (row.isNew) {
      setRows((cur) => (cur ?? []).filter((r) => r.rowId !== row.rowId))
      setDirty(true)
      return
    }
    setErrMsg(null)
    try {
      const res = await fetch(
        `/api/clients/${clientId}/pipeline-stages/${encodeURIComponent(row.stageKey)}`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reassignTo ? { reassignTo } : {}),
        },
      )
      const json = (await res.json()) as { error?: string; reason?: string; count?: number }
      if (res.status === 409 && json.reason === 'not_empty') {
        const other = (rows ?? []).find((r) => !r.isNew && r.stageKey !== row.stageKey)
        setBlocked({
          stageKey: row.stageKey,
          label: row.label,
          count: json.count ?? 0,
          to: other?.stageKey ?? '',
        })
        return
      }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setBlocked(null)
      await load()
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err))
    }
  }

  if (loadErr) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-bold text-red-700">加载失败</p>
        <p className="mt-1 text-xs text-red-600">{loadErr}</p>
        <button onClick={() => void load()} className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-100">
          重试
        </button>
      </div>
    )
  }

  if (!rows) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-400">加载中...</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-3 text-sm text-slate-600">
        一个客人从进线到成交要走的几步。每一步选一个「之后系统怎么对待他」——
        这决定了他还会不会收到自动跟进、还会不会出现在销售今天的名单里。
      </p>

      <div className="space-y-3">
        {rows.map((row, idx) => {
          const meta = actionMeta(row.marketingAction)
          return (
            <div key={row.rowId} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center gap-2">
                <div className="flex flex-col">
                  <button
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                    className="px-1 text-xs text-slate-400 hover:text-slate-700 disabled:opacity-30"
                    title="往上挪"
                  >▲</button>
                  <button
                    onClick={() => move(idx, 1)}
                    disabled={idx === rows.length - 1}
                    className="px-1 text-xs text-slate-400 hover:text-slate-700 disabled:opacity-30"
                    title="往下挪"
                  >▼</button>
                </div>

                <span className="w-6 text-center text-xs font-bold text-slate-400">{idx + 1}</span>

                <input
                  value={row.label}
                  onChange={(e) => patch(row.rowId, { label: e.target.value })}
                  placeholder="这一步叫什么（例：已报价）"
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                />

                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-500">
                  {row.contactCount ?? 0} 位客人
                </span>

                <button
                  onClick={() => {
                    // 删除会立刻以服务端为准重新加载，未保存的改名会丢。
                    if (dirty && !window.confirm('你还有没保存的修改，删除会把它们丢掉。要先取消、去保存吗？\n\n点「确定」继续删除。')) return
                    if (!row.isNew && !window.confirm(`确定删掉「${row.label}」这一步？`)) return
                    void removeStage(row)
                  }}
                  className="shrink-0 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:border-red-300 hover:text-red-600"
                >
                  删除
                </button>
              </div>

              {/* 之后系统怎么对待他 —— 结果卡，不是下拉里的代号 */}
              <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-5">
                {MARKETING_ACTIONS.map((a) => {
                  const m = actionMeta(a)
                  const on = row.marketingAction === a
                  return (
                    <button
                      key={a}
                      onClick={() => patch(row.rowId, { marketingAction: a })}
                      className={`rounded-lg border px-2 py-1.5 text-left text-[11px] font-bold transition ${
                        on ? TONE_CLASS[m.tone] : 'border-slate-200 bg-white text-slate-400 hover:border-slate-300'
                      }`}
                    >
                      {m.title}
                    </button>
                  )
                })}
              </div>

              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                <span className="font-semibold text-slate-600">{meta.title}：</span>
                {meta.behaviour}
                {meta.example && <span className="text-slate-400">　例：{meta.example}</span>}
              </p>

              <label className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                <input
                  type="checkbox"
                  checked={row.isTerminal}
                  onChange={(e) => patch(row.rowId, { isTerminal: e.target.checked })}
                />
                这是最后一步，到这儿这个客人就走完了
              </label>
            </div>
          )
        })}
      </div>

      {/* 删不掉：这一步还有人 */}
      {blocked && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-bold text-amber-900">
            「{blocked.label}」这一步还有 {blocked.count} 位客人，要先把他们挪走才能删。
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-amber-800">把他们挪到：</span>
            <select
              value={blocked.to}
              onChange={(e) => setBlocked({ ...blocked, to: e.target.value })}
              className="rounded-lg border border-amber-300 bg-white px-2 py-1 text-sm"
            >
              {rows
                .filter((r) => !r.isNew && r.stageKey !== blocked.stageKey)
                .map((r) => (
                  <option key={r.stageKey} value={r.stageKey}>
                    {r.label}（{actionMeta(r.marketingAction).title}）
                  </option>
                ))}
            </select>
            <button
              onClick={() => {
                const target = rows.find((r) => r.stageKey === blocked.stageKey)
                if (target && blocked.to) void removeStage(target, blocked.to)
              }}
              disabled={!blocked.to}
              className="rounded-lg bg-amber-600 px-3 py-1 text-sm font-bold text-white hover:bg-amber-700 disabled:bg-slate-300"
            >
              挪过去并删除
            </button>
            <button onClick={() => setBlocked(null)} className="text-xs text-amber-800 underline">
              先不删
            </button>
          </div>
          {(() => {
            const target = rows.find((r) => r.stageKey === blocked.to)
            if (!target || !stageSuppressesWorklist(target.marketingAction, target.isTerminal)) return null
            return (
              <p className="mt-2 text-xs font-bold text-red-700">
                ⚠ 挪到「{target.label}」之后，这 {blocked.count} 位客人会从销售今天的名单里消失
                （还能在「不在名单上的人」里找到）。
              </p>
            )
          })()}
        </div>
      )}

      {errMsg && <p className="mt-2 text-xs text-red-600">⚠ {errMsg}</p>}

      <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3">
        <button
          onClick={() => void save()}
          disabled={!dirty || saving || rows.some((r) => !r.label.trim())}
          className="rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        <button onClick={addRow} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold text-slate-600 hover:bg-slate-50">
          + 加一步
        </button>
        {!dirty && savedAt && <span className="text-xs text-emerald-600">✓ 已保存（{savedAt}）</span>}
        {rows.some((r) => !r.label.trim()) && <span className="text-xs text-slate-400">每一步都要填名字</span>}
      </div>

      <p className="mt-3 text-xs text-slate-400">
        改名字不影响历史记录 —— 系统内部用的是不会变的代号，界面上不显示。
      </p>
    </div>
  )
}
