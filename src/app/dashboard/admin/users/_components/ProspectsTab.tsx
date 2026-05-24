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
  completed: 'bg-green-100 text-green-700',
  running:   'bg-blue-100  text-blue-700',
  queued:    'bg-gray-100  text-gray-600',
  failed:    'bg-red-100   text-red-700',
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
          <h2 className="text-lg font-semibold text-gray-900">Discovery Prospects</h2>
          <p className="text-sm text-gray-500 mt-0.5">Users who submitted a free scan via /discover — {total} total</p>
        </div>
        {/* Status filter */}
        <div className="flex gap-1.5">
          {STATUSES.map(s => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setPage(1) }}
              className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors capitalize ${
                statusFilter === s
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
        ) : error ? (
          <div className="p-8 text-center text-sm text-red-500">{error}</div>
        ) : prospects.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">No prospects found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Domain</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Submitted</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {prospects.map(p => (
                <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-900 font-medium">{p.email}</td>
                  <td className="px-4 py-3 text-gray-600">{p.domain}</td>
                  <td className="px-4 py-3 text-gray-500">{p.name || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[p.status] ?? STATUS_STYLES.queued}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                    {new Date(p.created_at).toLocaleDateString('en-NZ')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => { void openDetail(p.id) }}
                      disabled={detailLoading}
                      className="text-xs text-indigo-600 hover:text-indigo-800 hover:underline transition-colors disabled:opacity-40"
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
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              ← Prev
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors"
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
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-start justify-between z-10">
              <div>
                <h3 className="text-base font-bold text-gray-900">{selected.domain}</h3>
                <p className="text-sm text-gray-500">{selected.email}</p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none mt-0.5"
              >
                ✕
              </button>
            </div>

            <div className="px-6 py-5 space-y-6">
              {/* Meta */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-gray-500">Status</span>
                  <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[selected.status]}`}>
                    {selected.status}
                  </span>
                </div>
                <div><span className="text-gray-500">Submitted:</span> <span className="text-gray-900 ml-1">{new Date(selected.created_at).toLocaleString('en-NZ')}</span></div>
                {selected.name && <div><span className="text-gray-500">Name:</span> <span className="text-gray-900 ml-1">{selected.name}</span></div>}
                {selected.completed_at && <div><span className="text-gray-500">Completed:</span> <span className="text-gray-900 ml-1">{new Date(selected.completed_at).toLocaleString('en-NZ')}</span></div>}
                {selected.error && <div className="col-span-2"><span className="text-red-500">Error:</span> <span className="text-gray-700 ml-1 text-xs">{selected.error}</span></div>}
              </div>

              {/* Progress log */}
              {selected.progress_log && selected.progress_log.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Scan Progress</h4>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {selected.progress_log.map((log, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-gray-600">
                        <span>{log.icon}</span>
                        <span>{log.message}</span>
                        <span className="ml-auto text-gray-400 shrink-0">{new Date(log.ts).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Report preview — same view as the prospect sees */}
              {selected.result && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Scan Result</h4>
                  <div className="rounded-xl overflow-hidden overflow-y-auto max-h-[600px]"
                       style={{ background: '#060E1A' }}>
                    <ReportView report={selected.result as DiscoveryReport} />
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
