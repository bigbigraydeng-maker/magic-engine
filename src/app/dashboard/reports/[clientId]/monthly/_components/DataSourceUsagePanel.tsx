/**
 * §9 Data Source Usage — rpanel card (ME design system)
 * Reference: ROADMAP.md P8.C.1, P8.11
 *
 * CRITICAL: SERVICE_DISPLAY_MAP must be used to hide real vendor names (CLAUDE.md §三)
 */
import type { DataSourceUsageData } from '@/lib/reports/monthly-aggregator'
import { EmptyState, RBar } from './Shared'
import { MePill } from '@/components/ui/me-primitives'

const SERVICE_DISPLAY_MAP: Record<string, string> = {
  dataforseo:   'Link / SERP / Local Intelligence',
  semrush:      'Keyword Intelligence',
  openai:       'Content Engine',
  anthropic:    'Strategy Engine',
  serpapi:      'Search Intelligence',
  perplexity:   'Discovery Engine',
  google:       'Search AI Engine',
  wavespeed:    'Visual Studio',
  atlas:        'Visual Studio',
  heygen:       'Avatar Studio',
  airtable:     'Content Workspace',
  publer:       'Publishing Hub',
}

function displayName(service: string): string {
  return SERVICE_DISPLAY_MAP[service.toLowerCase()] ?? 'Data Source'
}

export function DataSourceUsagePanel({ data }: { data: DataSourceUsageData | null }) {
  if (!data) {
    return (
      <div className="rounded-[24px] border border-black/10 bg-white p-5 shadow-[0_1px_2px_rgba(26,26,26,.04),0_8px_28px_rgba(26,26,26,.06)]">
        <EmptyState message="暂无数据源使用记录 — 本月数据上线后自动填充" />
      </div>
    )
  }

  const maxCalls = Math.max(...data.services.map(s => s.api_calls), 1)

  return (
    <div className="rounded-[24px] border border-black/10 bg-white p-5 shadow-[0_1px_2px_rgba(26,26,26,.04),0_8px_28px_rgba(26,26,26,.06)]">
      {/* header row */}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-[15px] font-semibold text-[#1A1A1A]">Data source usage</h3>
        <MePill tone="track">Healthy</MePill>
      </div>

      {/* bar rows */}
      {data.services.length > 0 ? (
        <div className="space-y-3">
          {data.services.map((svc, i) => (
            <div key={i} className="flex items-center justify-between gap-3 text-[13px]">
              <span className="min-w-0 flex-1 truncate text-black/60">{displayName(svc.service)}</span>
              <RBar pct={Math.round((svc.api_calls / maxCalls) * 100)} label={`$${svc.cost_usd.toFixed(3)}`} />
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-black/[.06] pt-3 text-[12.5px]">
            <span className="text-black/60">Total API calls</span>
            <span className="font-display font-semibold text-[#1A1A1A]">{data.total_calls.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between text-[12.5px]">
            <span className="text-black/60">Total cost (USD)</span>
            <span className="font-display font-semibold text-[#1A1A1A]">${data.total_cost_usd.toFixed(4)}</span>
          </div>
        </div>
      ) : (
        <EmptyState message="No data sources used this month." />
      )}
    </div>
  )
}
