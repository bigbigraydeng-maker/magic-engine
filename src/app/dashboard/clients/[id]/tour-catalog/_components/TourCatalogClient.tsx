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

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; snapshot: CatalogSnapshotResponse }

/** 接口错误码的中文说法。未知的码原样显示。 */
const ERROR_LABELS: Record<string, string> = {
  feed_not_configured: '这个网站还没有配置可读取的团数据源',
  feed_unavailable: '网站暂时读取不到',
  conflict: '撤销失败：导入之后又有人改过这些班期，为避免覆盖已拒绝撤销',
  not_applicable: '这次导入现在不能撤销',
}

function errorLabel(code: string): string {
  return ERROR_LABELS[code] ?? code
}

/** 班期状态的中文说法。 */
const DEPARTURE_STATUS_LABELS: Record<string, string> = {
  open: '可订',
  limited: '少量余位',
  sold_out: '已售罄',
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

export function TourCatalogClient({ clientId }: { clientId: string }) {
  const [state, setState] = useState<State>({ phase: 'loading' })

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
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

  if (state.phase === 'loading') {
    return <p className="text-sm font-semibold text-me-charcoal/40">加载中…</p>
  }

  if (state.phase === 'error') {
    return (
      <div className="rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/8 p-4">
        <p className="text-sm font-black text-[#C2453A]">读取团目录失败</p>
        <p className="mt-1 text-sm font-semibold text-me-charcoal/70">{state.message}</p>
        <button
          onClick={load}
          className="mt-3 rounded-lg border border-[#C2453A]/30 bg-white px-3 py-1 text-xs font-black text-[#C2453A] hover:bg-[#C2453A]/10"
        >
          重试
        </button>
      </div>
    )
  }

  const { tours, departures, batches } = state.snapshot

  return (
    <div className="space-y-5">
      {tours.length === 0 ? (
        <SeedPanel clientId={clientId} onSeeded={load} />
      ) : (
        <TourList tours={tours} departures={departures} />
      )}

      <ImportPanel clientId={clientId} tours={tours} onChanged={load} />

      <BatchHistory clientId={clientId} batches={batches} onChanged={load} />
    </div>
  )
}

function SeedPanel({ clientId, onSeeded }: { clientId: string; onSeeded: () => void }) {
  const [domain, setDomain] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSeed = async () => {
    if (!domain.trim()) return
    setBusy(true)
    setMessage(null)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/tour-catalog/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
      })
      if (!res.ok) {
        const { error: code } = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(errorLabel(code ?? `HTTP ${res.status}`))
      }
      const data = (await res.json()) as { tours?: number; departures?: number }
      setMessage(`已导入 ${data.tours ?? 0} 个团、${data.departures ?? 0} 个班期`)
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
        填上网站域名，我们可以先把你网站上现有的团读进来，之后在这里统一维护。
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        <input
          type="text"
          value={domain}
          onChange={e => setDomain(e.target.value)}
          placeholder="网站域名"
          className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal"
        />
        <button
          onClick={handleSeed}
          disabled={busy || !domain.trim()}
          className="rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white hover:bg-me-charcoal/85 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? '正在导入…' : '从网站导入现有的团'}
        </button>
      </div>
      {message && <p className="mt-3 text-sm font-black text-[#5C8A4A]">{message}</p>}
      {error && <p className="mt-3 text-sm font-black text-[#C2453A]">{error}</p>}
    </div>
  )
}

function TourList({
  tours,
  departures,
}: {
  tours: CatalogTourView[]
  departures: CatalogDepartureView[]
}) {
  return (
    <div className="space-y-3">
      {tours.map(tour => (
        <TourBlock
          key={tour.id}
          tour={tour}
          departures={departures.filter(d => d.tourId === tour.id)}
        />
      ))}
    </div>
  )
}

function TourBlock({
  tour,
  departures,
}: {
  tour: CatalogTourView
  departures: CatalogDepartureView[]
}) {
  const upcoming = upcomingCount(departures)
  return (
    <details className="rounded-xl border border-black/10 bg-white shadow-sm">
      <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3">
        <span className="font-black text-me-charcoal">{tour.name}</span>
        <span className="text-sm font-semibold text-me-charcoal/70">
          {tour.displayPriceText || '未定价'}
        </span>
        <span className="text-sm font-semibold text-me-charcoal/55">
          即将出发 {upcoming} 个班期
        </span>
        {!tour.managesDepartures && (
          <span className="rounded-full border border-black/10 bg-me-ivory px-2 py-0.5 text-[10px] font-bold text-me-charcoal/45">
            不管理班期
          </span>
        )}
      </summary>
      <div className="border-t border-black/5 px-4 py-3">
        {departures.length === 0 ? (
          <p className="text-sm font-semibold text-me-charcoal/40">还没有班期</p>
        ) : (
          <DepartureTable departures={departures} />
        )}
      </div>
    </details>
  )
}

function DepartureTable({ departures }: { departures: CatalogDepartureView[] }) {
  const today = todayIso()
  return (
    <div className="overflow-x-auto rounded-xl border border-black/10">
      <table className="w-full text-sm">
        <thead className="border-b border-black/10 bg-me-ivory text-left text-[10px] font-black uppercase tracking-[.12em] text-me-charcoal/45">
          <tr>
            <th className="px-4 py-3">出团日</th>
            <th className="px-4 py-3">返程日</th>
            <th className="px-4 py-3">状态</th>
            <th className="px-4 py-3">该班展示价</th>
          </tr>
        </thead>
        <tbody>
          {departures.map(d => {
            const past = d.departOn < today || d.status === 'cancelled'
            return (
              <tr
                key={d.id}
                className={`border-b border-black/5 last:border-0 ${past ? 'text-me-charcoal/35' : ''}`}
              >
                <td className="px-4 py-3 font-semibold">{d.departOn}</td>
                <td className="px-4 py-3 font-semibold">{d.returnOn || '—'}</td>
                <td className="px-4 py-3 font-semibold">
                  {DEPARTURE_STATUS_LABELS[d.status] ?? d.status}
                </td>
                <td className="px-4 py-3 font-semibold">{d.priceTextOverride || '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
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
    if (!window.confirm('确定撤销这次导入吗？这次新增的班期会被删除，改过的会恢复。')) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/clients/${clientId}/tour-catalog/batches/${batch.id}/rollback`,
        { method: 'POST' },
      )
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

  const adds = typeof batch.rowCounts.adds === 'number' ? batch.rowCounts.adds : null
  const updates = typeof batch.rowCounts.updates === 'number' ? batch.rowCounts.updates : null

  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-black/5 pb-2 last:border-0 last:pb-0">
      <span className="text-xs font-semibold text-me-charcoal/45">{batch.createdAt}</span>
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
