/**
 * §6 Search Visibility — rpanel card (ME design system)
 * Reference: ROADMAP.md P8.C.1, P8.7
 */
import type { SearchVisibilityData } from '@/lib/reports/monthly-aggregator'
import { EmptyState, RRow } from './Shared'
import { MeTrend } from '@/components/ui/me-primitives'
import { GOLD_GRADIENT } from '@/components/ui/me-theme'

export function SearchVisibilityPanel({ data }: { data: SearchVisibilityData | null }) {
  if (!data) {
    return (
      <div className="rounded-[24px] border border-black/10 bg-white p-5 shadow-[0_1px_2px_rgba(26,26,26,.04),0_8px_28px_rgba(26,26,26,.06)]">
        <EmptyState message="暂无搜索排名数据 — SERP Intelligence 模块上线后自动填充" />
      </div>
    )
  }

  const reachDir = data.improved_count > 0 ? 'up' : data.improved_count < 0 ? 'down' : 'flat'

  return (
    <div className="rounded-[24px] border border-black/10 bg-white p-5 shadow-[0_1px_2px_rgba(26,26,26,.04),0_8px_28px_rgba(26,26,26,.06)]">
      {/* header row */}
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-display text-[15px] font-semibold text-[#1A1A1A]">Search visibility</h3>
        <MeTrend dir={reachDir}>{data.improved_count > 0 ? `+${data.improved_count}` : data.improved_count}</MeTrend>
      </div>

      {/* big number */}
      <div className="font-display text-[28px] font-bold leading-none text-[#1A1A1A]">
        {data.top10_count.toString()}
      </div>
      <p className="mt-1 text-[12.5px] text-black/60">top-10 keywords this month</p>

      {/* sparkline placeholder */}
      <svg className="mt-3 block h-[42px] w-full" viewBox="0 0 300 42" preserveAspectRatio="none">
        <defs>
          <linearGradient id="sparkGradSearch" x1="0" y1="0" x2="300" y2="0" gradientUnits="userSpaceOnUse">
            <stop stopColor="#EBCB8B" /><stop offset="1" stopColor="#C4912E" />
          </linearGradient>
        </defs>
        <polyline
          fill="none"
          stroke="url(#sparkGradSearch)"
          strokeWidth="2.5"
          points="0,34 50,30 100,32 150,24 200,20 250,14 300,8"
        />
      </svg>

      {/* rrows */}
      <div className="mt-3">
        <RRow label="Tracked keywords" value={data.tracked_keywords} />
        <RRow label="Avg. rank" value={data.avg_rank != null ? `#${data.avg_rank}` : '—'} />
        <RRow label="Top 3" value={data.top3_count} />
      </div>

      {data.top_movers.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-[14px] border border-black/[.06]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/[.06] bg-[#FBF8F3]">
                <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-[.10em] text-black/40">Keyword</th>
                <th className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-[.10em] text-black/40">Prev</th>
                <th className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-[.10em] text-black/40">Now</th>
                <th className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-[.10em] text-black/40">Δ</th>
              </tr>
            </thead>
            <tbody>
              {data.top_movers.map((m, i) => (
                <tr key={i} className="border-b border-black/[.04] last:border-0 transition-colors hover:bg-[#FBF8F3]">
                  <td className="max-w-[160px] truncate px-4 py-[11px] text-xs text-[#1A1A1A]">{m.keyword}</td>
                  <td className="px-3 py-[11px] text-center text-xs text-black/40">
                    {m.previous_rank != null ? `#${m.previous_rank}` : '—'}
                  </td>
                  <td className="px-3 py-[11px] text-center text-xs font-bold text-[#1A1A1A]">
                    {m.current_rank != null ? `#${m.current_rank}` : '—'}
                  </td>
                  <td className="px-3 py-[11px] text-center text-xs font-semibold" style={{
                    color: m.delta != null && m.delta > 0 ? '#5C8A4A' : m.delta != null && m.delta < 0 ? '#C2453A' : '#C4912E'
                  }}>
                    {m.delta != null && m.delta > 0 ? `↑ ${m.delta}` : m.delta != null && m.delta < 0 ? `↓ ${Math.abs(m.delta)}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
