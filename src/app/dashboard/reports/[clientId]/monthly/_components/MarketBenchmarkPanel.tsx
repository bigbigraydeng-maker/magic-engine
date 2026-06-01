/**
 * §8 Market Benchmark — rpanel card (ME design system)
 * Reference: ROADMAP.md P8.C.1, P8.9
 */
import type { MarketBenchmarkData } from '@/lib/reports/monthly-aggregator'
import { EmptyState, RRow } from './Shared'
import { MeChip } from '@/components/ui/me-primitives'
import { GOLD_GRADIENT } from '@/components/ui/me-theme'

export function MarketBenchmarkPanel({ data }: { data: MarketBenchmarkData | null }) {
  if (!data) {
    return (
      <div className="rounded-[24px] border border-black/10 bg-white p-5 shadow-[0_1px_2px_rgba(26,26,26,.04),0_8px_28px_rgba(26,26,26,.06)]">
        <EmptyState message="暂无市场基准数据 — Market Benchmark 模块上线后自动填充" />
      </div>
    )
  }

  return (
    <div className="rounded-[24px] border border-black/10 bg-white p-5 shadow-[0_1px_2px_rgba(26,26,26,.04),0_8px_28px_rgba(26,26,26,.06)]">
      {/* header row */}
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-display text-[15px] font-semibold text-[#1A1A1A]">Market benchmark</h3>
        <MeChip gold>vs {data.top_opportunities.length} competitors</MeChip>
      </div>

      {/* rrows */}
      <div className="mt-3">
        <RRow label="Visibility rank" value="— / —" />
        <RRow label="Keywords compared" value={data.total_keywords_compared} />
        <RRow
          label="Avg. gap"
          value={data.avg_gap != null ? `${data.avg_gap > 0 ? '+' : ''}${data.avg_gap}` : '—'}
        />
        <RRow label="Competitor wins" value={data.keywords_competitor_wins} />
      </div>

      {data.top_opportunities.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-[14px] border border-black/[.06]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-black/[.06] bg-[#FBF8F3]">
                <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-[.10em] text-black/40">Keyword</th>
                <th className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-[.10em] text-black/40">You</th>
                <th className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-[.10em] text-black/40">Competitor</th>
                <th className="px-4 py-2 text-right text-[11px] font-semibold uppercase tracking-[.10em] text-black/40">Score</th>
              </tr>
            </thead>
            <tbody>
              {data.top_opportunities.map((opp, i) => (
                <tr key={i} className="border-b border-black/[.04] last:border-0 transition-colors hover:bg-[#FBF8F3]">
                  <td className="max-w-[160px] truncate px-4 py-[11px] text-xs text-[#1A1A1A]">{opp.keyword}</td>
                  <td className="px-3 py-[11px] text-center text-xs text-black/40">
                    {opp.client_rank != null ? `#${opp.client_rank}` : '—'}
                  </td>
                  <td className="px-3 py-[11px] text-center text-xs font-bold text-[#5C8A4A]">
                    {opp.competitor_rank != null ? `#${opp.competitor_rank}` : '—'}
                  </td>
                  <td className="px-4 py-[11px] text-right">
                    <div className="inline-flex items-center gap-2">
                      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-[#EAE6DF]">
                        <span
                          className="block h-full rounded-full"
                          style={{ width: `${Math.min(opp.opportunity_score, 100)}%`, background: GOLD_GRADIENT }}
                        />
                      </span>
                      <span className="min-w-[24px] text-right text-xs font-bold text-[#C4912E]">
                        {opp.opportunity_score}
                      </span>
                    </div>
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
