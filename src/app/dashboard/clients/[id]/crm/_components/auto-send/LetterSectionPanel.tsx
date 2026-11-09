'use client'

/**
 * 「自动发信」列表里的一个面板（一类信）：桌面是一行一封信的表，手机是一封信一张卡片。
 * 点一封信（整行 / 整张卡片）打开右边的抽屉；这里不做任何别的动作。
 * 面板标题、说明、脚注都来自数据（LetterSection），页面代码里不写死任何一类信的名字。
 */

import { formatCount } from '@/lib/crm/auto-send/format'
import type { LetterSection, LetterSummary } from '@/lib/crm/auto-send/types'
import { LetterStatusPill, Panel, RehearsalPill, SmallButton, letterWhenText as whenText } from './ui'

const NO_TITLE_TEXT = '（还没写）'
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-me-charcoal/40'

function letterLabel(letter: LetterSummary): string {
  return letter.title ?? `${NO_TITLE_TEXT}${letter.audienceLabel}`
}

function StatusCell({ letter }: { letter: LetterSummary }): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <LetterStatusPill status={letter.status} />
      {letter.rehearsalCount > 0 && <RehearsalPill count={letter.rehearsalCount} />}
    </div>
  )
}

/** 「被拦」一格：被拦人数；有出错的另起一行用红字写出来。 */
function BlockedCell({ letter }: { letter: LetterSummary }): JSX.Element {
  const failed = letter.failedCount ?? 0
  return (
    <>
      <div>{formatCount(letter.blockedCount)}</div>
      {failed > 0 && <div className="text-[10px] text-status-rej">出错 {failed}</div>}
    </>
  )
}

function LetterRow({ letter, onOpen }: { letter: LetterSummary; onOpen: (id: string) => void }): JSX.Element {
  const open = () => onOpen(letter.letterId)
  return (
    <tr
      onClick={open}
      data-testid={`letter-row-${letter.letterId}`}
      className="cursor-pointer border-t border-me-charcoal/10 hover:bg-me-ivory"
    >
      <td className="py-2.5 pr-3 font-bold text-me-charcoal">{whenText(letter)}</td>
      <td className="py-2.5 pr-3 text-me-charcoal/70">{letter.audienceLabel}</td>
      <td className="py-2.5 pr-3 font-medium text-me-charcoal">
        <button
          type="button"
          aria-label={`看这封信：${letterLabel(letter)}`}
          onClick={(event) => {
            event.stopPropagation()
            open()
          }}
          className={`rounded text-left ${FOCUS}`}
        >
          {letter.title ?? NO_TITLE_TEXT}
        </button>
      </td>
      <td className="py-2.5 pr-3">
        <StatusCell letter={letter} />
      </td>
      <td className="py-2.5 pr-3 text-right font-bold text-me-charcoal">{letter.recipientCount}</td>
      <td className="py-2.5 pr-3 text-right text-me-charcoal/70">{formatCount(letter.sentCount)}</td>
      <td className="py-2.5 pr-3 text-right text-me-charcoal/70">
        <BlockedCell letter={letter} />
      </td>
      <td aria-hidden className="py-2.5 text-center text-base text-me-charcoal/45">
        ›
      </td>
    </tr>
  )
}

function LetterTable({ letters, onOpen }: { letters: LetterSummary[]; onOpen: (id: string) => void }): JSX.Element {
  return (
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full table-fixed text-left text-xs">
        <colgroup>
          <col className="w-28" />
          <col className="w-[150px]" />
          <col />
          <col className="w-32" />
          <col className="w-[72px]" />
          <col className="w-14" />
          <col className="w-14" />
          <col className="w-6" />
        </colgroup>
        <thead>
          <tr className="text-me-charcoal/55">
            <th className="py-1 pr-3 font-semibold">发信日</th>
            <th className="py-1 pr-3 font-semibold">对象</th>
            <th className="py-1 pr-3 font-semibold">标题</th>
            <th className="py-1 pr-3 font-semibold">状态</th>
            <th className="py-1 pr-3 text-right font-semibold">收件人</th>
            <th className="py-1 pr-3 text-right font-semibold">已发</th>
            <th className="py-1 pr-3 text-right font-semibold">被拦</th>
            <th className="py-1">
              <span className="sr-only">查看这封信</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {letters.map((letter) => (
            <LetterRow key={letter.letterId} letter={letter} onOpen={onOpen} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 手机版：一封信一张卡片（Figma 06）。 */
function LetterCards({ letters, onOpen }: { letters: LetterSummary[]; onOpen: (id: string) => void }): JSX.Element {
  return (
    <ul className="space-y-2 md:hidden">
      {letters.map((letter) => (
        <li key={letter.letterId}>
          <button
            type="button"
            data-testid={`letter-card-${letter.letterId}`}
            aria-label={`看这封信：${letterLabel(letter)}`}
            onClick={() => onOpen(letter.letterId)}
            className={`w-full rounded-xl border border-me-charcoal/10 bg-white p-3 text-left ${FOCUS}`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-bold text-me-charcoal">{whenText(letter)}</span>
              <StatusCell letter={letter} />
            </div>
            <p className="mt-1 text-xs text-me-charcoal/55">{letter.audienceLabel}</p>
            <p className="mt-1 text-sm font-medium text-me-charcoal">{letter.title ?? NO_TITLE_TEXT}</p>
            <p className="mt-1 text-xs text-me-charcoal/70">
              收件人 {letter.recipientCount} · 已发 {formatCount(letter.sentCount)} · 被拦{' '}
              {formatCount(letter.blockedCount)}
              {(letter.failedCount ?? 0) > 0 && <span className="text-status-rej"> · 出错 {letter.failedCount}</span>}
            </p>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function LetterSectionPanel({
  section,
  onOpen,
  onRefresh,
  refreshing,
}: {
  section: LetterSection
  onOpen: (letterId: string) => void
  /** 只有放「刷新」按钮的那个面板才传。 */
  onRefresh?: () => void
  refreshing?: boolean
}): JSX.Element {
  const title = section.note ? `${section.title}（${section.note}）` : section.title
  return (
    <Panel
      title={title}
      testId={`section-${section.key}`}
      right={
        onRefresh ? (
          <SmallButton onClick={onRefresh} disabled={refreshing === true}>
            刷新
          </SmallButton>
        ) : undefined
      }
    >
      <LetterTable letters={section.letters} onOpen={onOpen} />
      <LetterCards letters={section.letters} onOpen={onOpen} />
      {section.footnote && <p className="mt-2 text-[11px] text-me-charcoal/55">{section.footnote}</p>}
    </Panel>
  )
}
