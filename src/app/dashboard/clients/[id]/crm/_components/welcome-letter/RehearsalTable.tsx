'use client'

/**
 * 彩排对照：最近每一天，ME「本该发」和旧群发「实际发」逐人比的结果。
 * 「对不上」的客人点进去看是谁（链接到 CRM 里那位客人）。
 */
import Link from 'next/link'
import { rehearsalHeadline, type RehearsalEvidenceView } from './welcome-letter-text'

export function RehearsalTable({ clientId, evidence }: { clientId: string; evidence: RehearsalEvidenceView }): JSX.Element {
  const enough = evidence.consecutiveDays >= evidence.requiredDays
  return (
    <div data-testid="rehearsal">
      <p className={`mb-2 text-sm font-semibold ${enough ? 'text-[#3F6B33]' : 'text-me-charcoal/80'}`}>{rehearsalHeadline(evidence)}</p>
      {evidence.days.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-xs">
            <thead className="text-me-charcoal/60">
              <tr>
                <th className="py-1 pr-3 font-semibold">线索日期</th>
                <th className="py-1 pr-3 font-semibold">新客人</th>
                <th className="py-1 pr-3 font-semibold">一致</th>
                <th className="py-1 pr-3 font-semibold">有原因的不同</th>
                <th className="py-1 pr-3 font-semibold">对不上</th>
                <th className="py-1 pr-3 font-semibold">没法比</th>
              </tr>
            </thead>
            <tbody>
              {evidence.days.map((d) => (
                <tr key={d.leadLocalDay} className="border-t border-me-charcoal/10">
                  <td className="py-1 pr-3 tabular-nums">{d.leadLocalDay}</td>
                  <td className="py-1 pr-3 tabular-nums">{d.total}</td>
                  <td className="py-1 pr-3 tabular-nums">{d.agree}</td>
                  <td className="py-1 pr-3 tabular-nums">{d.explained}</td>
                  <td className={`py-1 pr-3 tabular-nums ${d.unexplained > 0 ? 'font-bold text-[#C2453A]' : ''}`}>
                    {d.unexplained}
                    {d.unexplainedContactIds.slice(0, 5).map((id, i) => (
                      <Link
                        key={id}
                        href={`/dashboard/clients/${clientId}/crm/all?view=all&contact=${encodeURIComponent(id)}`}
                        className="ml-2 underline underline-offset-2"
                      >
                        看第 {i + 1} 位
                      </Link>
                    ))}
                  </td>
                  <td className="py-1 pr-3 tabular-nums">{d.unavailable}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-me-charcoal/60">「有原因的不同」= 旧群发发了、ME 不发，但原因说得通（销售已经亲自写过信、客人退订了、带了跳过标签、要求别再联系）。</p>
    </div>
  )
}
