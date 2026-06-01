/**
 * IntelligenceSummarySection — Data Intelligence dashboard widget.
 *
 * Fetches /intelligence/summary and /intelligence/insights in parallel
 * and renders:
 *   variant='full'    — 7 TrendCards grid + full InsightList
 *   variant='compact' — 3 TrendCards (top 3 spotlight) + InsightList (top 3)
 *
 * Phase 22.B.7
 */

'use client'

import { useEffect, useState, useCallback } from 'react'
import { TrendCard } from './TrendCard'
import { InsightList } from './InsightList'
import type { MetricSummaryTile, InsightCard } from '@/lib/flywheel/intelligence/types'

// ─── API shapes ───────────────────────────────────────────────────────────────

interface SummaryResponse {
  success: boolean
  tiles:   MetricSummaryTile[]
}

interface InsightsResponse {
  success:  boolean
  insights: InsightCard[]
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface IntelligenceSummarySectionProps {
  clientId: string
  variant?: 'full' | 'compact'
}

// ─── Component ───────────────────────────────────────────────────────────────

export function IntelligenceSummarySection({
  clientId,
  variant = 'full',
}: IntelligenceSummarySectionProps) {
  const [tiles,    setTiles]    = useState<MetricSummaryTile[]>([])
  const [insights, setInsights] = useState<InsightCard[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [summaryRes, insightsRes] = await Promise.all([
        fetch(`/api/clients/${clientId}/intelligence/summary`),
        fetch(`/api/clients/${clientId}/intelligence/insights`),
      ])

      if (!summaryRes.ok) throw new Error(`Summary fetch failed: ${summaryRes.status}`)
      if (!insightsRes.ok) throw new Error(`Insights fetch failed: ${insightsRes.status}`)

      const summaryData:  SummaryResponse  = await summaryRes.json()
      const insightsData: InsightsResponse = await insightsRes.json()

      setTiles(summaryData.tiles ?? [])
      setInsights(insightsData.insights ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load intelligence data')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) {
    return <IntelligenceSkeleton variant={variant} />
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-xs text-red-600">
        Data Intelligence unavailable: {error}
      </div>
    )
  }

  // ── No data state ─────────────────────────────────────────────────────────
  const hasData = tiles.some(t => t.currentValue !== null)
  if (!hasData) {
    return (
      <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-xs text-gray-500">
        Data Intelligence is collecting data — check back after the first daily sync runs.
      </div>
    )
  }

  const visibleTiles    = variant === 'compact' ? tiles.slice(0, 3) : tiles
  const insightLimit    = variant === 'compact' ? 3 : undefined

  return (
    <section aria-label="Data Intelligence">
      {/* Section header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-800">
          {variant === 'full' ? 'Data Intelligence' : 'Key Signals'}
        </h3>
        {insights.length > 0 && (
          <span className="text-[10px] text-gray-400">
            {insights.length} insight{insights.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* TrendCard grid */}
      {visibleTiles.length > 0 && (
        <div
          className={
            variant === 'full'
              ? 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-4'
              : 'grid grid-cols-3 gap-2 mb-3'
          }
        >
          {visibleTiles.map(tile => (
            <TrendCard key={tile.metricKey} tile={tile} />
          ))}
        </div>
      )}

      {/* InsightList */}
      {insights.length > 0 && (
        <div>
          {variant === 'full' && (
            <h4 className="text-xs font-semibold text-gray-600 mb-2">Insights</h4>
          )}
          <InsightList insights={insights} limit={insightLimit} />
        </div>
      )}
    </section>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function IntelligenceSkeleton({ variant }: { variant: 'full' | 'compact' }) {
  const count = variant === 'compact' ? 3 : 7

  return (
    <section aria-label="Data Intelligence loading" aria-busy>
      <div className="flex items-center gap-2 mb-3">
        <div className="h-4 w-32 bg-gray-100 rounded animate-pulse" />
      </div>

      <div
        className={
          variant === 'full'
            ? 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-4'
            : 'grid grid-cols-3 gap-2 mb-3'
        }
      >
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="h-16 rounded-lg bg-gray-50 animate-pulse" />
        ))}
      </div>

      {variant === 'full' && (
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-10 rounded-lg bg-gray-50 animate-pulse" />
          ))}
        </div>
      )}
    </section>
  )
}
