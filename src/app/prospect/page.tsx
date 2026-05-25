'use client'

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { ReportView } from '@/components/prospect/ProspectReportView'

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

const stages = [
  { label: 'Discovery scan', description: 'Reading website, search, social, and review signals.' },
  { label: 'Diagnosis model', description: 'Turning raw signals into business-facing priorities.' },
  { label: 'Report view', description: 'Preparing the ranked action plan preview.' },
]

function LogoMark() {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-950 text-sm font-black text-white">
      M
    </div>
  )
}

function PageShell({ children, reportReady = false }: { children: ReactNode; reportReady?: boolean }) {
  return (
    <main className="min-h-screen bg-[#f6f7f2] text-slate-950">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-[#f6f7f2]/90 px-5 py-5 backdrop-blur sm:px-8">
        <Link href="/" className="flex items-center gap-3">
          <LogoMark />
          <span className="text-sm font-bold">Magic Engine</span>
        </Link>
        <div className="flex items-center gap-3">
          {reportReady && (
            <span className="hidden rounded-lg bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-900 sm:inline-flex">
              Report ready
            </span>
          )}
          <Link href="/discover" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-950">
            New scan
          </Link>
        </div>
      </header>
      {children}
    </main>
  )
}

function StatusPill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-lg bg-cyan-100 px-3 py-1.5 text-xs font-bold text-cyan-950">
      {label}
    </span>
  )
}

function LoadingView({ domain, log }: { domain: string; log: LogEntry[] }) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const startRef = useRef(Date.now())
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [log.length])
  useEffect(() => {
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [])

  const progressPct = Math.min(92, Math.round((elapsed / 300) * 92))
  const elapsedLabel = elapsed >= 60
    ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
    : `${elapsed}s`
  const latestStep = log.length > 0 ? log[log.length - 1].message : 'Preparing scan...'

  return (
    <PageShell>
      <section className="grid gap-8 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_480px] lg:py-12">
        <div className="rounded-lg bg-slate-950 p-6 text-white sm:p-8">
          <StatusPill label={`Scanning ${domain}`} />
          <h1 className="mt-5 max-w-2xl text-4xl font-black leading-tight sm:text-5xl">
            Your Discovery Report is being built.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
            Magic Engine is gathering public signals and converting them into a ranked diagnosis.
            Most reports are ready in 3-5 minutes.
          </p>

          <div className="mt-8 rounded-lg border border-white/10 bg-white/[0.08] p-4">
            <div className="mb-3 flex items-center justify-between gap-4">
              <p className="text-sm font-bold text-white">{latestStep}</p>
              <p className="text-xs font-semibold text-cyan-100">{elapsedLabel}</p>
            </div>
            <div className="h-2 rounded-lg bg-white/10">
              <div className="h-2 rounded-lg bg-cyan-300 transition-all duration-1000" style={{ width: `${progressPct}%` }} />
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {stages.map((stage, index) => (
              <div key={stage.label} className="rounded-lg border border-white/10 bg-white/[0.06] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                  {String(index + 1).padStart(2, '0')}
                </p>
                <p className="mt-3 text-sm font-black text-white">{stage.label}</p>
                <p className="mt-2 text-xs leading-5 text-slate-400">{stage.description}</p>
              </div>
            ))}
          </div>
        </div>

        <aside className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="border-b border-slate-200 pb-4">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Live report feed</p>
            <h2 className="mt-2 text-2xl font-black">What we have found</h2>
          </div>
          <div className="mt-4 max-h-[520px] space-y-2 overflow-y-auto pr-1">
            {log.length === 0 && (
              <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
                Starting scan...
              </p>
            )}
            {log.map((entry, index) => (
              <div
                key={`${entry.ts}-${index}`}
                className={`rounded-lg border px-3 py-3 ${
                  entry.type === 'discovery'
                    ? 'border-cyan-200 bg-cyan-50'
                    : 'border-slate-200 bg-slate-50'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-bold leading-5 text-slate-900">{entry.message}</p>
                  <span className="text-xs font-bold text-slate-400">{entry.type === 'discovery' ? 'Found' : 'Step'}</span>
                </div>
                {entry.detail && <p className="mt-1 text-xs leading-5 text-slate-500">{entry.detail}</p>}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </aside>
      </section>
    </PageShell>
  )
}

function EmptyView() {
  return (
    <PageShell>
      <section className="mx-auto max-w-2xl px-5 py-20 text-center sm:px-8">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">No report found</p>
        <h1 className="mt-3 text-4xl font-black tracking-normal">Start a fresh Discovery Report.</h1>
        <p className="mt-4 text-base leading-7 text-slate-600">
          We could not find a report linked to this signed-in email. Start a new scan and we will send a secure report link.
        </p>
        <Link href="/discover" className="mt-8 inline-flex h-12 items-center rounded-lg bg-slate-950 px-5 text-sm font-black text-white">
          Start free diagnosis
        </Link>
      </section>
    </PageShell>
  )
}

function FailedView({ domain }: { domain: string }) {
  return (
    <PageShell>
      <section className="mx-auto max-w-2xl px-5 py-20 text-center sm:px-8">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-red-600">Scan failed</p>
        <h1 className="mt-3 text-4xl font-black tracking-normal">We could not complete this scan.</h1>
        <p className="mt-4 text-base leading-7 text-slate-600">
          Something blocked the scan for {domain}. This can happen with very new domains or strict site protection.
        </p>
        <Link href="/discover" className="mt-8 inline-flex h-12 items-center rounded-lg bg-slate-950 px-5 text-sm font-black text-white">
          Try again
        </Link>
      </section>
    </PageShell>
  )
}

function InitialLoadingView() {
  return (
    <PageShell>
      <section className="flex min-h-[520px] items-center justify-center px-5">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-950" />
          <p className="text-sm font-semibold text-slate-500">Loading your report...</p>
        </div>
      </section>
    </PageShell>
  )
}

export default function ProspectPage() {
  const [data, setData] = useState<ReportResponse | null>(null)
  const [notFound, setNotFound] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch('/api/prospect/report', { cache: 'no-store' })
        if (res.status === 404) {
          setNotFound(true)
          if (pollRef.current) clearInterval(pollRef.current)
          return
        }
        if (!res.ok) return
        const json = await res.json() as ReportResponse
        setData(json)

        if (json.status === 'completed' || json.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current)
        }
      } catch {
        // Keep polling after transient network errors.
      }
    }

    void poll()
    pollRef.current = setInterval(poll, 3000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  if (notFound) return <EmptyView />
  if (!data) return <InitialLoadingView />
  if (data.status === 'queued' || data.status === 'running') {
    return <LoadingView domain={data.domain} log={data.progress_log} />
  }
  if (data.status === 'failed') return <FailedView domain={data.domain} />
  if (data.status === 'completed' && data.result) {
    return (
      <PageShell reportReady>
        <ReportView report={data.result} />
      </PageShell>
    )
  }

  return <EmptyView />
}
