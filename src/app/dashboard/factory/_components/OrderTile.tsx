'use client'

import { useState } from 'react'
import { OrderNo } from './OrderNo'
import { cardDetails, cardLabel } from './cardLabel'
import { formatCreatedAt, formatDuration } from './reviewCardMeta'

// 审片页小卡共用零件:小窗视频、一行标题、一行状态、折叠的详情。
// 只负责显示;通过 / 打回 / 发布的按钮与逻辑仍在 ReviewInbox。

type Tone = 'amber' | 'green' | 'slate' | 'orange'

export function CardVideo({ src, onDuration }: { src: string; onDuration?: (s: number) => void }) {
  return src ? (
    <video
      controls
      preload="metadata"
      src={src}
      onLoadedMetadata={(e) => onDuration?.(e.currentTarget.duration)}
      className="w-full max-w-[140px] mx-auto aspect-[9/16] rounded-lg bg-black object-contain"
    />
  ) : (
    <div className="w-full max-w-[140px] mx-auto aspect-[9/16] rounded-lg bg-slate-100 grid place-items-center text-xs text-slate-500">无成片</div>
  )
}

export function StatusTag({ label, tone }: { label: string; tone: Tone }) {
  const cls = tone === 'orange' ? 'bg-orange-100 text-orange-700' : tone === 'amber' ? 'bg-amber-100 text-amber-800' : tone === 'green' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'
  return <span className="inline-flex"><span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{label}</span></span>
}

interface HeadProps {
  id: string
  angle: string
  rationale: string
  clientName: string
  createdAt?: string | null
  videoSrc: string
  status: { label: string; tone: Tone }
  note?: string
}

// 小卡头部:视频 + 「客户｜团名｜第N条｜版本」+ 一行状态 + 折叠详情(工程备注默认不展示)
function CompactHead(p: HeadProps) {
  const [duration, setDuration] = useState<number | null>(null)
  const details = cardDetails(p.angle, p.rationale)
  return (
    <>
      <div className="mb-2"><CardVideo src={p.videoSrc} onDuration={setDuration} /></div>
      <h3 className="text-sm font-semibold text-slate-900 leading-snug">{cardLabel(p.clientName, p.angle, p.rationale)}</h3>
      <div className="mt-1 mb-2 flex items-center gap-2 text-xs text-slate-500 flex-wrap">
        <StatusTag {...p.status} />
        <span>{formatDuration(duration)} · {formatCreatedAt(p.createdAt)}</span>
        <OrderNo id={p.id} />
      </div>
      {p.note && <p className="mb-2 text-xs text-orange-700">{p.note}</p>}
      {details.length > 0 && (
        <details className="mb-2 text-xs text-slate-500">
          <summary className="cursor-pointer select-none">详情</summary>
          {details.map((d, i) => <p key={i} className="mt-1 whitespace-pre-wrap break-words">{d}</p>)}
        </details>
      )}
    </>
  )
}

// 已发布 / 已打回 / 已作废:只读小卡,不放任何操作按钮
export function ReadOnlyTile(props: Omit<HeadProps, 'status'> & {
  status: { label: string; tone: Tone }
  link?: { href: string; label: string } | null
  dim?: boolean
}) {
  return (
    <div className={`border border-slate-200 rounded-xl bg-white p-3 flex flex-col ${props.dim ? 'opacity-75' : ''}`}>
      <CompactHead {...props} />
      {props.link && (
        <a href={props.link.href} target="_blank" rel="noopener noreferrer" className="mt-auto text-sm text-blue-600 underline">{props.link.label}</a>
      )}
    </div>
  )
}

// 待审小卡的头部;操作区由 ReviewInbox 接在它下面
export function PendingCardHead(props: Omit<HeadProps, 'status' | 'note'>) {
  return <CompactHead {...props} status={{ label: '待审', tone: 'amber' }} />
}
