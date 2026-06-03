'use client'

import { useState, useEffect, useCallback } from 'react'

interface LedgerRow {
  id: string
  created_at: string
  direction: 'debit' | 'credit'
  mtc_amount: number
  service_key: string | null
  notes: string | null
}

interface LedgerResponse {
  rows: LedgerRow[]
  total: number
  page: number
  pageSize: number
}

const SERVICE_LABELS: Record<string, string> = {
  blog_seo: 'SEO blog post',
  blog_dual_signal: 'Dual-signal blog',
  image_single: 'AI image',
  image_pack_4: 'Image pack ×4',
  image_pack_12: 'Image pack ×12',
  reels_storyboard: 'Reels storyboard',
  reels_480p_6s: 'Reels 480p 6s',
  reels_720p_6s: 'Reels 720p 6s',
  reels_720p_10s: 'Reels 720p 10s',
  reels_720p_15s: 'Reels 720p 15s',
  social_post: 'Social post',
  social_series: 'Social series',
  social_calendar: 'Social calendar',
  marketing_plan: 'Marketing plan',
  keyword_report: 'Keyword report',
  geo_directives: 'GEO directive',
  ai_tracker_report: 'AI tracker report',
  competitor_report: 'Competitor report',
  master_brief_update: 'Master brief update',
  bonus_registration: 'Welcome bonus',
  ai_factory_post: 'AI Factory post',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-NZ', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Pacific/Auckland',
  })
}

function ServiceLabel({ serviceKey, notes }: { serviceKey: string | null; notes: string | null }) {
  const label = serviceKey ? (SERVICE_LABELS[serviceKey] ?? serviceKey) : '—'
  return (
    <div>
      <span className="text-sm text-me-charcoal/75">{label}</span>
      {notes && (
        <p className="mt-0.5 text-xs text-me-charcoal/40">{notes}</p>
      )}
    </div>
  )
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i} className="border-b border-black/[.06]">
          <td className="px-4 py-3">
            <div className="h-4 w-32 animate-pulse rounded bg-me-charcoal/10" />
          </td>
          <td className="px-4 py-3">
            <div className="h-4 w-40 animate-pulse rounded bg-me-charcoal/10" />
          </td>
          <td className="px-4 py-3 text-right">
            <div className="ml-auto h-4 w-16 animate-pulse rounded bg-me-charcoal/10" />
          </td>
        </tr>
      ))}
    </>
  )
}

interface Props {
  clientId: string
}

export default function MtcLedgerTable({ clientId }: Props) {
  const [data, setData] = useState<LedgerResponse | null>(null)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchPage = useCallback(async (p: number) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/mtc/ledger?clientId=${encodeURIComponent(clientId)}&page=${p}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
      }
      const json: LedgerResponse = await res.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ledger')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    fetchPage(page)
  }, [fetchPage, page])

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 0

  return (
    <div>
      <div className="rounded-xl border border-black/[.07] overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-me-ivory">
            <tr>
              <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-me-charcoal/45">
                Date
              </th>
              <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-me-charcoal/45">
                Service
              </th>
              <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-me-charcoal/45">
                Amount (MTC)
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows />
            ) : error ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-sm text-red-500">
                  {error}
                </td>
              </tr>
            ) : !data || data.rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-sm text-me-charcoal/40">
                  No transactions yet
                </td>
              </tr>
            ) : (
              data.rows.map((entry) => (
                <tr
                  key={entry.id}
                  className="border-b border-black/[.06] hover:bg-me-ivory/40 transition last:border-0"
                >
                  <td className="px-4 py-3 text-sm text-me-charcoal/55 whitespace-nowrap">
                    {formatDate(entry.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <ServiceLabel serviceKey={entry.service_key} notes={entry.notes} />
                  </td>
                  <td className="px-4 py-3 text-right font-display font-bold tabular-nums whitespace-nowrap">
                    {entry.direction === 'debit' ? (
                      <span className="text-me-charcoal">
                        −{entry.mtc_amount.toLocaleString()} <span className="text-xs font-semibold text-me-charcoal/45">MTC</span>
                      </span>
                    ) : (
                      <span className="text-[#5C8A4A]">
                        +{entry.mtc_amount.toLocaleString()} <span className="text-xs font-semibold text-[#5C8A4A]/60">MTC</span>
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-me-charcoal/40">
            Page {page + 1} of {totalPages}
            {data && (
              <> &mdash; {data.total.toLocaleString()} transactions total</>
            )}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page <= 0 || loading}
              className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-bold text-me-charcoal/60 disabled:opacity-30 hover:border-me-ochre/40 transition"
            >
              ← Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1 || loading}
              className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-bold text-me-charcoal/60 disabled:opacity-30 hover:border-me-ochre/40 transition"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
