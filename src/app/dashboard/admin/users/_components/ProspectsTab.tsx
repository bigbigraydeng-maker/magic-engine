'use client'

import { useState, useEffect, useCallback } from 'react'
import { ReportView } from '@/components/prospect/ProspectReportView'
import type { DiscoveryReport } from '@/lib/zhangqian/types'

interface Prospect {
  id: string
  url: string
  domain: string
  email: string
  name: string | null
  status: 'queued' | 'running' | 'completed' | 'failed'
  created_at: string
  completed_at: string | null
}

interface ProspectDetail extends Prospect {
  result: Record<string, unknown> | null
  progress_log: Array<{ icon: string; message: string; ts: string }> | null
  error: string | null
}

const STATUS_STYLES: Record<string, string> = {
  completed: 'bg-[#5C8A4A]/12 text-[#5C8A4A]',
  running:   'bg-me-ochre/10  text-me-ochre',
  queued:    'bg-me-ivory  text-me-charcoal/60',
  failed:    'bg-[#C2453A]/10   text-[#C2453A]',
}

const STATUSES = ['all', 'completed', 'running', 'queued', 'failed'] as const

export default function ProspectsTab() {
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [total, setTotal]         = useState(0)
  const [page, setPage]           = useState(1)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [selected, setSelected]   = useState<ProspectDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ page: String(page), limit: '30' })
      if (statusFilter !== 'all') qs.set('status', statusFilter)
      const res  = await fetch(`/api/admin/prospects?${qs}`)
      const data = await res.json() as { prospects?: Prospect[]; total?: number; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed to load')
      setProspects(data.prospects ?? [])
      setTotal(data.total ?? 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter])

  useEffect(() => { void fetchList() }, [fetchList])

  async function openDetail(id: string) {
    setDetailLoading(true)
    try {
      const res  = await fetch(`/api/admin/prospects/${id}`)
      const data = await res.json() as { prospect?: ProspectDetail; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed to load detail')
      setSelected(data.prospect ?? null)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to load detail')
    } finally {
      setDetailLoading(false)
    }
  }

  const totalPages = Math.ceil(total / 30)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-me-charcoal/90">Discovery Prospects</h2>
          <p className="text-sm text-me-charcoal/55 mt-0.5">Users who submitted a free scan via /discover — {total} total</p>
        </div>
        {/* Status filter */}
        <div className="flex gap-1.5">
          {STATUSES.map(s => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setPage(1) }}
              className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors capitalize ${
                statusFilter === s
                  ? 'bg-me-ochre text-white border-me-ochre'
                  : 'bg-white text-me-charcoal/60 border-black/15 hover:border-black/20'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-black/10 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-me-charcoal/45">Loading…</div>
        ) : error ? (
          <div className="p-8 text-center text-sm text-[#C2453A]">{error}</div>
        ) : prospects.length === 0 ? (
          <div className="p-8 text-center text-sm text-me-charcoal/45">No prospects found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/[.06] bg-me-ivory">
                <th className="text-left px-4 py-3 text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide">Email</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide">Domain</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide">Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide">Submitted</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[.06]">
              {prospects.map(p => (
                <tr key={p.id} className="hover:bg-me-ivory transition-colors">
                  <td className="px-4 py-3 text-me-charcoal/90 font-medium">{p.email}</td>
                  <td className="px-4 py-3 text-me-charcoal/60">{p.domain}</td>
                  <td className="px-4 py-3 text-me-charcoal/55">{p.name || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[p.status] ?? STATUS_STYLES.queued}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-me-charcoal/45 text-xs whitespace-nowrap">
                    {new Date(p.created_at).toLocaleDateString('en-NZ')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => { void openDetail(p.id) }}
                      disabled={detailLoading}
                      className="text-xs text-me-ochre hover:text-me-ochre hover:underline transition-colors disabled:opacity-40"
                    >
                      View →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-me-charcoal/55">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 border border-black/15 rounded-lg hover:bg-me-ivory disabled:opacity-40 transition-colors"
            >
              ← Prev
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 border border-black/15 rounded-lg hover:bg-me-ivory disabled:opacity-40 transition-colors"
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Detail drawer */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-end" onClick={() => setSelected(null)}>
          <div
            className="w-full max-w-2xl h-full bg-white shadow-2xl overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-black/10 px-6 py-4 flex items-start justify-between z-10">
              <div>
                <h3 className="text-base font-bold text-me-charcoal/90">{selected.domain}</h3>
                <p className="text-sm text-me-charcoal/55">{selected.email}</p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-me-charcoal/45 hover:text-me-charcoal/60 text-xl leading-none mt-0.5"
              >
                ✕
              </button>
            </div>

            <div className="px-6 py-5 space-y-6">
              {/* Meta */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-me-charcoal/55">Status</span>
                  <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[selected.status]}`}>
                    {selected.status}
                  </span>
                </div>
                <div><span className="text-me-charcoal/55">Submitted:</span> <span className="text-me-charcoal/90 ml-1">{new Date(selected.created_at).toLocaleString('en-NZ')}</span></div>
                {selected.name && <div><span className="text-me-charcoal/55">Name:</span> <span className="text-me-charcoal/90 ml-1">{selected.name}</span></div>}
                {selected.completed_at && <div><span className="text-me-charcoal/55">Completed:</span> <span className="text-me-charcoal/90 ml-1">{new Date(selected.completed_at).toLocaleString('en-NZ')}</span></div>}
                {selected.error && <div className="col-span-2"><span className="text-[#C2453A]">Error:</span> <span className="text-me-charcoal/75 ml-1 text-xs">{selected.error}</span></div>}
              </div>

              {/* Progress log */}
              {selected.progress_log && selected.progress_log.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide mb-2">Scan Progress</h4>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {selected.progress_log.map((log, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-me-charcoal/60">
                        <span>{log.icon}</span>
                        <span>{log.message}</span>
                        <span className="ml-auto text-me-charcoal/45 shrink-0">{new Date(log.ts).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Report preview — same view as the prospect sees */}
              {selected.result && (
                <div>
                  <h4 className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide mb-2">Scan Result</h4>
                  <div className="rounded-xl overflow-hidden overflow-y-auto max-h-[600px]"
                       style={{ background: '#060E1A' }}>
                    <ReportView report={selected.result as unknown as DiscoveryReport} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
