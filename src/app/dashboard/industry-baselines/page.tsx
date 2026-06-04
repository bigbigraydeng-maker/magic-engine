'use client'

import { useState, useEffect, useCallback } from 'react'
import { AiVisibilityPanel } from './_components/AiVisibilityPanel'
import { GoogleSerpPanel } from './_components/GoogleSerpPanel'

interface BaselineDomain {
  id: string
  industry: string
  sub_industry: string
  domain: string
  keywords: string[]
  seo_score: number | null
  last_collected_at: string | null
  is_client: boolean
  notes: string | null
  city: string | null
  geo_scope: 'city' | 'state' | 'national' | null
}

// Group domains by sub_industry
function groupBySubIndustry(domains: BaselineDomain[]) {
  const map = new Map<string, BaselineDomain[]>()
  for (const d of domains) {
    if (!map.has(d.sub_industry)) map.set(d.sub_industry, [])
    map.get(d.sub_industry)!.push(d)
  }
  return map
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo))
}

function computeStats(domains: BaselineDomain[]) {
  const scores = domains
    .filter(d => d.seo_score !== null)
    .map(d => d.seo_score as number)
    .sort((a, b) => a - b)
  if (scores.length === 0) return null
  return {
    p50: percentile(scores, 50),
    p75: percentile(scores, 75),
    p90: percentile(scores, 90),
    n: scores.length,
  }
}

function isStale(lastCollectedAt: string | null): boolean {
  if (!lastCollectedAt) return true
  const days = (Date.now() - new Date(lastCollectedAt).getTime()) / 86_400_000
  return days > 30
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}

function labelSubIndustry(key: string): string {
  const labels: Record<string, string> = {
    inbound_tour_operator:    'Inbound Tour Operator — NZ (National)',
    outbound_tour_operator:   'Outbound Tour Operator — NZ → Overseas (National)',
    real_estate_auckland:     'Real Estate — Auckland (City)',
    flooring_tiles_brisbane:  'Flooring & Tiles — Brisbane (City)',
    logistics_3pl_nz:         '3PL Logistics — New Zealand (National)',
  }
  return labels[key] ?? key
}

// ─── Add Domain Modal ─────────────────────────────────────────────────────────

function AddDomainModal({
  subIndustry,
  industry,
  existingKeywords,
  onClose,
  onAdded,
}: {
  subIndustry: string
  industry: string
  existingKeywords: string[]
  onClose: () => void
  onAdded: () => void
}) {
  const [domain, setDomain] = useState('')
  const [notes, setNotes] = useState('')
  const [isClient, setIsClient] = useState(false)
  const [useSharedKw, setUseSharedKw] = useState(true)
  const [customKw, setCustomKw] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    if (!domain.trim()) return

    const keywords = useSharedKw
      ? existingKeywords
      : customKw.split('\n').map(k => k.trim()).filter(Boolean)

    setSaving(true)
    try {
      const res = await fetch('/api/baselines/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ industry, sub_industry: subIndustry, domain: domain.trim(), keywords, is_client: isClient, notes: notes.trim() || null }),
      })
      if (!res.ok) {
        const j = await res.json()
        setErr(j.error ?? 'Failed to add domain')
        return
      }
      onAdded()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <form
        className="w-full max-w-lg space-y-4 rounded-xl border border-black/10 bg-white p-6 shadow-card"
        onClick={e => e.stopPropagation()}
        onSubmit={submit}
      >
        <h3 className="font-display text-base font-bold text-me-charcoal">Add Competitor Domain</h3>
        <p className="text-xs font-semibold text-me-charcoal/55">{labelSubIndustry(subIndustry)}</p>

        <div className="space-y-1">
          <label className="text-xs font-black uppercase tracking-wide text-me-charcoal/55">Domain</label>
          <input
            className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal placeholder:text-me-taupe focus:border-me-ochre focus:outline-none"
            placeholder="e.g. competitorname.co.nz"
            value={domain}
            onChange={e => setDomain(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-black uppercase tracking-wide text-me-charcoal/55">Keywords</label>
          <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-me-charcoal/80">
            <input type="radio" checked={useSharedKw} onChange={() => setUseSharedKw(true)} />
            Use shared keywords for this sub-industry ({existingKeywords.length} keywords)
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-me-charcoal/80">
            <input type="radio" checked={!useSharedKw} onChange={() => setUseSharedKw(false)} />
            Custom keywords (one per line)
          </label>
          {!useSharedKw && (
            <textarea
              className="h-24 w-full resize-none rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal placeholder:text-me-taupe focus:border-me-ochre focus:outline-none"
              placeholder={'china tour nz\nchina travel packages nz'}
              value={customKw}
              onChange={e => setCustomKw(e.target.value)}
            />
          )}
        </div>

        <div className="space-y-1">
          <label className="text-xs font-black uppercase tracking-wide text-me-charcoal/55">Notes (optional)</label>
          <input
            className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal placeholder:text-me-taupe focus:border-me-ochre focus:outline-none"
            placeholder="e.g. Direct competitor, China-focused"
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-me-charcoal/80">
          <input type="checkbox" checked={isClient} onChange={e => setIsClient(e.target.checked)} />
          This is a Magic Engine client domain
        </label>

        {err && <p className="text-xs font-semibold text-status-rej">{err}</p>}

        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 rounded-lg bg-me-ochre px-4 py-2 text-sm font-black text-white transition-colors hover:bg-me-ochre/90 disabled:opacity-50"
          >
            {saving ? 'Adding…' : 'Add Domain'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-black text-me-charcoal/55 transition-colors hover:text-me-charcoal"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── Domain Row ───────────────────────────────────────────────────────────────

function DomainRow({
  domain,
  onCollect,
  onDelete,
}: {
  domain: BaselineDomain
  onCollect: (id: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [collecting, setCollecting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const stale = isStale(domain.last_collected_at)

  async function handleCollect() {
    setCollecting(true)
    try { await onCollect(domain.id) } finally { setCollecting(false) }
  }

  async function handleDelete() {
    if (!confirm(`Remove ${domain.domain} from this group?`)) return
    setDeleting(true)
    try { await onDelete(domain.id) } finally { setDeleting(false) }
  }

  return (
    <tr className="border-t border-black/5 transition-colors hover:bg-me-ivory">
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold text-me-charcoal">{domain.domain}</span>
          {domain.is_client && (
            <span className="rounded-full bg-me-ochre/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-me-ochre">CLIENT</span>
          )}
          {domain.notes && (
            <span className="max-w-[180px] truncate text-xs font-semibold text-me-charcoal/45" title={domain.notes}>{domain.notes}</span>
          )}
        </div>
      </td>
      <td className="px-4 py-2.5 text-center">
        {domain.seo_score !== null ? (
          <span className="text-sm font-black text-me-charcoal">{domain.seo_score}</span>
        ) : (
          <span className="text-xs font-semibold text-me-charcoal/45">—</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-center">
        <span className={`text-xs font-semibold ${stale ? 'text-status-exec' : 'text-me-charcoal/55'}`}>
          {stale && domain.last_collected_at ? '⚠ ' : ''}
          {formatDate(domain.last_collected_at)}
        </span>
      </td>
      <td className="px-4 py-2.5 text-center text-xs font-semibold text-me-charcoal/45">
        {domain.keywords.length}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={handleCollect}
            disabled={collecting}
            className="rounded-md border border-black/10 bg-white px-3 py-1 text-xs font-black text-me-charcoal/75 transition-colors hover:border-black/15 hover:text-me-charcoal disabled:opacity-40"
          >
            {collecting ? 'Running…' : 'Refresh'}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="rounded-md px-3 py-1 text-xs font-black text-status-rej transition-colors hover:bg-status-rej/10 disabled:opacity-40"
          >
            Remove
          </button>
        </div>
      </td>
    </tr>
  )
}

// ─── Sub-Industry Panel ───────────────────────────────────────────────────────

function SubIndustryPanel({
  subIndustry,
  domains,
  onRefresh,
}: {
  subIndustry: string
  domains: BaselineDomain[]
  onRefresh: () => void
}) {
  const [showAdd, setShowAdd] = useState(false)
  const stats = computeStats(domains)
  const sharedKeywords = domains[0]?.keywords ?? []

  async function handleCollect(id: string) {
    const res = await fetch(`/api/baselines/domains/${id}/collect`, { method: 'POST' })
    if (!res.ok) {
      const j = await res.json()
      alert(`Refresh failed: ${j.error}`)
      return
    }
    onRefresh()
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/baselines/domains/${id}`, { method: 'DELETE' })
    if (!res.ok) { alert('Delete failed'); return }
    onRefresh()
  }

  return (
    <div className="overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-black/10 px-4 py-3">
        <div>
          <h3 className="font-display text-sm font-bold text-me-charcoal">{labelSubIndustry(subIndustry)}</h3>
          <p className="mt-0.5 text-xs font-semibold text-me-charcoal/45">{domains.length} domains</p>
        </div>

        {/* Percentile badges + trend */}
        {stats ? (
          <div className="flex items-center gap-4">
            <TrendSparkline subIndustry={subIndustry} />
            <div className="text-center">
              <div className="text-[10px] font-black uppercase tracking-wide text-me-charcoal/45">P50</div>
              <div className="text-base font-bold text-me-charcoal">{stats.p50}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] font-black uppercase tracking-wide text-me-charcoal/45">P75</div>
              <div className="text-base font-bold text-status-track">{stats.p75}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] font-black uppercase tracking-wide text-me-charcoal/45">P90</div>
              <div className="text-base font-bold text-me-ochre">{stats.p90}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] font-black uppercase tracking-wide text-me-charcoal/45">n</div>
              <div className="text-base font-bold text-me-charcoal/55">{stats.n}</div>
            </div>
          </div>
        ) : (
          <span className="text-xs font-semibold text-me-charcoal/45">No scores yet</span>
        )}
      </div>

      {/* Domain table */}
      <table className="w-full">
        <thead>
          <tr className="text-[10px] font-black uppercase tracking-wide text-me-charcoal/45">
            <th className="px-4 py-2 text-left">Domain</th>
            <th className="px-4 py-2 text-center">SEO Score</th>
            <th className="px-4 py-2 text-center">Last Collected</th>
            <th className="px-4 py-2 text-center">Keywords</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {domains.map(d => (
            <DomainRow key={d.id} domain={d} onCollect={handleCollect} onDelete={handleDelete} />
          ))}
        </tbody>
      </table>

      {/* Add domain */}
      <div className="border-t border-black/5 px-4 py-3">
        <button
          onClick={() => setShowAdd(true)}
          className="text-xs font-black text-me-ochre transition-colors hover:text-me-charcoal"
        >
          + Add competitor domain
        </button>
      </div>

      {showAdd && (
        <AddDomainModal
          subIndustry={subIndustry}
          industry={domains[0]?.industry ?? 'tourism_operator'}
          existingKeywords={sharedKeywords}
          onClose={() => setShowAdd(false)}
          onAdded={onRefresh}
        />
      )}
    </div>
  )
}

// ─── Trend Sparkline (P30 S5.1) ───────────────────────────────────────────────
// Reads /api/baselines/score-history and draws an inline SVG showing P50 over time.

interface TrendPoint { week: string; p50: number; n: number }

function TrendSparkline({ subIndustry }: { subIndustry: string }) {
  const [data, setData] = useState<TrendPoint[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/baselines/score-history?sub_industry=${encodeURIComponent(subIndustry)}&weeks=12`)
      .then(r => r.ok ? r.json() : { weeks: [] })
      .then(j => setData(j.weeks ?? []))
      .catch(() => setData([]))
      .finally(() => setLoading(false))
  }, [subIndustry])

  if (loading) return <div className="h-8 w-32 animate-pulse rounded bg-me-ivory" />
  if (!data || data.length < 2) {
    return <span className="text-[10px] font-semibold italic text-me-charcoal/45">需 2 周后查看趋势</span>
  }

  const W = 120, H = 32
  const values = data.map(d => d.p50)
  const min = Math.min(...values), max = Math.max(...values)
  const range = Math.max(1, max - min)
  const x = (i: number) => (i / (data.length - 1)) * W
  const y = (v: number) => H - ((v - min) / range) * (H - 4) - 2
  const path = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(d.p50)}`).join(' ')
  const last = data[data.length - 1].p50
  const first = data[0].p50
  const delta = last - first
  const deltaColor = delta > 0 ? 'text-status-track' : delta < 0 ? 'text-status-rej' : 'text-me-charcoal/55'
  const deltaIcon = delta > 0 ? '↑' : delta < 0 ? '↓' : '→'

  return (
    <div className="flex items-center gap-2" title={`${data.length} weeks · P50 ${first} → ${last}`}>
      <svg width={W} height={H} className="overflow-visible">
        <path d={path} fill="none" stroke="#C4912E" strokeWidth="1.5" />
        {data.map((d, i) => (
          <circle key={i} cx={x(i)} cy={y(d.p50)} r="1.5" fill="#C4912E" />
        ))}
      </svg>
      <span className={`text-[10px] font-bold tabular-nums ${deltaColor}`}>
        {deltaIcon} {Math.abs(delta)}
      </span>
    </div>
  )
}

// ─── Cron Runs Panel (P30 S5.3) ───────────────────────────────────────────────

interface CronRun {
  id: string
  started_at: string
  completed_at: string | null
  status: 'running' | 'completed' | 'partial' | 'failed'
  domains_attempted: number
  domains_succeeded: number
  domains_failed: number
  benchmarks_written: number
  duration_seconds: number | null
  error_message: string | null
  triggered_by: 'cron' | 'admin_manual'
}

function CronRunsPanel({ refreshKey }: { refreshKey: number }) {
  const [runs, setRuns] = useState<CronRun[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch('/api/baselines/cron-runs?limit=20')
      .then(r => r.ok ? r.json() : { runs: [] })
      .then(j => setRuns(j.runs ?? []))
      .finally(() => setLoading(false))
  }, [refreshKey])

  const statusColor = (s: string) => s === 'completed' ? 'text-status-track bg-status-track/10'
    : s === 'partial' ? 'text-status-exec bg-status-exec/10'
    : s === 'running' ? 'text-status-sched bg-status-sched/10'
    : 'text-status-rej bg-status-rej/10'

  if (loading) return <div className="py-8 text-center text-sm font-semibold text-me-charcoal/45">Loading runs…</div>
  if (runs.length === 0) return (
    <div className="py-8 text-center text-sm font-semibold text-me-charcoal/45">
      No cron runs yet. Click &quot;Run SEO baselines&quot; (top right) to trigger one, or wait for the weekly schedule.
    </div>
  )

  return (
    <div className="overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm">
      <table className="w-full text-xs">
        <thead className="text-[10px] font-black uppercase tracking-wide text-me-charcoal/45">
          <tr>
            <th className="px-4 py-2.5 text-left">Started</th>
            <th className="px-2 py-2.5 text-center">Status</th>
            <th className="px-2 py-2.5 text-center">Domains</th>
            <th className="px-2 py-2.5 text-center">Benchmarks</th>
            <th className="px-2 py-2.5 text-center">Duration</th>
            <th className="px-4 py-2.5 text-left">Trigger</th>
          </tr>
        </thead>
        <tbody>
          {runs.map(r => (
            <tr key={r.id} className="border-t border-black/5">
              <td className="px-4 py-2 font-mono font-semibold text-me-charcoal/80">{formatDate(r.started_at)} <span className="text-me-charcoal/45">{r.started_at.split('T')[1]?.slice(0,5)}</span></td>
              <td className="px-2 py-2 text-center">
                <span className={`inline-block rounded-full px-1.5 py-0.5 font-bold ${statusColor(r.status)}`}>{r.status}</span>
              </td>
              <td className="px-2 py-2 text-center font-semibold tabular-nums text-me-charcoal/80">
                {r.domains_succeeded}/{r.domains_attempted}
                {r.domains_failed > 0 && <span className="ml-1 font-bold text-status-rej">({r.domains_failed} fail)</span>}
              </td>
              <td className="px-2 py-2 text-center font-black tabular-nums text-status-track">{r.benchmarks_written}</td>
              <td className="px-2 py-2 text-center font-semibold tabular-nums text-me-charcoal/45">{r.duration_seconds != null ? `${r.duration_seconds}s` : '—'}</td>
              <td className="px-4 py-2 font-semibold text-me-charcoal/45">{r.triggered_by}{r.error_message && <span className="ml-1 text-status-rej">⚠</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function IndustryBaselinesPage() {
  const [domains, setDomains] = useState<BaselineDomain[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'baselines' | 'ai_visibility' | 'google_serp' | 'runs'>('baselines')
  const [runsRefreshKey, setRunsRefreshKey] = useState(0)
  const [triggering, setTriggering] = useState(false)
  const [triggerMsg, setTriggerMsg] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/baselines/domains')
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setDomains(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleTrigger = async () => {
    setTriggering(true)
    setTriggerMsg('')
    try {
      const res = await fetch('/api/baselines/trigger-cron', { method: 'POST' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? 'Trigger failed')
      setTriggerMsg(`✓ Run started (${j.run_id?.slice(0, 8)}…)`)
      // Switch to runs tab so user can see progress
      setActiveTab('runs')
      setRunsRefreshKey(k => k + 1)
      // Poll for completion: refresh runs every 5s for 1 min
      let polls = 0
      const interval = setInterval(() => {
        setRunsRefreshKey(k => k + 1)
        polls++
        if (polls > 12) clearInterval(interval)
      }, 5000)
      // Also refresh domain list once the run likely finished
      setTimeout(() => load(), 60_000)
    } catch (err: any) {
      setTriggerMsg(`✗ ${err.message}`)
    } finally {
      setTriggering(false)
    }
  }

  const grouped = groupBySubIndustry(domains)

  return (
    <div className="min-h-screen bg-[#f6f7f2] px-4 py-8 md:px-6">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Page header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-me-charcoal">Industry Baselines</h1>
            <p className="mt-1 text-sm font-semibold text-me-charcoal/55">
              Competitor domain watchlist for SEO benchmark scoring. Scores feed into 华佗&apos;s P50/P75/P90 benchmarks.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {triggerMsg && (
              <span className={`text-xs font-bold ${triggerMsg.startsWith('✓') ? 'text-status-track' : 'text-status-rej'}`}>
                {triggerMsg}
              </span>
            )}
            <button
              onClick={handleTrigger}
              disabled={triggering}
              className="rounded-lg bg-me-ochre px-4 py-2 text-xs font-black text-white transition-colors hover:bg-me-ochre/90 disabled:opacity-50"
            >
              {triggering ? 'Starting…' : '▶ Run SEO baselines'}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-black/10">
          {([
            { key: 'baselines',     label: 'SEO Baselines' },
            { key: 'ai_visibility', label: 'AI 可见度' },
            { key: 'google_serp',   label: 'Google 排名' },
            { key: 'runs',          label: 'Cron Runs' },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => {
                setActiveTab(key)
                if (key === 'runs') setRunsRefreshKey(k => k + 1)
              }}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-black transition-colors ${
                activeTab === key
                  ? 'border-me-ochre text-me-ochre'
                  : 'border-transparent text-me-charcoal/45 hover:text-me-charcoal/75'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === 'baselines' && (
          <>
            {/* Info banner */}
            <div className="space-y-1 rounded-xl border border-me-ochre/30 bg-me-ochre/10 px-4 py-3 text-xs font-semibold text-me-charcoal/80">
              <p><strong className="font-black text-me-charcoal">How it works:</strong> Per-domain &quot;Refresh&quot; runs one DataForSEO call; &quot;Run SEO baselines&quot; (top right) runs the whole watchlist + writes to industry_benchmarks. This is the <em>SEO score</em> pipeline — distinct from the &quot;Run AI visibility&quot; button inside the AI 可见度 tab which tracks AI brand recommendations.</p>
              <p>Domains marked <span className="font-bold text-status-exec">⚠</span> haven&apos;t been collected in 30+ days. Sparkline shows weekly P50 trend.</p>
            </div>

            {loading && (
              <div className="py-8 text-center text-sm font-semibold text-me-charcoal/45">Loading…</div>
            )}

            {error && (
              <div className="rounded-xl border border-status-rej/30 bg-status-rej/10 px-4 py-3 text-sm font-semibold text-status-rej">{error}</div>
            )}

            {!loading && !error && grouped.size === 0 && (
              <div className="py-8 text-center text-sm font-semibold text-me-charcoal/45">No baseline domains found. Run the S2 seed migration first.</div>
            )}

            {Array.from(grouped.entries()).map(([subIndustry, subDomains]) => (
              <SubIndustryPanel
                key={subIndustry}
                subIndustry={subIndustry}
                domains={subDomains}
                onRefresh={load}
              />
            ))}
          </>
        )}

        {activeTab === 'ai_visibility' && <AiVisibilityPanel />}

        {activeTab === 'google_serp' && <GoogleSerpPanel />}

        {activeTab === 'runs' && (
          <CronRunsPanel refreshKey={runsRefreshKey} />
        )}
      </div>
    </div>
  )
}
