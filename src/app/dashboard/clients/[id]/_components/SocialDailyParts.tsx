'use client'

/**
 * Small display parts shared by the 社媒日常 tabs: one state tag, a fold group, the "待你处理" strip and the Reel work rows.
 * Display only. Every link goes where it went before; nothing here approves, authorises, stops or publishes.
 */
import Link from 'next/link'
import { useId, useState, type ReactNode } from 'react'

import { formatSlot } from '@/lib/social/story-lite/page-text'
import { groupWorksByStage, type ReelWork, type ReelVersion, type StatusKind } from '@/lib/social/week-overview/reel-works'
import type { TodoSummary } from '@/lib/social/week-overview/todo'

const TONE: Record<StatusKind | 'neutral', string> = {
  review: 'bg-me-ochre/15 text-[#6B470A] ring-me-ochre/45',
  approved: 'bg-status-sched/10 text-[#2A5069] ring-status-sched/30',
  sent: 'bg-status-track/12 text-[#35592A] ring-status-track/35',
  uploaded: 'bg-me-taupe/25 text-[#4A453C] ring-me-taupe/50',
  draft: 'bg-me-taupe/25 text-[#4A453C] ring-me-taupe/50',
  problem: 'bg-status-rej/10 text-[#8F2B22] ring-status-rej/35',
  making: 'bg-me-stone text-me-charcoal/80 ring-black/10',
  closed: 'bg-me-stone text-me-charcoal/70 ring-black/10',
  neutral: 'bg-white text-me-charcoal/75 ring-black/15',
}

/** The one small state tag used on every social page, so the same state is always the same colour. */
export function StatusTag({ kind = 'neutral', title, children }: { kind?: StatusKind | 'neutral'; title?: string; children: ReactNode }) {
  return (
    <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[kind]}`}>
      {children}
    </span>
  )
}

function Chevron() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-me-charcoal/55 transition-transform group-open:rotate-90" fill="currentColor">
      <path d="M7.2 4.6a1 1 0 0 1 1.4 0l4.7 4.7a1 1 0 0 1 0 1.4l-4.7 4.7a1 1 0 1 1-1.4-1.4L11.2 10 7.2 6a1 1 0 0 1 0-1.4Z" />
    </svg>
  )
}

/** A fold: the title and the count are always visible, the body opens and closes. */
export function FoldGroup({ title, count, kind, hint, defaultOpen, children }: {
  title: string
  count: number
  kind: StatusKind
  hint?: string
  defaultOpen: boolean
  children: ReactNode
}) {
  return (
    <details open={defaultOpen} className="group rounded-2xl border border-black/10 bg-white">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-2xl px-3 py-2.5 [&::-webkit-details-marker]:hidden">
        <Chevron />
        <h3 className="text-sm font-bold text-me-charcoal">{title}</h3>
        <StatusTag kind={kind}>{count} 条</StatusTag>
      </summary>
      <div className="space-y-2 border-t border-black/5 p-3">
        {hint && <p className="text-xs text-me-charcoal/70">{hint}</p>}
        {children}
      </div>
    </details>
  )
}

/** The headline of the page: how many things need a click, and where to click. Never says "0" for a part it could not read. */
export function TodoStrip({ summary, scope = '社媒日常' }: { summary: TodoSummary; scope?: string }) {
  const { total, items, unknown } = summary
  const calm = total === 0 && unknown.length === 0
  const heading = calm ? (
    `${scope}：现在没有要你处理的事`
  ) : total === 0 ? (
    `现在读不到${unknown.join('、')}，不确定有没有要你处理的事`
  ) : (
    <>
      待你处理 <span className="mx-0.5 text-3xl font-black tabular-nums">{total}</span> 件
    </>
  )
  return (
    <section
      aria-label="待你处理"
      className={`rounded-2xl border p-4 ${calm ? 'border-status-track/35 bg-status-track/10' : 'border-me-ochre/55 bg-me-ochre/10'}`}
    >
      <h2 className="text-lg font-bold leading-tight text-me-charcoal">{heading}</h2>
      {items.length > 0 && (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-me-charcoal">
              <span className="min-w-0 break-words">{item.text}</span>
              <Link href={item.href} className="inline-flex items-center rounded-lg bg-me-charcoal px-3 py-1.5 text-xs font-semibold text-white hover:bg-me-black">
                {item.cta}
                <span aria-hidden> →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {unknown.length > 0 && total > 0 && (
        <p className="mt-2 text-xs font-medium text-[#8F2B22]">现在读不到{unknown.join('、')}，上面的件数可能不全，请刷新页面。</p>
      )}
    </section>
  )
}

function PlayTile() {
  return (
    <span aria-hidden className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-me-charcoal text-me-gold">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
        <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
      </svg>
    </span>
  )
}

function versionTime(version: ReelVersion): string {
  const { reel } = version
  return reel.published_at ? `${formatSlot(reel.published_at)} 上传` : `${formatSlot(reel.created_at)} 创建`
}

function VersionList({ work }: { work: ReelWork }) {
  const total = work.versions.length
  return (
    <ol className="space-y-2">
      {work.versions.map((version, index) => (
        <li key={version.reel.id}>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusTag kind={version.tag.kind} title={version.tag.hint}>{version.tag.label}</StatusTag>
            <span className="font-medium text-me-charcoal">{total > 1 ? `第 ${total - index} 版${index === 0 ? '（最新）' : ''}` : '这一版'}</span>
            <span className="text-me-charcoal/70">{versionTime(version)}</span>
            {version.reel.permalink && (
              <a href={version.reel.permalink} className="underline" target="_blank" rel="noreferrer">
                打开 Reel 链接
              </a>
            )}
          </div>
          <p className="mt-1 break-words text-me-charcoal/70">{version.reel.angle || '（没有写主题）'}</p>
        </li>
      ))}
    </ol>
  )
}

function ReelWorkRow({ work, clientId }: { work: ReelWork; clientId: string }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const { latest } = work
  const meta = [work.templateLabel, versionTime(latest)].filter((part): part is string => Boolean(part)).join(' · ')
  return (
    <li className="rounded-xl border border-black/10 bg-white p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
        <div className="flex min-w-0 flex-1 gap-3">
          <PlayTile />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {work.batchLabel && <span className="text-xs font-semibold text-me-charcoal/65">{work.batchLabel} ·</span>}
              <h4 className="min-w-0 break-words text-sm font-semibold leading-snug text-me-charcoal">{work.title}</h4>
              <StatusTag kind={work.tag.kind} title={work.tag.hint}>{work.tag.label}</StatusTag>
              {work.versions.length > 1 && <StatusTag>共 {work.versions.length} 版</StatusTag>}
            </div>
            <p className="text-xs text-me-charcoal/70">{meta}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 pl-14 text-xs sm:flex-col sm:items-end sm:pl-0">
          <Link href={`/dashboard/factory?client=${clientId}`} className="font-semibold underline">
            {work.tag.kind === 'review' ? '去视频工厂看 / 点通过' : '去视频工厂看'}
          </Link>
          {latest.reel.permalink && (
            <a href={latest.reel.permalink} className="underline text-me-charcoal/75" target="_blank" rel="noreferrer">
              打开 Reel 链接
            </a>
          )}
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls={panelId}
            className="font-medium text-me-charcoal/75 underline"
          >
            {open ? '收起详情' : '详情'}
          </button>
        </div>
      </div>
      {open && (
        <div id={panelId} className="mt-2 space-y-2 rounded-lg bg-me-ivory p-2.5 text-xs text-me-charcoal/85">
          {work.campaignNote && <p className="break-words">工单备注：{work.campaignNote}</p>}
          <VersionList work={work} />
        </div>
      )}
    </li>
  )
}

/** Works in state groups (待你审核 first), each group foldable. Used by 本周总览 and 短视频. */
export function ReelWorkGroups({ works, clientId }: { works: ReadonlyArray<ReelWork>; clientId: string }) {
  return (
    <div className="space-y-3">
      {groupWorksByStage(works).map((stage) => (
        <FoldGroup key={stage.id} title={stage.title} count={stage.works.length} kind={stage.kind} hint={stage.hint} defaultOpen={stage.defaultOpen}>
          <ul className="space-y-2">
            {stage.works.map((work) => (
              <ReelWorkRow key={work.key} work={work} clientId={clientId} />
            ))}
          </ul>
        </FoldGroup>
      ))}
    </div>
  )
}
