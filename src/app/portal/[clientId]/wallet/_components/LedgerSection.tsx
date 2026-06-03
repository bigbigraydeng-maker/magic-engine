'use client'

import { useState, useEffect, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LedgerRow {
  id: string
  direction: 'debit' | 'credit'
  service_key: string | null
  mtc_amount: number
  source: string
  notes: string | null
  created_at: string
}

interface LedgerResponse {
  rows: LedgerRow[]
  total: number
  page: number
  pageSize: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    timeZone: 'Pacific/Auckland',
  })
}

function serviceLabel(serviceKey: string | null): string {
  if (!serviceKey) return '—'
  return SERVICE_LABELS[serviceKey] ?? serviceKey
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <tr key={i} className="border-b border-slate-100">
          <td className="px-4 py-3">
            <div className="h-4 w-24 animate-pulse rounded bg-slate-100" />
          </td>
          <td className="px-4 py-3">
            <div className="h-4 w-40 animate-pulse rounded bg-slate-100" />
          </td>
          <td className="px-4 py-3 text-right">
            <div className="ml-auto h-4 w-16 animate-pulse rounded bg-slate-100" />
          </td>
        </tr>
      ))}
    </>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  clientId: string
}

export default function LedgerSection({ clientId }: Props) {
  const [data, setData] = useState<LedgerResponse | null>(null)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchPage = useCallback(async (p: number) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/mtc/ledger?clientId=${encodeURIComponent(clientId)}&page=${p}`
      )
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => ({}))
        const msg =
          body !== null &&
          typeof body === 'object' &&
          'error' in body &&
          typeof (body as { error: unknown }).error === 'string'
            ? (body as { error: string }).error
            : `HTTP ${res.status}`
        throw new Error(msg)
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
      <h2 className="mb-4 font-display text-lg font-bold text-slate-900">
        Transaction history
      </h2>

      <div className="overflow-hidden rounded-xl border border-slate-100">
        <table className="w-full text-left">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                Date
              </th>
              <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                Description
              </th>
              <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-400">
                MTC
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows />
            ) : error ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-sm text-red-500">
                  Unable to load transaction history
                </td>
              </tr>
            ) : !data || data.rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-sm text-slate-400">
                  No transactions yet
                </td>
              </tr>
            ) : (
              data.rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-slate-100 transition last:border-0 hover:bg-slate-50/60"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-500">
                    {formatDate(row.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-slate-700">
                      {serviceLabel(row.service_key)}
                    </span>
                    {row.notes && (
                      <span className="ml-1 text-xs text-slate-400">
                        — {row.notes}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                    {row.direction === 'debit' ? (
                      <span className="font-bold text-slate-800">
                        −{row.mtc_amount.toLocaleString()}
                      </span>
                    ) : (
                      <span className="font-bold text-green-600">
                        +{row.mtc_amount.toLocaleString()}
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
          <p className="text-xs text-slate-400">
            Page {page + 1} of {totalPages}
            {data && (
              <> &mdash; {data.total.toLocaleString()} transactions</>
            )}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page <= 0 || loading}
              className="rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-500 disabled:opacity-30"
            >
              ← Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1 || loading}
              className="rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-500 disabled:opacity-30"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
