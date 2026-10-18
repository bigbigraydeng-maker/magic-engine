'use client'

import {
  LIST_CLS,
  fmtDate,
  relTime,
  type ContactRow,
  type CustomColumnMeta,
} from './contact-table-types'

const SOURCE_LABEL: Record<string, string> = {
  messenger: 'FB 私信',
  email: '邮件',
  whatsapp: 'WhatsApp',
  phone: '电话',
  fb_form: 'FB 表单',
  web_form: '网站表单',
}

export function nameForDisplay(
  r: Pick<ContactRow, 'name' | 'phone' | 'email' | 'hasMessenger'>,
): { text: string; missing: boolean; sub: string | null } {
  const trimmed = r.name.trim()
  const missing =
    trimmed === '' ||
    trimmed.includes('@') ||
    /^(whatsapp business|unknown|未知)$/i.test(trimmed)
  if (missing) {
    return {
      text: '未留名',
      missing: true,
      sub: r.phone ?? r.email ?? (r.hasMessenger ? '仅 FB 私信' : '没留联系方式'),
    }
  }
  return { text: trimmed, missing: false, sub: null }
}

function ContactCell({ r }: { r: ContactRow }) {
  if (r.phone || r.email) {
    const value = r.phone ?? r.email
    return (
      <span className="text-me-charcoal/70" title={value ?? undefined}>
        {value}
      </span>
    )
  }
  if (r.hasMessenger) return <span className="text-me-charcoal/45">仅 FB 私信</span>
  return <span className="text-me-charcoal/35">没留联系方式</span>
}

function PinCell({ r, onTogglePin }: { r: ContactRow; onTogglePin: (row: ContactRow) => void }) {
  return (
    <td className="px-2 py-2">
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
  const { text, missing, sub } = nameForDisplay(r)
  return (
    <td className="px-4 py-2">
      <div className="max-w-[260px]">
      <div className="flex items-center gap-2">
        <span
          title={missing ? r.name || text : text}
          className={`truncate font-medium ${missing ? 'text-me-charcoal/45' : 'text-me-charcoal'}`}
        >
          {text}
        </span>
        {(r.sources ?? []).slice(0, 1).map((k) => (
          <span
            key={k}
            title="最早是从这个渠道进来的"
            className="shrink-0 rounded bg-me-charcoal/[0.06] px-1.5 py-0.5 text-[10px] font-semibold text-me-charcoal/50"
          >
            {SOURCE_LABEL[k] ?? k}
          </span>
        ))}
        {r.important?.note && (
          <span
            title={r.important.note}
            className="shrink-0 rounded bg-me-gold/20 px-1.5 py-0.5 text-[10px] font-bold text-me-charcoal/70"
          >
            ⭐ {r.important.note.length > 12 ? `${r.important.note.slice(0, 12)}…` : r.important.note}
          </span>
        )}
        {r.important?.dueAt && new Date(r.important.dueAt) < new Date() && (
          <span className="shrink-0 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
            到期
          </span>
        )}
      </div>
      {sub !== null && (
        <div className="truncate text-[11px] font-normal text-me-charcoal/45">{sub}</div>
      )}
      </div>
    </td>
  )
}

function StageCell({ r, grouped }: { r: ContactRow; grouped: boolean }) {
  return (
    <td className="whitespace-nowrap px-4 py-2">
      {grouped ? (
        <div className="flex max-w-[380px] items-center gap-2">
          <span
            className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${LIST_CLS[r.nextAction.list]}`}
          >
            {r.nextAction.verbLabel}
          </span>
          <span className="truncate text-xs text-me-charcoal/60" title={r.nextAction.reason}>
            {r.nextAction.reason}
          </span>
        </div>
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
      <td className="whitespace-nowrap px-4 py-2 text-me-charcoal/60">{fmtDate(r.firstSeenAt)}</td>
      <td className="whitespace-nowrap px-4 py-2 text-me-charcoal/60">
        {r.lastTouchAt ? relTime(r.lastTouchAt) : <span className="text-me-charcoal/35">—</span>}
      </td>
      <td className="px-4 py-2">
        {/* max-width 写在 td 上在 auto 布局里不生效（不会出省略号），所以放进里面的 div。 */}
        <div className="max-w-[220px] truncate">
          <ContactCell r={r} />
        </div>
      </td>
      {columns.map((c) => {
        const value = r.custom[c.key]
        return (
          <td key={c.key} className="px-4 py-2 text-me-charcoal/60">
            <div className="max-w-[200px] truncate whitespace-nowrap" title={typeof value === 'string' ? value : undefined}>
              {value ?? <span className="text-me-charcoal/35">—</span>}
            </div>
          </td>
        )
      })}
      <StageCell r={r} grouped={grouped} />
    </tr>
  )
}
