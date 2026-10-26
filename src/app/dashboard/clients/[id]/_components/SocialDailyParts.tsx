'use client'

/**
 * Small display parts shared by the 社媒日常 tabs: one state tag, a fold group, the "待你处理" strip and the Reel work rows.
 * Display only. Every link goes where it went before; nothing here approves, authorises, stops or publishes.
 */
import Link from 'next/link'
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'

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
  const { total, items, unknown, limitedTo } = summary
  const calm = total === 0 && unknown.length === 0
  const heading = calm ? (
    `${scope}：${limitedTo ? `最近 ${limitedTo} 个版本里` : '现在'}没有要你处理的事`
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
      {limitedTo !== null && <p className="mt-2 text-xs text-me-charcoal/70">只读了最近 {limitedTo} 个版本，更早的请到视频工厂看。</p>}
    </section>
  )
}

function PlayGlyph({ className }: { className: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
    </svg>
  )
}

/** True once the element is (nearly) on screen. Without IntersectionObserver (old browsers, tests) it is true at once. */
function useNearScreen<T extends Element>(): { ref: RefObject<T>; near: boolean } {
  const ref = useRef<T>(null)
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const node = ref.current
    if (near || !node) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true)
          observer.disconnect()
        }
      },
      { rootMargin: '300px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [near])
  return { ref, near }
}

/** Size in pixels of the still kept as a cover: sharp enough for the 44 x 78 tile on a 3x screen. */
const COVER_STILL = { width: 135, height: 240 }
/** How long to wait for the first frame before giving up and stopping the download. */
const COVER_GIVE_UP_MS = 10_000
/** At most this many covers load at the same time: the browser's media pipeline stalls when dozens of videos start together. */
const COVER_MAX_PARALLEL = 6

type CoverPhase = 'waiting' | 'kept' | 'failed'

/** Copies what `video` is showing onto `canvas`. False when that cannot be done (no canvas, no 2d drawing, drawing fails). */
function drawStill(video: HTMLVideoElement, canvas: HTMLCanvasElement | null): boolean {
  const context = canvas?.getContext('2d')
  if (!context) return false
  try {
    context.drawImage(video, 0, 0, COVER_STILL.width, COVER_STILL.height)
    return true
  } catch {
    return false
  }
}

/**
 * Loads the start of a finished Reel video off-screen and copies its first frame onto the canvas, then stops the download:
 * a finished video is tens of MB, its first frame about half a MB. `onDone` is called once, with "kept" (the still is on the
 * canvas) or "failed" (no still could be made). Returns what to call to give up early; that also stops the download.
 */
function loadVideoStill(url: string, getCanvas: () => HTMLCanvasElement | null, onDone: (result: 'kept' | 'failed') => void): () => void {
  const video = document.createElement('video')
  let settled = false
  let giveUp = 0
  const stop = () => {
    window.clearTimeout(giveUp)
    video.removeAttribute('src')
    video.load()
  }
  const settle = (result: 'kept' | 'failed') => {
    if (settled) return
    settled = true
    stop()
    onDone(result)
  }
  if (typeof video.requestVideoFrameCallback !== 'function') {
    onDone('failed') // no way to learn when the first frame is shown, so do not start a download at all
    return () => {}
  }
  video.muted = true
  video.playsInline = true
  video.preload = 'metadata'
  video.addEventListener('error', () => settle('failed'))
  // Drawing before the browser has shown the first frame leaves the canvas empty, so wait to be told it is shown.
  // Asked before the source is set: a frame shown before the question would never be announced.
  video.requestVideoFrameCallback(() => {
    if (!settled) settle(drawStill(video, getCanvas()) ? 'kept' : 'failed')
  })
  giveUp = window.setTimeout(() => settle('failed'), COVER_GIVE_UP_MS)
  video.src = url
  return () => {
    settled = true
    stop()
  }
}

const coverQueue: Array<() => void> = []
let coversRunning = 0

let drainScheduled = false

/** Starts waiting covers once the current batch of changes is over, so rows that leave the page together do not start in between. */
function startQueuedCoversSoon() {
  if (drainScheduled) return
  drainScheduled = true
  queueMicrotask(() => {
    drainScheduled = false
    while (coversRunning < COVER_MAX_PARALLEL) {
      const start = coverQueue.shift()
      if (!start) return
      start()
    }
  })
}

/** `loadVideoStill`, but never more than COVER_MAX_PARALLEL at once across the page; the rest wait their turn in order. */
function loadFirstFrame(url: string, getCanvas: () => HTMLCanvasElement | null, onDone: (result: 'kept' | 'failed') => void): () => void {
  let holdsSlot = false
  let giveUp: (() => void) | null = null
  const release = () => {
    if (!holdsSlot) return
    holdsSlot = false
    coversRunning -= 1
    startQueuedCoversSoon()
  }
  const start = () => {
    holdsSlot = true
    coversRunning += 1
    giveUp = loadVideoStill(url, getCanvas, (result) => {
      release()
      onDone(result)
    })
  }
  if (coversRunning < COVER_MAX_PARALLEL && coverQueue.length === 0) {
    start()
  } else {
    coverQueue.push(start)
    startQueuedCoversSoon()
  }
  return () => {
    const queued = coverQueue.indexOf(start)
    if (queued >= 0) coverQueue.splice(queued, 1)
    giveUp?.()
    release()
  }
}

function useFirstFrameStill(url: string | null | undefined, wanted: boolean, canvas: RefObject<HTMLCanvasElement>): CoverPhase {
  const [phase, setPhase] = useState<CoverPhase>('waiting')
  useEffect(() => {
    if (!url || !wanted) return
    return loadFirstFrame(url, () => canvas.current, setPhase)
  }, [url, wanted, canvas])
  return phase
}

/**
 * The cover of a Reel: the first frame of its finished video, which is already a finished picture (hook text and logo).
 * The video is only asked for when the row is about to be seen. No video address, or a video that cannot be shown,
 * leaves the plain play tile. Decorative: the row's title already says what the Reel is.
 */
function ReelCover({ url }: { url?: string | null }) {
  const { ref, near } = useNearScreen<HTMLSpanElement>()
  const stillRef = useRef<HTMLCanvasElement>(null)
  const phase = useFirstFrameStill(url, near, stillRef)
  const kept = phase === 'kept'
  return (
    <span
      ref={ref}
      aria-hidden
      data-cover={url ? phase : 'none'}
      className={`relative mt-0.5 flex ${url ? 'h-[78px]' : 'h-11'} w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-me-charcoal text-me-gold`}
    >
      {url && near && phase !== 'failed' && (
        <canvas ref={stillRef} width={COVER_STILL.width} height={COVER_STILL.height} className={kept ? 'h-full w-full object-cover' : 'hidden'} />
      )}
      <PlayGlyph className={kept ? 'absolute bottom-1 right-1 h-3.5 w-3.5 text-white/90 drop-shadow' : 'h-5 w-5'} />
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
          <ReelCover key={latest.reel.video_url ?? 'none'} url={latest.reel.video_url} />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {work.batchLabel && <span className="text-xs font-semibold text-me-charcoal/65">{work.batchLabel} ·</span>}
              <h4 className="min-w-0 break-words text-sm font-semibold leading-snug text-me-charcoal">{work.title}</h4>
              <StatusTag kind={work.tag.kind} title={work.tag.hint}>{work.tag.label}</StatusTag>
              {work.versions.length > 1 && <StatusTag>共 {work.versions.length} 版</StatusTag>}
              {work.olderPending > 0 && work.tag.kind !== 'review' && (
                <StatusTag kind="review" title="最新版已经不是待审核，但旧版本里还有在等审核的。">另有 {work.olderPending} 个旧版待审核</StatusTag>
              )}
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
