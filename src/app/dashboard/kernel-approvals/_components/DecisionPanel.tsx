'use client'

/**
 * 一条待审批动作的详情 + 那一下点头 / 否决。
 *
 * 🔴 `expectedDecisionId` 必须原样带回服务端。它是这份数据的版本号：
 *    对不上 = 审批人看的是旧的一版（这条动作在他看的期间被别人处理过 / 政策变了），
 *    服务端一律拒绝。界面这时要说人话「你看的不是最新的，刷新再看一遍」，
 *    **绝不能自作主张重取一个新的版本号再提交** —— 那等于替人盲签。
 *
 * 🔴 「同意」的终点是 `authorized`，不是「已执行」。文案上必须区分，
 *    否则审批人以为自己点的是「现在就去做」。
 *
 * 🔴 `canApprove=false` 时按钮要禁用并说明原因，但「先不做」永远可点 ——
 *    否则契约升版后的旧请求会永久卡死（服务端注释里写明了这个坑）。
 */

import { useEffect, useState } from 'react'
import type { PendingApprovalSummary } from './ApprovalQueue'

interface ApprovalPermissions {
  readonly canApprove: boolean
  readonly canReject: boolean
  readonly approveBlockedReason: string | null
}

interface DetailResponse {
  readonly item: PendingApprovalSummary & {
    readonly input: Record<string, unknown>
    readonly status: string
  }
  readonly actor: { readonly email: string; readonly tier: string }
  readonly permissions: ApprovalPermissions
}

interface DecisionResult {
  readonly finalStatus: 'authorized' | 'denied'
  readonly decidedBy: string
  readonly reason: string
}

type PanelState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; detail: DetailResponse }
  | { kind: 'done'; result: DecisionResult }

/**
 * 🔴 这里的 key 必须跟服务端 `approvalPermissionsFor` 真实返回的字符串逐字一致
 *    （`service.ts`：`insufficient_tier` / `unknown_action` / `unknown_action_version`）。
 *    对不上不会报错，只会安静地退回去显示原始英文码 —— 审批人看不懂，
 *    而我们也不会知道这条提示从来没生效过。
 */
const BLOCKED_REASON_LABEL: Record<string, string> = {
  insufficient_tier: '你的账号权限不够批这条（可以点「先不做」）',
  unknown_action: '系统认不出这个动作，不给批（可以点「先不做」）',
  unknown_action_version: '这条是旧版本的请求，不能用新规则批（可以点「先不做」）',
}

export default function DecisionPanel({
  item,
  onDecided,
}: {
  item: PendingApprovalSummary
  onDecided: () => void
}) {
  const [state, setState] = useState<PanelState>({ kind: 'loading' })
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      const res = await fetch(`/api/kernel/approvals/${item.runId}`, { cache: 'no-store' })
      const body: unknown = await res.json().catch(() => null)
      if (!alive) return
      if (!res.ok) {
        const err = (body ?? {}) as { error?: string }
        setState({ kind: 'error', message: err.error ?? `读不出详情（${res.status}）` })
        return
      }
      setState({ kind: 'ready', detail: body as DetailResponse })
    })()
    return () => {
      alive = false
    }
  }, [item.runId])

  async function submit(resolution: 'approve' | 'reject') {
    setSubmitting(true)
    const res = await fetch(`/api/kernel/approvals/${item.runId}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resolution,
        expectedDecisionId: item.expectedDecisionId,
        reason: reason.trim() || undefined,
      }),
    })
    const body: unknown = await res.json().catch(() => null)
    setSubmitting(false)

    if (!res.ok) {
      const err = (body ?? {}) as { error?: string }
      setState({ kind: 'error', message: err.error ?? `没提交成功（${res.status}）` })
      return
    }
    setState({ kind: 'done', result: body as DecisionResult })
  }

  if (state.kind === 'loading') {
    return <p className="mt-2 px-3 text-sm text-slate-500">读取详情中…</p>
  }

  if (state.kind === 'error') {
    return (
      <div className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">
        <p>{state.message}</p>
        <button className="mt-2 text-xs underline" onClick={onDecided}>
          刷新这个列表再看一遍
        </button>
      </div>
    )
  }

  if (state.kind === 'done') {
    const approved = state.result.finalStatus === 'authorized'
    return (
      <div className="mt-2 rounded-lg bg-slate-50 p-3 text-sm ring-1 ring-slate-200">
        <p className="font-medium text-slate-900">
          {approved ? '已签上授权' : '已否决'}
        </p>
        <p className="mt-1 text-slate-600">
          {approved
            ? '这条动作现在停在「已授权」——它还没有被执行，也不会自己开始。'
            : '这条动作不会再被捡起来。'}
        </p>
        <button className="mt-2 text-xs underline" onClick={onDecided}>
          回到列表
        </button>
      </div>
    )
  }

  const { detail } = state
  const blockedLabel = detail.permissions.approveBlockedReason
    ? (BLOCKED_REASON_LABEL[detail.permissions.approveBlockedReason] ??
      detail.permissions.approveBlockedReason)
    : null

  return (
    <div className="mt-2 space-y-3 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          这条动作会做什么
        </p>
        <pre className="mt-1 max-h-64 overflow-auto rounded bg-white p-2 text-xs text-slate-800 ring-1 ring-slate-200">
          {JSON.stringify(detail.item.input, null, 2)}
        </pre>
      </div>

      <p className="text-xs text-slate-500">
        以 {detail.actor.email} 的身份审批 · 动作 {detail.item.actionKey} v
        {detail.item.actionVersion}
      </p>

      {blockedLabel && (
        <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900 ring-1 ring-amber-200">
          {blockedLabel}
        </p>
      )}

      <label className="block text-sm">
        <span className="mb-1 block text-slate-700">
          理由（「先不做」必填，「同意」可不填）
        </span>
        <textarea
          className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>

      <div className="flex gap-2">
        <button
          className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:bg-slate-300"
          disabled={!detail.permissions.canApprove || submitting}
          onClick={() => void submit('approve')}
        >
          同意（只签授权，不执行）
        </button>
        <button
          className="rounded border border-slate-400 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-40"
          disabled={!detail.permissions.canReject || submitting || !reason.trim()}
          onClick={() => void submit('reject')}
        >
          先不做
        </button>
      </div>
    </div>
  )
}
