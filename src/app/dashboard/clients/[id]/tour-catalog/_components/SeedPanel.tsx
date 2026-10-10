'use client'

/** Empty-catalog first step: read the tours that already exist on the client's website. */

import { useState } from 'react'
import type { SeedResponse } from '@/lib/tour-catalog/api-contract'
import { errorLabel } from './catalog-format'

export function SeedPanel({
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
      {message && <p className="mt-3 text-sm font-black text-[#456F35]">{message}</p>}
      {error && <p className="mt-3 text-sm font-black text-[#C2453A]">{error}</p>}
    </div>
  )
}
