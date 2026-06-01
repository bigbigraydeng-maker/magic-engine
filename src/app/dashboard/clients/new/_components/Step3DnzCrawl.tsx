'use client'

import { useState } from 'react'
import { useSiteAuditPolling } from '@/hooks/useSiteAuditPolling'

export interface Step3Data {
  jobId: string | null
  totalPages: number
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped'
}

interface Props {
  clientId: string
  domain: string
  initial: Step3Data
  onComplete: (data: Step3Data) => void
  onSkip: () => void
  onBack: () => void
}

export default function Step3DnzCrawl({
  clientId,
  domain,
  initial,
  onComplete,
  onSkip,
  onBack,
}: Props) {
  const [jobId, setJobId] = useState<string | null>(initial.jobId)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { status } = useSiteAuditPolling(clientId, { enabled: jobId !== null })

  const job = status?.job
  const progressPercent = status?.progressPercent ?? 0
  const etaSec = status?.etaSec
  const isTerminal = job?.status === 'completed' || job?.status === 'failed'
  const isInProgress = job?.status === 'pending' || job?.status === 'in_progress'

  const startCrawl = async (force = false) => {
    setStarting(true)
    setError(null)
    if (force) setJobId(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/site-audit/crawl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxPages: 100, force }),
      })
      const json = await res.json()
      if (!res.ok) {
        // 409: existing job still in progress — reuse its jobId
        if (res.status === 409 && json.jobId) {
          setJobId(json.jobId)
          return
        }
        throw new Error(json.error ?? `HTTP ${res.status}`)
      }
      setJobId(json.jobId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start crawl')
    } finally {
      setStarting(false)
    }
  }

  const handleContinue = () => {
    onComplete({
      jobId,
      totalPages: job?.total_pages_classified ?? 0,
      status: job?.status === 'completed' ? 'completed' : 'failed',
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-me-charcoal/90 mb-1">Site Audit (DNZ Crawl)</h2>
        <p className="text-me-charcoal/60 text-sm">
          We&apos;ll crawl <span className="font-mono text-me-charcoal/75">{domain}</span> to map
          existing content. This typically takes 2–5 minutes for up to 100 pages.
        </p>
      </div>

      {!jobId && !starting && (
        <div className="text-center py-8">
          <button
            type="button"
            onClick={() => startCrawl()}
            className="px-8 py-3 bg-me-ochre hover:bg-me-ochre text-white font-semibold rounded-lg"
          >
            ▶ Start Crawl
          </button>
        </div>
      )}

      {starting && (
        <div className="text-center py-8 text-me-charcoal/55 text-sm">Starting crawl…</div>
      )}

      {jobId && job && (
        <div className="bg-me-ivory border border-black/10 rounded-lg p-5 space-y-4">
          {/* Status row */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-me-charcoal/75">
              Status:{' '}
              <span
                className={
                  job.status === 'completed'
                    ? 'text-[#5C8A4A]'
                    : job.status === 'failed'
                      ? 'text-[#C2453A]'
                      : 'text-me-ochre'
                }
              >
                {job.status}
              </span>
            </span>
            {etaSec != null && etaSec > 0 && (
              <span className="text-xs text-me-charcoal/55">
                ~{Math.ceil(etaSec / 60)} min remaining
              </span>
            )}
          </div>

          {/* Progress bar */}
          <div className="w-full bg-me-stone rounded-full h-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                job.status === 'failed' ? 'bg-[#C2453A]/70' : 'bg-me-ochre'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Counts */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xs text-me-charcoal/55">Discovered</p>
              <p className="text-xl font-bold text-me-charcoal/90">
                {job.total_urls_discovered ?? 0}
              </p>
            </div>
            <div>
              <p className="text-xs text-me-charcoal/55">Crawled</p>
              <p className="text-xl font-bold text-me-charcoal/90">
                {job.total_pages_classified ?? 0}
              </p>
            </div>
            <div>
              <p className="text-xs text-me-charcoal/55">GEO Detected</p>
              <p className="text-xl font-bold text-[#5C8A4A]">
                {status?.geoDetectedCount ?? 0}
              </p>
            </div>
          </div>

          {job.error_message && (
            <div className="p-3 bg-[#C2453A]/10 border border-[#C2453A]/30 rounded text-xs text-[#C2453A]">
              {job.error_message}
            </div>
          )}

          {isTerminal && (
            <button
              type="button"
              onClick={() => startCrawl(true)}
              disabled={starting}
              className="text-xs text-me-ochre hover:text-me-ochre underline disabled:opacity-50"
            >
              {starting ? 'Starting…' : '↺ Re-crawl'}
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="p-3 bg-[#C2453A]/10 border border-[#C2453A]/30 rounded-lg text-sm text-[#C2453A]">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between pt-4">
        <button
          type="button"
          onClick={onBack}
          className="px-6 py-3 text-me-charcoal/60 hover:text-me-charcoal/90 font-medium"
        >
          ← Back
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSkip}
            className="px-6 py-3 text-me-charcoal/60 hover:text-me-charcoal/90 font-medium border border-black/15 rounded-lg"
          >
            Skip crawl
          </button>
          <button
            type="button"
            onClick={handleContinue}
            disabled={!isTerminal && isInProgress}
            className="px-6 py-3 bg-me-ochre hover:bg-me-ochre disabled:bg-me-stone disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
          >
            Continue to Step 4 →
          </button>
        </div>
      </div>
    </div>
  )
}
