'use client'

// 社媒日常页的「短视频」只读面板 —— 视频由视频工厂统一生产与审核,
// 这里只看排期和状态,数据与「本周总览」同源(social-overview 接口,已按客户过滤)。

import { useEffect, useState } from 'react'
import Link from 'next/link'

import { STATUS_META } from '@/app/dashboard/factory/_components/statusMeta'
import type { WorkOrderStatus } from '@/lib/factory/types'
import { describeReelUploadState } from '@/lib/social/story-lite/page-text'
import type { OverviewReel } from '@/lib/social/week-overview/build'

type LoadState = 'loading' | 'ready' | 'unauthenticated' | 'forbidden' | 'error'

export function DailyPlanReelsPanel({ clientId }: { clientId: string }) {
  const [load, setLoad] = useState<LoadState>('loading')
  const [reels, setReels] = useState<OverviewReel[]>([])
  const [reelsError, setReelsError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoad('loading')
    setReelsError(null)
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/social-overview`)
        if (cancelled) return
        if (res.status === 401) return setLoad('unauthenticated')
        if (res.status === 403) return setLoad('forbidden')
        const json = (await res.json().catch(() => ({}))) as {
          success?: boolean
          reels?: OverviewReel[]
          reels_error?: string | null
        }
        if (!res.ok || json.success !== true) return setLoad('error')
        setReels(Array.isArray(json.reels) ? json.reels : [])
        setReelsError(typeof json.reels_error === 'string' ? json.reels_error : null)
        setLoad('ready')
      } catch {
        if (!cancelled) setLoad('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [clientId])

  return (
    <section className="bg-white rounded-xl border border-black/10 p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <h2 className="text-sm font-semibold text-me-charcoal">短视频（共 {reels.length} 条）</h2>
        <Link
          href={`/dashboard/factory?client=${clientId}`}
          className="text-xs text-blue-600 underline"
        >去视频工厂</Link>
      </div>
      <p className="text-xs text-me-charcoal/60 mb-4">
        这里只看排期和状态；审片、通过、打回、看片都在视频工厂。
      </p>

      {load === 'loading' ? (
        <p className="text-xs text-me-charcoal/50">加载中…</p>
      ) : load === 'unauthenticated' ? (
        <p className="text-xs text-red-600">请先登录管理员账号后刷新</p>
      ) : load === 'forbidden' ? (
        <p className="text-xs text-red-600">只有管理员能看</p>
      ) : load === 'error' ? (
        <p className="text-xs text-red-600">读不到短视频排期，请刷新或确认管理员登录</p>
      ) : reelsError ? (
        <p className="text-xs text-red-600">短视频现在读不到，请刷新页面。</p>
      ) : reels.length === 0 ? (
        <p className="text-xs text-me-charcoal/50">这个客户还没有可看的短视频。</p>
      ) : (
        <ul className="space-y-1.5">
          {reels.map((reel) => {
            const meta = STATUS_META[reel.status as WorkOrderStatus]
            return (
              <li key={reel.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${meta?.color ?? 'bg-me-charcoal/10 text-me-charcoal'}`}>
                  {describeReelUploadState(reel) ?? meta?.label ?? '状态未知'}
                </span>
                <span className="text-me-charcoal">{reel.angle || '（没有写主题）'}</span>
                <span className="text-xs text-me-charcoal/40">工单 {reel.id.slice(0, 8)}</span>
                {reel.permalink && (
                  <a
                    href={reel.permalink}
                    className="text-xs underline text-me-charcoal/70"
                    target="_blank"
                    rel="noreferrer"
                  >
                    打开 Reel 链接
                  </a>
                )}
                <Link
                  href={`/dashboard/factory?client=${clientId}`}
                  className="text-xs underline text-me-charcoal/70"
                >
                  去视频工厂
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
