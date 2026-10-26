'use client'

import { useEffect, useId, useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type {
  PublishChange,
  PublishErrorCode,
  SellableCheck,
} from '@/lib/tour-catalog/publish-contract'
import { changeLine, groupChangesByTour } from './tour-list-helpers'
import { useChannelsConnected } from './catalog-context'

export const STALE_TEXT = '你查看之后又有人改了内容，已为你刷新，请重新核对'

const ERROR_TEXTS: Record<PublishErrorCode, string> = {
  stale: STALE_TEXT,
  nothing_to_publish: '草稿和对外内容已经一致，没有需要上架的改动',
  high_risk_unacknowledged: '请先勾选确认标红的价格和班期改动',
  after_revert_unacknowledged: '请先勾选确认上一次换回旧版的提醒',
  sellable_count_mismatch: '填写的可售团数不对，请按红框里的数字重新填',
  invalid_request: '提交的内容不完整，请关掉这个窗口重新打开再试',
  version_not_found: '找不到这一版，请刷新页面后再试',
  already_current: '这一版就是客人现在看到的内容，不用换',
  publish_failed: '操作没成功，对外内容没有变化，请稍后再试',
}

/** Same codes while no channel reads the catalog: say "published", not "what customers see". */
const ERROR_TEXTS_UNCONNECTED: Partial<Record<PublishErrorCode, string>> = {
  nothing_to_publish: '草稿和已上架的内容已经一致，没有需要上架的改动',
  already_current: '这一版就是现在已上架的内容，不用换',
  publish_failed: '操作没成功，已上架的内容没有变化，请稍后再试',
}

/** Plain-Chinese sentence for an error code from the publish / revert routes. */
export function publishErrorText(code: string | undefined, channelsConnected: boolean): string {
  const known = code && code in ERROR_TEXTS ? (code as PublishErrorCode) : 'publish_failed'
  if (!channelsConnected) return ERROR_TEXTS_UNCONNECTED[known] ?? ERROR_TEXTS[known]
  return ERROR_TEXTS[known]
}

function DialogHeader(props: {
  title: string
  subtitle?: ReactNode
  titleId: string
  onClose: () => void
}): JSX.Element {
  const { title, subtitle, titleId, onClose } = props
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 id={titleId} className="font-display text-lg font-black text-me-charcoal">
          {title}
        </h2>
        {subtitle ? (
          <div className="mt-1 text-sm font-semibold text-me-charcoal/55">{subtitle}</div>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="shrink-0 whitespace-nowrap rounded-lg border border-black/10 bg-white px-3 py-1 text-sm font-semibold text-me-charcoal hover:bg-me-ivory"
      >
        关闭
      </button>
    </div>
  )
}

export function DialogShell(props: {
  title: string
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
}): JSX.Element {
  const { title, subtitle, onClose, children } = props
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={ref}
        onKeyDown={handleKeyDown}
        className="w-full max-w-3xl rounded-xl bg-white p-5 shadow-xl outline-none"
      >
        <DialogHeader title={title} subtitle={subtitle} titleId={titleId} onClose={onClose} />
        {children}
      </div>
    </div>
  )
}

export function ChangeList(props: { changes: PublishChange[] }): JSX.Element {
  const { changes } = props
  if (changes.length === 0) {
    return <p className="text-sm font-semibold text-me-charcoal/55">没有改动</p>
  }
  const groups = groupChangesByTour(changes)
  return (
    <>
      {groups.map(group => (
        <section key={group.tourId}>
          <h3 className="text-sm font-black text-me-charcoal">{group.tourName}</h3>
          <ul className="mt-1 space-y-1">
            {group.changes.map((change, index) => (
              <li
                key={`${change.kind}-${change.field ?? ''}-${change.departOn ?? ''}-${index}`}
                data-risk={change.risk}
                className={
                  change.risk === 'high'
                    ? 'break-all rounded bg-[#C2453A]/10 px-2 py-1 text-sm font-black text-[#C2453A]'
                    : 'break-all px-2 py-1 text-sm font-semibold text-me-charcoal/70'
                }
              >
                {changeLine(change)}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}

export function AckCheckbox(props: {
  checked: boolean
  onChange: (checked: boolean) => void
  children: ReactNode
}): JSX.Element {
  const { checked, onChange, children } = props
  return (
    <label className="flex items-start gap-2 rounded-lg border border-[#C2453A]/30 bg-[#C2453A]/10 p-3 text-sm font-black text-[#C2453A]">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
      />
      <span>{children}</span>
    </label>
  )
}

/** Explains what the red rows in a change list mean. */
export function RiskLegend(): JSX.Element {
  const connected = useChannelsConnected()
  return (
    <p className="text-xs font-semibold text-me-charcoal/55">
      <span className="font-black text-[#C2453A]">标红</span> ={' '}
      {connected
        ? '价格、班期、是否在售这类客人会直接看到并据此下单的内容'
        : '价格、班期、是否在售这类最要紧、最不能出错的内容'}
    </p>
  )
}

export function SellableCountConfirm(props: {
  sellable: SellableCheck
  value: string
  onChange: (value: string) => void
  /** Nothing is published yet, so there is no "from A" to compare with. */
  firstPublish?: boolean
}): JSX.Element | null {
  const { sellable, value, onChange, firstPublish = false } = props
  const connected = useChannelsConnected()
  if (!sellable.needsCountConfirm) return null
  const outward = connected ? '对外' : ''
  const wrong = value.trim() !== '' && !sellableConfirmed(sellable, value)
  return (
    <div className="rounded-lg border border-[#C2453A]/30 bg-[#C2453A]/10 p-3">
      <p className="text-sm font-black text-[#C2453A]">
        {firstPublish
          ? `这是第一次上架：上架后${outward}可售的团共 ${sellable.after} 个。请输入这个数字确认。`
          : `上架后${outward}可售的团会从 ${sellable.before} 个变成 ${sellable.after} 个`}
      </p>
      <label className="mt-2 block text-sm font-black text-[#C2453A]">
        请在这里输入 {sellable.after} 确认
        <input
          type="text"
          inputMode="numeric"
          aria-label="输入上架后的可售团数"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="mt-1 w-32 rounded-lg border border-black/10 bg-white px-2 py-1 text-sm"
        />
      </label>
      {wrong ? (
        <p role="alert" className="mt-1 text-sm font-black text-[#C2453A]">
          数字不对，应该输入 {sellable.after}
        </p>
      ) : null}
    </div>
  )
}

/** True when the typed text equals the expected count exactly (after trim). */
export function sellableConfirmed(sellable: SellableCheck, value: string): boolean {
  if (!sellable.needsCountConfirm) return true
  return value.trim() === String(sellable.after)
}
