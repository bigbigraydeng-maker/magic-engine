'use client'

/** 导入记录: past departure-sheet imports, each can be undone (in the draft). */

import { useState } from 'react'
import type { CatalogBatchView } from './types'
import { BATCH_STATUS_LABELS, errorLabel, formatBatchTime } from './catalog-format'
import { useChannelsConnected } from './catalog-context'

/** Rollback confirm text, using row counts when they are numbers. */
function rollbackConfirmText(batch: CatalogBatchView, connected: boolean): string {
  const adds = typeof batch.rowCounts.adds === 'number' ? batch.rowCounts.adds : '若干'
  const updates = typeof batch.rowCounts.updates === 'number' ? batch.rowCounts.updates : '若干'
  return `确定撤销这次导入吗？撤销改的是草稿：这次新增的 ${adds} 个班期会被删除，改过的 ${updates} 个会恢复原样。如果这次导入之后有人手工改过其中的班期，系统会拒绝撤销，以免覆盖后来的修改。已经上架的内容不会跟着变，${connected ? '要让客人看到' : '要让它跟着变'}还得再上架一次。`
}

/** 撤销冲突时服务器返回的细节。 */
interface RollbackConflict {
  reason?: string
  tourName?: string
  departOn?: string
}

/** 撤销冲突的中文说明。 */
function rollbackConflictText(conflict: RollbackConflict): string {
  const name = conflict.tourName ?? '某个团'
  const date = conflict.departOn ?? '某个班期'
  return `撤销不了：这次导入之后，「${name}」${date} 这个班期又被改过（或删了）。为了不覆盖后来的修改，系统不会自动撤销。你可以到「团」页签里打开这个团看「修改记录」，需要的话手工改回去。`
}

export function BatchHistory({
  clientId,
  batches,
  onChanged,
}: {
  clientId: string
  batches: CatalogBatchView[]
  onChanged: () => void
}) {
  const connected = useChannelsConnected()
  if (batches.length === 0) return null
  return (
    <div className="space-y-3 rounded-xl border border-black/10 bg-white p-5 shadow-sm">
      <h2 className="font-display font-black text-me-charcoal">导入记录</h2>
      <p className="text-sm font-semibold text-me-charcoal/55">
        {connected
          ? '导入和撤销改的都是草稿，客人看不到；要对外生效还得点页面上方的「查看并上架」。'
          : '导入和撤销改的都是草稿，还没上架；之后还要点页面上方的「查看并上架」。'}
      </p>
      <ul className="space-y-2">
        {batches.map(b => (
          <BatchRow key={b.id} clientId={clientId} batch={b} onChanged={onChanged} />
        ))}
      </ul>
    </div>
  )
}

function BatchRow({
  clientId,
  batch,
  onChanged,
}: {
  clientId: string
  batch: CatalogBatchView
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const connected = useChannelsConnected()

  const handleRollback = async () => {
    if (!window.confirm(rollbackConfirmText(batch, connected))) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/clients/${clientId}/tour-catalog/batches/${batch.id}/rollback`,
        { method: 'POST' },
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string
          conflict?: RollbackConflict
        }
        if (body.error === 'conflict' && body.conflict) {
          throw new Error(rollbackConflictText(body.conflict))
        }
        throw new Error(errorLabel(body.error ?? `HTTP ${res.status}`))
      }
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const adds = typeof batch.rowCounts.adds === 'number' ? batch.rowCounts.adds : null
  const updates = typeof batch.rowCounts.updates === 'number' ? batch.rowCounts.updates : null

  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-black/5 pb-2 last:border-0 last:pb-0">
      <span className="text-xs font-semibold text-me-charcoal/45">{formatBatchTime(batch.createdAt)}</span>
      <span className="text-sm font-black text-me-charcoal/70">
        {BATCH_STATUS_LABELS[batch.status] ?? batch.status}
      </span>
      {adds !== null && (
        <span className="text-xs font-semibold text-me-charcoal/55">新增 {adds} 个</span>
      )}
      {updates !== null && (
        <span className="text-xs font-semibold text-me-charcoal/55">更新 {updates} 个</span>
      )}
      {batch.status === 'applied' && (
        <button
          onClick={handleRollback}
          disabled={busy}
          className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs font-black text-me-charcoal/70 hover:bg-me-ivory disabled:opacity-40"
        >
          {busy ? '正在撤销…' : '撤销这次导入'}
        </button>
      )}
      {error && <span className="text-xs font-black text-[#C2453A]">{error}</span>}
    </li>
  )
}
