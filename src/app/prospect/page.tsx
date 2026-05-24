'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { ReportView } from '@/components/prospect/ProspectReportView'

// ─── Logo ─────────────────────────────────────────────────────────────────────

const MagicLogo = () => (
  <svg width="26" height="24" viewBox="0 0 68 64" fill="none" aria-hidden="true">
    <path d="M53 3 L54.3 7.2 L58.5 8.5 L54.3 9.8 L53 14 L51.7 9.8 L47.5 8.5 L51.7 7.2 Z" fill="rgba(240,248,255,0.9)"/>
    <polygon points="3,60 13,6 22,6 12,60" fill="#9ABDE0"/>
    <polygon points="13,6 22,6 33,38 24,38" fill="#789EC8"/>
    <polygon points="46,6 55,6 44,38 35,38" fill="#789EC8"/>
    <polygon points="46,6 55,6 65,60 55,60" fill="#9ABDE0"/>
    <polygon points="24,38 33,38 34,48 35,38 44,38 34,60" fill="#587FAF"/>
  </svg>
)

// ─── Types ────────────────────────────────────────────────────────────────────

interface LogEntry {
  type: 'step' | 'discovery'
  icon: string
  message: string
  detail?: string | null
  ts: string
}

interface ReportResponse {
  job_id: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  progress_log: LogEntry[]
  domain: string
  error: string | null
  result: import('@/lib/zhangqian/types').DiscoveryReport | null
}

// ─── Loading view ─────────────────────────────────────────────────────────────

function LoadingView({ domain, log }: { domain: string; log: LogEntry[] }) {
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [log.length])

  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(Date.now())
  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000)
    return () => clearInterval(t)
  }, [])

  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60
  const elapsedStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
  const progressPct = Math.min(90, Math.round((elapsed / 300) * 90))
  const latestStep = log.length > 0 ? log[log.length - 1].message : 'Starting…'

  const phase =
    elapsed < 60  ? 'Reading your website…' :
    elapsed < 150 ? 'Checking keyword rankings & search visibility…' :
    elapsed < 240 ? 'Mapping competitors & social signals…' :
                    'Diagnosing brand health across 6 dimensions…'

  return (
    <div className="max-w-xl mx-auto px-5 py-12">
      <div className="text-center mb-6">
        <div
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-semibold mb-4"
          style={{ background: 'rgba(22,45,90,0.7)', border: '1px solid rgba(70,125,215,0.2)', color: '#7ABFFF' }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          Scanning {domain}
        </div>
        <h2 className="text-[22px] font-black mb-1" style={{ color: '#ECF3FF' }}>
          AI is mapping your brand…
        </h2>
        <p className="text-[13px] mb-1 transition-opacity duration-500" style={{ color: 'rgba(160,200,255,0.7)' }}>
          {phase}
        </p>
        <p className="text-[12px] mb-4" style={{ color: 'rgba(120,170,230,0.4)' }}>
          {elapsedStr} elapsed · Usually 3–5 minutes total
        </p>
        <div className="max-w-xs mx-auto">
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div className="h-1.5 rounded-full transition-all duration-1000"
                 style={{ width: `${progressPct}%`, background: 'linear-gradient(90deg, #2855A4, #5B9EFF)' }} />
          </div>
        </div>
        <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px]"
             style={{ background: 'rgba(10,20,40,0.5)', border: '1px solid rgba(70,125,215,0.1)' }}>
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
          <span style={{ color: 'rgba(160,200,255,0.6)' }}>{latestStep}</span>
        </div>
      </div>

      <div className="rounded-2xl overflow-hidden"
           style={{ background: 'rgba(10,20,40,0.6)', border: '1px solid rgba(70,125,215,0.15)' }}>
        <div className="px-5 pt-4 pb-2 flex items-center gap-2"
             style={{ borderBottom: '1px solid rgba(70,125,215,0.08)' }}>
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: 'rgba(120,170,230,0.5)' }}>Live Discovery Feed</span>
        </div>
        <div className="px-5 py-4 space-y-2.5 max-h-96 overflow-y-auto">
          {log.length === 0 && (
            <div className="text-[12px] py-4 text-center" style={{ color: 'rgba(120,170,230,0.3)' }}>
              Starting scan…
            </div>
          )}
          {log.map((entry, i) => (
            <div
              key={i}
              className="flex items-start gap-3"
              style={{
                background: entry.type === 'discovery' ? 'rgba(22,45,90,0.4)' : 'transparent',
                borderRadius: entry.type === 'discovery' ? '10px' : undefined,
                padding: entry.type === 'discovery' ? '8px 10px' : '2px 0',
                border: entry.type === 'discovery' ? '1px solid rgba(70,125,215,0.15)' : 'none',
              }}
            >
              <span className="text-[16px] flex-shrink-0 mt-0.5">{entry.icon}</span>
              <div>
                <p className="text-[12px] leading-snug"
                   style={{ color: entry.type === 'discovery' ? '#A5C8FF' : 'rgba(120,170,230,0.55)' }}>
                  {entry.message}
                </p>
                {entry.detail && (
                  <p className="text-[11px] mt-0.5" style={{ color: 'rgba(120,170,230,0.4)' }}>{entry.detail}</p>
                )}
              </div>
              {entry.type === 'discovery' && (
                <span className="ml-auto text-green-400 text-[10px] flex-shrink-0 mt-0.5">✓</span>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  )
}

// ─── Failed view ──────────────────────────────────────────────────────────────

function FailedView({ domain }: { domain: string }) {
  return (
    <div className="max-w-xl mx-auto px-5 py-20 text-center">
      <div className="text-[32px] mb-4">⚠️</div>
      <h2 className="text-[18px] font-black mb-2" style={{ color: '#ECF3FF' }}>
        Scan couldn&apos;t complete
      </h2>
      <p className="text-[12px] mb-6" style={{ color: 'rgba(120,170,230,0.5)' }}>
        Something went wrong while scanning {domain}. This can happen with very new domains or sites that block automated requests.
      </p>
      <a
        href="/discover"
        className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-[13px] font-bold"
        style={{
          background: 'linear-gradient(135deg,#2855A4 0%,#183572 100%)',
          border: '1px solid rgba(75,135,225,0.32)',
          color: '#EEF4FF',
        }}
      >
        Try Again
      </a>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProspectPage() {
  const [data, setData] = useState<ReportResponse | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [showReadyToast, setShowReadyToast] = useState(false)
  const prevStatusRef = useRef<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const prev = prevStatusRef.current
    const curr = data?.status ?? null
    prevStatusRef.current = curr
    if (curr === 'completed' && (prev === 'queued' || prev === 'running')) {
      setShowReadyToast(true)
      const t = setTimeout(() => setShowReadyToast(false), 2000)
      return () => clearTimeout(t)
    }
  }, [data?.status])

  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch('/api/prospect/report', { cache: 'no-store' })
        if (res.status === 404) {
          setNotFound(true)
          return
        }
        if (!res.ok) return
        const json = await res.json() as ReportResponse
        setData(json)

        if (json.status === 'completed' || json.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current)
        }
      } catch {
        // Network error — keep polling
      }
    }

    void poll()
    pollRef.current = setInterval(poll, 3000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  return (
    <div
      className="min-h-screen bg-[#060E1A] flex flex-col"
      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif" }}
    >
      <nav
        className="flex items-center justify-between px-5 py-4 sticky top-0 z-10"
        style={{
          borderBottom: '1px solid rgba(70,125,215,0.08)',
          background: 'rgba(6,14,26,0.9)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <Link href="/" className="flex items-center gap-2.5">
          <MagicLogo />
          <span className="text-[15px] font-bold text-white tracking-tight">Magic Engine</span>
        </Link>
        {data?.status === 'completed' && (
          <div
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold"
            style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)', color: '#4ade80' }}
          >
            ✓ Report ready
          </div>
        )}
      </nav>

      {showReadyToast && (
        <div
          className="fixed top-20 left-1/2 -translate-x-1/2 z-20 px-4 py-2.5 rounded-full text-[13px] font-semibold pointer-events-none"
          style={{
            background: 'rgba(34,197,94,0.18)',
            border: '1px solid rgba(34,197,94,0.4)',
            color: '#4ade80',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 8px 32px rgba(34,197,94,0.25)',
          }}
        >
          Your Discovery Report is ready ✨
        </div>
      )}

      <main className="flex-1">
        {notFound && (
          <div className="max-w-xl mx-auto px-5 py-20 text-center">
            <div className="text-[32px] mb-4">🔍</div>
            <h2 className="text-[18px] font-black mb-2" style={{ color: '#ECF3FF' }}>
              No report found
            </h2>
            <p className="text-[12px] mb-6" style={{ color: 'rgba(120,170,230,0.5)' }}>
              We couldn&apos;t find a Discovery Report linked to your account. Start a free scan to get yours.
            </p>
            <Link
              href="/discover"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-[13px] font-bold"
              style={{
                background: 'linear-gradient(135deg,#2855A4 0%,#183572 100%)',
                border: '1px solid rgba(75,135,225,0.32)',
                color: '#EEF4FF',
              }}
            >
              Start Free Discovery Report →
            </Link>
          </div>
        )}

        {!notFound && !data && (
          <div className="flex items-center justify-center py-32">
            <div className="text-center">
              <div className="w-8 h-8 rounded-full border-2 border-blue-500 border-t-transparent animate-spin mx-auto mb-4" />
              <p className="text-[12px]" style={{ color: 'rgba(120,170,230,0.4)' }}>Loading your report…</p>
            </div>
          </div>
        )}

        {data && (data.status === 'queued' || data.status === 'running') && (
          <LoadingView domain={data.domain} log={data.progress_log} />
        )}

        {data?.status === 'completed' && data.result && (
          <ReportView report={data.result} />
        )}

        {data?.status === 'failed' && (
          <FailedView domain={data.domain} />
        )}
      </main>

      <footer className="px-5 py-4 text-center">
        <p className="text-[10px]" style={{ color: 'rgba(70,115,185,0.25)', letterSpacing: '2px' }}>
          MAGIC LAB &copy; 2026
        </p>
      </footer>
    </div>
  )
}
