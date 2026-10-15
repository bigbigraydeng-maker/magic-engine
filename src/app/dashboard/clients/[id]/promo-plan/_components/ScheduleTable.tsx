'use client'

import type { Schedule, ScheduleKind } from '@/lib/marketing-plan/promo/schedule'
import { isoWeekday, weekStartOf } from '@/lib/marketing-plan/promo/schedule'

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

function groupByWeek(s: Schedule): { week: string; days: Schedule['days'] }[] {
  const out: { week: string; days: Schedule['days'] }[] = []
  for (const day of s.days) {
    const week = weekStartOf(day.date)
    const last = out[out.length - 1]
    if (last && last.week === week) last.days.push(day)
    else out.push({ week, days: [day] })
  }
  return out
}

/** 排期表：按周列出每天要做什么。只读，不写任何数据，不派任何待办。 */
export function ScheduleTable({ schedule, mode, today }: { schedule: Schedule; mode: ScheduleMode; today: string }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white" aria-label="排期表">
      <div className="px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-bold text-gray-900">排期表 · 每天做什么</h2>
        <p className="text-xs text-gray-500 mt-0.5">{MODE_NOTE[mode]}</p>
        {!schedule.error && <p className="text-xs font-medium text-gray-800 mt-1">{summaryOf(schedule)}</p>}
        <p className="text-[11px] text-gray-500 mt-0.5">以上是计划原文，未经官网核实，发布前必须核对。</p>
        <p className="text-[11px] text-gray-500 mt-0.5">这里按具体日期落点，只列落在计划阶段内的日子；每周对账按「每周条数」折算，首尾不足一周的周和短视频的月度条数会和这里差几条。做事以本表逐日为准，对账只看整体进度。</p>
      </div>
      {schedule.error && <p className="px-4 py-3 text-sm text-red-700 bg-red-50">{schedule.error}</p>}
      {schedule.too_dense && (
        <p className="px-4 py-3 text-sm text-yellow-900 bg-yellow-50">排得太密了，不逐日展开。请减少每周条数或缩短阶段。</p>
      )}
      {schedule.notes.length > 0 && (
        <ul className="px-4 py-2 space-y-0.5 bg-gray-50">{schedule.notes.map((n, i) => <li key={i} className="text-xs text-gray-600">• {n}</li>)}</ul>
      )}
      {groupByWeek(schedule).map(w => (
        <div key={w.week} className="border-t border-gray-100">
          <p className="px-4 pt-3 text-xs font-semibold text-gray-600">{w.week} 起的一周</p>
          <ul className="px-4 pb-3 divide-y divide-gray-50">
            {w.days.map(d => (
              <li key={d.date} className={`py-2 grid grid-cols-1 sm:grid-cols-[9rem_1fr] gap-2 ${d.date < today ? 'opacity-50' : ''}`}>
                <p className="text-xs text-gray-700">{d.date.slice(5)} {WEEKDAY[isoWeekday(d.date)]}{d.date < today ? '（已过，是否完成未核对）' : ''}</p>
                <ul className="space-y-0.5">
                  {d.items.map((it, i) => (
                    <li key={i} className="text-xs text-gray-900">{KIND_META[it.kind].icon} <strong>{KIND_META[it.kind].label}</strong>：{it.text}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
