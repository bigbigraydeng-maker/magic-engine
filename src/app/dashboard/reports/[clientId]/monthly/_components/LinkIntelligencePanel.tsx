/**
 * §5 Link Intelligence — monthly backlink snapshot
 * Reference: ROADMAP.md P8.C.1, P8.6
 */
import type { LinkIntelligenceData } from '@/lib/reports/monthly-aggregator'
import { KpiCard, EmptyState } from './Shared'

export function LinkIntelligencePanel({ data }: { data: LinkIntelligenceData | null }) {
  if (!data) {
    return (
      <div className="bg-white rounded-xl border border-black/10 p-5">
        <EmptyState message="暂无外链数据 — Link Intelligence 模块上线后自动填充" />
      </div>
    )
  }

  const deltaColor = (n: number | null) => {
    if (n == null) return 'text-me-charcoal/45'
    return n > 0 ? 'text-[#5C8A4A]' : n < 0 ? 'text-[#C2453A]' : 'text-me-charcoal/55'
  }
  const deltaArrow = (n: number | null) => {
    if (n == null) return '—'
    return `${n > 0 ? '↑' : n < 0 ? '↓' : '→'} ${Math.abs(n)} vs last month`
  }

  return (
    <div className="bg-white rounded-xl border border-black/10 p-5 space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Total Backlinks"
          value={data.total_backlinks.toLocaleString()}
          sub={
            <span className={`text-xs font-semibold ${deltaColor(data.total_backlinks_delta)}`}>
              {deltaArrow(data.total_backlinks_delta)}
            </span>
          }
          highlight={(data.total_backlinks_delta ?? 0) > 0}
        />
        <KpiCard
          label="New This Month"
          value={`+${data.new_backlinks.toLocaleString()}`}
          sub={<span className="text-xs text-me-charcoal/45">new links gained</span>}
          highlight={data.new_backlinks > 0}
        />
        <KpiCard
          label="Lost This Month"
          value={data.lost_backlinks.toLocaleString()}
          sub={<span className="text-xs text-me-charcoal/45">links removed</span>}
        />
        <KpiCard
          label="Referring Domains"
          value={data.referring_domains.toLocaleString()}
          sub={
            data.avg_domain_rank != null
              ? <span className="text-xs text-me-charcoal/45">avg DR {data.avg_domain_rank}</span>
              : <span className="text-xs text-me-charcoal/45">—</span>
          }
        />
      </div>
    </div>
  )
}
