'use client'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend,
  Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

type MetricComparison = { current: number | null; previous: number | null; percent_change: number | null }
type Evidence = {
  campaigns?: unknown; comparison?: unknown
  daily_campaigns?: unknown; placements?: unknown
  age_gender?: unknown; devices?: unknown; regions?: unknown
}

const CURRENT_COLOR = '#2563eb'
const PREVIOUS_COLOR = '#94a3b8'
const CHART_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#059669', '#d97706', '#dc2626', '#6366f1', '#ec4899']

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readEvidence(value: unknown): Evidence | null {
  return asRecord(value) as Evidence | null
}

function num(v: unknown): number { return typeof v === 'number' ? v : 0 }
function str(v: unknown, fallback = ''): string { return typeof v === 'string' && v ? v : fallback }

function readCampaigns(evidence: Evidence): { name: string; spend: number }[] {
  if (!Array.isArray(evidence.campaigns)) return []
  return evidence.campaigns
    .map(row => asRecord(row))
    .filter((row): row is Record<string, unknown> => row !== null && typeof row.spend === 'number')
    .map(row => ({ name: str(row.campaign_name, '（未命名广告系列）'), spend: num(row.spend) }))
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

function ChartCard({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return <div className={`min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
    <h4 className="mb-3 text-sm font-semibold text-slate-900">{title}</h4>
    {children}
  </div>
}

function CampaignSpendChart({ campaigns }: { campaigns: { name: string; spend: number }[] }) {
  const height = Math.max(160, campaigns.length * 40)
  return <ChartCard title="广告系列花费排行（所列候选，按花费排序）">
    <div style={{ width: '100%', height }}>
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
  </ChartCard>
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
  return <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
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

// ─── New chart: Daily trend (spend + CTR per day, aggregated across campaigns) ───

type DailyRow = { date_start: string; spend: number; ctr: number; impressions: number; clicks: number }

function readDailyCampaigns(evidence: Evidence): DailyRow[] {
  if (!Array.isArray(evidence.daily_campaigns)) return []
  const byDate = new Map<string, { spend: number; impressions: number; clicks: number }>()
  for (const raw of evidence.daily_campaigns) {
    const row = asRecord(raw)
    if (!row) continue
    const date = str(row.date_start)
    if (!date) continue
    const existing = byDate.get(date) ?? { spend: 0, impressions: 0, clicks: 0 }
    existing.spend += num(row.spend)
    existing.impressions += num(row.impressions)
    existing.clicks += num(row.clicks)
    byDate.set(date, existing)
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { spend, impressions, clicks }]) => ({
      date_start: date.slice(5),
      spend: Math.round(spend * 100) / 100,
      ctr: impressions > 0 ? Math.round(clicks / impressions * 10000) / 100 : 0,
      impressions, clicks,
    }))
}

function DailyTrendChart({ data }: { data: DailyRow[] }) {
  return <ChartCard title="每日花费与点击率趋势">
    <div style={{ width: '100%', height: 240 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ left: 0, right: 16, top: 8, bottom: 4 }}>
          <defs>
            <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CURRENT_COLOR} stopOpacity={0.3} />
              <stop offset="100%" stopColor={CURRENT_COLOR} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="date_start" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
          <YAxis yAxisId="spend" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
            formatter={(value: number, name: string) => [name === '花费' ? value.toFixed(2) : `${value.toFixed(2)}%`, name]}
          />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          <Area yAxisId="spend" type="monotone" dataKey="spend" name="花费" stroke={CURRENT_COLOR}
            fill="url(#spendGradient)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          <Line yAxisId="spend" type="monotone" dataKey="ctr" name="CTR %" stroke="#d97706"
            strokeWidth={2} dot={{ r: 3, fill: '#d97706' }} activeDot={{ r: 5 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  </ChartCard>
}

// ─── New chart: Placement distribution (horizontal bar) ───

type PlacementRow = { name: string; spend: number; ctr: number }

function readPlacements(evidence: Evidence): PlacementRow[] {
  if (!Array.isArray(evidence.placements)) return []
  return evidence.placements
    .map(raw => asRecord(raw))
    .filter((row): row is Record<string, unknown> => row !== null && num(row.spend) > 0)
    .map(row => ({
      name: `${str(row.publisher_platform, '?')} · ${str(row.platform_position, '?')}`,
      spend: num(row.spend),
      ctr: num(row.impressions) > 0 ? Math.round(num(row.clicks) / num(row.impressions) * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 8)
}

function PlacementChart({ data }: { data: PlacementRow[] }) {
  const height = Math.max(160, data.length * 36)
  return <ChartCard title="版位花费分布">
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
          <CartesianGrid horizontal={false} stroke="#e2e8f0" />
          <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
          <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11, fill: '#334155' }}
            tickFormatter={value => truncate(String(value), 18)} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
            formatter={(value: number, name: string) => [name === 'CTR' ? `${value.toFixed(2)}%` : value.toFixed(2), name]}
          />
          <Bar dataKey="spend" name="花费" fill="#7c3aed" radius={[0, 4, 4, 0]} barSize={14} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  </ChartCard>
}

// ─── New chart: Age × Gender (grouped bar) ───

type AgeGenderRow = { age: string; male: number; female: number; unknown: number }

function readAgeGender(evidence: Evidence): AgeGenderRow[] {
  if (!Array.isArray(evidence.age_gender)) return []
  const byAge = new Map<string, { male: number; female: number; unknown: number }>()
  for (const raw of evidence.age_gender) {
    const row = asRecord(raw)
    if (!row) continue
    const age = str(row.age, '?')
    const gender = str(row.gender).toLowerCase()
    const spend = num(row.spend)
    const existing = byAge.get(age) ?? { male: 0, female: 0, unknown: 0 }
    if (gender === 'male') existing.male += spend
    else if (gender === 'female') existing.female += spend
    else existing.unknown += spend
    byAge.set(age, existing)
  }
  return [...byAge.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([age, values]) => ({ age, ...values }))
}

function AgeGenderChart({ data }: { data: AgeGenderRow[] }) {
  return <ChartCard title="受众画像 · 年龄 × 性别花费">
    <div style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: 0, right: 16, top: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="age" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
            formatter={(value: number) => value.toFixed(2)}
          />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="male" name="男" fill="#2563eb" radius={[4, 4, 0, 0]} barSize={16} />
          <Bar dataKey="female" name="女" fill="#ec4899" radius={[4, 4, 0, 0]} barSize={16} />
          {data.some(row => row.unknown > 0) &&
            <Bar dataKey="unknown" name="未知" fill="#94a3b8" radius={[4, 4, 0, 0]} barSize={16} />}
        </BarChart>
      </ResponsiveContainer>
    </div>
  </ChartCard>
}

// ─── New chart: Device distribution (donut) ───

type DeviceRow = { name: string; spend: number }

function readDevices(evidence: Evidence): DeviceRow[] {
  if (!Array.isArray(evidence.devices)) return []
  return evidence.devices
    .map(raw => asRecord(raw))
    .filter((row): row is Record<string, unknown> => row !== null && num(row.spend) > 0)
    .map(row => ({ name: str(row.device_platform, '其他'), spend: Math.round(num(row.spend) * 100) / 100 }))
    .sort((a, b) => b.spend - a.spend)
}

function DeviceChart({ data }: { data: DeviceRow[] }) {
  const total = data.reduce((sum, row) => sum + row.spend, 0)
  return <ChartCard title="设备分布">
    <div style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="spend" nameKey="name" cx="50%" cy="50%"
            innerRadius={50} outerRadius={80} paddingAngle={3} strokeWidth={2} stroke="#fff">
            {data.map((_, index) => <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
          </Pie>
          <Tooltip
            contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
            formatter={(value: number, name: string) => [`${value.toFixed(2)} (${total > 0 ? (value / total * 100).toFixed(1) : 0}%)`, name]}
          />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  </ChartCard>
}

// ─── New chart: Region distribution (horizontal bar) ───

type RegionRow = { name: string; spend: number }

function readRegions(evidence: Evidence): RegionRow[] {
  if (!Array.isArray(evidence.regions)) return []
  return evidence.regions
    .map(raw => asRecord(raw))
    .filter((row): row is Record<string, unknown> => row !== null && num(row.spend) > 0)
    .map(row => ({ name: str(row.country, '其他'), spend: Math.round(num(row.spend) * 100) / 100 }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 10)
}

function RegionChart({ data }: { data: RegionRow[] }) {
  const height = Math.max(120, data.length * 36)
  return <ChartCard title="地区花费分布">
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
          <CartesianGrid horizontal={false} stroke="#e2e8f0" />
          <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
          <YAxis type="category" dataKey="name" width={60} tick={{ fontSize: 11, fill: '#334155' }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
            formatter={(value: number) => value.toFixed(2)}
          />
          <Bar dataKey="spend" name="花费" fill="#0891b2" radius={[0, 4, 4, 0]} barSize={14}>
            {data.map((_, index) => <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  </ChartCard>
}

// ─── Main export ───

export default function ReportCharts({ evidence: raw }: { evidence: unknown }) {
  const evidence = readEvidence(raw)
  if (!evidence) return null

  const campaigns = readCampaigns(evidence)
  const comparisons = COMPARISON_METRICS
    .map(metric => ({ ...metric, comparison: readComparison(evidence, metric.key) }))
    .filter((metric): metric is typeof metric & { comparison: MetricComparison } => metric.comparison !== null)
  const daily = readDailyCampaigns(evidence)
  const placements = readPlacements(evidence)
  const ageGender = readAgeGender(evidence)
  const devices = readDevices(evidence)
  const regions = readRegions(evidence)

  const hasCharts = campaigns.length > 0 || comparisons.length > 0 || daily.length > 0
    || placements.length > 0 || ageGender.length > 0 || devices.length > 0 || regions.length > 0
  if (!hasCharts) return null

  return <div className="space-y-4" data-testid="report-charts">
    {comparisons.length > 0 && <>
      <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
        {comparisons.map(metric => <ComparisonMiniChart key={metric.key} label={metric.label} metric={metric.comparison} format={metric.format} />)}
      </div>
      <div className="flex items-center justify-center gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: PREVIOUS_COLOR }} />上周</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: CURRENT_COLOR }} />本周</span>
      </div>
    </>}

    {daily.length > 1 && <DailyTrendChart data={daily} />}

    {campaigns.length > 0 && <CampaignSpendChart campaigns={campaigns} />}

    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
      {placements.length > 0 && <PlacementChart data={placements} />}
      {ageGender.length > 0 && <AgeGenderChart data={ageGender} />}
      {devices.length > 0 && <DeviceChart data={devices} />}
      {regions.length > 0 && <RegionChart data={regions} />}
    </div>
  </div>
}
