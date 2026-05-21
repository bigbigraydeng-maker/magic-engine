'use client'

/**
 * /dashboard/clients/[id]/seo-gap
 * SEO Keyword Gap Analysis — DataForSEO auto-fetch → AI analysis → DOCX download
 */

import { useState } from 'react'

interface AnalysisSummary {
  total_keywords_raw: number
  total_keywords_b2c: number
  competitors: number
  tier_a_count: number
  tier_b_count: number
  tier_c_count: number
  clusters: Array<{ name: string; volume: number }>
  executive_summary: string
  cost_usd: number
}

interface PastAnalysis {
  id: string
  title: string
  csv_count: number
  competitor_count: number
  total_keywords: number
  b2c_keywords: number
  cost_usd: number
  status: string
  report_url: string | null
  created_at: string
}

interface Props {
  params: { id: string }
}

export default function SeoGapPage({ params }: Props) {
  const { id: clientId } = params

  const [title, setTitle]               = useState('SEO Gap Analysis')
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState<string | null>(null)
  const [summary, setSummary]           = useState<AnalysisSummary | null>(null)
  const [docxBase64, setDocxBase64]     = useState<string | null>(null)
  const [reportUrl, setReportUrl]       = useState<string | null>(null)
  const [pastAnalyses, setPastAnalyses] = useState<PastAnalysis[] | null>(null)
  const [loadingHistory, setLoadingHistory] = useState(false)

  // ── Submit analysis ───────────────────────────────────────────────────────

  const runAnalysis = async () => {
    setLoading(true)
    setError(null)
    setSummary(null)
    setDocxBase64(null)
    setReportUrl(null)

    try {
      const apiKey = process.env.NEXT_PUBLIC_INTERNAL_API_KEY ?? ''
      const res = await fetch(`/api/clients/${clientId}/seo-gap`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title }),
      })

      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Analysis failed')

      setSummary(json.summary)
      setDocxBase64(json.docx_base64 ?? null)
      setReportUrl(json.report_url ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  // ── Load history ──────────────────────────────────────────────────────────

  const loadHistory = async () => {
    setLoadingHistory(true)
    try {
      const apiKey = process.env.NEXT_PUBLIC_INTERNAL_API_KEY ?? ''
      const res = await fetch(`/api/clients/${clientId}/seo-gap`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      const json = await res.json()
      if (json.success) setPastAnalyses(json.analyses)
    } catch {
      // swallow — non-critical
    } finally {
      setLoadingHistory(false)
    }
  }

  // ── DOCX download ─────────────────────────────────────────────────────────

  const downloadDocx = () => {
    if (!docxBase64) return
    const bytes = Uint8Array.from(atob(docxBase64), c => c.charCodeAt(0))
    const blob  = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${title.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.docx`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">SEO Gap Analysis</h1>
        <p className="text-gray-400 mt-1 text-sm">
          Auto-fetch keyword gaps from DataForSEO → AI analysis → DOCX report
        </p>
      </div>

      {/* Title input */}
      <div>
        <label className="block text-sm text-gray-400 mb-1">Report Title</label>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          className="w-full bg-gray-800 text-white border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="e.g. Oztop Building Supplies — May 2026"
        />
      </div>

      {/* Run button */}
      <button
        onClick={runAnalysis}
        disabled={loading}
        className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold rounded-lg transition-colors"
      >
        {loading ? '⚙️ Analysing… (30–60 seconds)' : '🚀 Run SEO Gap Analysis'}
      </button>

      {/* Error */}
      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Results */}
      {summary && (
        <div className="space-y-6">
          {/* Stat grid */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Raw Keywords', value: summary.total_keywords_raw },
              { label: 'B2C Opportunities', value: summary.total_keywords_b2c },
              { label: 'Competitors', value: summary.competitors },
              { label: 'Tier A (Act Now)', value: summary.tier_a_count },
              { label: 'Tier B (Content)', value: summary.tier_b_count },
              { label: 'Tier C (Suburb)', value: summary.tier_c_count },
            ].map(s => (
              <div key={s.label} className="bg-gray-800 rounded-xl p-4 text-center">
                <p className="text-2xl font-bold text-indigo-400">{s.value}</p>
                <p className="text-xs text-gray-400 mt-1">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Executive summary */}
          <div className="bg-gray-800 rounded-xl p-5">
            <h3 className="text-white font-semibold mb-2">Executive Summary</h3>
            <p className="text-gray-300 text-sm leading-relaxed">{summary.executive_summary}</p>
          </div>

          {/* Top clusters */}
          {summary.clusters.length > 0 && (
            <div className="bg-gray-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-3">Top Keyword Clusters</h3>
              <div className="space-y-2">
                {summary.clusters.slice(0, 6).map(c => (
                  <div key={c.name} className="flex justify-between items-center">
                    <span className="text-gray-300 text-sm">{c.name}</span>
                    <span className="text-indigo-400 text-sm font-mono">{c.volume.toLocaleString()}/mo</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Download DOCX */}
          <button
            onClick={downloadDocx}
            disabled={!docxBase64}
            className="w-full py-3 bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white font-semibold rounded-lg transition-colors"
          >
            📄 Download Full DOCX Report
          </button>

          {reportUrl && (
            <p className="text-center text-xs text-gray-500">
              Report also saved to Supabase Storage (valid 7 days)
            </p>
          )}

          <p className="text-center text-xs text-gray-600">
            AI cost: ${summary.cost_usd.toFixed(4)} USD
          </p>
        </div>
      )}

      {/* History */}
      <div className="pt-4 border-t border-gray-700">
        <button
          onClick={loadHistory}
          disabled={loadingHistory}
          className="text-indigo-400 hover:text-indigo-300 text-sm"
        >
          {loadingHistory ? 'Loading…' : '📋 View previous analyses'}
        </button>

        {pastAnalyses && pastAnalyses.length > 0 && (
          <div className="mt-4 space-y-2">
            {pastAnalyses.map(a => (
              <div key={a.id} className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-3">
                <div>
                  <p className="text-white text-sm font-medium">{a.title}</p>
                  <p className="text-gray-500 text-xs">
                    {new Date(a.created_at).toLocaleDateString('en-AU')} ·
                    {' '}{a.b2c_keywords} B2C keywords · {a.competitor_count} competitors
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    a.status === 'completed' ? 'bg-green-900 text-green-300' :
                    a.status === 'failed'    ? 'bg-red-900 text-red-300' :
                    'bg-yellow-900 text-yellow-300'
                  }`}>
                    {a.status}
                  </span>
                  {a.report_url && (
                    <a
                      href={a.report_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-400 hover:text-indigo-300 text-xs"
                    >
                      Download ↗
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {pastAnalyses && pastAnalyses.length === 0 && (
          <p className="text-gray-500 text-sm mt-3">No previous analyses for this client.</p>
        )}
      </div>
    </div>
  )
}
