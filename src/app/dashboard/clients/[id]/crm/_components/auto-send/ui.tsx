'use client'

/**
 * 「自动发信」页面里的几个小零件：面板外框、小按钮、状态标签。
 * 样子照「最近发送」（RecentSends）来，这样跟 CRM 里相邻的页面长得一样。
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { MePill } from '@/components/ui/me-primitives'
import { formatSendDate } from '@/lib/crm/auto-send/format'
import { LETTER_STATUS_META, RECIPIENT_STATUS_META } from '@/lib/crm/auto-send/status'
import type { LetterStatus, LetterSummary, RecipientStatus } from '@/lib/crm/auto-send/types'

/** 「发信日」那一格的话：有日期显示日期（12月2日（周三）），没有固定发信日显示数据给的话。 */
export function letterWhenText(letter: LetterSummary): string {
  if (letter.sendDate !== null) return formatSendDate(letter.sendDate)
  return letter.whenLabel ?? '—'
}

const BUTTON_VARIANT = {
  outline: 'border border-me-stone bg-white text-me-charcoal',
  dark: 'border border-me-charcoal bg-me-charcoal text-me-ivory',
  danger: 'border border-status-rej bg-white text-status-rej',
} as const

export type SmallButtonVariant = keyof typeof BUTTON_VARIANT

/** 小按钮（刷新 / 看这批 / 重试）。大小和颜色取自「最近发送」。 */
export function SmallButton({
  variant = 'outline',
  className = '',
  ...rest
}: { variant?: SmallButtonVariant } & ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return (
    <button
      type="button"
      {...rest}
      className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-me-charcoal/40 disabled:opacity-40 ${BUTTON_VARIANT[variant]} ${className}`}
    />
  )
}

/** 面板外框：圆角、淡边、象牙白底，标题 13px 粗体。 */
export function Panel({
  title,
  right,
  children,
  testId,
}: {
  title: ReactNode
  right?: ReactNode
  children: ReactNode
  testId?: string
}): JSX.Element {
  return (
    <section className="mb-4 rounded-xl border border-me-charcoal/10 bg-me-ivory/40 p-3" data-testid={testId}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-black text-me-charcoal/70">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

/** 虚线描边：「演练」标签用它，一眼和真发出去的实心标签分开。 */
export const DASHED_PILL = 'border border-dashed border-me-taupe'

const REHEARSAL_HINT = '演练：系统彩排了一遍，没有真的发出去，不算「已发」。'

export function LetterStatusPill({ status }: { status: LetterStatus }): JSX.Element {
  const meta = LETTER_STATUS_META[status]
  return <MePill tone={meta.tone}>{meta.label}</MePill>
}

export function RecipientStatusPill({ status }: { status: RecipientStatus }): JSX.Element {
  const meta = RECIPIENT_STATUS_META[status]
  if (status === 'rehearsal') return <RehearsalPill />
  return <MePill tone={meta.tone}>{meta.label}</MePill>
}

/** 「演练」标签；可以带上条数（列表里显示「演练 5」）。 */
export function RehearsalPill({ count }: { count?: number }): JSX.Element {
  return (
    <span title={REHEARSAL_HINT}>
      <MePill tone="attn" className={DASHED_PILL}>
        演练{count === undefined ? '' : ` ${count}`}
      </MePill>
    </span>
  )
}
