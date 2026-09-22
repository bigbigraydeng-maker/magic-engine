'use client'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

/** Only the evidence fields these charts read — the full shape (see src/lib/meta/ai/analysis.ts
 * loadEvidence) carries more (video_ads, age_gender, fatigue_candidates) that no chart uses yet. */
type MetricComparison = { current: number | null; previous: number | null; percent_change: number | null }
type CampaignRow = { campaign_name?: unknown; spend?: unknown }
type Evidence = { campaigns?: unknown; comparison?: unknown }

const CURRENT_COLOR = '#2563eb'
const PREVIOUS_COLOR = '#94a3b8'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readEvidence(value: unknown): Evidence | null {
  return asRecord(value) as Evidence | null
}

function readCampaigns(evidence: Evidence): { name: string; spend: number }[] {
  if (!Array.isArray(evidence.campaigns)) return []
  return evidence.campaigns
    .map(row => asRecord(row) as CampaignRow | null)
    .filter((row): row is CampaignRow => row !== null && typeof row.spend === 'number')
    .map(row => ({ name: typeof row.campaign_name === 'string' && row.campaign_name ? row.campaign_name : '（未命名广告系列）', spend: row.spend as number }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 6)
}

function readComparison(evidence: Evidence, key: string): MetricComparison | null {
  const comparison = asRecord(evidence.comparison)
  const metric = comparison ? asRecord(comparison[key]) : null
  if (!metric) return null
  const current = typeof metric.current === 'number' ? metric.current : null
  const previous = typeof metric.previous === 'number' ? metric.previous : null
  const percentChange = typeof metric.percent_change === 'number' ? metric.percent_change : null
  return current === null && previous === null ? null : { current, previous, percent_change: percentChange }
}

function truncate(name: string, max = 12) {
  return name.length > max ? `${name.slice(0, max)}…` : name
}

function CampaignSpendChart({ campaigns }: { campaigns: { name: string; spend: number }[] }) {
  const height = Math.max(160, campaigns.length * 40)
  return <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4">
    <h4 className="text-sm font-semibold text-slate-900">广告系列花费排行（所列候选，按花费排序）</h4>
    <div style={{ width: '100%', height }} className="mt-2">
      <ResponsiveContainer>
        <BarChart data={campaigns} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
          <CartesianGrid horizontal={false} stroke="#e2e8f0" />
          <XAxis type="number" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
          <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 12, fill: '#334155' }}
            tickFormatter={value => truncate(String(value))} axisLine={false} tickLine={false} />
          <Tooltip formatter={(value: number) => value.toFixed(2)} labelStyle={{ color: '#0f172a' }} />
          <Bar dataKey="spend" name="花费" fill={CURRENT_COLOR} radius={[0, 4, 4, 0]} barSize={16} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  </div>
}

const COMPARISON_METRICS: { key: string; label: string; format: (value: number) => string }[] = [
  { key: 'spend', label: '花费', format: value => value.toFixed(2) },
  { key: 'clicks', label: '点击', format: value => value.toFixed(0) },
  { key: 'ctr', label: 'CTR', format: value => `${(value * 100).toFixed(2)}%` },
  { key: 'reach', label: '覆盖人数', format: value => value.toFixed(0) },
]

function ComparisonMiniChart({ label, metric, format }: { label: string; metric: MetricComparison; format: (value: number) => string }) {
  const data = [
    { period: '上周', value: metric.previous ?? 0 },
    { period: '本周', value: metric.current ?? 0 },
  ]
  const trend = metric.percent_change
  return <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3">
    <div className="flex items-baseline justify-between">
      <h4 className="text-sm font-semibold text-slate-900">{label}</h4>
      {trend !== null && <span className={`text-xs font-medium ${trend >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
        {trend >= 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}%
      </span>}
    </div>
    <div style={{ width: '100%', height: 96 }} className="mt-1">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
          <XAxis dataKey="period" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
          <Tooltip formatter={(value: number) => format(value)} labelStyle={{ color: '#0f172a' }} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={28}>
            {data.map((entry, index) => <Cell key={entry.period} fill={index === 0 ? PREVIOUS_COLOR : CURRENT_COLOR} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  </div>
}

export default function ReportCharts({ evidence: raw }: { evidence: unknown }) {
  const evidence = readEvidence(raw)
  if (!evidence) return null
  const campaigns = readCampaigns(evidence)
  const comparisons = COMPARISON_METRICS
    .map(metric => ({ ...metric, comparison: readComparison(evidence, metric.key) }))
    .filter((metric): metric is typeof metric & { comparison: MetricComparison } => metric.comparison !== null)
  if (campaigns.length === 0 && comparisons.length === 0) return null
  return <div className="space-y-3" data-testid="report-charts">
    {comparisons.length > 0 && <>
      <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
        {comparisons.map(metric => <ComparisonMiniChart key={metric.key} label={metric.label} metric={metric.comparison} format={metric.format} />)}
      </div>
      <div className="flex items-center justify-center gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: PREVIOUS_COLOR }} />上周</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: CURRENT_COLOR }} />本周</span>
      </div>
    </>}
    {campaigns.length > 0 && <CampaignSpendChart campaigns={campaigns} />}
  </div>
}
