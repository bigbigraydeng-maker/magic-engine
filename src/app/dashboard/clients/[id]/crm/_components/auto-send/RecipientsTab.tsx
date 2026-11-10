'use client'

/**
 * 抽屉第二页「收件人与发送情况」：每人一行——姓名、座位、状态、原因、打开。
 * 只显示姓名，不显示邮箱。被拦的原因用「最近发送」(REASON_LABELS) 的写法翻成大白话，
 * 那张表里没有的原因另有一份补充（只增不改）。点姓名打开这位客人的资料页（示例数据没有资料页，不做链接）。
 */

import { formatSeats } from '@/lib/crm/auto-send/format'
import { resolveReasonText } from '@/lib/crm/auto-send/reason-labels'
import type { LetterDetail, OpenInfo, RecipientRow } from '@/lib/crm/auto-send/types'
import { engagementText, openInfoLine, recipientsFootnote } from '@/lib/crm/auto-send/view'
import { REASON_LABELS } from '../RecentSends'
import { RecipientStatusPill } from './ui'

const NO_NAME_TEXT = '（没有名字）'

function NameCell({
  clientId,
  row,
  linkNames,
}: {
  clientId: string
  row: RecipientRow
  linkNames: boolean
}): JSX.Element {
  const name = row.displayName ?? NO_NAME_TEXT
  if (!linkNames) {
    return (
      <span className="text-me-charcoal" title="示例客人，没有资料页">
        {name}
      </span>
    )
  }
  return (
    <a
      href={`/dashboard/clients/${clientId}/crm/all?contact=${encodeURIComponent(row.contactId)}`}
      className="text-me-ochre underline"
    >
      {name}
    </a>
  )
}

function RecipientLine({
  clientId,
  row,
  info,
  linkNames,
}: {
  clientId: string
  row: RecipientRow
  info: OpenInfo
  linkNames: boolean
}): JSX.Element {
  const reason = resolveReasonText(row, REASON_LABELS)
  return (
    <tr className="border-t border-me-charcoal/10 align-top" data-testid={`recipient-${row.contactId}`}>
      <td className="py-2 pr-2">
        <NameCell clientId={clientId} row={row} linkNames={linkNames} />
      </td>
      <td className="py-2 pr-2 text-me-charcoal/70">{formatSeats(row.seats)}</td>
      <td className="py-2 pr-2">
        <RecipientStatusPill status={row.status} />
      </td>
      <td className="py-2 pr-2 text-me-charcoal/70">
        <div>{reason.main}</div>
        {reason.detail && <div className="text-xs text-me-charcoal/45">{reason.detail}</div>}
      </td>
      <td className="py-2 text-right text-me-charcoal/70">{engagementText(info, row)}</td>
    </tr>
  )
}

function RecipientTable({
  clientId,
  recipients,
  info,
  linkNames,
}: {
  clientId: string
  recipients: RecipientRow[]
  info: OpenInfo
  linkNames: boolean
}): JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="text-me-charcoal/55">
            <th className="py-1 pr-2 font-semibold">姓名</th>
            <th className="py-1 pr-2 font-semibold">座位</th>
            <th className="py-1 pr-2 font-semibold">状态</th>
            <th className="py-1 pr-2 font-semibold">原因 / 备注</th>
            <th className="py-1 text-right font-semibold">打开</th>
          </tr>
        </thead>
        <tbody>
          {recipients.map((row) => (
            <RecipientLine key={row.contactId} clientId={clientId} row={row} info={info} linkNames={linkNames} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function RecipientsTab({
  clientId,
  detail,
  linkNames,
}: {
  clientId: string
  detail: LetterDetail
  /** 真实数据才给姓名做链接；示例数据里的客人是编的，没有资料页。 */
  linkNames: boolean
}): JSX.Element {
  const { openInfo, recipients, summary } = detail
  const line = openInfoLine(openInfo)
  return (
    <div className="space-y-3">
      {summary.rehearsalCount > 0 && (
        <p role="note" className="rounded-lg border border-dashed border-me-taupe bg-me-ivory p-3 text-xs text-me-charcoal/70">
          演练：系统彩排了一遍，下面标「演练」的没有真的发出去，不算「已发」。
        </p>
      )}
      {summary.unknownCount > 0 && (
        <p role="note" className="text-xs font-semibold text-me-charcoal">
          下面标「结果不明」的：发出了，但没拿到最终结果，信可能已经送到客人手里，先别重发。
        </p>
      )}
      {line && <p className="text-xs text-me-charcoal/70">{line}</p>}
      {recipients.length === 0 ? (
        <p className="text-xs text-me-charcoal/55">这封信还没有收件人名单。</p>
      ) : (
        <RecipientTable clientId={clientId} recipients={recipients} info={openInfo} linkNames={linkNames} />
      )}
      <p className="text-xs text-me-charcoal/55">{recipientsFootnote(openInfo)}</p>
    </div>
  )
}
