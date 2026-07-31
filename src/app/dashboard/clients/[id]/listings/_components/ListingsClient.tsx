'use client'

/**
 * 房子列表 —— 一行一套房。
 *
 * 加载 / 出错 / 就绪 三态照 BrandAliasesPanel 的写法。表格样式跟
 * tailor-made 列表页一致(同一个「经营工具」家族,别让 FDE 每页重新学一遍)。
 *
 * 没有删除按钮:删房子会连带影响已经挂在它下面的人和战役,是不可逆操作,
 * 要 PM 单独决定。不要的房子改成「已撤下」。
 */

import { useCallback, useEffect, useState } from 'react'
import {
  propertyTypeLabel,
  priceBandLabel,
  listingStatusMeta,
  type ListingStatusMeta,
} from '@/lib/listings/constants'
import type { ListingWithCount } from '@/lib/listings/queries'
import { ListingForm } from './ListingForm'

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; listings: ListingWithCount[] }

/** 编辑中的那套房;'new' = 正在建新的;null = 没开表单。 */
type Editing = ListingWithCount | 'new' | null

const TONE_CLS: Record<ListingStatusMeta['tone'], string> = {
  prospect:  'bg-me-ivory text-me-charcoal/60 border-black/10',
  live:      'bg-[#5C8A4A]/12 text-[#5C8A4A] border-[#5C8A4A]/30',
  offer:     'bg-me-ochre/15 text-me-ochre border-me-ochre/30',
  sold:      'bg-[#3E6E8C]/12 text-[#3E6E8C] border-[#3E6E8C]/30',
  withdrawn: 'bg-me-ivory text-me-charcoal/35 border-black/5',
}

export function ListingsClient({ clientId }: { clientId: string }) {
  const [state, setState]     = useState<State>({ phase: 'loading' })
  const [editing, setEditing] = useState<Editing>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/listings`)
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(error ?? `HTTP ${res.status}`)
      }
      const { listings } = (await res.json()) as { listings: ListingWithCount[] }
      setState({ phase: 'ready', listings: listings ?? [] })
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  /** 保存后就地替换 / 插到最前,不重新拉整张表。 */
  const handleSaved = (saved: ListingWithCount) => {
    setState(prev => {
      if (prev.phase !== 'ready') return prev
      const exists = prev.listings.some(l => l.id === saved.id)
      return {
        phase: 'ready',
        listings: exists
          ? prev.listings.map(l => (l.id === saved.id ? saved : l))
          : [saved, ...prev.listings],
      }
    })
    setEditing(null)
  }

  if (state.phase === 'loading') {
    return <p className="text-sm font-semibold text-me-charcoal/40">加载中…</p>
  }

  if (state.phase === 'error') {
    return (
      <div className="rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/8 p-4">
        <p className="text-sm font-black text-[#C2453A]">读取房子列表失败</p>
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

  return (
    <div className="space-y-5">
      {editing === null && (
        <div className="flex justify-end">
          <button
            onClick={() => setEditing('new')}
            className="rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white hover:bg-me-charcoal/85"
          >
            + 建一套房
          </button>
        </div>
      )}

      {editing !== null && (
        <ListingForm
          clientId={clientId}
          existing={editing === 'new' ? null : editing}
          onSaved={handleSaved}
          onCancel={() => setEditing(null)}
        />
      )}

      {state.listings.length === 0 && editing === null && <EmptyState />}

      {state.listings.length > 0 && (
        <ListingTable listings={state.listings} onEdit={setEditing} />
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-black/10 bg-white p-10 text-center">
      <p className="font-black text-me-charcoal">这个客户还没有房子</p>
      <p className="mx-auto mt-2 max-w-md text-sm font-semibold text-me-charcoal/55">
        建第一套房之后，进来的每个人、每次投放都能挂到具体哪套房上 ——
        「哪个郊区的客人更容易成交」「这个价位该投多少钱」才有得算。
      </p>
      <p className="mt-3 text-xs font-semibold text-me-charcoal/40">
        点右上角「建一套房」开始。只有门牌地址是必填的，其余可以边卖边补。
      </p>
    </div>
  )
}

function ListingTable({
  listings,
  onEdit,
}: {
  listings: ListingWithCount[]
  onEdit: (l: ListingWithCount) => void
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-black/10 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="border-b border-black/10 bg-me-ivory text-left text-[10px] font-black uppercase tracking-[.12em] text-me-charcoal/45">
          <tr>
            <th className="px-4 py-3">地址</th>
            <th className="px-4 py-3">郊区</th>
            <th className="px-4 py-3">状态</th>
            <th className="px-4 py-3">价格档</th>
            <th className="px-4 py-3">房型 / 卧室</th>
            <th className="px-4 py-3">带来的客人</th>
            <th className="px-4 py-3">上市日期</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {listings.map(l => (
            <tr key={l.id} className="border-b border-black/5 last:border-0 hover:bg-me-ivory/60">
              <td className="px-4 py-3 font-black text-me-charcoal">{l.address_line}</td>
              <td className="px-4 py-3 font-semibold text-me-charcoal/70">
                {l.suburb || <span className="text-me-charcoal/35">—</span>}
              </td>
              <td className="px-4 py-3"><StatusChip status={l.status} /></td>
              <td className="px-4 py-3 font-semibold text-me-charcoal/70">
                {priceBandLabel(l.price_band)}
              </td>
              <td className="px-4 py-3 font-semibold text-me-charcoal/70">
                {propertyTypeLabel(l.property_type)}
                {l.bedrooms != null && (
                  <span className="text-me-charcoal/45"> · {l.bedrooms} 房</span>
                )}
              </td>
              <td className="px-4 py-3">
                {l.contact_count > 0 ? (
                  <span className="font-black text-me-charcoal">{l.contact_count} 人</span>
                ) : (
                  <span className="text-xs font-semibold text-me-charcoal/35">还没有人</span>
                )}
              </td>
              <td className="px-4 py-3 text-xs font-semibold text-me-charcoal/45">
                {l.listed_on || '—'}
              </td>
              <td className="px-4 py-3 text-right">
                <button
                  onClick={() => onEdit(l)}
                  className="text-xs font-black text-me-charcoal/50 hover:text-me-ochre"
                >
                  编辑
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StatusChip({ status }: { status: string }) {
  const meta = listingStatusMeta(status)
  return (
    <span
      title={meta.hint}
      className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold leading-none ${TONE_CLS[meta.tone]}`}
    >
      {meta.label}
    </span>
  )
}
