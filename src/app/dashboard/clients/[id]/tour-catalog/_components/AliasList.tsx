'use client'

/** 叫法对照: names remembered from past imports, mapped to tours. */

import { useState } from 'react'
import type { CatalogTourView } from './types'
import { errorLabel } from './catalog-format'

export function AliasList({
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
