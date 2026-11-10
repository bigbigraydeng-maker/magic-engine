'use client'

/**
 * 「按团看」：每个团（团 × 出发日）一行——收件人数、已发几封、往后几封、最近一封的结果、下一封哪天发。
 * 点一个团展开它的各封信，再点一封信打开右边的抽屉。只读，没有任何发送的动作。
 * 桌面是一张表，手机是一团一张卡片。团名、说明、脚注里不写死任何一类信的名字（团和信都来自数据）。
 */

import { Fragment, useState } from 'react'
import { formatSendDate, formatShortDate } from '@/lib/crm/auto-send/format'
import type { LetterSummary, TourGroupSummary } from '@/lib/crm/auto-send/types'
import { OPENED_NOTE, lastSentLine, letterResultLine } from '@/lib/crm/auto-send/view'
import { LetterStatusPill, Panel, letterWhenText } from './ui'

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-me-charcoal/40'
const NEVER_SENT_TEXT = '还没发过'
const NO_NEXT_TEXT = '没有了'

const GROUPS_FOOTNOTE =
  '「往后」按现在的订单和节奏算；前面错过的批次不补发，所以不算在里面。「过期没发」是发信日已经过了、系统里有记录却没发出去的信。'

interface GroupProps {
  groups: TourGroupSummary[]
  /** 页面上所有信（按 letterId），展开一个团时用。 */
  letters: ReadonlyMap<string, LetterSummary>
  openGroupId: string | null
  onToggle: (groupId: string) => void
  onOpen: (letterId: string) => void
}

function Overdue({ group }: { group: TourGroupSummary }): JSX.Element | null {
  if (group.lettersOverdue === 0) return null
  return <div className="text-xs text-status-rej">过期没发 {group.lettersOverdue} 封</div>
}

function NextCell({ next }: { next: TourGroupSummary['next'] }): JSX.Element {
  if (next === null) return <span className="text-me-charcoal/55">{NO_NEXT_TEXT}</span>
  return (
    <div className="space-y-1">
      <div>{formatSendDate(next.sendDate)}</div>
      <LetterStatusPill status={next.status} />
    </div>
  )
}

function lastSentText(group: TourGroupSummary): string {
  return group.lastSent === null ? NEVER_SENT_TEXT : lastSentLine(group.lastSent)
}

/** 展开一个团：它的各封信（按发信日从早到晚），点一封打开抽屉。 */
function GroupLetters({
  group,
  letters,
  onOpen,
}: {
  group: TourGroupSummary
  letters: ReadonlyMap<string, LetterSummary>
  onOpen: (letterId: string) => void
}): JSX.Element {
  const rows = group.letterIds.flatMap((id) => {
    const letter = letters.get(id)
    return letter === undefined ? [] : [letter]
  })
  if (rows.length === 0) {
    return <p className="text-xs text-me-charcoal/55">这个团现在没有可看的信（往后的批次到时间再出现）。</p>
  }
  return (
    <ul
      data-testid={`group-letters-${group.groupId}`}
      className="mt-1 divide-y divide-me-charcoal/10"
    >
      {rows.map((letter) => (
        <li key={letter.letterId}>
          <button
            type="button"
            aria-label={`看这封信：${letter.title ?? letter.audienceLabel}`}
            onClick={() => onOpen(letter.letterId)}
            className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-1 py-2 text-left text-xs ${FOCUS}`}
          >
            <span className="font-bold text-me-charcoal">{letterWhenText(letter)}</span>
            <span className="text-me-charcoal/70">{letter.audienceLabel}</span>
            <LetterStatusPill status={letter.status} />
            <span className="text-me-charcoal/70">{letterResultLine(letter)}</span>
            <span aria-hidden className="ml-auto text-base text-me-charcoal/45">
              ›
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function GroupRow({ group, letters, openGroupId, onToggle, onOpen }: GroupProps & { group: TourGroupSummary }): JSX.Element {
  const open = openGroupId === group.groupId
  const toggle = () => onToggle(group.groupId)
  return (
    <Fragment>
      <tr
        onClick={toggle}
        data-testid={`group-row-${group.groupId}`}
        className="cursor-pointer border-t border-me-charcoal/10 align-top hover:bg-me-ivory"
      >
        <td className="py-2.5 pr-3">
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? '收起' : '展开'}这个团的信：${group.tourName}`}
            onClick={(event) => {
              event.stopPropagation()
              toggle()
            }}
            className={`rounded text-left font-bold text-me-charcoal ${FOCUS}`}
          >
            {group.tourName}
          </button>
          <div className="text-[11px] text-me-charcoal/55">{formatShortDate(group.departOn)}出发</div>
        </td>
        <td className="py-2.5 pr-3 text-right font-bold text-me-charcoal">{group.recipientCount}</td>
        <td className="py-2.5 pr-3 text-right text-me-charcoal/70">
          <div>{group.lettersSent} 封</div>
          <Overdue group={group} />
        </td>
        <td className="py-2.5 pr-3 text-right text-me-charcoal/70">{group.lettersAhead} 封</td>
        <td className="py-2.5 pr-3 text-me-charcoal/70">{lastSentText(group)}</td>
        <td className="py-2.5 pr-3 text-me-charcoal/70">
          <NextCell next={group.next} />
        </td>
        <td aria-hidden className="py-2.5 text-center text-base text-me-charcoal/45">
          {open ? '⌄' : '›'}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="pb-3">
            <GroupLetters group={group} letters={letters} onOpen={onOpen} />
          </td>
        </tr>
      )}
    </Fragment>
  )
}

function GroupTable(props: GroupProps): JSX.Element {
  return (
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full table-fixed text-left text-xs">
        <colgroup>
          <col className="w-[190px]" />
          <col className="w-[64px]" />
          <col className="w-[88px]" />
          <col className="w-[64px]" />
          <col />
          <col className="w-[150px]" />
          <col className="w-6" />
        </colgroup>
        <thead>
          <tr className="text-me-charcoal/55">
            <th className="py-1 pr-3 font-semibold">团</th>
            <th className="py-1 pr-3 text-right font-semibold">收件人</th>
            <th className="py-1 pr-3 text-right font-semibold">已发</th>
            <th className="py-1 pr-3 text-right font-semibold">往后</th>
            <th className="py-1 pr-3 font-semibold">最近一封（打开仅供参考）</th>
            <th className="py-1 pr-3 font-semibold">下一封</th>
            <th className="py-1">
              <span className="sr-only">展开这个团的信</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {props.groups.map((group) => (
            <GroupRow key={group.groupId} group={group} {...props} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 手机版：一个团一张卡片，点开才是它的各封信。 */
function GroupCards({ groups, letters, openGroupId, onToggle, onOpen }: GroupProps): JSX.Element {
  return (
    <ul className="space-y-2 md:hidden">
      {groups.map((group) => {
        const open = openGroupId === group.groupId
        return (
          <li key={group.groupId} className="rounded-xl border border-me-charcoal/10 bg-white p-3">
            <button
              type="button"
              data-testid={`group-card-${group.groupId}`}
              aria-expanded={open}
              aria-label={`${open ? '收起' : '展开'}这个团的信：${group.tourName}`}
              onClick={() => onToggle(group.groupId)}
              className={`w-full rounded text-left ${FOCUS}`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-bold text-me-charcoal">{group.tourName}</span>
                <span className="shrink-0 text-xs text-me-charcoal/55">{formatShortDate(group.departOn)}出发</span>
              </div>
              <p className="mt-1 text-xs text-me-charcoal/70">
                收件人 {group.recipientCount} · 已发 {group.lettersSent} 封 · 往后 {group.lettersAhead} 封
              </p>
              {group.lettersOverdue > 0 && <p className="text-xs text-status-rej">过期没发 {group.lettersOverdue} 封</p>}
              <p className="mt-1 text-xs text-me-charcoal/70">最近一封：{lastSentText(group)}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-me-charcoal/70">
                <span>下一封：{group.next === null ? NO_NEXT_TEXT : formatSendDate(group.next.sendDate)}</span>
                {group.next !== null && <LetterStatusPill status={group.next.status} />}
              </div>
            </button>
            {open && (
              <div className="mt-2">
                <GroupLetters group={group} letters={letters} onOpen={onOpen} />
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function TourGroupPanel({
  groups,
  letters,
  onOpen,
}: {
  groups: TourGroupSummary[]
  letters: ReadonlyMap<string, LetterSummary>
  onOpen: (letterId: string) => void
}): JSX.Element {
  const [openGroupId, setOpenGroupId] = useState<string | null>(null)
  const props: GroupProps = {
    groups,
    letters,
    openGroupId,
    onToggle: (groupId) => setOpenGroupId((current) => (current === groupId ? null : groupId)),
    onOpen,
  }
  return (
    <Panel title="按团看（每个团一行）" testId="section-groups">
      <GroupTable {...props} />
      <GroupCards {...props} />
      <p className="mt-2 text-xs text-me-charcoal/55">{GROUPS_FOOTNOTE}</p>
      <p className="mt-1 text-xs text-me-charcoal/55">{OPENED_NOTE}</p>
    </Panel>
  )
}
