'use client'

/**
 * 「短视频」只读面板 —— 视频由视频工厂统一生产与审核，这里按「作品」看排期和状态（同一条片的修订版折成一条）。
 * 数据与「本周总览」同源（social-overview 接口，已按客户过滤），不请求工厂工单接口。
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

import type { OverviewReel, ReelVariety } from '@/lib/social/week-overview/build'
import { countReelWorks, describeVarietyAdvice, groupReelWorks, type ReelWork, type StatusKind } from '@/lib/social/week-overview/reel-works'
import { buildReelTodoSummary } from '@/lib/social/week-overview/todo'

import { ReelWorkGroups, TodoStrip } from './SocialDailyParts'

type LoadState = 'loading' | 'ready' | 'unauthenticated' | 'forbidden' | 'error'

const NOTE = 'text-xs text-me-charcoal/70'
const ERROR_TEXT = 'text-sm font-medium text-[#8F2B22]'

const CELL_TONE: Record<StatusKind | 'neutral', string> = {
  review: 'border-me-ochre/55 bg-me-ochre/10',
  approved: 'border-status-sched/35 bg-status-sched/10',
  sent: 'border-status-track/40 bg-status-track/10',
  uploaded: 'border-black/10 bg-white',
  draft: 'border-black/10 bg-white',
  problem: 'border-status-rej/40 bg-status-rej/10',
  making: 'border-black/10 bg-white',
  closed: 'border-black/10 bg-white',
  neutral: 'border-black/10 bg-white',
}

/** The Reels from "being made" to "public", as four or more numbers: where the pieces are right now. */
function ReelStats({ works }: { works: ReelWork[] }) {
  const { byKind } = countReelWorks(works)
  const cells: Array<{ label: string; value: number; kind: StatusKind; always: boolean }> = [
    { label: '待你审核', value: byKind.review, kind: 'review', always: true },
    { label: '已通过，等发出', value: byKind.approved, kind: 'approved', always: true },
    { label: 'Facebook 草稿', value: byKind.draft + byKind.uploaded, kind: 'draft', always: true },
    { label: '已公开', value: byKind.sent, kind: 'sent', always: true },
    { label: '出问题 / 被打回', value: byKind.problem, kind: 'problem', always: false },
    { label: '制作中', value: byKind.making, kind: 'making', always: false },
  ]
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(120px,1fr))]">
      {cells.filter((cell) => cell.always || cell.value > 0).map((cell) => (
        <li key={cell.label} className={`rounded-xl border px-3 py-2 ${CELL_TONE[cell.kind]}`}>
          <p className="text-xs font-medium text-me-charcoal/75">{cell.label}</p>
          <p className="text-2xl font-black tabular-nums text-me-charcoal">{cell.value}</p>
        </li>
      ))}
    </ul>
  )
}

function ReelsBody({ clientId, works, variety, weeklyQuota }: { clientId: string; works: ReelWork[]; variety: ReelVariety | null; weeklyQuota: number | null }) {
  const counts = countReelWorks(works)
  const advice = variety ? describeVarietyAdvice(variety) : null
  return (
    <div className="space-y-4">
      <TodoStrip summary={buildReelTodoSummary(clientId, works)} scope="短视频" />
      <ReelStats works={works} />
      <div>
        <p className={NOTE}>
          共 {counts.works} 条作品{counts.versions > counts.works ? `（${counts.versions} 个版本，同一条的修订版已折叠在一起）` : ''}
          ；{typeof weeklyQuota === 'number' ? `每周名额 ${weeklyQuota} 条` : '每周名额未配置'}。
        </p>
        {advice && <p className="mt-1 text-xs font-medium text-[#8A4A0A]">{advice}</p>}
      </div>
      <ReelWorkGroups works={works} clientId={clientId} />
    </div>
  )
}

export function DailyPlanReelsPanel({ clientId }: { clientId: string }) {
  const [load, setLoad] = useState<LoadState>('loading')
  const [reels, setReels] = useState<OverviewReel[]>([])
  const [reelsError, setReelsError] = useState<string | null>(null)
  const [variety, setVariety] = useState<ReelVariety | null>(null)
  const [weeklyQuota, setWeeklyQuota] = useState<number | null>(null)

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
          reel_variety?: ReelVariety
          quota?: { reel_per_week?: number | null } | null
        }
        if (!res.ok || json.success !== true) return setLoad('error')
        setReels(Array.isArray(json.reels) ? json.reels : [])
        setReelsError(typeof json.reels_error === 'string' ? json.reels_error : null)
        setVariety(json.reel_variety ?? null)
        setWeeklyQuota(typeof json.quota?.reel_per_week === 'number' ? json.quota.reel_per_week : null)
        setLoad('ready')
      } catch {
        if (!cancelled) setLoad('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [clientId])

  const works = useMemo(() => groupReelWorks(reels), [reels])

  return (
    <section className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-me-charcoal">短视频</h2>
          <Link href={`/dashboard/factory?client=${clientId}`} className="text-xs font-semibold underline">
            去视频工厂
          </Link>
        </div>
        <p className={NOTE}>这里只看排期和状态；审片、通过、打回、看片都在视频工厂。</p>
      </div>

      {load === 'loading' ? (
        <div className="space-y-3" aria-busy="true">
          <p className={NOTE}>加载中…</p>
          <div className="h-24 animate-pulse rounded-2xl bg-me-stone/70" />
        </div>
      ) : load === 'unauthenticated' ? (
        <p className={ERROR_TEXT}>请先登录管理员账号后刷新</p>
      ) : load === 'forbidden' ? (
        <p className={ERROR_TEXT}>只有管理员能看</p>
      ) : load === 'error' ? (
        <p className={ERROR_TEXT}>读不到短视频排期，请刷新或确认管理员登录</p>
      ) : reelsError ? (
        <p className={ERROR_TEXT}>短视频现在读不到，请刷新页面。</p>
      ) : works.length === 0 ? (
        <p className="text-sm text-me-charcoal/80">这个客户还没有可看的短视频。</p>
      ) : (
        <ReelsBody clientId={clientId} works={works} variety={variety} weeklyQuota={weeklyQuota} />
      )}
    </section>
  )
}
