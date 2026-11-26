'use client'

/**
 * 彩排对照：最近 14 个日历日（到昨天），每天 ME「本该发」和旧群发「实际发」逐人比的结果；没比对、按别的规则比、
 * 中途换了提案的日子都写出来（这些日子会让「连续几天」断开）。下面是旧群发每一批的实发人数和 ME 对上的人数。
 * 「对不上」的客人点进去看是谁（链接到 CRM 里那位客人）。
 */
import Link from 'next/link'
import { DAY_KIND_TEXT, nzTime, rehearsalHeadline, type RehearsalEvidenceView } from './welcome-letter-text'

const GOOD = 'text-[#3F6B33]'
const BAD = 'font-bold text-[#C2453A]'

function DayRow({ clientId, day }: { clientId: string; day: RehearsalEvidenceView['calendar'][number] }): JSX.Element {
  const s = day.stats
  const kindClass = day.kind === 'consistent' || day.kind === 'no_leads' ? GOOD : day.kind === 'not_yet' ? 'text-me-charcoal/70' : BAD
  return (
    <tr className="border-t border-me-charcoal/10">
      <td className="py-1 pr-3 tabular-nums">{day.day}</td>
      <td className={`py-1 pr-3 ${kindClass}`}>{DAY_KIND_TEXT[day.kind]}</td>
      <td className="py-1 pr-3 tabular-nums">{s?.total ?? ''}</td>
      <td className="py-1 pr-3 tabular-nums">{s?.agree ?? ''}</td>
      <td className="py-1 pr-3 tabular-nums">{s?.explained ?? ''}</td>
      <td className={`py-1 pr-3 tabular-nums ${s !== null && s.unexplained > 0 ? BAD : ''}`}>
        {s?.unexplained ?? ''}
        {(s?.unexplainedContactIds ?? []).slice(0, 5).map((id, i) => (
          <Link key={id} href={`/dashboard/clients/${clientId}/crm/all?view=all&contact=${encodeURIComponent(id)}`} className="ml-2 underline underline-offset-2">
            看第 {i + 1} 位
          </Link>
        ))}
      </td>
      <td className="py-1 pr-3 tabular-nums">{s?.unavailable ?? ''}</td>
    </tr>
  )
}

function Batches({ evidence }: { evidence: RehearsalEvidenceView }): JSX.Element | null {
  if (evidence.batches.length === 0) {
    // Days were compared but no batch was read: say so, never let "nothing read" look like "no gap".
    const compared = evidence.calendar.some((d) => d.kind === 'consistent' || d.kind === 'inconsistent' || d.kind === 'partial')
    return compared ? <p className="mt-3 text-xs font-semibold text-[#C2453A]" data-testid="batches-missing">没有读到旧群发的批次记录，批次对账这次做不了。</p> : null
  }
  return (
    <div className="mt-3 overflow-x-auto" data-testid="batches">
      <p className="mb-1 text-xs font-semibold text-me-charcoal/70">旧群发每一批：实发人数和 ME 对上的人数（差几位 = 旧群发发了、ME 没看到的人）</p>
      <table className="w-full min-w-[520px] text-left text-xs">
        <thead className="text-me-charcoal/60">
          <tr>
            <th className="py-1 pr-3 font-semibold">批次</th>
            <th className="py-1 pr-3 font-semibold">发出时间</th>
            <th className="py-1 pr-3 font-semibold">实发</th>
            <th className="py-1 pr-3 font-semibold">ME 对上</th>
            <th className="py-1 pr-3 font-semibold">差几位</th>
          </tr>
        </thead>
        <tbody>
          {evidence.batches.map((b) => (
            <tr key={b.campaignId} className="border-t border-me-charcoal/10">
              <td className="py-1 pr-3">
                {b.title}
                {b.partialDay === true && <span className="ml-1 text-me-charcoal/60">（这批客人进来那天中途换了提案，差额里有一部分是换提案造成的）</span>}
              </td>
              <td className="py-1 pr-3">{nzTime(b.sentAt)}</td>
              <td className="py-1 pr-3 tabular-nums">{b.emailsSent}</td>
              <td className="py-1 pr-3 tabular-nums">{b.matchedContacts}</td>
              <td className={`py-1 pr-3 tabular-nums ${b.gap > 0 ? BAD : ''}`}>{b.gap}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function RehearsalTable({ clientId, evidence }: { clientId: string; evidence: RehearsalEvidenceView }): JSX.Element {
  const enough = evidence.consecutiveDays >= evidence.requiredDays && evidence.undatedRows === 0
  return (
    <div data-testid="rehearsal">
      <p className={`mb-2 text-sm font-semibold ${enough ? GOOD : 'text-me-charcoal/80'}`}>{rehearsalHeadline(evidence)}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-left text-xs">
          <thead className="text-me-charcoal/60">
            <tr>
              <th className="py-1 pr-3 font-semibold">线索日期</th>
              <th className="py-1 pr-3 font-semibold">这天怎么样</th>
              <th className="py-1 pr-3 font-semibold">新客人</th>
              <th className="py-1 pr-3 font-semibold">一致</th>
              <th className="py-1 pr-3 font-semibold">有原因的不同</th>
              <th className="py-1 pr-3 font-semibold">对不上</th>
              <th className="py-1 pr-3 font-semibold">没法比</th>
            </tr>
          </thead>
          <tbody>
            {[...evidence.calendar].reverse().map((day) => <DayRow key={day.day} clientId={clientId} day={day} />)}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-me-charcoal/60">「有原因的不同」= 旧群发发了、ME 不发，但原因说得通（销售已经亲自写过信、客人退订了、带了跳过标签、要求别再联系）。</p>
      <Batches evidence={evidence} />
    </div>
  )
}
