'use client'

/**
 * AdOutcomePanel —— 客户「广告结果怎么算」设置（ads IMPACT 阶段 1，设计 §3.2 / §7 L4）。
 *
 * 选「领先结果」（每天能数）和「主结果」（真生意），填目标单次主结果成本和
 * 每个广告单位主结果最低数。诊断据此判断「花钱没结果」「钱和结果错配」。
 *
 * - 下拉选项来自 GET 下发的 steps（词表只在 outcome-ladder.ts 定义一次），前端不写死。
 * - 只有 Magic Engine 内部员工能保存（接口 403 → 提示）。
 * - 读失败 ≠ 没配置：读不到时不渲染成空表单、不给保存，免得一存盖掉没看见的旧值。
 * - 写入只走 /api/clients/[id]/ad-outcome-config —— 不许进数据库直改。
 */

import { useState, useEffect, useCallback } from 'react'

interface Props {
  clientId: string
}

interface StepOption {
  value: string
  label: string
}

interface OutcomeConfigDto {
  leading: string | null
  primary: string | null
  targetCostPerPrimary: number | null
  minPrimaryPerUnit: number
}

interface ConfigResponse {
  config: OutcomeConfigDto
  source: 'row' | 'no_row' | 'read_error'
  steps: StepOption[]
}

interface Draft {
  leading: string
  primary: string
  target: string
  min: string
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; steps: StepOption[]; readFailed: boolean }

function toDraft(c: OutcomeConfigDto): Draft {
  return {
    leading: c.leading ?? '',
    primary: c.primary ?? '',
    target: c.targetCostPerPrimary === null ? '' : String(c.targetCostPerPrimary),
    min: String(c.minPrimaryPerUnit),
  }
}

/** 保存前先在本地挡一遍，给人话提示；接口会再校验一次。 */
function checkDraft(d: Draft, steps: StepOption[]): string | null {
  const li = steps.findIndex(s => s.value === d.leading)
  const pi = steps.findIndex(s => s.value === d.primary)
  if (li >= 0 && pi >= 0 && pi < li) return '「主结果」不能比「领先结果」更靠前，请重新选。'
  if (d.target.trim() !== '') {
    const n = Number(d.target)
    if (!Number.isFinite(n) || n <= 0) return '目标成本要么留空，要么填大于 0 的数字。'
  }
  const m = Number(d.min)
  if (!Number.isInteger(m) || m < 1) return '最低数要填 1 或以上的整数。'
  return null
}

function errorText(status: number): string {
  if (status === 403) return '只有 Magic Engine 内部同事能改这项。'
  if (status === 503) return '这项设置暂时存不进去（系统还没升级完），原来的设置还在，请联系技术。'
  if (status === 400) return '填的内容有不对的地方，原来的设置还在。请检查后再保存。'
  return '保存没成功，原来的设置还在。请稍后重试。'
}

export function AdOutcomePanel({ clientId }: Props) {
  const [state, setState] = useState<PanelState>({ phase: 'loading' })
  const [draft, setDraft] = useState<Draft>({ leading: '', primary: '', target: '', min: '5' })
  const [saving, setSaving] = useState(false)
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const apply = (json: ConfigResponse) => {
    setState({ phase: 'ready', steps: json.steps, readFailed: json.source === 'read_error' })
    setDraft(toDraft(json.config))
  }

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/ad-outcome-config`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as ConfigResponse
      setState({ phase: 'ready', steps: json.steps, readFailed: json.source === 'read_error' })
      setDraft(toDraft(json.config))
    } catch {
      setState({ phase: 'error' })
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  const save = async (steps: StepOption[]) => {
    const problem = checkDraft(draft, steps)
    if (problem) {
      setBanner({ kind: 'err', text: problem })
      return
    }
    setSaving(true)
    setBanner(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/ad-outcome-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leading_result: draft.leading === '' ? null : draft.leading,
          primary_result: draft.primary === '' ? null : draft.primary,
          target_cost_per_primary: draft.target.trim() === '' ? null : Number(draft.target),
          min_primary_per_unit: Number(draft.min),
        }),
      })
      if (!res.ok) {
        setBanner({ kind: 'err', text: errorText(res.status) })
        return
      }
      apply((await res.json()) as ConfigResponse)
      setBanner({ kind: 'ok', text: '已保存，下一次广告体检按新设置算。' })
    } catch {
      setBanner({ kind: 'err', text: errorText(0) })
    } finally {
      setSaving(false)
    }
  }

  if (state.phase === 'loading') {
    return <div className="rounded-xl border border-gray-200 p-5 text-sm text-gray-400">加载中…</div>
  }
  if (state.phase === 'error') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        结果设置加载失败，请刷新页面再试。
      </div>
    )
  }

  const { steps, readFailed } = state
  const selectCls = 'mt-1 w-full rounded-lg border border-gray-200 p-2 text-sm focus:border-gray-400 focus:outline-none'

  return (
    <div className="rounded-xl border border-gray-200 p-5">
      <div>
        <h3 className="font-medium text-gray-800">广告结果怎么算</h3>
        <p className="mt-1 text-sm text-gray-500">
          告诉体检：这个客户每天看哪个数（领先结果），真正算生意的是哪个数（主结果），以及一个主结果最多愿意花多少钱。
        </p>
      </div>

      {readFailed ? (
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          暂时读不到这个客户的结果设置，为免盖掉原来的设置，先别改。请联系技术。
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-gray-700">
              领先结果
              <select value={draft.leading} onChange={e => setDraft({ ...draft, leading: e.target.value })} className={selectCls}>
                <option value="">未设置</option>
                {steps.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium text-gray-700">
              主结果
              <select value={draft.primary} onChange={e => setDraft({ ...draft, primary: e.target.value })} className={selectCls}>
                <option value="">未设置</option>
                {steps.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium text-gray-700">
              目标单次主结果成本（账户币种）
              <input
                type="number" min="0" step="0.01" inputMode="decimal"
                value={draft.target}
                onChange={e => setDraft({ ...draft, target: e.target.value })}
                placeholder="例如 25"
                className={selectCls}
              />
              <span className="mt-1 block text-xs font-normal text-gray-400">
                留空 = 不判「花钱没结果」，不会拿行业默认值代替
              </span>
            </label>
            <label className="block text-sm font-medium text-gray-700">
              主结果最低数
              <input
                type="number" min="1" step="1" inputMode="numeric"
                value={draft.min}
                onChange={e => setDraft({ ...draft, min: e.target.value })}
                className={selectCls}
              />
              <span className="mt-1 block text-xs font-normal text-gray-400">
                每个广告单位主结果少于这个数，不做钱和结果的比较
              </span>
            </label>
          </div>

          <p className="mt-4 text-xs text-gray-500">
            合格询盘、成交目前归不到具体广告（私信来源要等 Meta 企业验证通过），选它们做主结果时，『钱和结果错配』会显示为暂不可比。
          </p>

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={() => save(steps)}
              className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:opacity-50"
            >
              保存结果设置
            </button>
            {saving && <span className="text-xs text-gray-400">保存中…</span>}
          </div>
        </>
      )}

      {!saving && banner && (
        <p className={`mt-2 text-xs ${banner.kind === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>{banner.text}</p>
      )}
    </div>
  )
}
