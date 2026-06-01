'use client'

import { useEffect, useState } from 'react'
import type { ClientSitePage, PagesResponse } from '@/app/api/clients/[id]/site-audit/pages/route'

interface Props {
  clientId: string
  onContinue: () => void
  onBack: () => void
}

export default function Step4ReviewPages({ clientId, onContinue, onBack }: Props) {
  const [pages, setPages] = useState<ClientSitePage[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(
          `/api/clients/${clientId}/site-audit/pages?limit=20&sort=word_count&order=desc`
        )
        const json = (await res.json()) as PagesResponse | { error: string }
        if (cancelled) return
        if (!res.ok || 'error' in json) {
          throw new Error(('error' in json && json.error) || 'Failed to load pages')
        }
        setPages(json.pages)
        setTotal(json.total)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load pages')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [clientId])

  // Aggregate counts by page_type
  const typeCounts = pages.reduce<Record<string, number>>((acc, p) => {
    acc[p.page_type] = (acc[p.page_type] ?? 0) + 1
    return acc
  }, {})
  const geoCount = pages.filter((p) => p.has_geo_block).length

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-me-charcoal/90 mb-1">Review Crawled Pages</h2>
        <p className="text-me-charcoal/60 text-sm">
          Confirm the snapshot looks reasonable. You can refine later from the client dashboard.
        </p>
      </div>

      {loading && <div className="text-center py-12 text-me-charcoal/55 text-sm">Loading pages…</div>}

      {error && (
        <div className="p-3 bg-[#C2453A]/10 border border-[#C2453A]/30 rounded-lg text-sm text-[#C2453A]">
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-me-ivory border border-black/10 rounded-lg p-4 text-center">
              <p className="text-xs text-me-charcoal/55">Total Pages</p>
              <p className="text-2xl font-bold text-me-charcoal/90">{total}</p>
            </div>
            <div className="bg-[#5C8A4A]/10 border border-[#5C8A4A]/30 rounded-lg p-4 text-center">
              <p className="text-xs text-[#5C8A4A]">GEO Detected</p>
              <p className="text-2xl font-bold text-[#5C8A4A]">{geoCount}</p>
            </div>
            <div className="bg-me-ochre/10 border border-me-ochre/30 rounded-lg p-4 text-center">
              <p className="text-xs text-me-ochre">Top Type</p>
              <p className="text-lg font-bold text-me-ochre truncate">
                {Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'}
              </p>
            </div>
          </div>

          {/* Type distribution */}
          {Object.keys(typeCounts).length > 0 && (
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(typeCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([type, count]) => (
                  <span
                    key={type}
                    className="px-2.5 py-1 bg-me-ivory text-me-charcoal/75 rounded-full"
                  >
                    {type}: <span className="font-semibold">{count}</span>
                  </span>
                ))}
            </div>
          )}

          {/* Low-page warning */}
          {total < 5 && total > 0 && (
            <div className="p-3 bg-me-ochre/10 border border-me-ochre/30 rounded-lg text-xs text-me-ochre">
              ⚠️ Only {total} page(s) were crawled. The Master Brief will have limited
              context — consider adding manual reference URLs in Step 2 or re-running
              the crawl from the client dashboard later.
            </div>
          )}

          {total === 0 && (
            <div className="p-3 bg-me-ochre/10 border border-me-ochre/30 rounded-lg text-xs text-me-ochre">
              ⚠️ No pages were crawled (sitemap.xml may be missing). You can still
              continue, but the Master Brief will rely on uploaded files only.
            </div>
          )}

          {/* Page table */}
          {pages.length > 0 && (
            <div className="border border-black/10 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-me-ivory border-b border-black/10">
                    <th className="text-left px-4 py-2 text-xs font-semibold text-me-charcoal/60">URL</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-me-charcoal/60 w-24">Type</th>
                    <th className="text-right px-4 py-2 text-xs font-semibold text-me-charcoal/60 w-24">Words</th>
                    <th className="text-center px-4 py-2 text-xs font-semibold text-me-charcoal/60 w-16">GEO</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/10">
                  {pages.slice(0, 20).map((page) => (
                    <tr key={page.id}>
                      <td className="px-4 py-2">
                        <a
                          href={page.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-me-ochre hover:underline text-xs truncate block max-w-md"
                          title={page.url}
                        >
                          {page.title ?? page.url}
                        </a>
                      </td>
                      <td className="px-4 py-2 text-xs text-me-charcoal/60">{page.page_type}</td>
                      <td className="px-4 py-2 text-xs text-right font-mono text-me-charcoal/60">
                        {page.word_count ?? 0}
                      </td>
                      <td className="px-4 py-2 text-center text-xs">
                        {page.has_geo_block ? (
                          <span className="text-[#5C8A4A]">✓</span>
                        ) : (
                          <span className="text-me-charcoal/35">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <div className="flex items-center justify-between pt-4">
        <button
          type="button"
          onClick={onBack}
          className="px-6 py-3 text-me-charcoal/60 hover:text-me-charcoal/90 font-medium"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={loading}
          className="px-6 py-3 bg-me-ochre hover:bg-me-ochre disabled:bg-me-charcoal/25 text-white font-semibold rounded-lg"
        >
          Looks good, activate →
        </button>
      </div>
    </div>
  )
}
