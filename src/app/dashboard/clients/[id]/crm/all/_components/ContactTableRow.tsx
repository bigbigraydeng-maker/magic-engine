'use client'

import {
  LIST_CLS,
  fmtDate,
  relTime,
  type ContactRow,
  type CustomColumnMeta,
} from './contact-table-types'

function ContactCell({ r }: { r: ContactRow }) {
  if (r.phone || r.email) return <span className="text-me-charcoal/70">{r.phone ?? r.email}</span>
  if (r.hasMessenger) return <span className="text-me-charcoal/45">仅 FB 私信</span>
  return <span className="text-me-charcoal/35">没留联系方式</span>
}

function PinCell({ r, onTogglePin }: { r: ContactRow; onTogglePin: (row: ContactRow) => void }) {
  return (
    <td className="px-2 py-3">
      {/* 点星星不能顺带打开抽屉 —— 两个动作是分开的。 */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          void onTogglePin(r)
        }}
        title={r.pinnedAt ? '取消置顶' : '置顶'}
        aria-label={r.pinnedAt ? '取消置顶' : '置顶'}
        className={`p-1 text-base leading-none ${
          r.pinnedAt ? 'text-yellow-500' : 'text-me-charcoal/40 hover:text-me-charcoal'
        }`}
      >
        {r.pinnedAt ? '⭐' : '☆'}
      </button>
    </td>
  )
}

function NameCell({ r }: { r: ContactRow }) {
  return (
    <td className="px-4 py-3 font-medium text-me-charcoal">
      {r.name}
      {r.important?.note && (
        <span
          title={r.important.note}
          className="ml-2 rounded bg-me-gold/20 px-1.5 py-0.5 text-[10px] font-bold text-me-charcoal/70"
        >
          ⭐ {r.important.note.length > 12 ? `${r.important.note.slice(0, 12)}…` : r.important.note}
        </span>
      )}
      {r.important?.dueAt && new Date(r.important.dueAt) < new Date() && (
        <span className="ml-1 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
          到期
        </span>
      )}
    </td>
  )
}

function StageCell({ r, grouped }: { r: ContactRow; grouped: boolean }) {
  return (
    <td className="px-4 py-3">
      {grouped ? (
        <>
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${LIST_CLS[r.nextAction.list]}`}>
            {r.nextAction.verbLabel}
          </span>
          <span className="ml-2 text-xs text-me-charcoal/60">{r.nextAction.reason}</span>
        </>
      ) : r.stageLabel ? (
        <span className="text-me-charcoal/70">{r.stageLabel}</span>
      ) : (
        <span className="text-me-charcoal/35">还没标</span>
      )}
    </td>
  )
}

export function ContactTableRow(props: {
  row: ContactRow
  active: boolean
  grouped: boolean
  columns: CustomColumnMeta[]
  onToggle: (contactId: string) => void
  onTogglePin: (row: ContactRow) => void
}) {
  const { row: r, active, grouped, columns, onToggle, onTogglePin } = props
  return (
    <tr
      // 直达链接靠它定位（?contact=<id> 打开对应抽屉）
      id={`contact-${r.contactId}`}
      onClick={() => onToggle(r.contactId)}
      className={`border-b border-me-charcoal/5 cursor-pointer hover:bg-me-ivory/40 ${active ? 'bg-me-ivory/50' : ''}`}
    >
      <PinCell r={r} onTogglePin={onTogglePin} />
      <NameCell r={r} />
      <td className="px-4 py-3 text-me-charcoal/60">{fmtDate(r.firstSeenAt)}</td>
      <td className="px-4 py-3 text-me-charcoal/60">
        {r.lastTouchAt ? relTime(r.lastTouchAt) : <span className="text-me-charcoal/35">还没联系过</span>}
      </td>
      <td className="px-4 py-3">
        <ContactCell r={r} />
      </td>
      {columns.map((c) => (
        <td key={c.key} className="px-4 py-3 text-me-charcoal/60">
          {r.custom[c.key] ?? <span className="text-me-charcoal/35">还没聊到</span>}
        </td>
      ))}
      <StageCell r={r} grouped={grouped} />
    </tr>
  )
}
