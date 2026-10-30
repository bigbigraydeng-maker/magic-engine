'use client'

import { useEffect, useState } from 'react'
import type { TimelineAiBrief } from '@/app/dashboard/clients/[id]/crm/_components/ContactTimeline'
import { preserveOriginalName } from '@/lib/crm/brief-display-name'
import type { RecentStaffNote } from '@/lib/crm/recent-staff-notes'

const noteTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Pacific/Auckland', month: 'numeric', day: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false,
})

type BriefState = { status: 'loading' | 'ready' | 'error'; brief: TimelineAiBrief | null }

export function RecentNotesPanel({ clientId, notes, openingContactId = null, onOpen }: {
  clientId: string
  notes: RecentStaffNote[]
  openingContactId?: string | null
  onOpen: (note: RecentStaffNote) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const [expandedContactId, setExpandedContactId] = useState<string | null>(null)
  const [briefState, setBriefState] = useState<BriefState>({ status: 'loading', brief: null })

  useEffect(() => {
    if (!expandedContactId) return
    const ctrl = new AbortController()
    void (async () => {
      try {
        const response = await fetch(
          `/api/clients/${clientId}/crm/contacts/${expandedContactId}/brief`,
          { signal: ctrl.signal },
        )
        if (!response.ok) throw new Error('brief unavailable')
        const data = (await response.json()) as { brief?: TimelineAiBrief | null }
        if (!ctrl.signal.aborted) setBriefState({ status: 'ready', brief: data.brief ?? null })
      } catch {
        if (!ctrl.signal.aborted) setBriefState({ status: 'error', brief: null })
      }
    })()
    return () => ctrl.abort()
  }, [clientId, expandedContactId])

  if (notes.length === 0) return null
  const visible = showAll ? notes : notes.slice(0, 15)
  const toggle = (id: string) => {
    setExpandedContactId((current) => current === id ? null : id)
    setBriefState({ status: 'loading', brief: null })
  }

  return <section aria-label="最近记一笔" className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-base font-black text-me-charcoal">最近记一笔</h2>
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-900">{notes.length} 位</span>
        </div>
        <p className="mt-1 text-xs text-me-charcoal/60">点小卡片直接看最近手记和 AI 概况；需要完整往来时再打开客户卡片。最多显示 50 位。</p>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-me-charcoal/50">按写入时间排序</span>
        {notes.length > 15 && <button type="button" onClick={() => setShowAll((value) => !value)}
          className="text-xs font-bold text-amber-900 underline">{showAll ? '收起' : `展开这 ${notes.length} 位`}</button>}
      </div>
    </div>
    <div className="mt-3 grid items-start gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {visible.map((note) => {
        const isExpanded = expandedContactId === note.contactId
        const brief = isExpanded && briefState.status === 'ready' ? briefState.brief : null
        const briefAt = brief?.generatedAt ? Date.parse(brief.generatedAt) : NaN
        const noteAt = Date.parse(note.at)
        const aiOlderThanNote = Number.isFinite(briefAt) && Number.isFinite(noteAt) && briefAt < noteAt
        return <div key={note.contactId} className="rounded-lg border border-amber-100 bg-white hover:border-amber-400">
          <button type="button" onClick={() => toggle(note.contactId)} aria-expanded={isExpanded}
            aria-controls={`recent-note-${note.contactId}`}
            className="block w-full px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600">
            <span className="flex items-center justify-between gap-2 text-sm font-bold text-me-charcoal">
              <span className="truncate">{note.name}</span>
              <span className="flex shrink-0 items-center gap-2">
                <time dateTime={note.at} className="text-[11px] font-normal text-me-charcoal/45">记于 {noteTime.format(new Date(note.at))}</time>
                <span aria-hidden="true" className="text-amber-800">{isExpanded ? '▴' : '▾'}</span>
              </span>
            </span>
            <span className="mt-0.5 block truncate text-xs text-me-charcoal/60" title={note.preview}>{note.preview}</span>
          </button>
          {isExpanded && <div id={`recent-note-${note.contactId}`} className="border-t border-amber-100 px-3 pb-3 pt-2 text-xs text-me-charcoal/80">
            <p className="font-bold text-amber-900">最近一笔 · 员工原文</p>
            <p className="mt-1 whitespace-pre-wrap break-words leading-relaxed">{note.content ?? note.preview}</p>
            {Date.parse(note.at) - Date.parse(note.occurredAt) >= 24 * 60 * 60 * 1000 &&
              <p className="mt-1 text-[11px] text-me-charcoal/45">补记通话：{noteTime.format(new Date(note.occurredAt))}</p>}
            <div className="mt-3 border-t border-amber-100 pt-2">
              <p className="font-bold text-amber-900">AI 概况 · 未核实，以原文为准</p>
              {briefState.status === 'loading' && <p className="mt-1 text-me-charcoal/50">正在读取 AI 概况…</p>}
              {briefState.status === 'error' && <p className="mt-1 text-me-charcoal/50">AI 概况暂时读不到，员工手记仍可查看。</p>}
              {briefState.status === 'ready' && !brief && <p className="mt-1 text-me-charcoal/50">暂无 AI 概况。</p>}
              {brief && <>
                {Number.isFinite(briefAt) && <p className="mt-1 text-[11px] text-me-charcoal/50">生成于 {noteTime.format(new Date(briefAt))}</p>}
                {aiOlderThanNote && <p className="mt-1 font-semibold text-[#C2453A]">这份 AI 概况早于最近手记，请以手记和原文为准。</p>}
                <p className="mt-1 whitespace-pre-wrap break-words leading-relaxed">{preserveOriginalName(brief.summary, note.name)}</p>
              </>}
            </div>
            <button type="button" onClick={() => onOpen(note)} aria-busy={openingContactId === note.contactId}
              className="mt-3 rounded-md border border-amber-300 px-2.5 py-1.5 font-bold text-amber-900 hover:bg-amber-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600">
              {openingContactId === note.contactId ? '正在打开客户…' : '打开客户卡片 →'}
            </button>
          </div>}
        </div>
      })}
    </div>
  </section>
}
