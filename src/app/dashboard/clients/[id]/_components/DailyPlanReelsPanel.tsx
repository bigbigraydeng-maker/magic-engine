'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { WorkOrderStatus } from '@/lib/factory/types'
import type { PublishedView } from '@/lib/factory/publish/publish-display'
import { factoryVideoUrl } from '@/lib/factory/outlets'
import { STATUS_META, publishedBadge } from '@/app/dashboard/factory/_components/statusMeta'

// 每日计划页的「视频 Reels」只读面板 —— 视频由视频工厂统一生产与审核,
// 这里只做查看入口,通过/发布仍走工厂审核页并经 PM 授权。

interface WorkOrder {
  id: string
  client_id: string
  status: WorkOrderStatus
  angle: string
  output?: { video_path?: string } | null
  published: PublishedView | null
  created_at: string
}

// 展示顺序:要拍板/在途的在前,历史/停用的在后。空组跳过。
const REEL_STATUS_ORDER: readonly WorkOrderStatus[] = [
  'in_review', 'approved', 'publishing', 'published', 'measuring', 'closed',
  'review_rejected', 'publish_failed', 'rendered', 'queued', 'claimed', 'producing',
]

// 这些状态不展示:归档/被替换/失败/死信 —— 不是「可看的 Reel」。
const HIDDEN_STATUSES: readonly WorkOrderStatus[] = ['archived', 'superseded', 'failed', 'dead_letter']

export function DailyPlanReelsPanel({ clientId }: { clientId: string }) {
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const res = await fetch('/api/factory/work-orders')
        if (!res.ok) {
          if (!cancelled) setError(`读不到视频工单（${res.status}），请刷新或确认管理员登录`)
          return
        }
        const json = await res.json()
        if (cancelled) return
        setOrders((json.orders ?? []) as WorkOrder[])
      } catch {
        if (!cancelled) setError('读不到视频工单，请刷新或确认管理员登录')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [clientId])

  const videos = useMemo(() => {
    return orders
      .filter((o) => o.client_id === clientId)
      .filter((o) => typeof o.output?.video_path === 'string' && o.output.video_path.length > 0)
      .filter((o) => !HIDDEN_STATUSES.includes(o.status))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }, [orders, clientId])

  const grouped = useMemo(
    () => REEL_STATUS_ORDER
      .map((status) => ({ status, items: videos.filter((o) => o.status === status) }))
      .filter((g) => g.items.length > 0),
    [videos],
  )

  return (
    <section className="bg-white rounded-xl border border-black/10 p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <h2 className="text-sm font-semibold text-me-charcoal">视频 Reels（共 {videos.length} 条）</h2>
        <Link
          href={`/dashboard/factory?client=${clientId}`}
          className="text-xs text-blue-600 underline"
        >去视频工厂审核页</Link>
      </div>
      <p className="text-xs text-me-charcoal/60 mb-4">
        视频由视频工厂统一生产与审核；这里只是查看入口，通过、发布仍要在工厂审核页操作并经 PM 授权。
      </p>

      {loading ? (
        <p className="text-xs text-me-charcoal/50">加载中…</p>
      ) : error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : videos.length === 0 ? (
        <p className="text-xs text-me-charcoal/50">这个客户还没有可看的 Reel 视频。</p>
      ) : (
        <div className="space-y-6">
          {grouped.map((g) => (
            <div key={g.status}>
              <h3 className="text-xs font-medium text-me-charcoal/60 mb-2 flex items-center gap-2">
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${STATUS_META[g.status].color}`}>
                  {STATUS_META[g.status].label}
                </span>
                <span className="text-me-charcoal/40">{g.items.length}</span>
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {g.items.map((o) => {
                  const badge = o.published ? publishedBadge(o.published) : null
                  return (
                    <div key={o.id} className="border border-black/10 rounded-lg p-3 bg-white">
                      <video
                        controls
                        preload="metadata"
                        className="w-full rounded-md bg-black/5"
                        src={factoryVideoUrl(o.output?.video_path, process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')}
                      />
                      <p className="text-xs text-me-charcoal mt-2 line-clamp-2">{o.angle}</p>
                      <div className="flex items-center gap-2 flex-wrap mt-2">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${STATUS_META[o.status].color}`}>
                          {STATUS_META[o.status].label}
                        </span>
                        {badge && (
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${badge.color}`}>
                            {badge.label}
                          </span>
                        )}
                        <span className="text-xs text-me-charcoal/40">工单 {o.id.slice(0, 8)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
