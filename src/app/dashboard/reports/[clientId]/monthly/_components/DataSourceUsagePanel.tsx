/**
 * §9 Data Source Usage — monthly API cost by service
 * Reference: ROADMAP.md P8.C.1, P8.11
 *
 * CRITICAL: SERVICE_DISPLAY_MAP must be used to hide real vendor names (CLAUDE.md §三)
 */
import type { DataSourceUsageData } from '@/lib/reports/monthly-aggregator'
import { EmptyState } from './Shared'

/** Maps internal service keys → client-facing display names (CLAUDE.md §三) */
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
      <div className="bg-white rounded-xl border border-black/10 p-5">
        <EmptyState message="暂无数据源使用记录 — 本月数据上线后自动填充" />
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-black/10 p-5 space-y-4">
      <div className="flex items-center gap-8 flex-wrap">
        <div>
          <p className="text-xs text-me-charcoal/55">Total Cost This Month</p>
          <p className="text-2xl font-bold text-me-charcoal/90">${data.total_cost_usd.toFixed(4)}</p>
        </div>
        <div>
          <p className="text-xs text-me-charcoal/55">Total API Calls</p>
          <p className="text-2xl font-bold text-me-charcoal/90">{data.total_calls.toLocaleString()}</p>
        </div>
      </div>

      {data.services.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-black/[.06]">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-me-ivory border-b border-black/[.06]">
                <th className="text-left px-4 py-2 text-xs font-semibold text-me-charcoal/55">Module</th>
                <th className="text-center px-3 py-2 text-xs font-semibold text-me-charcoal/55">API Calls</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-me-charcoal/55">Cost (USD)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[.06]">
              {data.services.map((svc, i) => (
                <tr key={i} className="hover:bg-me-ivory/50">
                  <td className="px-4 py-2 text-xs text-me-charcoal/75">{displayName(svc.service)}</td>
                  <td className="px-3 py-2 text-center text-xs text-me-charcoal/60">{svc.api_calls.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right text-xs font-mono text-me-charcoal/90">${svc.cost_usd.toFixed(4)}</td>
                </tr>
              ))}
              <tr className="bg-me-ivory font-semibold">
                <td className="px-4 py-2 text-xs text-me-charcoal/75">Total</td>
                <td className="px-3 py-2 text-center text-xs text-me-charcoal/75">{data.total_calls.toLocaleString()}</td>
                <td className="px-4 py-2 text-right text-xs font-mono text-me-charcoal/90">${data.total_cost_usd.toFixed(4)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
