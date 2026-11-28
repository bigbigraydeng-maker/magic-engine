/**
 * 跟进进度页的画面：只收数字，不取数。分组规则和文案在 `lib/crm/followup-progress/groups.ts`。
 */

import { WEEK_DAYS, type FollowupProgress } from '@/lib/crm/followup-progress/load'
import { delta, pointDaysAgo, SNAPSHOT_TIME_LABEL, type DayPoint } from '@/lib/crm/followup-progress/history'
import { FOLLOWUP_GROUPS, groupMeta, OUT_OF_SCOPE, OUT_OF_SCOPE_LABEL, type FollowupGroup } from '@/lib/crm/followup-progress/groups'
import { GroupLink } from './GroupLink'

const OWNER_LABEL = { staff: '员工', ai: 'AI（人点了才发）', none: '暂不处理' } as const

function Change({ value }: { value: number | null }): JSX.Element {
  if (value === null) return <span className="text-me-charcoal/60">还没有记录</span>
  if (value === 0) return <span className="text-me-charcoal/60">没变</span>
  return <span className="tabular-nums text-me-charcoal">{value > 0 ? `多了 ${value}` : `少了 ${-value}`}</span>
}

function GroupRow({ clientId, group, progress, day, week }: { clientId: string; group: FollowupGroup; progress: FollowupProgress; day: DayPoint | null; week: DayPoint | null }): JSX.Element {
  const meta = groupMeta()[group]
  return (
    <tr className="border-t border-me-charcoal/10 align-top">
      <td className="max-w-[230px] py-3 pr-4 sm:max-w-none">
        <div className="font-medium text-me-charcoal">{meta.label}</div>
        <div className="mt-0.5 text-[12.5px] leading-snug text-me-charcoal/70">{meta.howTo}</div>
      </td>
      <td className="py-3 pr-4 text-right text-lg font-semibold tabular-nums text-me-charcoal">{progress.counts.groups[group]}</td>
      <td className="py-3 pr-4 text-sm"><Change value={delta(progress.counts, day, group)} /></td>
      <td className="py-3 pr-4 text-sm"><Change value={delta(progress.counts, week, group)} /></td>
      <td className="py-3 pr-4 text-sm text-me-charcoal/80">{OWNER_LABEL[meta.owner]}</td>
      <td className="py-3 text-sm">
        {meta.page ? <GroupLink clientId={clientId} page={meta.page} needsEmailFeature={meta.needsEmailFeature} /> : <span className="text-me-charcoal/60">—</span>}
      </td>
    </tr>
  )
}

function WeekCards({ progress }: { progress: FollowupProgress }): JSX.Element {
  const items: Array<[string, number]> = [
    ['新填表的客人', progress.week.newEnquiries],
    ['员工打过电话或发过信的客人', progress.week.guestsContactedByStaff],
    ['来信或来电的客人', progress.week.guestsWhoReplied],
    ['交给 AI 的客人', progress.week.takenByAi],
    ['变成高意向客人', progress.week.movedToQualified],
    ['新订单', progress.week.newBookings],
  ]
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map(([label, n]) => (
        <div key={label} className="rounded border border-me-charcoal/15 bg-white p-3">
          <dt className="text-[12.5px] text-me-charcoal/70">{label}</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums text-me-charcoal">{n}</dd>
        </div>
      ))}
    </dl>
  )
}

export function ProgressView({ clientId, progress, history, now }: { clientId: string; progress: FollowupProgress; history: readonly DayPoint[]; now: Date }): JSX.Element {
  const day = pointDaysAgo(history, now, 1)
  const week = pointDaysAgo(history, now, 7)
  const outTotal = OUT_OF_SCOPE.reduce((n, k) => n + progress.counts.out[k], 0)
  return (
    <>
      <h1 className="text-lg font-semibold text-me-charcoal">跟进进度</h1>
      <p className="mb-5 mt-1 text-sm text-me-charcoal/70">
        还没成交、可以联系的客人一共 <strong className="tabular-nums">{progress.counts.inScope}</strong> 位，分成下面几组。数字是打开这一页时现算的；「比昨天」「比上周」来自{SNAPSHOT_TIME_LABEL}自动记下的数{history.length === 0 ? '，现在还没有记过（第一次记数之后才有对比；近期没有新咨询的客户不记）' : ''}。
      </p>

      <h2 className="mb-2 text-sm font-semibold text-me-charcoal">最近 {WEEK_DAYS} 天发生了什么</h2>
      <WeekCards progress={progress} />

      <h2 className="mb-1 mt-7 text-sm font-semibold text-me-charcoal">每一组现在多少人</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left">
          <thead>
            <tr className="text-[12.5px] text-me-charcoal/60">
              <th className="py-2 pr-4 font-normal">哪一组、该怎么办</th>
              <th className="py-2 pr-4 text-right font-normal">人数</th>
              <th className="py-2 pr-4 font-normal">比昨天</th>
              <th className="py-2 pr-4 font-normal">比上周</th>
              <th className="py-2 pr-4 font-normal">谁来处理</th>
              <th className="py-2 font-normal">入口</th>
            </tr>
          </thead>
          <tbody>
            {FOLLOWUP_GROUPS.map((g) => <GroupRow key={g} clientId={clientId} group={g} progress={progress} day={day} week={week} />)}
          </tbody>
        </table>
      </div>

      <h2 className="mb-1 mt-7 text-sm font-semibold text-me-charcoal">不在跟进范围里的 {outTotal} 位</h2>
      <ul className="text-sm text-me-charcoal/80">
        {OUT_OF_SCOPE.map((k) => <li key={k} className="flex justify-between border-t border-me-charcoal/10 py-1.5"><span>{OUT_OF_SCOPE_LABEL[k]}</span><span className="tabular-nums">{progress.counts.out[k]}</span></li>)}
      </ul>

      <p className="mt-6 text-[12.5px] leading-relaxed text-me-charcoal/60">
        这一页和「今天先联系」的名单不是一回事：那边排的是今天先打谁，这里看的是全部客人的大盘，所以两边人数不会一样。
        「打过电话或发过信」只认系统里记下的电话、邮件和 WhatsApp，打了没接通的也算打过；员工用自己手机打、没记进系统的看不到。
        Facebook 私信两头都不算：回复分不出是真人还是自动回复，客人发来的私信在系统里是整段对话一条记录，看不出谁最后说话。
        「比昨天」「比上周」比的是那天早上记下的数，不是整整 24 小时前。
      </p>
    </>
  )
}
