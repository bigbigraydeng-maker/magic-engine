'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * 新建行程单。传 sourceId 时以该行程为蓝本复制
 * （tailor-made 的新单大多是老单改出来的，复制比从零填快得多）。
 */
export default function TailorMadeNewButton({
  clientId,
  sourceId,
  label = '新建行程单',
  variant = 'primary',
}: {
  clientId: string
  sourceId?: string
  label?: string
  variant?: 'primary' | 'ghost'
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      let source
      if (sourceId) {
        const res = await fetch(`/api/clients/${clientId}/tailor-made/${sourceId}`, {
          credentials: 'include',
        })
        if (!res.ok) throw new Error('读取原行程失败')
        source = (await res.json()).item?.payload
      }

      const res = await fetch(`/api/clients/${clientId}/tailor-made`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source }),
        credentials: 'include',
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '新建失败')

      const { item } = await res.json()
      router.push(`/dashboard/clients/${clientId}/tailor-made/${item.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '新建失败')
      setBusy(false)
    }
  }

  const cls =
    variant === 'primary'
      ? 'rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white transition-colors hover:bg-me-ochre disabled:opacity-50'
      : 'rounded-lg border border-black/10 px-3 py-1.5 text-xs font-bold text-me-charcoal/60 transition-colors hover:border-me-ochre/40 hover:text-me-ochre disabled:opacity-50'

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" onClick={create} disabled={busy} className={cls}>
        {busy ? '创建中…' : label}
      </button>
      {error && <span className="text-xs font-semibold text-[#C2453A]">{error}</span>}
    </span>
  )
}
