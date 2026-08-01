'use client'

/**
 * /dashboard/today — 今日待办 (22.E.S18 前置 · 滚动排班).
 *
 * The in-ME home of the PM's rolling to-do: today's pillar theme + live
 * counts with deep links. Reads GET /api/workbench/today — the same lib the
 * pm-daily-todo email renders, so inbox and dashboard never disagree.
 *
 * First brick of the "一条待办流" product surface (2026-07-28 拍板):
 * today it serves the PM; the data shape is per-client so FDE / client-boss
 * filtered views can layer on top later (四视角).
 */

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

interface ClientCount {
  name: string
  id: string
  drafts?: number
  findings?: number
  cards?: number
  reels?: number
}

interface TodayPayload {
  weekday: number
  weekday_label: string
  theme: { title: string; hint: string } | null
  nz_date: string
  counts: {
    draftsByClient: ClientCount[]
    findingsByClient: ClientCount[]
    recentCardsByClient: ClientCount[]
    reelsByClient: ClientCount[]
    cronFailures24h: number
  }
}

type PageState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; data: TodayPayload }

function SectionCard({
  emoji,
  title,
  children,
}: {
  emoji: string
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-2 text-sm font-black text-slate-800">
        {emoji} {title}
      </p>
      {children}
    </div>
  )
}

function ClientRow({
  name,
  count,
  unit,
  href,
}: {
  name: string
  count: number
  unit: string
  href: string
}) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-2 last:border-b-0">
      <span className="text-sm text-slate-600">{name}</span>
      <span className="flex items-center gap-3">
        <span className="text-sm font-bold text-slate-800">
          {count} {unit}
        </span>
        <Link
          href={href}
          className="rounded-lg bg-cyan-600 px-3 py-1 text-xs font-bold text-white hover:bg-cyan-700"
        >
          去处理
        </Link>
      </span>
    </div>
  )
}

export default function TodayPage() {
  const [state, setState] = useState<PageState>({ phase: 'loading' })

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch('/api/workbench/today')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as TodayPayload
      setState({ phase: 'ready', data })
    } catch (err) {
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (state.phase === 'loading') {
    return <div className="p-8 text-sm text-slate-400">加载今日待办...</div>
  }

  if (state.phase === 'error') {
    return (
      <div className="p-8">
        <p className="text-sm font-bold text-red-700">加载失败：{state.message}</p>
        <button
          onClick={load}
          className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-100"
        >
          重试
        </button>
      </div>
    )
  }

  const { data } = state
  const { counts } = data
  const totalDrafts = counts.draftsByClient.reduce((s, c) => s + (c.drafts ?? 0), 0)
  const totalFindings = counts.findingsByClient.reduce((s, c) => s + (c.findings ?? 0), 0)
  const totalCards = counts.recentCardsByClient.reduce((s, c) => s + (c.cards ?? 0), 0)
  const totalReels = (counts.reelsByClient ?? []).reduce((s, c) => s + (c.reels ?? 0), 0)
  const total = totalDrafts + totalFindings + totalCards + totalReels + counts.cronFailures24h

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6">
        <h1 className="text-xl font-black text-slate-900">
          📋 今日待办 · {data.weekday_label} {data.nz_date}
        </h1>
        {data.theme && (
          <p className="mt-1 text-sm text-slate-500">
            <span className="font-bold text-slate-700">{data.theme.title}</span>
            {data.theme.hint ? ` — ${data.theme.hint}` : ''}
          </p>
        )}
      </div>

      {total === 0 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-sm font-bold text-emerald-700">
          今天没有待办 ✅ 系统都在正常跑。
        </div>
      ) : (
        <div className="space-y-4">
          {totalDrafts > 0 && (
            <SectionCard emoji="📝" title="Blog 草稿待审">
              {counts.draftsByClient.map((c) => (
                <ClientRow
                  key={c.id}
                  name={c.name}
                  count={c.drafts ?? 0}
                  unit="篇"
                  href={`/dashboard/clients/${c.id}/blog`}
                />
              ))}
            </SectionCard>
          )}

          {totalFindings > 0 && (
            <SectionCard emoji="🔎" title="SEO 巡逻新发现">
              {counts.findingsByClient.map((c) => (
                <ClientRow
                  key={c.id}
                  name={c.name}
                  count={c.findings ?? 0}
                  unit="条"
                  href={`/dashboard/clients/${c.id}/execution`}
                />
              ))}
            </SectionCard>
          )}

          {totalCards > 0 && (
            <SectionCard emoji="🗂" title="本周新建议卡待处理">
              {counts.recentCardsByClient.map((c) => (
                <ClientRow
                  key={c.id}
                  name={c.name}
                  count={c.cards ?? 0}
                  unit="张"
                  href={`/dashboard/clients/${c.id}/execution`}
                />
              ))}
            </SectionCard>
          )}

          {totalReels > 0 && (
            <SectionCard emoji="🎬" title="社媒成片待审">
              {(counts.reelsByClient ?? []).map((c) => (
                <ClientRow
                  key={c.id}
                  name={c.name}
                  count={c.reels ?? 0}
                  unit="条"
                  href="/dashboard/factory"
                />
              ))}
            </SectionCard>
          )}

          {counts.cronFailures24h > 0 && (
            <SectionCard emoji="⚠️" title="系统有活儿没跑成">
              <ClientRow
                name="过去 24 小时"
                count={counts.cronFailures24h}
                unit="次失败"
                href="/dashboard/admin/cron-health"
              />
            </SectionCard>
          )}
        </div>
      )}

      <p className="mt-6 text-xs text-slate-400">
        每个工作日早上这份清单也会发到你的邮箱。数字实时统计，办完自动消失。
      </p>
    </div>
  )
}
