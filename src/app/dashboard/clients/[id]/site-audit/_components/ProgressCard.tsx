/**
 * ProgressCard Component
 *
 * Pure display component for site audit job progress.
 * Receives all data via props — no direct hook calls.
 *
 * States handled:
 *  - isLoading: skeleton screen
 *  - error:     error banner
 *  - job=null:  empty state
 *  - pending:   gray bar, "Starting..."
 *  - in_progress: blue bar, percentage, ETA, 4 metrics
 *  - completed: green terminal state, metrics
 *  - failed:    red terminal state, error message, metrics
 */

'use client'

import React from 'react'

// ---------------------------------------------------------------------------
// Types (exported so consumers and tests can import them)
// ---------------------------------------------------------------------------

export type JobStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

export interface SiteAuditJob {
  id: string
  client_id: string
  domain: string
  status: JobStatus
  total_pages: number
  crawled_pages: number
  classified_pages: number
  geo_detected: number
  error_count: number
  error_message?: string
  created_at: string
  updated_at: string
}

export interface ProgressCardProps {
  job: SiteAuditJob | null
  isLoading: boolean
  error: string | null
  onViewPages?: () => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<JobStatus, string> = {
  pending: 'Starting...',
  in_progress: 'In Progress',
  completed: 'Job Completed',
  failed: 'Job Failed',
}

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

/**
 * Calculate crawl progress as a 0–100 integer.
 * Returns 0 for pending, 100 for completed, computed value for in_progress.
 */
function calcProgressPercent(job: SiteAuditJob): number {
  if (job.status === 'completed') return 100
  if (job.status !== 'in_progress') return 0
  if (job.total_pages <= 0) return 0
  const pct = (job.crawled_pages / job.total_pages) * 100
  return Math.min(Math.max(Math.round(pct), 0), 100)
}

/**
 * Estimate seconds remaining based on crawl rate.
 * Uses created_at as proxy for job start time.
 * Returns null when rate cannot be computed.
 */
function calcEtaText(job: SiteAuditJob): string | null {
  if (job.status !== 'in_progress') return null

  const elapsedSec = (Date.now() - new Date(job.created_at).getTime()) / 1000
  if (elapsedSec <= 0 || job.crawled_pages <= 0 || job.total_pages <= 0) {
    return 'Calculating...'
  }

  const rate = job.crawled_pages / elapsedSec
  const remainingPages = job.total_pages - job.crawled_pages

  if (remainingPages <= 0) return null

  const remainingSec = Math.round(remainingPages / rate)
  const minutes = Math.floor(remainingSec / 60)
  const seconds = remainingSec % 60

  const minLabel = minutes === 1 ? 'minute' : 'minutes'
  const secLabel = seconds === 1 ? 'second' : 'seconds'

  return `Estimated ${minutes} ${minLabel} ${seconds} ${secLabel} remaining`
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SkeletonCard(): React.ReactElement {
  return (
    <div data-testid="progress-card-skeleton" className="rounded-xl border border-gray-200 bg-white p-6 animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-1/3 mb-4" />
      <div className="h-3 bg-gray-200 rounded w-full mb-2" />
      <div className="h-3 bg-gray-200 rounded w-2/3 mb-6" />
      <div className="grid grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-10 bg-gray-200 rounded" />
        ))}
      </div>
    </div>
  )
}

interface MetricItemProps {
  testId: string
  label: string
  value: number
}

function MetricItem({ testId, label, value }: MetricItemProps): React.ReactElement {
  return (
    <div className="flex flex-col items-center gap-1">
      <span data-testid={testId} className="text-2xl font-bold text-gray-900">
        {value}
      </span>
      <span className="text-xs text-gray-500">{label}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ProgressCard({ job, isLoading, error, onViewPages }: ProgressCardProps): React.ReactElement {
  // -- Loading state --
  if (isLoading) {
    return <SkeletonCard />
  }

  // -- Error state --
  if (error) {
    return (
      <div data-testid="progress-card-error" className="rounded-xl border border-red-200 bg-red-50 p-6">
        <p className="text-sm text-red-700">{error}</p>
      </div>
    )
  }

  // -- Empty state --
  if (!job) {
    return (
      <div data-testid="progress-card-empty" className="rounded-xl border border-gray-200 bg-white p-6 text-center">
        <p className="text-sm text-gray-500">No job in progress</p>
      </div>
    )
  }

  // -- Job state --
  const percent = calcProgressPercent(job)
  const etaText = calcEtaText(job)
  const isTerminal = job.status === 'completed' || job.status === 'failed'

  const cardColorClass =
    job.status === 'completed'
      ? 'bg-green-50 border-green-200'
      : job.status === 'failed'
        ? 'bg-red-50 border-red-200'
        : 'bg-white border-gray-200'

  const progressBarColorClass =
    job.status === 'in_progress' ? 'bg-blue-500' : 'bg-gray-300'

  return (
    <div
      data-testid="progress-card-content"
      className={`rounded-xl border p-6 ${cardColorClass}`}
    >
      {/* Header: domain + status label */}
      <div className="flex items-center justify-between mb-4">
        <span data-testid="progress-card-domain" className="text-sm font-semibold text-gray-700">
          {job.domain}
        </span>
        {!isTerminal && (
          <span data-testid="progress-status-label" className="text-xs text-gray-500">
            {STATUS_LABEL[job.status]}
          </span>
        )}
      </div>

      {/* Terminal message (completed / failed) */}
      {isTerminal && (
        <div className="mb-4">
          <p data-testid="progress-terminal-message" className="text-sm font-semibold">
            {job.status === 'completed' ? '✓ ' : '✗ '}
            {STATUS_LABEL[job.status]}
          </p>
          {job.error_message && (
            <p data-testid="progress-error-message" className={`text-xs mt-1 ${job.status === 'failed' ? 'text-red-600' : 'text-amber-600'}`}>
              {job.error_message}
            </p>
          )}
        </div>
      )}

      {/* Progress bar (only for non-terminal states) */}
      {!isTerminal && (
        <div className="mb-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500">Progress</span>
            <span data-testid="progress-percent-text" className="text-xs font-medium text-gray-700">
              {percent}%
            </span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div
              data-testid="progress-bar-fill"
              className={`h-2 rounded-full transition-all ${progressBarColorClass}`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}

      {/* ETA (only for in_progress) */}
      {etaText !== null && (
        <p data-testid="progress-eta" className="text-xs text-blue-600 mb-4">
          {etaText}
        </p>
      )}

      {/* 4 Metrics */}
      <div className="grid grid-cols-4 gap-4 mt-4 pt-4 border-t border-gray-100">
        <MetricItem testId="metric-crawled-pages" label="Crawled" value={job.crawled_pages} />
        <MetricItem testId="metric-classified-pages" label="Classified" value={job.classified_pages} />
        <MetricItem testId="metric-geo-detected" label="GEO Detected" value={job.geo_detected} />
        <MetricItem testId="metric-error-count" label="Errors" value={job.error_count} />
      </div>

      {/* CTA: only shown after successful completion */}
      {job.status === 'completed' && onViewPages && (
        <div className="mt-4 pt-4 border-t border-green-100">
          <button
            data-testid="btn-view-pages"
            onClick={onViewPages}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
          >
            查看页面清单
            <span aria-hidden="true">→</span>
          </button>
        </div>
      )}
    </div>
  )
}
