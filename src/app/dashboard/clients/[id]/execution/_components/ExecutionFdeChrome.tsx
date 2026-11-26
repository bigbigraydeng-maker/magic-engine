'use client'

import Link from 'next/link'
import { MePanel, MePill } from '@/components/ui/me-primitives'
import { cx } from '@/components/ui/me-theme'
import type { ExecutionBoardStats } from '../execution-page-stats'

export interface ExecutionPriorityRow {
  id: string
  title: string
  description: string
  href: string
  cta: string
  urgent?: boolean
  onClick?: () => void
}

export function ExecutionFdeChrome({
  stats,
  priorities,
  onManualEntry,
  confirmationHref,
  waitingCards,
}: {
  stats: ExecutionBoardStats
  priorities: ExecutionPriorityRow[]
  onManualEntry: () => void
  confirmationHref: string
  waitingCards: number
}) {
  const progressPct = stats.total === 0 ? 0 : Math.round((stats.done / stats.total) * 100)

  return (
    <div className="space-y-5">
      <motionDiv className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-me-charcoal">任务</h1>
          <p className="mt-1 text-sm font-semibold text-me-charcoal/60">
            这位客户还要做哪些事。先做最上面的，做完点「完成」。
          </p>
        </div>
        <button
          type="button"
          onClick={onManualEntry}
          className="shrink-0 rounded-lg border border-me-ochre/35 bg-me-ochre/10 px-4 py-2 text-sm font-black text-me-ochre hover:bg-me-ochre/15"
        >
          ＋ 记一件做过的事
        </button>
      </motionDiv>

      <motionDiv className="grid gap-3 md:grid-cols-3">
        <MePanel className="p-4">
          <p className="text-xs font-black uppercase tracking-wide text-me-ochre">本周推进</p>
          <p className="mt-1 font-display text-2xl font-bold text-me-charcoal">
            {stats.done} / {stats.total || '—'} 件
          </p>
          <div className="mt-2 h-1.5 w-full rounded-full bg-me-stone">
            <div className="h-1.5 rounded-full bg-me-ochre transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          <p className="mt-2 text-xs font-semibold text-me-charcoal/50">按执行看板全量任务统计</p>
        </MePanel>
        <MePanel className="p-4">
          <p className="text-xs font-black uppercase tracking-wide text-me-ochre">卡住的地方</p>
          <p className="mt-1 font-display text-2xl font-bold text-me-charcoal">{stats.stuck} 件</p>
          <p className="mt-2 text-xs font-semibold text-me-charcoal/50">有 blocker 或内容状态 failed/stale</p>
        </MePanel>
        <MePanel className="p-4">
          <p className="text-xs font-black uppercase tracking-wide text-me-ochre">系统在跑</p>
          <p className="mt-1 font-display text-2xl font-bold text-me-charcoal">{stats.automated} 件</p>
          <p className="mt-2 text-xs font-semibold text-me-charcoal/50">飞轮自主行动还没收尾</p>
        </MePanel>
      </motionDiv>

      {priorities.length > 0 && (
        <section className="space-y-3">
          <p className="text-sm font-black text-me-charcoal">今天请先做这 {priorities.length} 件</p>
          <motionDiv className="space-y-3">
            {priorities.map(row => {
              const body = (
                <MePanel className={cx('p-4', row.urgent && 'border-[#C2453A]/35 bg-[#C2453A]/[0.04]')}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-me-charcoal">{row.title}</p>
                      <p className="mt-1 text-sm font-semibold text-me-charcoal/60">{row.description}</p>
                    </div>
                    {row.urgent && <MePill tone="rej">会改 Meta 广告</MePill>}
                  </div>
                  {row.onClick ? (
                    <button
                      type="button"
                      onClick={row.onClick}
                      className="mt-3 rounded-lg bg-me-charcoal px-4 py-2 text-xs font-black text-white hover:bg-me-charcoal/85"
                    >
                      {row.cta}
                    </button>
                  ) : (
                    <Link
                      href={row.href}
                      className="mt-3 inline-flex rounded-lg bg-me-charcoal px-4 py-2 text-xs font-black text-white hover:bg-me-charcoal/85"
                    >
                      {row.cta}
                    </Link>
                  )}
                </MePanel>
              )
              return <motionDiv key={row.id}>{body}</motionDiv>
            })}
          </motionDiv>
        </section>
      )}

      {waitingCards > 0 && (
        <MePanel className="border-me-ochre/30 bg-me-ochre/10 p-4">
          <p className="text-sm font-semibold text-me-charcoal">
            另有 {waitingCards} 张确认卡 ——{' '}
            <Link href={confirmationHref} className="font-black text-me-ochre hover:underline">去确认卡 →</Link>
          </p>
        </MePanel>
      )}
    </div>
  )
}

function motionDiv({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={className}>{children}</div>
}
