/**
 * §6 Search Visibility — SERP keyword ranking summary
 * Reference: ROADMAP.md P8.C.1, P8.7
 */
import type { SearchVisibilityData } from '@/lib/reports/monthly-aggregator'
import { KpiCard, EmptyState } from './Shared'

export function SearchVisibilityPanel({ data }: { data: SearchVisibilityData | null }) {
  if (!data) {
    return (
      <div className="bg-white rounded-xl border border-black/10 p-5">
        <EmptyState message="暂无搜索排名数据 — SERP Intelligence 模块上线后自动填充" />
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-black/10 p-5 space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Tracked Keywords"
          value={data.tracked_keywords.toString()}
          sub={<span className="text-xs text-me-charcoal/45">monitored this month</span>}
        />
        <KpiCard
          label="Avg. Rank"
          value={data.avg_rank != null ? `#${data.avg_rank}` : '—'}
          sub={<span className="text-xs text-me-charcoal/45">across all keywords</span>}
        />
        <KpiCard
          label="Top 10 Keywords"
          value={data.top10_count.toString()}
          sub={
            <span className="text-xs text-me-charcoal/45">
              incl. {data.top3_count} in Top 3
            </span>
          }
          highlight={data.top10_count > 0}
        />
        <KpiCard
          label="Improved This Month"
          value={data.improved_count.toString()}
          sub={<span className="text-xs text-me-charcoal/45">keywords ranked higher</span>}
          highlight={data.improved_count > 0}
        />
      </div>

      {data.top_movers.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-me-charcoal/55 mb-2">Top Movers</p>
          <div className="overflow-x-auto rounded-lg border border-black/[.06]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-me-ivory border-b border-black/[.06]">
                  <th className="text-left px-4 py-2 text-xs font-semibold text-me-charcoal/55">Keyword</th>
                  <th className="text-center px-3 py-2 text-xs font-semibold text-me-charcoal/55">Previous</th>
                  <th className="text-center px-3 py-2 text-xs font-semibold text-me-charcoal/55">Current</th>
                  <th className="text-center px-3 py-2 text-xs font-semibold text-me-charcoal/55">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[.06]">
                {data.top_movers.map((m, i) => (
                  <tr key={i} className="hover:bg-me-ivory/50">
                    <td className="px-4 py-2 text-xs text-me-charcoal/75 font-mono truncate max-w-xs">{m.keyword}</td>
                    <td className="px-3 py-2 text-center text-xs text-me-charcoal/55">
                      {m.previous_rank != null ? `#${m.previous_rank}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-center text-xs font-bold text-me-charcoal/90">
                      {m.current_rank != null ? `#${m.current_rank}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-center text-xs font-semibold text-[#5C8A4A]">
                      {m.delta != null && m.delta > 0 ? `↑ ${m.delta}` : m.delta != null && m.delta < 0 ? `↓ ${Math.abs(m.delta)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
