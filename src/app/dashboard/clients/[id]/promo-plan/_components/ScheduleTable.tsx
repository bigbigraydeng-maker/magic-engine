'use client'

import type { Schedule, ScheduleKind } from '@/lib/marketing-plan/promo/schedule'
import { addDays } from '@/lib/marketing-plan/promo/reconcile'
import { weekStartOf } from '@/lib/marketing-plan/promo/schedule'
import { buildScheduleView } from '@/lib/marketing-plan/promo/schedule-view'
import type { ViewDayLine, ViewWeek } from '@/lib/marketing-plan/promo/schedule-view'

export type ScheduleMode = 'preview' | 'approved' | 'sample'

const KIND_META: Record<ScheduleKind, { icon: string; label: string }> = {
  ads_start: { icon: '📣', label: '广告' },
  post: { icon: '📱', label: '帖子' },
  story: { icon: '🕒', label: '快拍' },
  reel: { icon: '🎬', label: '短视频' },
  blog: { icon: '📝', label: '博客' },
  newsletter: { icon: '✉️', label: '邮件' },
}

const WEEKDAY = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']

const MODE_NOTE: Record<ScheduleMode, string> = {
  preview: '预览：计划还没批准，这里只是把计划排成每天的安排，批准前不会派任何待办。',
  approved: '计划排期：只是把计划排成每天的安排，还没有分配给任何人、没有发布，批准后也暂时不会自动派活（下一步另做）。',
  sample: '示例排期：根据上面的示例计划算出，只用来看长什么样。',
}

function summaryOf(s: Schedule): string {
  const t = s.totals
  const parts = [
    t.post ? `帖子 ${t.post}` : '', t.story ? `快拍 ${t.story}` : '', t.reel ? `短视频 ${t.reel}` : '',
    t.blog ? `博客 ${t.blog}` : '', t.newsletter ? `邮件 ${t.newsletter}` : '', t.ads_start ? `广告阶段 ${t.ads_start}` : '',
  ].filter(Boolean)
  return parts.length > 0 ? `共排出：${parts.join('、')}` : '这份计划还没排出任何每天要做的事'
}

function DayRow({ line }: { line: ViewDayLine }) {
  return (
    <li className={`py-2 flex flex-wrap gap-x-3 gap-y-0.5 ${line.past ? 'opacity-50' : ''}`}>
      <p className="text-xs text-gray-700">{line.date.slice(5)} {WEEKDAY[line.weekday]}{line.past ? '（已过，是否完成未核对）' : ''}</p>
      <p className="text-xs text-gray-900">
        {line.kinds.map(k => <span key={k} className="mr-1">{KIND_META[k].icon}</span>)}
        {line.text}
      </p>
    </li>
  )
}

function WeekHeading({ week, label }: { week: ViewWeek; label: string | null }) {
  return (
    <p className="px-4 pt-3 text-xs font-semibold text-gray-600">
      {week.weekStart.slice(5)} 周起{label ? `（${label}）` : ''}
    </p>
  )
}

/** 排期表：按周列出每天要做什么。只读，不写任何数据，不派任何待办。 */
export function ScheduleTable({ schedule, mode, today, phaseNames }: { schedule: Schedule; mode: ScheduleMode; today: string; phaseNames?: Record<string, string> }) {
  const view = buildScheduleView(schedule, today, phaseNames)
  const w0 = weekStartOf(today)
  const next = addDays(w0, 7)
  const weekLabel = (weekStart: string): string | null =>
    weekStart === w0 ? '本周' : weekStart === next ? '下周' : null

  return (
    <section className="rounded-xl border border-gray-200 bg-white" aria-label="排期表">
      <div className="px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-bold text-gray-900">排期表 · 每天做什么</h2>
        <p className="text-xs text-gray-500 mt-0.5">{MODE_NOTE[mode]}</p>
        {!schedule.error && <p className="text-xs font-medium text-gray-800 mt-1">{summaryOf(schedule)}</p>}
        <p className="text-[11px] text-gray-500 mt-0.5">以上是计划原文，未经官网核实，发布前必须核对。</p>
        <p className="text-[11px] text-gray-500 mt-0.5">这里按具体日期落点，只列落在计划阶段内的日子；每周对账按「每周条数」折算，首尾不足一周的周和短视频的月度条数会和这里差几条。做事以本表逐日为准，对账只看整体进度。</p>
        {!schedule.error && <p className="text-[11px] text-gray-500 mt-0.5">{view.routine}</p>}
        {!schedule.error && view.adsNote && <p className="text-[11px] text-gray-500 mt-0.5">{view.adsNote}</p>}
      </div>
      {schedule.error && <p className="px-4 py-3 text-sm text-red-700 bg-red-50">{schedule.error}</p>}
      {schedule.too_dense && (
        <p className="px-4 py-3 text-sm text-yellow-900 bg-yellow-50">排得太密了，不逐日展开。请减少每周条数或缩短阶段。</p>
      )}
      {schedule.notes.length > 0 && (
        <ul className="px-4 py-2 space-y-0.5 bg-gray-50">{schedule.notes.map((n, i) => <li key={i} className="text-xs text-gray-600">• {n}</li>)}</ul>
      )}
      {!schedule.error && !schedule.too_dense && view.weeks.map(w => (
        <div key={w.weekStart} className="border-t border-gray-100">
          {w.expanded ? (
            <>
              <WeekHeading week={w} label={weekLabel(w.weekStart)} />
              {w.days.length === 0 ? (
                <p className="px-4 pb-3 pt-1 text-xs text-gray-500">这周没有要特别做的事</p>
              ) : (
                <ul className="px-4 pb-3 divide-y divide-gray-50">
                  {w.days.map(d => <DayRow key={d.date} line={d} />)}
                </ul>
              )}
            </>
          ) : (
            <details>
              <summary className="px-4 py-3 text-xs font-semibold text-gray-600 cursor-pointer">{w.summary}</summary>
              {w.days.length === 0 ? (
                <p className="px-4 pb-3 text-xs text-gray-500">这周没有要特别做的事</p>
              ) : (
                <ul className="px-4 pb-3 divide-y divide-gray-50">
                  {w.days.map(d => <DayRow key={d.date} line={d} />)}
                </ul>
              )}
            </details>
          )}
        </div>
      ))}
    </section>
  )
}
