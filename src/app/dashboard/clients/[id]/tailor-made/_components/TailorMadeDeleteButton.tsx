'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * 列表页的「删除」。实际做的是归档（status → archived）：列表默认不显示已归档，
 * 对员工来说等于删掉；但数据还在，删错了能找回。不走 DELETE 硬删。
 * 复用现有 GET + PUT，不新增接口。
 */
export default function TailorMadeDeleteButton({
  clientId,
  itineraryId,
  label,
}: {
  clientId: string
  itineraryId: string
  label: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remove = async () => {
    if (!window.confirm(`确定删除「${label}」？\n删除后列表里不再显示（后台留底，删错可找回）。`)) return
    setBusy(true)
    setError(null)
    try {
      const url = `/api/clients/${clientId}/tailor-made/${itineraryId}`
      const res = await fetch(url, { credentials: 'include' })
      if (!res.ok) throw new Error('读取行程单失败')
      const payload = (await res.json()).item?.payload
      if (!payload) throw new Error('读取行程单失败')

      const put = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload, status: 'archived' }),
        credentials: 'include',
      })
      if (!put.ok) throw new Error((await put.json().catch(() => ({}))).error || '删除失败')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-bold text-me-charcoal/50 transition-colors hover:border-[#C2453A]/40 hover:text-[#C2453A] disabled:opacity-50"
      >
        {busy ? '删除中…' : '删除'}
      </button>
      {error && <span className="text-xs font-semibold text-[#C2453A]">{error}</span>}
    </span>
  )
}
