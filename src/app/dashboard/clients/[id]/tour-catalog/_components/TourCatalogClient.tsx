'use client'

/**
 * 团目录 —— 这家客户所有团的统一档案。
 *
 * 加载 / 出错 / 就绪 三态照 ListingsClient 的写法。团列表用 <details> 折叠,
 * 展开看班期。下面挂上传班期表和导入记录。
 */

import { useCallback, useEffect, useState } from 'react'
import type {
  CatalogBatchView,
  CatalogDepartureView,
  CatalogSnapshotResponse,
  CatalogTourView,
} from './types'
import { ImportPanel } from './ImportPanel'
import { TourEditor } from './TourEditor'
import { DeparturesEditor } from './DeparturesEditor'
import { ChangeLog } from './ChangeLog'
import type { SeedResponse } from '@/lib/tour-catalog/api-contract'

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; snapshot: CatalogSnapshotResponse }

/** 接口错误码的中文说法。未知的码原样显示。 */
const ERROR_LABELS: Record<string, string> = {
  feed_not_configured: '这家客户的网站还没有开通团数据读取，请联系开发',
  client_domain_missing: '这家客户的档案里还没有登记网站，请先在客户设置里填上网站',
  catalog_load_failed: '服务器暂时读不到数据，请点重试；还不行请联系开发',
  feed_unavailable: '网站暂时读取不到',
  conflict: '撤销失败：导入之后又有人改过这些班期，为避免覆盖已拒绝撤销',
  not_applicable: '这次导入现在不能撤销',
  alias_not_found: '这个叫法已经不存在了',
  alias_failed: '删除失败，请稍后重试',
}

/** "2026-10-10T00:26:16+13:00" -> "10月10日 00:26" in the viewer's local time; raw text if unparseable. */
function formatBatchTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function errorLabel(code: string): string {
  return ERROR_LABELS[code] ?? code
}

/** 班期状态的中文说法。 */
const DEPARTURE_STATUS_LABELS: Record<string, string> = {
  open: '可订',
  limited: '少量余位',
  sold_out: '已满团',
  closed: '已关闭',
  cancelled: '已取消',
}

/** 导入记录状态的中文说法。 */
const BATCH_STATUS_LABELS: Record<string, string> = {
  previewed: '只预览未导入',
  applied: '已导入',
  rolled_back: '已撤销',
  rejected: '已作废',
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** 即将出发 = 出团日不早于今天,且状态是可订 / 少量余位。 */
function upcomingCount(departures: CatalogDepartureView[]): number {
  const today = todayIso()
  return departures.filter(
    d => d.departOn >= today && (d.status === 'open' || d.status === 'limited'),
  ).length
}

/** 展示价文案：没价显示「未定价」，含 TBC 显示「价格待定」，否则原样显示。 */
function priceText(displayPriceText: string | null): string {
  if (!displayPriceText) return '未定价'
  if (displayPriceText.toUpperCase().includes('TBC')) return '价格待定'
  return displayPriceText
}

/** Rollback confirm text, using row counts when they are numbers. */
function rollbackConfirmText(batch: CatalogBatchView): string {
  const adds = typeof batch.rowCounts.adds === 'number' ? batch.rowCounts.adds : '若干'
  const updates = typeof batch.rowCounts.updates === 'number' ? batch.rowCounts.updates : '若干'
  return `确定撤销这次导入吗？这次新增的 ${adds} 个班期会被删除，改过的 ${updates} 个会恢复原样。如果这次导入之后有人手工改过其中的班期，系统会拒绝撤销，以免覆盖后来的修改。`
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
  return `撤销不了：这次导入之后，「${name}」${date} 这个班期又被改过（或删了）。为了不覆盖后来的修改，系统不会自动撤销。你可以展开这个团看「修改记录」，需要的话手工改回去。`
}

export function TourCatalogClient({ clientId }: { clientId: string }) {
  const [state, setState] = useState<State>({ phase: 'loading' })

  // silent = refresh data without blanking the page (keeps an open import preview intact).
  const load = useCallback(async (silent = false) => {
    if (!silent) setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/tour-catalog`)
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(errorLabel(error ?? `HTTP ${res.status}`))
      }
      const snapshot = (await res.json()) as CatalogSnapshotResponse
      setState({ phase: 'ready', snapshot })
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [clientId])

  useEffect(() => { load() }, [load])
  const reload = useCallback(() => { load() }, [load])
  const refreshQuietly = useCallback(() => { load(true) }, [load])

  if (state.phase === 'loading') {
    return <p className="text-sm font-semibold text-me-charcoal/40">加载中…</p>
  }

  if (state.phase === 'error') {
    return (
      <div className="rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/8 p-4">
        <p className="text-sm font-black text-[#C2453A]">读取团目录失败</p>
        <p className="mt-1 text-sm font-semibold text-me-charcoal/70">{state.message}</p>
        <button
          onClick={() => { load() }}
          className="mt-3 rounded-lg border border-[#C2453A]/30 bg-white px-3 py-1 text-xs font-black text-[#C2453A] hover:bg-[#C2453A]/10"
        >
          重试
        </button>
      </div>
    )
  }

  const { tours, departures, aliases, batches } = state.snapshot

  return (
    <div className="space-y-5">
      {tours.length === 0 ? (
        <SeedPanel clientId={clientId} domain={state.snapshot.domain} onSeeded={refreshQuietly} />
      ) : (
        <TourList
          clientId={clientId}
          tours={tours}
          departures={departures}
          onChanged={refreshQuietly}
        />
      )}

      <AliasList clientId={clientId} aliases={aliases} tours={tours} onChanged={refreshQuietly} />

      <ImportPanel
        clientId={clientId}
        tours={tours}
        onChanged={reload}
        onAliasesChanged={refreshQuietly}
      />

      {/* Preview-only batches are drafts, not history: list only what was imported or undone. */}
      <BatchHistory
        clientId={clientId}
        batches={batches.filter(b => b.status !== 'previewed')}
        onChanged={reload}
      />
    </div>
  )
}

function SeedPanel({
  clientId,
  domain,
  onSeeded,
}: {
  clientId: string
  domain: string | null
  onSeeded: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSeed = async () => {
    setBusy(true)
    setMessage(null)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/tour-catalog/seed`, { method: 'POST' })
      if (!res.ok) {
        const { error: code } = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(errorLabel(code ?? `HTTP ${res.status}`))
      }
      const data = (await res.json()) as SeedResponse
      setMessage(`已读入 ${data.toursInserted ?? 0} 个团、${data.departuresInserted ?? 0} 个班期`)
      onSeeded()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-dashed border-black/10 bg-white p-10 text-center">
      <p className="font-black text-me-charcoal">还没有任何团</p>
      <p className="mx-auto mt-2 max-w-md text-sm font-semibold text-me-charcoal/55">
        {domain
          ? `第一次使用：点下面的按钮，把 ${domain} 上现有的团读进来，之后就在这里统一维护。`
          : '这家客户的档案里还没有登记网站，读不了现有的团。请先在客户设置里填上网站。'}
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={handleSeed}
          disabled={busy || !domain}
          className="rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white hover:bg-me-charcoal/85 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? '正在读取…' : '读入网站上现有的团'}
        </button>
      </div>
      {message && <p className="mt-3 text-sm font-black text-[#5C8A4A]">{message}</p>}
      {error && <p className="mt-3 text-sm font-black text-[#C2453A]">{error}</p>}
    </div>
  )
}

function TourList({
  clientId,
  tours,
  departures,
  onChanged,
}: {
  clientId: string
  tours: CatalogTourView[]
  departures: CatalogDepartureView[]
  onChanged: () => void
}) {
  return (
    <div className="space-y-3">
      {tours.map(tour => (
        <TourBlock
          key={tour.id}
          clientId={clientId}
          tour={tour}
          departures={departures.filter(d => d.tourId === tour.id)}
          onChanged={onChanged}
        />
      ))}
    </div>
  )
}

function TourBlock({
  clientId,
  tour,
  departures,
  onChanged,
}: {
  clientId: string
  tour: CatalogTourView
  departures: CatalogDepartureView[]
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const upcoming = upcomingCount(departures)
  const refreshKey = [tour.updatedAt ?? '', ...departures.map(d => d.updatedAt ?? '')].join('|')

  return (
    <details className="rounded-xl border border-black/10 bg-white shadow-sm">
      <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3">
        <span className="font-black text-me-charcoal">{tour.name}</span>
        <span className="text-sm font-semibold text-me-charcoal/70">
          {priceText(tour.displayPriceText)}
        </span>
        <span className="text-sm font-semibold text-me-charcoal/55">
          即将出发 {upcoming} 个班期
        </span>
        {!tour.isActive && (
          <span className="rounded-full border border-[#C2453A]/30 bg-[#C2453A]/10 px-2 py-0.5 text-[10px] font-bold text-[#C2453A]">
            已下架
          </span>
        )}
        {!tour.managesDepartures && (
          <span className="rounded-full border border-black/10 bg-me-ivory px-2 py-0.5 text-[10px] font-bold text-me-charcoal/45">
            不管理班期
          </span>
        )}
      </summary>
      <div className="space-y-4 border-t border-black/5 px-4 py-3">
        {editing ? (
          <TourEditor
            clientId={clientId}
            tour={tour}
            onSaved={() => {
              setEditing(false)
              onChanged()
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-lg border border-black/10 bg-white px-3 py-1 text-sm font-semibold text-me-charcoal hover:bg-me-ivory"
            >
              编辑这个团
            </button>
          </div>
        )}

        <DeparturesEditor
          clientId={clientId}
          tourId={tour.id}
          departures={departures}
          onChanged={onChanged}
        />

        <ChangeLog clientId={clientId} tourId={tour.id} refreshKey={refreshKey} />
      </div>
    </details>
  )
}

function AliasList({
  clientId,
  aliases,
  tours,
  onChanged,
}: {
  clientId: string
  aliases: Array<{ aliasNorm: string; tourId: string }>
  tours: CatalogTourView[]
  onChanged: () => void
}) {
  const tourName = (tourId: string) => tours.find(t => t.id === tourId)?.name ?? tourId
  return (
    <div className="space-y-3 rounded-xl border border-black/10 bg-white p-5 shadow-sm">
      <h2 className="font-display font-black text-me-charcoal">已记住的叫法</h2>
      <p className="text-sm font-semibold text-me-charcoal/55">
        班期表里的团名有时和系统里的不一样（比如表里只写 Natural China，系统里有高端款和普通款两个）。
        预览时你选一次对应的是哪个团，系统就记在这里，以后同样的写法会自动对上。选错了可以在这里删掉。
      </p>
      {aliases.length === 0 ? (
        <p className="text-sm font-semibold text-me-charcoal/40">现在还没有，第一次上传班期表时如果有对不上的团名，会在预览里让你选。</p>
      ) : (
        <ul className="space-y-2">
          {aliases.map(a => (
            <AliasRow
              key={a.aliasNorm}
              clientId={clientId}
              aliasNorm={a.aliasNorm}
              tourName={tourName(a.tourId)}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function AliasRow({
  clientId,
  aliasNorm,
  tourName,
  onChanged,
}: {
  clientId: string
  aliasNorm: string
  tourName: string
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDelete = async () => {
    const ok = window.confirm(
      '删除这个叫法后，表里再出现它时会重新要你选择对应的团。确定删除吗？',
    )
    if (!ok) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/tour-catalog/aliases`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aliasNorm }),
      })
      if (!res.ok) {
        const { error: code } = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(errorLabel(code ?? `HTTP ${res.status}`))
      }
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-black/5 pb-2 last:border-0 last:pb-0">
      <span className="text-sm font-semibold text-me-charcoal/70">{aliasNorm}</span>
      <span className="text-sm font-semibold text-me-charcoal/45">→</span>
      <span className="text-sm font-black text-me-charcoal">{tourName}</span>
      <button
        onClick={handleDelete}
        disabled={busy}
        className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs font-black text-me-charcoal/70 hover:bg-me-ivory disabled:opacity-40"
      >
        {busy ? '正在删除…' : '删除'}
      </button>
      {error && <span className="text-xs font-black text-[#C2453A]">{error}</span>}
    </li>
  )
}

function BatchHistory({
  clientId,
  batches,
  onChanged,
}: {
  clientId: string
  batches: CatalogBatchView[]
  onChanged: () => void
}) {
  if (batches.length === 0) return null
  return (
    <div className="space-y-3 rounded-xl border border-black/10 bg-white p-5 shadow-sm">
      <h2 className="font-display font-black text-me-charcoal">导入记录</h2>
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

  const handleRollback = async () => {
    if (!window.confirm(rollbackConfirmText(batch))) return
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
