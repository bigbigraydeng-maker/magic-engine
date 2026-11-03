'use client'

/**
 * QualifiedStagesPanel —— 客户「哪些客人阶段算合格客人」设置。
 *
 * 广告成绩单里数每个广告组带来了几个合格客人。勾上算合格的阶段；
 * 报价后又变成别的阶段的客人也照样算。只给内部员工看，不影响预算判断。
 *
 * - 阶段列表来自 GET 下发的 stages（顺序即展示顺序，前端不排序、不截断）。
 * - 只有 Magic Engine 内部员工能保存（接口 403 → 提示）。
 * - 读失败 ≠ 没配置：读不到时不渲染成空表单、不给保存，免得一存盖掉没看见的旧值。
 * - 数据库没升级（not_migrated）时只提示，不给勾选。
 * - 写入只走 /api/clients/[id]/ad-qualified-stages —— 不许进数据库直改。
 */

import { useState, useEffect, useCallback } from 'react'

interface Props {
  clientId: string
}

interface StageOption {
  key: string
  label: string
}

type Source = 'row' | 'no_row' | 'read_error' | 'not_migrated'

interface StagesResponse {
  success: boolean
  source: Source
  stages: StageOption[]
  selected: string[]
  updatedBy: string | null
  updatedAt: string | null
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | {
      phase: 'ready'
      source: Source
      stages: StageOption[]
      saved: string[]
      updatedBy: string | null
      updatedAt: string | null
    }

function errorText(status: number): string {
  if (status === 403) return '只有 Magic Engine 内部同事能改这项。'
  if (status === 503) return '这项设置暂时存不进去（系统还没升级完），原来的设置还在，请联系技术。'
  if (status === 400) return '填的内容有不对的地方，原来的设置还在。请检查后再保存。'
  if (status === 409) return '这个客户还没开「广告健康监测」，先开了再设置合格阶段。'
  return '保存没成功，原来的设置还在。请稍后重试。'
}

/** 顺序无关的比较：勾选集合相同即视为没改。 */
function sameSelection(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sa = [...a].sort()
  const sb = [...b].sort()
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== sb[i]) return false
  }
  return true
}

export function QualifiedStagesPanel({ clientId }: Props) {
  const [state, setState] = useState<PanelState>({ phase: 'loading' })
  const [draft, setDraft] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const apply = (json: StagesResponse) => {
    setState({
      phase: 'ready',
      source: json.source,
      stages: json.stages,
      saved: json.selected,
      updatedBy: json.updatedBy,
      updatedAt: json.updatedAt,
    })
    // 丢掉已经不在阶段表里的 key，免得保存时把它们带回去。
    const known = new Set(json.stages.map(s => s.key))
    setDraft(json.selected.filter(k => known.has(k)))
  }

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/ad-qualified-stages`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as StagesResponse
      apply(json)
    } catch {
      setState({ phase: 'error' })
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  const toggle = (key: string) => {
    setBanner(null)
    setDraft(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]))
  }

  const save = async () => {
    setSaving(true)
    setBanner(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/ad-qualified-stages`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qualified_stage_keys: draft }),
      })
      if (!res.ok) {
        setBanner({ kind: 'err', text: errorText(res.status) })
        return
      }
      const json = (await res.json()) as StagesResponse
      apply(json)
      setBanner({ kind: 'ok', text: '已保存。' })
    } catch {
      setBanner({ kind: 'err', text: errorText(0) })
    } finally {
      setSaving(false)
    }
  }

  if (state.phase === 'loading') {
    return <div className="rounded-xl border border-gray-200 p-5 text-sm text-gray-500">加载中…</div>
  }
  if (state.phase === 'error') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        合格客人阶段设置加载失败，请刷新页面再试。
      </div>
    )
  }

  const { source, stages, saved, updatedBy, updatedAt } = state
  const known = new Set(stages.map(s => s.key))
  const orphanCount = saved.filter(k => !known.has(k)).length
  const changed = !sameSelection(draft, saved)

  return (
    <div className="rounded-xl border border-gray-200 p-5">
      <div>
        <h3 className="text-sm font-semibold text-gray-800">哪些客人阶段算「合格客人」</h3>
        <p className="mt-1 text-xs text-gray-500">
          广告成绩单里数每个广告组带来了几个合格客人。勾上算合格的阶段；报价后又变成别的阶段的客人也照样算。只给内部员工看，不影响预算判断。
        </p>
      </div>

      {source === 'not_migrated' ? (
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          数据库还没升级，这项暂时存不进去。
        </p>
      ) : source === 'read_error' ? (
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          读不到原来的设置，先不让改，免得盖掉没看见的旧值。
        </p>
      ) : stages.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">这个客户还没有 CRM 阶段。</p>
      ) : (
        <>
          {orphanCount > 0 && (
            <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
              设置里有 {orphanCount} 个阶段已经不在客户的阶段表里，保存时会被去掉。
            </p>
          )}

          <ul className="mt-4 space-y-2">
            {stages.map(s => (
              <li key={s.key}>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={draft.includes(s.key)}
                    onChange={() => toggle(s.key)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <span>{s.label}</span>
                </label>
              </li>
            ))}
          </ul>

          <p className="mt-3 text-xs text-gray-500">
            已勾 {draft.length} 个
            {updatedBy && updatedAt
              ? ` · 上次由 ${updatedBy} 在 ${new Date(updatedAt).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' })} 改`
              : ''}
          </p>

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              disabled={saving || !changed}
              onClick={save}
              className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:opacity-50"
            >
              保存
            </button>
            {saving && <span className="text-xs text-gray-500">保存中…</span>}
          </div>
        </>
      )}

      {!saving && banner && (
        <p className={`mt-2 text-xs ${banner.kind === 'ok' ? 'text-emerald-700' : 'text-red-700'}`}>
          {banner.text}
        </p>
      )}
    </div>
  )
}
