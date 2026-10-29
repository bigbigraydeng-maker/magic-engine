'use client'

import { cleanDisplayName } from '@/lib/crm/clean-display-name'
import {
  LIST_CLS,
  arrivalLabel,
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
  // 判据跟后端同一份：`cleanDisplayName`（邮箱 / 电话 / 占位词 = 没留名；`kay@home` 这类昵称是名字）；
  // 后端兜底词「未留姓名」和平台系统账号名（WhatsApp Business）也算没留名。
  const missing =
    trimmed === '' ||
    trimmed === '未留姓名' ||
    /^whatsapp business$/i.test(trimmed) ||
    cleanDisplayName(trimmed) === null
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

function NameCell({ r, grouped }: { r: ContactRow; grouped: boolean }) {
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
        {/* 回头客 —— 摆在渠道小标签**前面**，是这一行最该先看到的东西（PM 2026-10-27）。
            悬停说清为什么：之前咨询过、我们联系过、又填了表。 */}
        {r.returning && (
          <span
            data-testid="returning-tag"
            title={r.reason ?? '之前咨询过、我们联系过，今天又填了咨询表'}
            className="shrink-0 rounded bg-[#C2453A]/12 px-1.5 py-0.5 text-[10px] font-black text-[#C2453A]"
          >
            🔥 回头
          </span>
        )}
        {/* 刚打通聊上 —— 这个人正热着，跟「回头」一样摆在最前（PM 2026-10-29）。 */}
        {r.afterCall && !r.returning && (
          <span
            data-testid="after-call-tag"
            title={r.reason ?? '刚打通电话聊上了，还没记下一步'}
            className="shrink-0 rounded bg-[#C2453A]/12 px-1.5 py-0.5 text-[10px] font-black text-[#C2453A]"
          >
            📞 刚聊过
          </span>
        )}
        {/* 「今天先联系」不画来源小标签：一行只留名字和「回头」这类最该先看的东西。 */}
        {!grouped && (r.sources ?? []).slice(0, 1).map((k) => (
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

/** 联系渠道：一个词 + 一个小图标，让销售一眼知道「用什么联系他」。号码 / 邮箱留在点开后的详情里。 */
const CHANNEL_CHIP: Record<NonNullable<ContactRow['suggestedChannel']>, string> = {
  phone: '📞 电话',
  sms: '💬 短信',
  email: '✉️ 邮件',
  messenger: '💬 私信',
  none: '暂无可用渠道',
}

function ChannelCell({ r }: { r: ContactRow }) {
  const ch = r.suggestedChannel
  return (
    <td className="whitespace-nowrap px-4 py-2 text-xs text-me-charcoal/60" data-testid="channel-cell">
      {ch ? CHANNEL_CHIP[ch] : <span className="text-me-charcoal/35">—</span>}
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
      <NameCell r={r} grouped={grouped} />
      {grouped ? (
        <>
          <td className="whitespace-nowrap px-4 py-2 text-xs text-me-charcoal/55" data-testid="arrival-cell">
            {r.firstSeenAt ? arrivalLabel(r.firstSeenAt) : <span className="text-me-charcoal/35">—</span>}
          </td>
          <StageCell r={r} grouped />
          <ChannelCell r={r} />
        </>
      ) : (
        <>
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
      <StageCell r={r} grouped={false} />
        </>
      )}
    </tr>
  )
}
