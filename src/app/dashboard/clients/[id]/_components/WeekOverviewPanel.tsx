'use client'

/**
 * 「本周总览」：先说要你点什么，再说这周发了什么、排了什么。只读：授权和停仍在 Story 页，视频的通过 / 打回仍在视频工厂。
 * 一次请求拿全部（服务端按客户过滤，不下载原图，缩略图用小图）。
 */
import Link from 'next/link'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import {
  describeMode,
  describeNzDay,
  formatClock,
  nzDateKey,
  tallyStoryItems,
  thumbnailUrl,
} from '@/lib/social/story-lite/page-text'
import type { LitePackState } from '@/lib/social/story-lite/service'
import type { OverviewStoryItem, PublishingQuota, WeekOverview } from '@/lib/social/week-overview/build'
import { REEL_QUERY_LIMIT, countReelWorks, describeVarietyAdvice, groupReelWorks, type ReelWork, type StatusKind } from '@/lib/social/week-overview/reel-works'
import { describeStoryChips, describeStoryItemState, describeStoryPackLine } from '@/lib/social/week-overview/story-view'
import { buildTodoSummary } from '@/lib/social/week-overview/todo'

import { ReelWorkGroups, StatusTag, TodoStrip } from './SocialDailyParts'
import { WeekPackApproval } from './WeekPackApproval'

const ROLE_LABEL: Record<string, string> = {
  inspiration: '灵感',
  fact: '事实',
  invite: '邀请私信',
  itinerary: '讲清行程',
  price_inclusions: '价格与含项',
  reason: '理由',
  acquisition: '拉新',
}

const KIND_LABEL: Record<StatusKind, string> = {
  review: '待审核',
  problem: '出问题',
  approved: '已通过',
  making: '制作中',
  draft: 'Facebook 草稿',
  uploaded: '已上传（未核对）',
  sent: '已发出',
  closed: '旧记录',
}
const KIND_ORDER: StatusKind[] = ['review', 'problem', 'approved', 'making', 'draft', 'uploaded', 'sent', 'closed']

/** "用了 3/3" or "名额未配置": a missing quota is never shown as 0. */
function usedOf(used: number, limit: number | null | undefined): string {
  return typeof limit === 'number' ? `用了 ${used}/${limit}` : `${used} 条（名额未配置）`
}

function quotaOf(label: string, limit: number | null | undefined): string {
  return typeof limit === 'number' ? `${label}名额 ${limit} 条` : `${label}名额未配置`
}

type LoadState = 'loading' | 'ready' | 'forbidden' | 'error'

const ERROR_TEXT = 'text-sm font-medium text-[#8F2B22]'

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
        <p className="break-words text-sm font-semibold leading-snug text-me-charcoal">{item.text_line}</p>
        <p className="text-xs text-me-charcoal/70">
          {formatClock(item.slot_at)}{item.media_kind === 'video' ? ' · 视频' : ''}
          {item.role ? ` · ${ROLE_LABEL[item.role] ?? ''}` : ''} · {describeStoryItemState(item.status, packState, item.slot_at, now)}
        </p>
      </div>
    </li>
  )
}

/** The safety line: real publishing on or off, and the way to stop. One compact bar, not a box. */
function SafetyBanner({ live, clientId }: { live: boolean; clientId: string }) {
  const mode = describeMode(live)
  return (
    <div
      role="status"
      className={`rounded-xl border px-3 py-2.5 ${live ? 'border-status-rej/60 bg-status-rej/10' : 'border-me-ochre/50 bg-me-ochre/10'}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${live ? 'bg-status-rej' : 'bg-me-ochre'}`} />
        <p className="min-w-0 flex-1 text-sm font-bold text-me-charcoal">Story {mode.headline}</p>
        <Link href={`/dashboard/clients/${clientId}/story`} className="text-xs font-semibold underline">
          去 Story 页授权 / 停
        </Link>
      </div>
      <p className="mt-1 text-xs text-me-charcoal/80">{mode.detail}</p>
    </div>
  )
}

function Tile({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 rounded-2xl border border-black/10 bg-white p-4">
      <h2 className="text-sm font-bold text-me-charcoal/80">{title}</h2>
      {children}
    </section>
  )
}

function BigNumber({ prefix, value, unit }: { prefix?: string; value: number; unit: string }) {
  return (
    <p className="text-me-charcoal">
      {prefix && <span className="text-sm font-semibold">{prefix} </span>}
      <span className="text-3xl font-black tabular-nums">{value}</span> <span className="text-sm font-semibold">{unit}</span>
    </p>
  )
}

function ReelTile({ data, works }: { data: WeekOverview; works: ReelWork[] | null }) {
  const counts = works ? countReelWorks(works) : null
  return (
    <Tile title="视频 Reel">
      {!counts ? (
        <p className={ERROR_TEXT}>现在读不到 Reel，不知道有几条在审。</p>
      ) : counts.works === 0 ? (
        <p className="text-sm text-me-charcoal/80">现在没有可看的 Reel。</p>
      ) : (
        <>
          <BigNumber value={counts.works} unit="条作品" />
          {counts.versions > counts.works && (
            <p className="text-xs text-me-charcoal/70">
              共 {counts.versions} 个版本，同一条的修订版已折叠在一起{counts.versions >= REEL_QUERY_LIMIT ? `；只读了最近 ${REEL_QUERY_LIMIT} 个版本` : ''}
            </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {KIND_ORDER.filter((kind) => counts.byKind[kind] > 0).map((kind) => (
              <StatusTag key={kind} kind={kind}>
                {KIND_LABEL[kind]} {counts.byKind[kind]}
              </StatusTag>
            ))}
          </div>
        </>
      )}
      <p className="text-xs text-me-charcoal/70">{quotaOf('每周', data.quota?.reel_per_week)}</p>
    </Tile>
  )
}

function PostTile() {
  return (
    <Tile title="图文帖子">
      <p className="text-sm text-me-charcoal/80">尚未接入。这一周的整包不会授权图文，也不会把它显示成 0 条。</p>
    </Tile>
  )
}

function StoryTile({ data, now }: { data: WeekOverview; now: Date }) {
  const story = data.story
  const tally = tallyStoryItems(story?.items ?? [], story?.state ?? 'DRAFT', now)
  const chips = describeStoryChips(tally)
  return (
    <Tile title="Story">
      {data.story_error ? (
        <p className={ERROR_TEXT}>Story 读取失败，现在不知道本周排了什么，请刷新页面。</p>
      ) : !story ? (
        <p className="text-sm text-me-charcoal/80">本周还没排 Story，也没有进行中的周包。</p>
      ) : tally.total === 0 ? (
        <p className="text-sm text-me-charcoal/80">这个周包里还没有 Story。</p>
      ) : (
        <>
          <BigNumber prefix="本周" value={tally.total} unit="条" />
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <StatusTag key={chip.label} kind={chip.kind} title={chip.hint}>
                {chip.label} {chip.count}
              </StatusTag>
            ))}
          </div>
        </>
      )}
      {(story || data.story_error) && <p className="text-xs text-me-charcoal/80">{describeStoryPackLine(story, Boolean(data.story_error))}</p>}
      {story?.newer_draft_title && (
        <p className="text-xs font-medium text-me-charcoal">另外还有一个新的周包「{story.newer_draft_title}」还没授权，上面说的是已经授权的那个。</p>
      )}
      <p className="text-xs text-me-charcoal/70">{quotaOf('每天', data.quota?.story_per_day)}</p>
    </Tile>
  )
}

function StoryDays({ data, now }: { data: WeekOverview; now: Date }) {
  const quota: PublishingQuota | null = data.quota
  const story = data.story
  const today = nzDateKey(now.toISOString())
  const days = useMemo(() => {
    const byDay = new Map<string, OverviewStoryItem[]>()
    for (const item of story?.items ?? []) {
      const key = nzDateKey(item.slot_at)
      byDay.set(key, [...(byDay.get(key) ?? []), item])
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, items]) => ({ key, items: items.sort((a, b) => a.slot_at.localeCompare(b.slot_at)) }))
  }, [story])
  if (days.length === 0) return null
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-bold text-me-charcoal">每天排了什么</h2>
        <p className="text-xs text-me-charcoal/70">Story 都发到 Facebook 主页，时间是新西兰时间。</p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {days.map((day) => (
          <article key={day.key} className={`space-y-2 rounded-xl border bg-white p-3 ${day.key === today ? 'border-me-ochre' : 'border-black/10'}`}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold text-me-charcoal">{describeNzDay(day.key)}</h3>
              {day.key === today && <StatusTag kind="review">今天</StatusTag>}
            </div>
            <p className="text-xs font-semibold text-me-charcoal/70">Story（{usedOf(day.items.length, quota?.story_per_day)}）</p>
            <ul className="space-y-2">
              {day.items.map((item) => (
                <StoryRow key={item.item_id} item={item} packState={story?.state ?? 'DRAFT'} now={now} />
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  )
}

function ReelSection({ data, works, clientId }: { data: WeekOverview; works: ReelWork[] | null; clientId: string }) {
  const advice = describeVarietyAdvice(data.reel_variety)
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-bold text-me-charcoal">视频 Reel 明细</h2>
        <p className="text-xs text-me-charcoal/70">
          Reel 没有固定发布日：你在视频工厂点「通过」后，下一个整点发出，所以这里按状态分组，不按日期排。
        </p>
        {!data.reels_error && advice && <p className="mt-1 text-xs font-medium text-[#8A4A0A]">{advice}</p>}
      </div>
      {data.reels_error && <p className={ERROR_TEXT}>Reel 读取失败，请刷新页面。</p>}
      {!data.reels_error && works && works.length === 0 && <p className="text-sm text-me-charcoal/80">现在没有可看的 Reel。</p>}
      {works && works.length > 0 && <ReelWorkGroups works={works} clientId={clientId} />}
    </section>
  )
}

function Skeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <p className="text-sm text-me-charcoal/70">正在读取…</p>
      <div className="h-24 animate-pulse rounded-2xl bg-me-stone/70" />
      <div className="h-32 animate-pulse rounded-2xl bg-me-stone/70" />
    </div>
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

  const now = useMemo(() => new Date(), [data])
  const works = useMemo(() => (data && !data.reels_error ? groupReelWorks(Array.isArray(data.reels) ? data.reels : []) : null), [data])

  if (load === 'loading') return <Skeleton />
  if (load === 'forbidden') return <p className={ERROR_TEXT}>本周总览只有管理员能看。</p>
  if (load === 'error' || !data) {
    return <p className={ERROR_TEXT}>读取失败，现在不知道这一周排到哪了，请刷新页面；还不行就找开发。</p>
  }

  const story = data.story
  const tally = tallyStoryItems(story?.items ?? [], story?.state ?? 'DRAFT', now)
  const todo = buildTodoSummary({
    clientId,
    works,
    story: story ? { title: story.title, state: story.state, itemCount: story.items.length, newerDraftTitle: story.newer_draft_title } : null,
    storyFailed: Boolean(data.story_error),
    tally,
  })

  return (
    <div className="space-y-5">
      {data.story_error && data.reels_error && (
        <p role="alert" className={ERROR_TEXT}>Story 和 Reel 都读取失败，现在不知道这一周排到哪了，请刷新页面；还不行就找开发。</p>
      )}
      <TodoStrip summary={todo} />
      <SafetyBanner live={data.live} clientId={clientId} />
      <WeekPackApproval clientId={clientId} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <ReelTile data={data} works={works} />
        <StoryTile data={data} now={now} />
        <PostTile />
      </div>
      <StoryDays data={data} now={now} />
      <ReelSection data={data} works={works} clientId={clientId} />
      <p className="rounded-xl border border-dashed border-black/15 px-3 py-2 text-xs text-me-charcoal/70">
        即将上线：图文排进每天日历 · 整周画面复核
      </p>
    </div>
  )
}
