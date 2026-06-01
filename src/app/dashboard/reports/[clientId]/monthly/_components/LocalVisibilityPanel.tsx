/**
 * §7 Local Visibility — rpanel card (ME design system)
 * Reference: ROADMAP.md P8.C.1, P8.8
 */
import type { LocalVisibilityData } from '@/lib/reports/monthly-aggregator'
import { EmptyState, RRow } from './Shared'
import { MeTrend } from '@/components/ui/me-primitives'

export function LocalVisibilityPanel({ data }: { data: LocalVisibilityData | null }) {
  if (!data) {
    return (
      <div className="rounded-[24px] border border-black/10 bg-white p-5 shadow-[0_1px_2px_rgba(26,26,26,.04),0_8px_28px_rgba(26,26,26,.06)]">
        <EmptyState message="暂无本地搜索数据 — Local Visibility 模块上线后自动填充" />
      </div>
    )
  }

  const top = data.cities[0]

  return (
    <div className="rounded-[24px] border border-black/10 bg-white p-5 shadow-[0_1px_2px_rgba(26,26,26,.04),0_8px_28px_rgba(26,26,26,.06)]">
      {/* header row */}
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-display text-[15px] font-semibold text-[#1A1A1A]">Local visibility</h3>
        <MeTrend dir="up">{data.total_cities}</MeTrend>
      </div>

      {/* big number — best city avg rank */}
      <div className="font-display text-[28px] font-bold leading-none text-[#1A1A1A]">
        {top?.avg_rank != null ? `#${top.avg_rank}` : data.total_cities}
      </div>
      <p className="mt-1 text-[12.5px] text-black/60">
        {top ? `"${top.city}" avg rank` : 'cities tracked'}
      </p>

      {/* rrows */}
      <div className="mt-3">
        {data.top_opportunity_city && (
          <RRow label="Top opportunity" value={data.top_opportunity_city} />
        )}
        {data.cities.slice(0, 3).map((city, i) => (
          <RRow
            key={i}
            label={`"${city.city}"`}
            value={city.avg_rank != null ? `#${city.avg_rank}` : '—'}
          />
        ))}
      </div>
    </div>
  )
}
