'use client'

/**
 * 「发布日历」：一个地方看这一周的 Story、图文 Post、视频 Reel 排到哪了、每天名额用了几个。只读：授权和停仍在各自的页面。
 * 一次请求拿全部（服务端按客户过滤，不下载原图，缩略图用小图）。
 */
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

import { STATUS_META } from '@/app/dashboard/factory/_components/statusMeta'
import type { WorkOrderStatus } from '@/lib/factory/types'
import {
  describeMode,
  describeNzDay,
  describeOverviewItemStatus,
  describePackState,
  describeReelHeadline,
  describeStoryHeadline,
  describeVarietyLine,
  formatClock,
  isRecordedUploaded,
  nzDateKey,
  tallyStoryItems,
  thumbnailUrl,
} from '@/lib/social/story-lite/page-text'
import type { LitePackState } from '@/lib/social/story-lite/service'
import type { OverviewReel, OverviewStoryItem, PublishingQuota, WeekOverview } from '@/lib/social/week-overview/build'

const ROLE_LABEL: Record<string, string> = {
  inspiration: '灵感',
  fact: '事实',
  invite: '邀请私信',
  itinerary: '讲清行程',
  price_inclusions: '价格与含项',
  reason: '理由',
  acquisition: '拉新',
}

/** "用了 3/3" or "名额未配置": a missing quota is never shown as 0. */
function usedOf(used: number, limit: number | null | undefined): string {
  return typeof limit === 'number' ? `用了 ${used}/${limit}` : `${used} 条（名额未配置）`
}

type LoadState = 'loading' | 'ready' | 'forbidden' | 'error'

function StoryRow({ item, packState, now }: { item: OverviewStoryItem; packState: LitePackState; now: Date }) {
  const [small, setSmall] = useState(true)
  return (
    <li className="flex gap-3">
      <div className="h-20 w-[45px] shrink-0 overflow-hidden rounded bg-me-charcoal/10">
        {item.media_kind === 'video' ? (
          <video src={item.media_url} muted playsInline preload="metadata" className="h-full w-full object-cover" aria-label="视频缩略图" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={small ? thumbnailUrl(item.media_url) : item.media_url}
            alt={item.text_line}
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
            onError={() => setSmall(false)}
          />
        )}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-snug text-me-charcoal">{item.text_line}</p>
        <p className="text-xs text-me-charcoal/70">
          {formatClock(item.slot_at)}{item.media_kind === 'video' ? ' · 视频' : ''}
          {item.role ? ` · ${ROLE_LABEL[item.role] ?? ''}` : ''} · Facebook 主页 Story · {describeOverviewItemStatus(item.status, packState, item.slot_at, now)}
        </p>
      </div>
    </li>
  )
}

function ReelRow({ reel, clientId }: { reel: OverviewReel; clientId: string }) {
  const meta = STATUS_META[reel.status as WorkOrderStatus]
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span className="rounded-full bg-me-charcoal/10 px-2 py-0.5 text-xs font-medium text-me-charcoal">{reel.status === 'published' ? '库里记为已上传' : meta?.label ?? '状态未知'}</span>
      <span className="text-me-charcoal">{reel.angle || '（没有写主题）'}</span>
      {reel.permalink && (
        <a href={reel.permalink} className="text-xs underline text-me-charcoal/70" target="_blank" rel="noreferrer">
          打开 Reel 链接
        </a>
      )}
      {isRecordedUploaded(reel) && <span className="text-xs text-me-charcoal/70">平台状态未核</span>}
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

  const now = useMemo(() => new Date(), [data])

  if (load === 'loading') return <p className="text-sm text-me-charcoal/70">正在读取…</p>
  if (load === 'forbidden') return <p className="text-sm font-medium text-[#B03A2E]">本周总览只有管理员能看。</p>
  if (load === 'error' || !data) {
    return <p className="text-sm font-medium text-[#B03A2E]">读取失败，现在不知道这一周排到哪了，请刷新页面；还不行就找开发。</p>
  }

  const mode = describeMode(data.live)
  const story = data.story
  const tally = tallyStoryItems(story?.items ?? [], story?.state ?? 'DRAFT', now)
  const variety = describeVarietyLine(data.reel_variety)

  return (
    <div className="space-y-5">
      <section className="space-y-1 rounded-xl border border-black/10 bg-white px-4 py-3">
        <h2 className="text-lg font-bold text-me-charcoal">社媒日常：三条线分别报</h2>
        <p className="text-sm text-me-charcoal/80">图文：未接入</p>
        <p className="text-sm text-me-charcoal/80">{data.story_error ? 'Story：现在读不到，不知道本周情况' : describeStoryHeadline(tally)}</p>
        <p className="text-sm text-me-charcoal/80">{data.reels_error ? 'Reel：现在读不到，不知道有几条在审' : describeReelHeadline(data.reels)}</p>
        {!data.reels_error && (
          <p className={variety.warn ? 'text-sm font-medium text-[#C2570C]' : 'text-sm text-me-charcoal/80'}>{variety.text}</p>
        )}
      </section>
      <div
        role="status"
        className={`rounded-xl border px-4 py-3 ${data.live ? 'border-[#B03A2E] bg-[#B03A2E]/10' : 'border-me-ochre/50 bg-me-ochre/10'}`}
      >
        <p className="text-base font-bold text-me-charcoal">{mode.headline}</p>
        <p className="text-sm text-me-charcoal/80">{mode.detail}</p>
        <p className="text-sm text-me-charcoal/80">这一周的内容已经排好，你看一遍、点一次授权就行。</p>
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
        {story?.newer_draft_title && (
          <p className="text-sm font-medium text-me-charcoal">
            另外还有一个新的周包「{story.newer_draft_title}」还没授权，上面说的是已经授权的那个。
          </p>
        )}
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-me-charcoal">每天排了什么</h2>
        {data.story_error && data.reels_error && (
          <p className="text-sm font-medium text-[#B03A2E]">Story 和 Reel 都读取失败，现在不知道这一周排到哪了，请刷新页面；还不行就找开发。</p>
        )}
        {data.story_error && <p className="text-sm font-medium text-[#B03A2E]">Story 读取失败，下面的 Story 不完整，请刷新。</p>}
        {!data.story_error && days.length === 0 && <p className="text-sm text-me-charcoal/80">这一周还没有 Story。</p>}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {days.map((day) => (
            <article key={day.key} className="space-y-3 rounded-xl border border-black/10 bg-white p-3">
              <h3 className="text-sm font-bold text-me-charcoal">{describeNzDay(day.key)}</h3>
              <div>
                <p className="mb-1 text-xs font-semibold text-me-charcoal/70">Story（{usedOf(day.items.length, data.quota?.story_per_day)}）</p>
                <ul className="space-y-2">
                  {day.items.map((item) => (
                    <StoryRow key={item.item_id} item={item} packState={story?.state ?? 'DRAFT'} now={now} />
                  ))}
                </ul>
              </div>
              <p className="text-xs text-me-charcoal/70">
                图文 Post：尚未接入（做好后会显示在这里）
                {typeof data.quota?.post_per_day === 'number' ? `，每天名额 ${data.quota.post_per_day} 条` : '，名额未配置'}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-2 rounded-xl border border-black/10 bg-white p-3">
        <h2 className="text-lg font-bold text-me-charcoal">视频 Reel（按状态，没有固定发布日）</h2>
        <p className="text-xs text-me-charcoal/70">
          {typeof data.quota?.reel_per_week === 'number' ? `每周名额 ${data.quota.reel_per_week} 条` : '每周名额未配置'}
          ；Reel 没有固定发布日（以 PM 在工厂点通过的时间为准，通过后下一个整点发），所以不按日期排，名额用量暂不统计。
        </p>
        {data.reels_error && <p className="text-sm font-medium text-[#B03A2E]">Reel 读取失败，请刷新页面。</p>}
        {!data.reels_error && data.reels.length === 0 && <p className="text-sm text-me-charcoal/80">现在没有可看的 Reel。</p>}
        <ul className="space-y-1.5">
          {data.reels.slice(0, 12).map((reel) => (
            <ReelRow key={reel.id} reel={reel} clientId={clientId} />
          ))}
        </ul>
        {data.reels.length > 12 && <p className="text-xs text-me-charcoal/70">还有 {data.reels.length - 12} 条更早的，去视频工厂看全部。</p>}
      </section>

      <section className="space-y-1 rounded-xl border border-black/10 bg-white p-3">
        <h2 className="text-lg font-bold text-me-charcoal">这一周的画面复核</h2>
        <p className="text-sm text-me-charcoal/80">
          尚未接入：授权前会有一步「整周画面复核」（把这一周所有 Reel 封面和 Story 首帧拼成一张总览图，看有没有两张撞脸），做好后结果会显示在这里。
        </p>
      </section>

      <section className="space-y-1 rounded-xl border border-black/10 bg-white p-3">
        <h2 className="text-lg font-bold text-me-charcoal">没能进日历</h2>
        <p className="text-sm text-me-charcoal/80">
          尚未接入：还没有「报名」这一步。以后被规则挡下的内容（比如事实没出处、画面没过审、图和最近发过的重复）会在这里列出来，并写明被哪一条规则挡的，不会只留在日志里。
        </p>
      </section>
    </div>
  )
}
