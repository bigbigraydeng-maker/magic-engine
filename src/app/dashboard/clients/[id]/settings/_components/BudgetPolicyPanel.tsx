'use client'

/**
 * BudgetPolicyPanel —— 客户「广告预算管控」设置（ads IMPACT 阶段 2，设计 §4.1 硬前置第 2 条 / §7 L4）。
 *
 * 是否锁定预算、每日总花费上限、单个预算单位当天最多能变动多少。往后挪预算的处方
 * 会先查这里——锁定了就一律不出、不执行。
 *
 * - 只有 Magic Engine 内部员工能保存（接口 403 → 提示）。
 * - 读失败 ≠ 没配置：读不到时不渲染成空表单、不给保存，免得一存盖掉没看见的旧值。
 * - 写入只走 /api/clients/[id]/ad-budget-policy —— 不许进数据库直改。
 * - 新客户默认是锁定的（没配置过 = 锁定，不是放开），这里只是把这件事亮出来给 FDE 看，
 *   不是「默认关闭挪预算功能」这种运营开关。
 */

import { useState, useEffect, useCallback } from 'react'

interface Props {
  clientId: string
}

interface BudgetPolicyDto {
  locked: boolean
  totalDailyCapMinor: number | null
  perUnitDailyChangeCapPct: number | null
}

interface PolicyResponse {
  policy: BudgetPolicyDto
  source: 'row' | 'no_row' | 'read_error'
}

interface Draft {
  locked: boolean
  totalCap: string // 账户币种主单位（如 $500），界面输入主单位，提交时换算成分
  perUnitPct: string
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; readFailed: boolean; unconfigured: boolean }

function toDraft(p: BudgetPolicyDto): Draft {
  return {
    locked: p.locked,
    totalCap: p.totalDailyCapMinor === null ? '' : String(p.totalDailyCapMinor / 100),
    perUnitPct: p.perUnitDailyChangeCapPct === null ? '' : String(p.perUnitDailyChangeCapPct),
  }
}

/** 保存前先在本地挡一遍，给人话提示；接口会再校验一次。 */
function checkDraft(d: Draft): string | null {
  if (d.totalCap.trim() !== '') {
    const n = Number(d.totalCap)
    if (!Number.isFinite(n) || n <= 0) return '每日总花费上限要么留空，要么填大于 0 的数字。'
  }
  if (d.perUnitPct.trim() !== '') {
    const n = Number(d.perUnitPct)
    if (!Number.isFinite(n) || n <= 0 || n > 100) return '单预算单位当日变动上限要么留空，要么填 0 到 100 之间的百分比。'
  }
  return null
}

function errorText(status: number): string {
  if (status === 403) return '只有 Magic Engine 内部同事能改这项。'
  if (status === 503) return '这项设置暂时存不进去（系统还没升级完），原来的设置还在，请联系技术。'
  if (status === 400) return '填的内容有不对的地方，原来的设置还在。请检查后再保存。'
  return '保存没成功，原来的设置还在。请稍后重试。'
}

export function BudgetPolicyPanel({ clientId }: Props) {
  const [state, setState] = useState<PanelState>({ phase: 'loading' })
  const [draft, setDraft] = useState<Draft>({ locked: true, totalCap: '', perUnitPct: '' })
  const [saving, setSaving] = useState(false)
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const apply = (json: PolicyResponse) => {
    setState({ phase: 'ready', readFailed: json.source === 'read_error', unconfigured: json.source === 'no_row' })
    setDraft(toDraft(json.policy))
  }

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/ad-budget-policy`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as PolicyResponse
      apply(json)
    } catch {
      setState({ phase: 'error' })
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  const save = async () => {
    const problem = checkDraft(draft)
    if (problem) {
      setBanner({ kind: 'err', text: problem })
      return
    }
    setSaving(true)
    setBanner(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/ad-budget-policy`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          budget_locked: draft.locked,
          total_daily_cap_minor: draft.totalCap.trim() === '' ? null : Math.round(Number(draft.totalCap) * 100),
          per_unit_daily_change_cap_pct: draft.perUnitPct.trim() === '' ? null : Number(draft.perUnitPct),
        }),
      })
      if (!res.ok) {
        setBanner({ kind: 'err', text: errorText(res.status) })
        return
      }
      apply((await res.json()) as PolicyResponse)
      setBanner({ kind: 'ok', text: '已保存，下一次挪预算处方按新设置算。' })
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
        预算管控设置加载失败，请刷新页面再试。
      </div>
    )
  }

  const { readFailed, unconfigured } = state
  const inputCls = 'mt-1 w-full rounded-lg border border-gray-200 p-2 text-sm focus:border-gray-400 focus:outline-none'

  return (
    <div className="rounded-xl border border-gray-200 p-5">
      <div>
        <h3 className="font-medium text-gray-800">广告预算管控</h3>
        <p className="mt-1 text-sm text-gray-500">
          锁定了，系统就不会挪这个客户的广告预算，只会建议、不会动手。
        </p>
      </div>

      {readFailed ? (
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          暂时读不到这个客户的预算管控设置，为免盖掉原来的设置，先别改。请联系技术。
        </p>
      ) : (
        <>
          {unconfigured && (
            <p className="mt-4 rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-600">
              这个客户还没单独配置过，系统按最安全的方式处理：<strong>预算已锁定</strong>，不会自动挪动。
            </p>
          )}

          <div className="mt-4 flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input
                type="checkbox"
                checked={draft.locked}
                onChange={e => setDraft({ ...draft, locked: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300"
              />
              锁定预算（不许系统挪动这个客户的广告花费）
            </label>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-gray-700">
              每日总花费上限（账户币种）
              <input
                type="number" min="0" step="0.01" inputMode="decimal"
                value={draft.totalCap}
                onChange={e => setDraft({ ...draft, totalCap: e.target.value })}
                placeholder="例如 500"
                className={inputCls}
              />
              <span className="mt-1 block text-xs font-normal text-gray-400">
                留空 = 不设这项特定上限（是否允许挪动仍由上面的「锁定」决定）
              </span>
            </label>
            <label className="block text-sm font-medium text-gray-700">
              单个预算单位当日变动上限（%）
              <input
                type="number" min="0" max="100" step="1" inputMode="numeric"
                value={draft.perUnitPct}
                onChange={e => setDraft({ ...draft, perUnitPct: e.target.value })}
                placeholder="例如 20"
                className={inputCls}
              />
              <span className="mt-1 block text-xs font-normal text-gray-400">
                留空 = 用系统默认上限
              </span>
            </label>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={save}
              className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:opacity-50"
            >
              保存预算管控设置
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
