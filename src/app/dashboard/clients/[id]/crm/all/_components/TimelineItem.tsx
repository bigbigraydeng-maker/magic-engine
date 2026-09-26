'use client'

/**
 * 一条时间线条目（触点 / 私信原文 / 阶段流转）。
 *
 * 从 page.tsx 搬出来（2026-09-26，WP3 R6 纯搬家），函数体一个字没改。
 */

import { CHANNEL_LABEL, DIRECTION_LABEL, OUTCOME_LABEL, fmtDate, relTime, type TimelineEntry } from './contact-table-types'

/** 一条时间线条目（触点 / 阶段流转）。 */
export function TimelineItem({ e }: { e: TimelineEntry }) {
  if (e.kind === 'stage') {
    return (
      <li className="flex gap-3">
        <span className="mt-0.5 shrink-0 text-xs text-me-charcoal/35">{relTime(e.at)}</span>
        <div className="min-w-0 text-sm text-me-charcoal/70">
          <span className="rounded bg-me-ochre/12 px-1.5 py-0.5 text-xs font-bold text-me-ochre">改了跟进阶段</span>
          <span className="ml-2">
            {e.fromLabel ?? '还没标'} → <span className="font-semibold text-me-charcoal">{e.toLabel ?? '—'}</span>
          </span>
          {e.note && <span className="ml-2 text-me-charcoal/45">· {e.note}</span>}
        </div>
      </li>
    )
  }
  if (e.kind === 'message') {
    // 私信 / 邮件原文。方向决定气泡:入站=客人(白底),出站=我们(灰底)。
    // sender 名放前面,一眼知道谁说的,系统自动回复(出站)也不会被当成客人的话。
    const inbound = e.direction === 'inbound'
    return (
      <li className="flex gap-3">
        <span className="mt-1 shrink-0 text-xs text-me-charcoal/35">{relTime(e.at)}</span>
        <div className={`min-w-0 flex-1 ${inbound ? '' : 'flex justify-end'}`}>
          <div
            className={`inline-block max-w-[85%] rounded-2xl px-3 py-1.5 text-sm leading-relaxed ${
              inbound ? 'bg-white text-me-charcoal ring-1 ring-black/5' : 'bg-me-charcoal/5 text-me-charcoal/80'
            }`}
          >
            <span className="mr-1.5 text-[11px] font-bold text-me-charcoal/45">
              {inbound ? e.senderName || '客户' : e.senderName || '我们'}
            </span>
            <span className="whitespace-pre-wrap break-words">{e.body}</span>
          </div>
        </div>
      </li>
    )
  }
  const badge = (text: string) => (
    <span className="rounded bg-white px-1.5 py-0.5 text-[11px] font-semibold text-me-charcoal/60 ring-1 ring-black/5">
      {text}
    </span>
  )
  const outcomeLabel = e.outcome ? OUTCOME_LABEL[e.outcome] : null
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 shrink-0 text-xs text-me-charcoal/35">{relTime(e.at)}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-bold text-me-charcoal/70">{DIRECTION_LABEL[e.direction] ?? e.direction}</span>
          <span className="text-xs text-me-charcoal/40">·</span>
          <span className="text-xs text-me-charcoal/50">{CHANNEL_LABEL[e.channel] ?? e.channel}</span>
          {outcomeLabel && badge(outcomeLabel)}
          {e.tour && badge(`团：${e.tour}`)}
          {e.travelWindow && badge(`想去：${e.travelWindow}`)}
          {e.callbackAt && badge(`约回电：${fmtDate(e.callbackAt)}`)}
          {e.competitor && badge(`提到：${e.competitor}`)}
        </div>
        {e.summary && <p className="mt-0.5 text-sm leading-relaxed text-me-charcoal/75">{e.summary}</p>}
      </div>
    </li>
  )
}
