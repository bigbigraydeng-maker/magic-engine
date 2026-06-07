'use client'

import { useState, useEffect } from 'react'

interface JobSummary {
  name: string
  latest_status: 'running' | 'completed' | 'failed'
  latest_started_at: string
  latest_finished_at: string | null
  latest_duration_ms: number | null
  latest_processed: number
  latest_completed: number
  latest_failed: number
  latest_error: string | null
  recent_failure_runs: number
  recent_runs: number
}

function formatDuration(ms: number | null) {
  if (!ms) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTime(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', hour12: false })
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function CronHealthPage() {
  const [jobs, setJobs] = useState<JobSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const fetchData = async () => {
    try {
      const res = await fetch('/api/admin/cron-health')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setJobs(data.jobs ?? [])
      setLastRefresh(new Date())
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 60000) // auto-refresh every 60s
    return () => clearInterval(interval)
  }, [])

  const healthy = jobs.filter(j => j.latest_failed === 0 && j.latest_status !== 'failed')
  const warning = jobs.filter(j => (j.latest_failed ?? 0) > 0 || j.latest_status === 'failed')

  return (
    <div className="min-h-screen bg-me-ivory py-8 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-me-charcoal/90">
              Cron Health
            </h1>
            <p className="mt-1 text-sm text-me-charcoal/50">
              Most recent run per job · auto-refreshes every 60s
              {lastRefresh && ` · last updated ${timeAgo(lastRefresh.toISOString())}`}
            </p>
          </div>
          <button
            onClick={fetchData}
            className="rounded-md bg-me-ochre px-4 py-2 text-sm font-medium text-white hover:bg-me-ochre/90"
          >
            Refresh
          </button>
        </div>

        {error && (
          <div className="mb-6 rounded-md bg-red-50 p-4 text-red-700 text-sm">{error}</div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20 text-me-charcoal/40">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-black/10 border-t-me-ochre mr-2" />
            Loading…
          </div>
        ) : (
          <>
            {/* Summary strip */}
            <div className="mb-6 grid grid-cols-3 gap-4">
              <div className="rounded-lg bg-white shadow-sm p-4 text-center">
                <div className="text-2xl font-bold text-me-charcoal/90">{jobs.length}</div>
                <div className="text-xs text-me-charcoal/50 mt-1">Total Jobs</div>
              </div>
              <div className="rounded-lg bg-green-50 shadow-sm p-4 text-center">
                <div className="text-2xl font-bold text-green-700">{healthy.length}</div>
                <div className="text-xs text-green-600 mt-1">Healthy</div>
              </div>
              <div className={`rounded-lg shadow-sm p-4 text-center ${warning.length > 0 ? 'bg-red-50' : 'bg-white'}`}>
                <div className={`text-2xl font-bold ${warning.length > 0 ? 'text-red-700' : 'text-me-charcoal/30'}`}>
                  {warning.length}
                </div>
                <div className={`text-xs mt-1 ${warning.length > 0 ? 'text-red-600' : 'text-me-charcoal/30'}`}>
                  Need Attention
                </div>
              </div>
            </div>

            {/* Warning jobs first */}
            {warning.length > 0 && (
              <div className="mb-6">
                <h2 className="text-sm font-semibold text-red-600 uppercase tracking-wide mb-3">⚠ Failed / Errors</h2>
                <JobTable jobs={warning} />
              </div>
            )}

            {/* Healthy jobs */}
            <div>
              {warning.length > 0 && (
                <h2 className="text-sm font-semibold text-green-700 uppercase tracking-wide mb-3">✓ Healthy</h2>
              )}
              <JobTable jobs={healthy} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function JobTable({ jobs }: { jobs: JobSummary[] }) {
  if (!jobs.length) return null
  return (
    <div className="rounded-lg bg-white shadow-sm overflow-hidden mb-4">
      <table className="w-full text-sm">
        <thead className="bg-me-ivory border-b border-black/10">
          <tr>
            <th className="px-4 py-3 text-left font-semibold text-me-charcoal/70">Job</th>
            <th className="px-4 py-3 text-left font-semibold text-me-charcoal/70">Last Run (NZST)</th>
            <th className="px-4 py-3 text-center font-semibold text-me-charcoal/70">Status</th>
            <th className="px-4 py-3 text-right font-semibold text-me-charcoal/70">Duration</th>
            <th className="px-4 py-3 text-right font-semibold text-me-charcoal/70">Processed</th>
            <th className="px-4 py-3 text-right font-semibold text-me-charcoal/70">Failed</th>
            <th className="px-4 py-3 text-left font-semibold text-me-charcoal/70">Error</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/5">
          {jobs.map(job => {
            const hasFailed = (job.latest_failed ?? 0) > 0 || job.latest_status === 'failed'
            return (
              <tr key={job.name} className={hasFailed ? 'bg-red-50' : 'hover:bg-me-ivory/50'}>
                <td className="px-4 py-3 font-mono text-xs text-me-charcoal/90">{job.name}</td>
                <td className="px-4 py-3 text-me-charcoal/60 whitespace-nowrap">
                  <span>{formatTime(job.latest_started_at)}</span>
                  <span className="ml-2 text-me-charcoal/40">({timeAgo(job.latest_started_at)})</span>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    job.latest_status === 'completed' ? 'bg-green-100 text-green-700' :
                    job.latest_status === 'failed' ? 'bg-red-100 text-red-700' :
                    'bg-yellow-100 text-yellow-700'
                  }`}>
                    {job.latest_status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-me-charcoal/60 font-mono text-xs">
                  {formatDuration(job.latest_duration_ms)}
                </td>
                <td className="px-4 py-3 text-right text-me-charcoal/60">{job.latest_processed ?? 0}</td>
                <td className={`px-4 py-3 text-right font-semibold ${(job.latest_failed ?? 0) > 0 ? 'text-red-600' : 'text-me-charcoal/30'}`}>
                  {job.latest_failed ?? 0}
                </td>
                <td className="px-4 py-3 text-xs text-red-600 max-w-xs truncate">
                  {job.latest_error ?? '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
