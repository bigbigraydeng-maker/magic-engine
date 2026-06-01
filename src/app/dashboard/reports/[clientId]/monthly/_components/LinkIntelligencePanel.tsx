/**
 * §5 Link Intelligence — rpanel card (ME design system)
 * Reference: ROADMAP.md P8.C.1, P8.6
 */
import type { LinkIntelligenceData } from '@/lib/reports/monthly-aggregator'
import { EmptyState, RRow } from './Shared'
import { MeTrend } from '@/components/ui/me-primitives'

export function LinkIntelligencePanel({ data }: { data: LinkIntelligenceData | null }) {
  if (!data) {
    return (
      <div className="rounded-[24px] border border-black/10 bg-white p-5 shadow-[0_1px_2px_rgba(26,26,26,.04),0_8px_28px_rgba(26,26,26,.06)]">
        <EmptyState message="暂无外链数据 — Link Intelligence 模块上线后自动填充" />
      </div>
    )
  }

  const newLinks  = data.new_backlinks ?? 0
  const trendDir  = newLinks > 0 ? 'up' : newLinks < 0 ? 'down' : 'flat'

  return (
    <div className="rounded-[24px] border border-black/10 bg-white p-5 shadow-[0_1px_2px_rgba(26,26,26,.04),0_8px_28px_rgba(26,26,26,.06)]">
      {/* header row */}
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-display text-[15px] font-semibold text-[#1A1A1A]">Link intelligence</h3>
        <MeTrend dir={trendDir}>{newLinks > 0 ? `+${newLinks}` : newLinks}</MeTrend>
      </div>

      {/* big number */}
      <div className="font-display text-[28px] font-bold leading-none text-[#1A1A1A]">
        {data.referring_domains.toLocaleString()}
      </div>
      <p className="mt-1 text-[12.5px] text-black/60">referring domains</p>

      {/* rrows */}
      <div className="mt-3">
        <RRow label="Total backlinks" value={data.total_backlinks.toLocaleString()} />
        <RRow label="New this month" value={`+${data.new_backlinks.toLocaleString()}`} />
        <RRow label="Lost this month" value={data.lost_backlinks.toLocaleString()} />
        {data.avg_domain_rank != null && (
          <RRow label="Authority score" value={data.avg_domain_rank} />
        )}
      </div>
    </div>
  )
}
