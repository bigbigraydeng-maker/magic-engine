'use client'

/**
 * 待审批队列 —— 列表侧。
 *
 * 🔴 三种「没东西看」必须长得不一样，绝不许混成一个空列表：
 *      ① 真的没有等审批的动作     → 「都处理完了」
 *      ② 内核还没在这个环境启用   → 「还没启用」（服务端 503 kernel_not_provisioned）
 *      ③ 出错了                   → 把错误原文摆出来
 *    混成一个空列表 = 界面在替系统撒谎：明明是没启用/出错，看起来却像「没活儿」。
 *
 * 🔴 `skippedRunIds` 和 `hasMore` 必须显示出来。
 *    服务端专门把这两样如实回传，就是因为「少给一条等审批的动作」= 那条动作永远
 *    不会被处理，而界面上看不出少了东西。这里把它们藏起来就等于把服务端的努力废掉。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import DecisionPanel from './DecisionPanel'

export interface ClientOption {
  readonly id: string
  readonly name: string
}

export interface PendingApprovalSummary {
  readonly runId: string
  readonly clientId: string
  readonly expectedDecisionId: string
  readonly actionKey: string
  readonly actionVersion: number
  readonly title: string | null
  readonly risk: string | null
  readonly sideEffect: string | null
  readonly costEstimateUsd: number | null
  readonly costCapUsd: number | null
  readonly rationale: string | null
  readonly requestedAt: string
}

interface ListResponse {
  readonly items: PendingApprovalSummary[]
  readonly skippedRunIds: string[]
  readonly hasMore: boolean
  readonly nextCursor: string | null
}

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'not_provisioned'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: ListResponse }

async function fetchPage(clientId: string, cursor: string | null): Promise<LoadState> {
  const qs = new URLSearchParams({ clientId })
  if (cursor) qs.set('cursor', cursor)

  const res = await fetch(`/api/kernel/approvals?${qs.toString()}`, { cache: 'no-store' })
  const body: unknown = await res.json().catch(() => null)

  if (res.ok) return { kind: 'ready', data: body as ListResponse }

  const err = (body ?? {}) as { code?: string; error?: string }
  if (err.code === 'kernel_not_provisioned') {
    return { kind: 'not_provisioned', message: err.error ?? '内核还没在这个环境启用' }
  }
  return { kind: 'error', message: err.error ?? `请求失败（${res.status}）` }
}

function RiskBadge({ risk, sideEffect }: { risk: string | null; sideEffect: string | null }) {
  const label = [risk, sideEffect].filter(Boolean).join(' · ')
  if (!label) return null
  return (
    <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-800 ring-1 ring-amber-200">
      {label}
    </span>
  )
}

function moneyLine(item: PendingApprovalSummary): string {
  if (item.costEstimateUsd === null && item.costCapUsd === null) return '花费未知'
  const est = item.costEstimateUsd === null ? '?' : `US$${item.costEstimateUsd}`
  const cap = item.costCapUsd === null ? '无上限' : `上限 US$${item.costCapUsd}`
  return `预计 ${est}、${cap}`
}

export default function ApprovalQueue({ clients }: { clients: ClientOption[] }) {
  const [clientId, setClientId] = useState<string>(clients[0]?.id ?? '')
  const [state, setState] = useState<LoadState>({ kind: 'idle' })
  const [selected, setSelected] = useState<PendingApprovalSummary | null>(null)

  /**
   * 🔴 只有「最后一次发出的请求」有资格写状态。
   *    审批人在上一个客户还没读完时切下拉框，两个请求会并发；旧的那个如果更慢，
   *    它回来时会盖掉新的 —— 结果是下拉框写着客户 B、列表却是客户 A 的待办。
   *    在审批场景里这不是显示问题，是**可能让人对着 A 的动作按了 B 的批准**。
   */
  const requestSeq = useRef(0)

  const load = useCallback(async (id: string, cursor: string | null = null) => {
    if (!id) return
    const seq = ++requestSeq.current
    setState({ kind: 'loading' })
    const next = await fetchPage(id, cursor)
    if (seq !== requestSeq.current) return
    setState(next)
  }, [])

  useEffect(() => {
    void load(clientId)
    setSelected(null)
  }, [clientId, load])

  return (
    <div className="space-y-4">
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">看哪个客户</span>
        <select
          className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
        >
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      {state.kind === 'loading' && <p className="text-sm text-slate-500">读取中…</p>}

      {state.kind === 'not_provisioned' && (
        <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-700 ring-1 ring-slate-300">
          <p className="font-medium">内核还没在这个环境启用</p>
          <p className="mt-1 text-slate-600">
            这不是「没有待办」——是承载它的那几张表还没建。建之前这一页不会有任何内容。
          </p>
          <p className="mt-1 text-xs text-slate-500">服务端原话：{state.message}</p>
        </div>
      )}

      {state.kind === 'error' && (
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-800 ring-1 ring-red-200">
          <p className="font-medium">读不出来</p>
          <p className="mt-1">{state.message}</p>
          <button
            className="mt-2 rounded border border-red-300 px-2 py-1 text-xs"
            onClick={() => void load(clientId)}
          >
            重试
          </button>
        </div>
      )}

      {state.kind === 'ready' && (
        <ReadyList
          data={state.data}
          selected={selected}
          onSelect={setSelected}
          onLoadMore={(cursor) => void load(clientId, cursor)}
          onDecided={() => {
            setSelected(null)
            void load(clientId)
          }}
        />
      )}
    </div>
  )
}

function ReadyList({
  data,
  selected,
  onSelect,
  onLoadMore,
  onDecided,
}: {
  data: ListResponse
  selected: PendingApprovalSummary | null
  onSelect: (item: PendingApprovalSummary) => void
  onLoadMore: (cursor: string) => void
  onDecided: () => void
}) {
  return (
    <div className="space-y-3">
      {data.skippedRunIds.length > 0 && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
          <p className="font-medium">有 {data.skippedRunIds.length} 条读不出来，没显示在下面</p>
          <p className="mt-1 text-xs">
            它们的数据对不上，不会自己消失，也不会被处理。编号：
            {data.skippedRunIds.join('、')}
          </p>
        </div>
      )}

      {data.items.length === 0 ? (
        <p className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800 ring-1 ring-emerald-200">
          都处理完了，这个客户没有等你点头的动作。
        </p>
      ) : (
        <ul className="space-y-2">
          {data.items.map((item) => (
            <li key={item.runId}>
              <button
                className={`w-full rounded-lg border p-3 text-left text-sm ${
                  selected?.runId === item.runId
                    ? 'border-slate-900 bg-white'
                    : 'border-slate-200 bg-white hover:border-slate-400'
                }`}
                onClick={() => onSelect(item)}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-900">
                    {item.title ?? item.actionKey}
                  </span>
                  <RiskBadge risk={item.risk} sideEffect={item.sideEffect} />
                </div>
                {item.rationale && (
                  <p className="mt-1 text-slate-600">{item.rationale}</p>
                )}
                <p className="mt-1 text-xs text-slate-500">
                  {moneyLine(item)} · 提交于{' '}
                  {new Date(item.requestedAt).toLocaleString('zh-CN')}
                </p>
              </button>

              {selected?.runId === item.runId && (
                <DecisionPanel item={item} onDecided={onDecided} />
              )}
            </li>
          ))}
        </ul>
      )}

      {data.hasMore && data.nextCursor && (
        <button
          className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          onClick={() => onLoadMore(data.nextCursor as string)}
        >
          还有更多，加载下一页
        </button>
      )}
    </div>
  )
}
