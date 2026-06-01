/**
 * §7 Local Visibility — city-level search ranking summary
 * Reference: ROADMAP.md P8.C.1, P8.8
 */
import type { LocalVisibilityData } from '@/lib/reports/monthly-aggregator'
import { EmptyState } from './Shared'

export function LocalVisibilityPanel({ data }: { data: LocalVisibilityData | null }) {
  if (!data) {
    return (
      <div className="bg-white rounded-xl border border-black/10 p-5">
        <EmptyState message="暂无本地搜索数据 — Local Visibility 模块上线后自动填充" />
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-black/10 p-5 space-y-4">
      <div className="flex items-center gap-6 flex-wrap">
        <div className="text-center">
          <p className="text-2xl font-bold text-me-ochre">{data.total_cities}</p>
          <p className="text-xs text-me-charcoal/55 mt-1">Cities Tracked</p>
        </div>
        {data.top_opportunity_city && (
          <div className="flex items-center gap-2 bg-me-ochre/10 border border-me-ochre/30 rounded-lg px-4 py-2">
            <span className="text-me-ochre text-sm">🎯</span>
            <div>
              <p className="text-xs text-me-ochre font-semibold">Top Opportunity</p>
              <p className="text-sm font-bold text-me-ochre">{data.top_opportunity_city}</p>
            </div>
          </div>
        )}
      </div>

      {data.cities.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-black/[.06]">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-me-ivory border-b border-black/[.06]">
                <th className="text-left px-4 py-2 text-xs font-semibold text-me-charcoal/55">City</th>
                <th className="text-center px-3 py-2 text-xs font-semibold text-me-charcoal/55">Keywords</th>
                <th className="text-center px-3 py-2 text-xs font-semibold text-me-charcoal/55">Avg Rank</th>
                <th className="text-center px-3 py-2 text-xs font-semibold text-me-charcoal/55">Top 3</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[.06]">
              {data.cities.map((city, i) => {
                const isOpportunity = city.city === data.top_opportunity_city
                return (
                  <tr key={i} className={isOpportunity ? 'bg-me-ochre/40' : 'hover:bg-me-ivory/50'}>
                    <td className="px-4 py-2 text-xs font-medium text-me-charcoal/75">
                      {isOpportunity && <span className="mr-1">🎯</span>}
                      {city.city}
                    </td>
                    <td className="px-3 py-2 text-center text-xs text-me-charcoal/60">{city.tracked_keywords}</td>
                    <td className="px-3 py-2 text-center text-xs font-bold text-me-charcoal/90">
                      {city.avg_rank != null ? `#${city.avg_rank}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-center text-xs text-[#5C8A4A] font-semibold">{city.top3_count}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
