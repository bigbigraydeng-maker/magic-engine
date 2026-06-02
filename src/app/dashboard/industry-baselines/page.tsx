'use client'

import { useState, useEffect, useCallback } from 'react'

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <form
        className="w-full max-w-lg rounded-xl bg-slate-900 border border-white/10 p-6 space-y-4"
        onClick={e => e.stopPropagation()}
        onSubmit={submit}
      >
        <h3 className="text-base font-semibold text-white">Add Competitor Domain</h3>
        <p className="text-xs text-slate-400">{labelSubIndustry(subIndustry)}</p>

        <div className="space-y-1">
          <label className="text-xs text-slate-400">Domain</label>
          <input
            className="w-full rounded-lg bg-slate-800 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            placeholder="e.g. competitorname.co.nz"
            value={domain}
            onChange={e => setDomain(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs text-slate-400">Keywords</label>
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
            <input type="radio" checked={useSharedKw} onChange={() => setUseSharedKw(true)} />
            Use shared keywords for this sub-industry ({existingKeywords.length} keywords)
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
            <input type="radio" checked={!useSharedKw} onChange={() => setUseSharedKw(false)} />
            Custom keywords (one per line)
          </label>
          {!useSharedKw && (
            <textarea
              className="w-full rounded-lg bg-slate-800 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 h-24 resize-none"
              placeholder={'china tour nz\nchina travel packages nz'}
              value={customKw}
              onChange={e => setCustomKw(e.target.value)}
            />
          )}
        </div>

        <div className="space-y-1">
          <label className="text-xs text-slate-400">Notes (optional)</label>
          <input
            className="w-full rounded-lg bg-slate-800 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none"
            placeholder="e.g. Direct competitor, China-focused"
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
          <input type="checkbox" checked={isClient} onChange={e => setIsClient(e.target.checked)} />
          This is a Magic Engine client domain
        </label>

        {err && <p className="text-xs text-red-400">{err}</p>}

        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 text-sm font-medium text-white transition-colors"
          >
            {saving ? 'Adding…' : 'Add Domain'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
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
    <tr className="border-t border-white/5 hover:bg-white/[0.02] transition-colors">
      <td className="py-2.5 px-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-white font-mono">{domain.domain}</span>
          {domain.is_client && (
            <span className="rounded px-1.5 py-0.5 bg-blue-500/20 text-blue-300 text-[10px] font-semibold">CLIENT</span>
          )}
          {domain.notes && (
            <span className="text-xs text-slate-500 truncate max-w-[180px]" title={domain.notes}>{domain.notes}</span>
          )}
        </div>
      </td>
      <td className="py-2.5 px-4 text-center">
        {domain.seo_score !== null ? (
          <span className="text-sm font-semibold text-white">{domain.seo_score}</span>
        ) : (
          <span className="text-xs text-slate-500">—</span>
        )}
      </td>
      <td className="py-2.5 px-4 text-center">
        <span className={`text-xs ${stale ? 'text-amber-400' : 'text-slate-400'}`}>
          {stale && domain.last_collected_at ? '⚠ ' : ''}
          {formatDate(domain.last_collected_at)}
        </span>
      </td>
      <td className="py-2.5 px-4 text-center text-xs text-slate-500">
        {domain.keywords.length}
      </td>
      <td className="py-2.5 px-4">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={handleCollect}
            disabled={collecting}
            className="rounded-md bg-white/[0.06] hover:bg-white/10 disabled:opacity-40 px-3 py-1 text-xs text-slate-300 transition-colors"
          >
            {collecting ? 'Running…' : 'Refresh'}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="rounded-md hover:bg-red-500/20 disabled:opacity-40 px-3 py-1 text-xs text-red-400 hover:text-red-300 transition-colors"
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
    <div className="rounded-xl border border-white/10 bg-slate-900/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div>
          <h3 className="text-sm font-semibold text-white">{labelSubIndustry(subIndustry)}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{domains.length} domains</p>
        </div>

        {/* Percentile badges */}
        {stats ? (
          <div className="flex items-center gap-3">
            <div className="text-center">
              <div className="text-[10px] text-slate-500 uppercase tracking-wide">P50</div>
              <div className="text-base font-bold text-white">{stats.p50}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-slate-500 uppercase tracking-wide">P75</div>
              <div className="text-base font-bold text-emerald-400">{stats.p75}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-slate-500 uppercase tracking-wide">P90</div>
              <div className="text-base font-bold text-blue-400">{stats.p90}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-slate-500 uppercase tracking-wide">n</div>
              <div className="text-base font-bold text-slate-400">{stats.n}</div>
            </div>
          </div>
        ) : (
          <span className="text-xs text-slate-500">No scores yet</span>
        )}
      </div>

      {/* Domain table */}
      <table className="w-full">
        <thead>
          <tr className="text-[10px] text-slate-500 uppercase tracking-wide">
            <th className="text-left py-2 px-4">Domain</th>
            <th className="text-center py-2 px-4">SEO Score</th>
            <th className="text-center py-2 px-4">Last Collected</th>
            <th className="text-center py-2 px-4">Keywords</th>
            <th className="py-2 px-4"></th>
          </tr>
        </thead>
        <tbody>
          {domains.map(d => (
            <DomainRow key={d.id} domain={d} onCollect={handleCollect} onDelete={handleDelete} />
          ))}
        </tbody>
      </table>

      {/* Add domain */}
      <div className="px-4 py-3 border-t border-white/5">
        <button
          onClick={() => setShowAdd(true)}
          className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function IndustryBaselinesPage() {
  const [domains, setDomains] = useState<BaselineDomain[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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

  const grouped = groupBySubIndustry(domains)

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-white">Industry Baselines</h1>
        <p className="text-sm text-slate-400 mt-1">
          Competitor domain watchlist for SEO benchmark scoring. Refresh individual domains on demand — scores feed into华佗&apos;s P50/P75/P90 benchmarks.
        </p>
      </div>

      {/* Info banner */}
      <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 px-4 py-3 text-xs text-blue-300 space-y-1">
        <p><strong>How it works:</strong> Each &quot;Refresh&quot; button runs one DataForSEO call for that domain only — no bulk re-runs.</p>
        <p>Domains marked <span className="text-amber-300">⚠</span> haven&apos;t been collected in 30+ days. Refresh them when you need fresh data.</p>
        <p>P50/P75/P90 are calculated live from all scored domains in the group.</p>
      </div>

      {loading && (
        <div className="text-sm text-slate-500 py-8 text-center">Loading…</div>
      )}

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {!loading && !error && grouped.size === 0 && (
        <div className="text-sm text-slate-500 py-8 text-center">No baseline domains found. Run the S2 seed migration first.</div>
      )}

      {Array.from(grouped.entries()).map(([subIndustry, subDomains]) => (
        <SubIndustryPanel
          key={subIndustry}
          subIndustry={subIndustry}
          domains={subDomains}
          onRefresh={load}
        />
      ))}
    </div>
  )
}
