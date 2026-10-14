'use client'

import { useState } from 'react'
import { OrderNo } from './OrderNo'
import { formatCreatedAt, formatDuration, parseAngle } from './reviewCardMeta'

// 审片页平铺卡片的共用零件:视频(可点开播放,读出时长)、标题块、状态标签。
// 只负责显示;通过 / 打回 / 发布的按钮与逻辑仍在 ReviewInbox。

export function CardVideo({ src, onDuration }: { src: string; onDuration?: (s: number) => void }) {
  return src ? (
    <video
      controls
      preload="metadata"
      src={src}
      onLoadedMetadata={(e) => onDuration?.(e.currentTarget.duration)}
      className="w-full aspect-[9/16] max-h-[360px] rounded-lg bg-black object-contain"
    />
  ) : (
    <div className="w-full aspect-[9/16] max-h-[360px] rounded-lg bg-slate-100 grid place-items-center text-xs text-slate-500">无成片</div>
  )
}

export function StatusTag({ label, tone }: { label: string; tone: 'amber' | 'green' | 'slate' | 'orange' }) {
  const cls = tone === 'orange' ? 'bg-orange-100 text-orange-700' : tone === 'amber' ? 'bg-amber-100 text-amber-800' : tone === 'green' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{label}</span>
}

export function CardTitle(props: {
  id: string
  angle: string
  rationale: string
  clientName: string
  createdAt?: string | null
  duration: number | null
  status: { label: string; tone: 'amber' | 'green' | 'slate' | 'orange' }
}) {
  const p = parseAngle(props.angle)
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between gap-2 mb-1">
        <StatusTag {...props.status} />
        <span className="text-xs text-slate-500">{formatDuration(props.duration)} · {formatCreatedAt(props.createdAt)}</span>
      </div>
      <h3 className="text-sm font-semibold text-slate-900 leading-snug">{p.title}</h3>
      {props.rationale && <p className="mt-1 text-sm text-slate-700">{props.rationale}</p>}
      <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
        <span>{props.clientName}</span>
        <OrderNo id={props.id} />
      </div>
    </div>
  )
}

// 已发布 / 已作废:只读卡片,不放任何操作按钮(作废的更不能误点)
export function ReadOnlyTile(props: {
  id: string
  angle: string
  rationale: string
  clientName: string
  createdAt?: string | null
  videoSrc: string
  status: { label: string; tone: 'amber' | 'green' | 'slate' | 'orange' }
  note?: string
  link?: { href: string; label: string } | null
  dim?: boolean
}) {
  const [duration, setDuration] = useState<number | null>(null)
  return (
    <div className={`border border-slate-200 rounded-xl bg-white p-3 flex flex-col ${props.dim ? 'opacity-75' : ''}`}>
      <div className="mb-3"><CardVideo src={props.videoSrc} onDuration={setDuration} /></div>
      <CardTitle
        id={props.id}
        angle={props.angle}
        rationale={props.rationale}
        clientName={props.clientName}
        createdAt={props.createdAt}
        duration={duration}
        status={props.status}
      />
      {props.note && <p className="mb-2 text-xs text-orange-700">{props.note}</p>}
      {props.link && (
        <a href={props.link.href} target="_blank" rel="noopener noreferrer" className="mt-auto text-sm text-blue-600 underline">{props.link.label}</a>
      )}
    </div>
  )
}

// 待审卡片的头部(视频 + 标题 + 状态);操作区由 ReviewInbox 接在它下面,原样保留
export function PendingCardHead(props: {
  id: string
  angle: string
  rationale: string
  clientName: string
  createdAt?: string | null
  videoSrc: string
}) {
  const [duration, setDuration] = useState<number | null>(null)
  return (
    <>
      <div className="mb-3"><CardVideo src={props.videoSrc} onDuration={setDuration} /></div>
      <CardTitle
        id={props.id}
        angle={props.angle}
        rationale={props.rationale}
        clientName={props.clientName}
        createdAt={props.createdAt}
        duration={duration}
        status={{ label: '待审', tone: 'amber' }}
      />
    </>
  )
}
