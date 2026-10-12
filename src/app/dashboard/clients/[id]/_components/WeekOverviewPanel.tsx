'use client'

/**
 * 「本周总览」：一个地方看这一周的 Story、图文 Post、视频 Reel 排到哪了。只读：授权和停仍在各自的页面。
 * 一次请求拿全部（服务端按客户过滤，不下载原图，缩略图用小图）。
 */
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

import { STATUS_META } from '@/app/dashboard/factory/_components/statusMeta'
import type { WorkOrderStatus } from '@/lib/factory/types'
import {
  describeItemStatusInPack,
  describeMode,
  describeNzDay,
  describePackState,
  formatClock,
  nzDateKey,
  thumbnailUrl,
} from '@/lib/social/story-lite/page-text'
import type { LitePackState } from '@/lib/social/story-lite/service'
import type { OverviewReel, OverviewStoryItem, WeekOverview } from '@/lib/social/week-overview/build'

type LoadState = 'loading' | 'ready' | 'forbidden' | 'error'

function StoryRow({ item, packState }: { item: OverviewStoryItem; packState: LitePackState }) {
  const [small, setSmall] = useState(true)
  return (
    <li className="flex gap-3">
      <div className="h-20 w-[45px] shrink-0 overflow-hidden rounded bg-me-charcoal/10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={small ? thumbnailUrl(item.media_url) : item.media_url}
          alt={item.text_line}
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          onError={() => setSmall(false)}
        />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-snug text-me-charcoal">{item.text_line}</p>
        <p className="text-xs text-me-charcoal/70">
          {formatClock(item.slot_at)} · Facebook 主页 Story · {describeItemStatusInPack(item.status, packState)}
        </p>
      </div>
    </li>
  )
}

function ReelRow({ reel, clientId }: { reel: OverviewReel; clientId: string }) {
  const meta = STATUS_META[reel.status as WorkOrderStatus]
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span className="rounded-full bg-me-charcoal/10 px-2 py-0.5 text-xs font-medium text-me-charcoal">{meta?.label ?? '状态未知'}</span>
      <span className="text-me-charcoal">{reel.angle || '（没有写主题）'}</span>
      {reel.permalink && (
        <a href={reel.permalink} className="text-xs underline text-me-charcoal/70" target="_blank" rel="noreferrer">
          打开已发的 Reel
        </a>
      )}
      <Link href={`/dashboard/factory?client=${clientId}`} className="text-xs underline text-me-charcoal/70">
        去视频工厂看 / 点通过
      </Link>
    </li>
  )
}

export function WeekOverviewPanel({ clientId }: { clientId: string }) {
  const [load, setLoad] = useState<LoadState>('loading')
  const [data, setData] = useState<WeekOverview | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/social-overview`)
        if (cancelled) return
        if (res.status === 401 || res.status === 403) return setLoad('forbidden')
        const json = (await res.json().catch(() => ({}))) as { success?: boolean } & Partial<WeekOverview>
        if (!res.ok || json.success !== true) return setLoad('error')
        setData(json as WeekOverview)
        setLoad('ready')
      } catch {
        if (!cancelled) setLoad('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [clientId])

  const days = useMemo(() => {
    const byDay = new Map<string, OverviewStoryItem[]>()
    for (const item of data?.story?.items ?? []) {
      const key = nzDateKey(item.slot_at)
      byDay.set(key, [...(byDay.get(key) ?? []), item])
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, items]) => ({ key, items: items.sort((a, b) => a.slot_at.localeCompare(b.slot_at)) }))
  }, [data])

  if (load === 'loading') return <p className="text-sm text-me-charcoal/70">正在读取…</p>
  if (load === 'forbidden') return <p className="text-sm font-medium text-[#B03A2E]">本周总览只有管理员能看。</p>
  if (load === 'error' || !data) {
    return <p className="text-sm font-medium text-[#B03A2E]">读取失败，现在不知道这一周排到哪了，请刷新页面；还不行就找开发。</p>
  }

  const mode = describeMode(data.live)
  const story = data.story

  return (
    <div className="space-y-5">
      <div
        role="status"
        className={`rounded-xl border px-4 py-3 ${data.live ? 'border-[#B03A2E] bg-[#B03A2E]/10' : 'border-me-ochre/50 bg-me-ochre/10'}`}
      >
        <p className="text-base font-bold text-me-charcoal">{mode.headline}</p>
        <p className="text-sm text-me-charcoal/80">
          Story：
          {data.story_error
            ? '现在读不到 Story 周包，不知道是否已授权。'
            : story
              ? `「${story.title}」${describePackState(story.state)}${story.state === 'AUTHORIZED' && story.expires_at ? `（${describeNzDay(nzDateKey(story.expires_at))}前有效）` : ''}。`
              : '没有进行中的 Story 周包。'}{' '}
          <Link href={`/dashboard/clients/${clientId}/story`} className="underline">
            去 Story 页授权 / 停
          </Link>
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-me-charcoal">每天排了什么</h2>
        {data.story_error && <p className="text-sm font-medium text-[#B03A2E]">Story 读取失败，下面的 Story 不完整，请刷新。</p>}
        {!data.story_error && days.length === 0 && <p className="text-sm text-me-charcoal/80">这一周还没有 Story。</p>}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {days.map((day) => (
            <article key={day.key} className="space-y-3 rounded-xl border border-black/10 bg-white p-3">
              <h3 className="text-sm font-bold text-me-charcoal">{describeNzDay(day.key)}</h3>
              <div>
                <p className="mb-1 text-xs font-semibold text-me-charcoal/70">Story（{day.items.length} 条）</p>
                <ul className="space-y-2">
                  {day.items.map((item) => (
                    <StoryRow key={item.item_id} item={item} packState={story?.state ?? 'DRAFT'} />
                  ))}
                </ul>
              </div>
              <p className="text-xs text-me-charcoal/70">图文 Post：尚未接入（做好后会显示在这里）</p>
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-2 rounded-xl border border-black/10 bg-white p-3">
        <h2 className="text-lg font-bold text-me-charcoal">视频 Reel（按状态，没有固定发布日）</h2>
        {data.reels_error && <p className="text-sm font-medium text-[#B03A2E]">Reel 读取失败，请刷新页面。</p>}
        {!data.reels_error && data.reels.length === 0 && <p className="text-sm text-me-charcoal/80">现在没有可看的 Reel。</p>}
        <ul className="space-y-1.5">
          {data.reels.slice(0, 12).map((reel) => (
            <ReelRow key={reel.id} reel={reel} clientId={clientId} />
          ))}
        </ul>
        {data.reels.length > 12 && <p className="text-xs text-me-charcoal/70">还有 {data.reels.length - 12} 条更早的，去视频工厂看全部。</p>}
      </section>
    </div>
  )
}
