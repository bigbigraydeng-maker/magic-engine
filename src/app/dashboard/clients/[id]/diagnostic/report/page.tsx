'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EvidenceArtifact {
  filename: string
  json: string
}

interface ReportData {
  run_id: string
  html: string
  markdown: string
  evidence: EvidenceArtifact
}

interface TocEntry {
  id: string
  label: string
}

interface CitationPanel {
  idx: string
  refs: string[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API_KEY = process.env.NEXT_PUBLIC_INTERNAL_API_KEY ?? ''

/**
 * Injects sequential `id` attributes into every <h2> in the HTML string and
 * returns the modified HTML plus a TOC entry list extracted from those tags.
 */
function buildToc(html: string): { processedHtml: string; toc: TocEntry[] } {
  const toc: TocEntry[] = []
  let idx = 0
  const processedHtml = html.replace(/<h2>([^<]*)<\/h2>/g, (_match, content: string) => {
    const id = `section-${idx++}`
    toc.push({ id, label: content })
    return `<h2 id="${id}">${content}</h2>`
  })
  return { processedHtml, toc }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LoadingScreen() {
  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <header className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <div className="h-6 w-16 bg-gray-200 rounded animate-pulse" />
        <div className="h-5 w-40 bg-gray-200 rounded animate-pulse" />
      </header>
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400">
        <span className="animate-spin w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full" />
        <p className="text-sm">正在生成诊断报告…</p>
      </div>
    </div>
  )
}

function EvidenceDrawer({
  citation,
  onClose,
}: {
  citation: CitationPanel | null
  onClose: () => void
}) {
  if (!citation) return null
  return (
    <>
      <div
        className="fixed inset-0 z-30 bg-black/20"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="fixed right-0 top-0 bottom-0 z-40 w-80 bg-white shadow-xl border-l border-gray-200 flex flex-col"
        role="complementary"
        aria-label={`引用来源 ${citation.idx}`}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-sm font-semibold text-gray-900">
            引用来源&nbsp;[{citation.idx}]
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            aria-label="关闭证据抽屉"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {citation.refs.length === 0 ? (
            <p className="text-xs text-gray-400">无来源记录</p>
          ) : (
            <ul className="space-y-2">
              {citation.refs.map((url, i) => (
                <li key={i}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-indigo-600 hover:text-indigo-800 break-all leading-relaxed"
                  >
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  )
}

function ErrorScreen({
  clientId,
  error,
  onRetry,
}: {
  clientId: string
  error: string
  onRetry: () => void
}) {
  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <header className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <Link
          href={`/dashboard/clients/${clientId}/diagnostic`}
          className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
        >
          ← 速览
        </Link>
        <span className="text-sm font-semibold text-gray-900">诊断完整报告</span>
      </header>
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center max-w-md w-full">
          <p className="text-sm font-semibold text-red-700 mb-1">报告加载失败</p>
          <p className="text-xs text-red-600 mb-4">{error}</p>
          <button
            onClick={onRetry}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
          >
            重试
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DiagnosticReportPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const clientId = params.id as string
  const runIdParam = searchParams.get('run_id')

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reportData, setReportData] = useState<ReportData | null>(null)
  const [processedHtml, setProcessedHtml] = useState('')
  const [toc, setToc] = useState<TocEntry[]>([])
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const [citation, setCitation] = useState<CitationPanel | null>(null)
  const [docxLoading, setDocxLoading] = useState(false)

  const fetchReport = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = runIdParam ? `?run_id=${encodeURIComponent(runIdParam)}` : ''
      const res = await fetch(`/api/clients/${clientId}/diagnostic/report${qs}`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const data = await res.json() as { success: boolean } & ReportData
      const { processedHtml: ph, toc: t } = buildToc(data.html)
      setReportData(data)
      setProcessedHtml(ph)
      setToc(t)
      if (t.length > 0) setActiveSection(t[0].id)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [clientId, runIdParam])

  useEffect(() => { void fetchReport() }, [fetchReport])

  useEffect(() => {
    const handleMessage = (e: MessageEvent<{ type?: string; idx?: string; refs?: string[] }>) => {
      if (e.data?.type === 'cite:click') {
        setCitation({ idx: e.data.idx ?? '', refs: e.data.refs ?? [] })
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  const handlePrint = () => {
    iframeRef.current?.contentWindow?.print()
  }

  const handleDownloadDocx = async () => {
    if (!reportData) return
    setDocxLoading(true)
    try {
      const qs = runIdParam ? `?run_id=${encodeURIComponent(runIdParam)}` : ''
      const res = await fetch(`/api/clients/${clientId}/diagnostic/report/docx${qs}`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `diagnostic-report-${reportData.run_id.slice(0, 8)}.docx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('[docx download]', e)
      alert(e instanceof Error ? e.message : '导出失败，请重试')
    } finally {
      setDocxLoading(false)
    }
  }

  const handleDownloadEvidence = () => {
    if (!reportData) return
    const blob = new Blob([reportData.evidence.json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = reportData.evidence.filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleTocClick = (id: string) => {
    setActiveSection(id)
    const iframe = iframeRef.current
    if (!iframe?.contentDocument) return
    const el = iframe.contentDocument.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (loading) return <LoadingScreen />
  if (error) {
    return (
      <ErrorScreen
        clientId={clientId}
        error={error}
        onRetry={() => void fetchReport()}
      />
    )
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
      {/* ── Sticky header ────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 z-20">
        <Link
          href={`/dashboard/clients/${clientId}/diagnostic`}
          className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors flex-shrink-0"
          aria-label="返回速览"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          速览
        </Link>

        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-gray-900 truncate">诊断完整报告</h1>
          {reportData && (
            <p className="text-xs text-gray-400 hidden sm:block truncate">
              Run {reportData.run_id.slice(0, 8)}…
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Download evidence.json */}
          <button
            onClick={handleDownloadEvidence}
            disabled={!reportData}
            title="下载 Evidence JSON"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            <span className="hidden sm:inline">Evidence</span>
            <span className="sm:hidden">↓</span>
          </button>

          {/* Export DOCX */}
          <button
            onClick={() => void handleDownloadDocx()}
            disabled={!reportData || docxLoading}
            title="导出 Word 文档"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {docxLoading ? (
              <span className="w-3.5 h-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            )}
            <span className="hidden sm:inline">{docxLoading ? '生成中…' : 'DOCX'}</span>
          </button>

          {/* Print / Export PDF */}
          <button
            onClick={handlePrint}
            disabled={!reportData}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
              />
            </svg>
            打印 / PDF
          </button>
        </div>
      </header>

      {/* ── Body: TOC sidebar + iframe ─────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* TOC sidebar — hidden on mobile */}
        {toc.length > 0 && (
          <nav
            className="hidden md:flex flex-col w-52 flex-shrink-0 bg-white border-r border-gray-100 overflow-y-auto"
            aria-label="目录"
          >
            <div className="px-3 pt-4 pb-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">目录</p>
            </div>
            <ul className="px-2 pb-4 space-y-0.5">
              {toc.map(entry => (
                <li key={entry.id}>
                  <button
                    onClick={() => handleTocClick(entry.id)}
                    className={`w-full text-left rounded-md px-2 py-1.5 text-xs transition-colors truncate ${
                      activeSection === entry.id
                        ? 'bg-indigo-50 text-indigo-700 font-medium'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }`}
                  >
                    {entry.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {/* Report iframe */}
        <iframe
          ref={iframeRef}
          srcDoc={processedHtml}
          className="flex-1 w-full h-full border-0 bg-white"
          title="诊断完整报告"
          sandbox="allow-same-origin allow-scripts allow-modals"
        />
      </div>

      <EvidenceDrawer citation={citation} onClose={() => setCitation(null)} />
    </div>
  )
}
