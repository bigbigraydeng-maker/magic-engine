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
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <EmptyState message="暂无数据源使用记录 — 本月数据上线后自动填充" />
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <div className="flex items-center gap-8 flex-wrap">
        <div>
          <p className="text-xs text-gray-500">Total Cost This Month</p>
          <p className="text-2xl font-bold text-gray-900">${data.total_cost_usd.toFixed(4)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Total API Calls</p>
          <p className="text-2xl font-bold text-gray-900">{data.total_calls.toLocaleString()}</p>
        </div>
      </div>

      {data.services.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Module</th>
                <th className="text-center px-3 py-2 text-xs font-semibold text-gray-500">API Calls</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">Cost (USD)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {data.services.map((svc, i) => (
                <tr key={i} className="hover:bg-gray-50/50">
                  <td className="px-4 py-2 text-xs text-gray-800">{displayName(svc.service)}</td>
                  <td className="px-3 py-2 text-center text-xs text-gray-600">{svc.api_calls.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right text-xs font-mono text-gray-900">${svc.cost_usd.toFixed(4)}</td>
                </tr>
              ))}
              <tr className="bg-gray-50 font-semibold">
                <td className="px-4 py-2 text-xs text-gray-700">Total</td>
                <td className="px-3 py-2 text-center text-xs text-gray-700">{data.total_calls.toLocaleString()}</td>
                <td className="px-4 py-2 text-right text-xs font-mono text-gray-900">${data.total_cost_usd.toFixed(4)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
