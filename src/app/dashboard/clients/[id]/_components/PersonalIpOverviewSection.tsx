'use client'

import { useCallback, useEffect, useState } from 'react'
import type { PersonalIpTile } from '@/lib/clients/personal-ip-overview'
import { PERSONAL_IP_UNREADABLE } from '@/lib/clients/personal-ip-overview'

interface Props {
  clientId: string
}

export function PersonalIpOverviewSection({ clientId }: Props) {
  const [tiles, setTiles] = useState<PersonalIpTile[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/personal-ip-overview`)
      if (!res.ok) {
        throw new Error(`加载失败 (${res.status})`)
      }
      const body = await res.json() as { tiles?: PersonalIpTile[] }
      setTiles(body.tiles ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
      setTiles(null)
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl border border-black/10 bg-white" />
        ))}
      </div>
    )
  }

  if (error || !tiles) {
    return (
      <div className="rounded-xl border border-me-ochre/30 bg-me-ochre/10 px-4 py-3 text-sm font-semibold text-me-ochre">
        关键数字暂时{PERSONAL_IP_UNREADABLE}：{error ?? '未知错误'}
      </div>
    )
  }

  return (
    <section aria-label="个人 IP 关键数字" className="space-y-3">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-me-ochre">关键数字（近 28 天 · 仅展示）</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {tiles.map((tile) => (
          <div
            key={tile.key}
            className="rounded-xl border border-black/10 bg-white px-4 py-4 shadow-sm"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-me-charcoal/45">
              {tile.label}
            </p>
            <p
              className={`mt-2 text-lg font-black tabular-nums leading-snug ${
                tile.value === PERSONAL_IP_UNREADABLE ? 'text-me-charcoal/45' : 'text-me-charcoal'
              }`}
            >
              {tile.value}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
