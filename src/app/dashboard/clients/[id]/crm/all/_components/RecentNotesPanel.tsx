'use client'

import { useState } from 'react'
import type { RecentStaffNote } from '@/lib/crm/recent-staff-notes'

const noteTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Pacific/Auckland', month: 'numeric', day: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false,
})

export function RecentNotesPanel({ notes, openingContactId = null, onOpen }: {
  notes: RecentStaffNote[]
  openingContactId?: string | null
  onOpen: (note: RecentStaffNote) => void
}) {
  const [expanded, setExpanded] = useState(false)
  if (notes.length === 0) return null
  const visible = expanded ? notes : notes.slice(0, 15)
  return <section aria-label="最近记一笔" className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-base font-black text-me-charcoal">最近记一笔</h2>
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-900">{notes.length} 位</span>
        </div>
        <p className="mt-1 text-xs text-me-charcoal/60">最近 7 天的员工手记，点客人打开原有客户卡片；主名单无需翻页。最多显示 50 位。</p>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-me-charcoal/50">按写入时间排序</span>
        {notes.length > 15 && <button type="button" onClick={() => setExpanded((value) => !value)}
          className="text-xs font-bold text-amber-900 underline">{expanded ? '收起' : `展开这 ${notes.length} 位`}</button>}
      </div>
    </div>
    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {visible.map((note) => <button type="button" key={note.contactId} onClick={() => onOpen(note)}
        aria-busy={openingContactId === note.contactId}
        className="rounded-lg border border-amber-100 bg-white px-3 py-2 text-left hover:border-amber-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600">
        <span className="flex items-center justify-between gap-2 text-sm font-bold text-me-charcoal"><span className="truncate">{note.name}</span><time dateTime={note.at} className="shrink-0 text-[11px] font-normal text-me-charcoal/45">记于 {noteTime.format(new Date(note.at))}</time></span>
        <span className="mt-0.5 block truncate text-xs text-me-charcoal/60" title={note.preview}>{openingContactId === note.contactId ? '正在打开客户…' : note.preview}</span>
        {Date.parse(note.at) - Date.parse(note.occurredAt) >= 24 * 60 * 60 * 1000 &&
          <span className="block text-[11px] text-me-charcoal/45">补记通话：{noteTime.format(new Date(note.occurredAt))}</span>}
      </button>)}
    </div>
  </section>
}
