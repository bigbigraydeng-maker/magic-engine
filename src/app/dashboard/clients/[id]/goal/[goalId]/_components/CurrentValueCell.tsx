'use client'

/**
 * A2.1 — Current value cell for the Goal primary metric card.
 *
 * Auto-fetches current_value from /api/goals/[goalId]/fetch-current-value
 * when the metric has measurement='auto' (organic_traffic, brand_search_volume,
 * etc). Shows manual placeholder otherwise.
 *
 * Renders inside the Goal detail page's primary-metric card (4-column grid).
 */

import React, { useEffect, useState, useCallback } from 'react'
import { PRIMARY_METRIC_CATALOG } from '@/types/strategy'
import type { GoalRow } from '@/types/strategy'

// Silence "React unused" while keeping it in scope for JSX under vite-react in tests
void React

interface FetchSuccess {
  ok: true
  value: number
  source: string
  snapshot_date: string
  label: string
}

interface FetchFailure {
  ok: false
  reason: string
}

type FetchResponse = FetchSuccess | FetchFailure

interface Props {
  goal: GoalRow
}

export function CurrentValueCell({ goal }: Props) {
  const metricDef = PRIMARY_METRIC_CATALOG.find(m => m.key === goal.primary_metric_key)
  const isAuto = metricDef?.measurement === 'auto'

  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [result, setResult] = useState<FetchSuccess | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchValue = useCallback(async (manualRefresh: boolean) => {
    if (manualRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/goals/${goal.id}/fetch-current-value`, {
        cache: 'no-store',
      })
      const json = await res.json() as FetchResponse
      if (json.ok) {
        setResult(json)
      } else {
        setError(json.reason)
      }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [goal.id])

  // Auto-fetch on mount (only for auto-measurement metrics)
  useEffect(() => {
    if (!isAuto) return
    void fetchValue(false)
  }, [isAuto, fetchValue])

  // Manual / self_report path: show last-submitted-by-FDE value if any.
  // The judge endpoint stores it on the goal during early-submit / 90-day judge.
  // We hint how to update so PM/FDE knows where to enter it.
  if (!isAuto) {
    const hint = metricDef?.measurement === 'self_report'
      ? '客户自报 · 用「Submit Verdict」录入'
      : '手动填写'
    return (
      <div>
        <div className="text-[11px] font-black uppercase text-me-charcoal/45">Current</div>
        <div className="text-lg font-bold text-me-charcoal/40">—</div>
        <div className="text-[10px] font-semibold text-me-charcoal/45">{hint}</div>
      </div>
    )
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-1.5">
        <div className="text-[11px] font-black uppercase text-me-charcoal/45">Current</div>
        {result && !loading && (
          <button
            type="button"
            onClick={() => void fetchValue(true)}
            disabled={refreshing}
            title={`刷新自动获取（数据源: ${result.source}）`}
            className="text-[10px] text-me-charcoal/30 hover:text-me-ochre disabled:opacity-40"
          >
            {refreshing ? '⏳' : '↻'}
          </button>
        )}
      </div>

      {loading && (
        <>
          <div className="text-lg font-bold text-me-charcoal/40">…</div>
          <div className="text-[10px] font-semibold text-me-charcoal/45">获取中</div>
        </>
      )}

      {!loading && result && (
        <>
          <div className="text-lg font-bold text-me-charcoal">
            {result.value.toLocaleString()}
          </div>
          <div className="text-[10px] font-semibold text-me-ochre" title={result.label}>
            ⚡ {result.source}
          </div>
        </>
      )}

      {!loading && error && (
        <>
          <div className="text-lg font-bold text-me-charcoal/40">—</div>
          <div className="text-[10px] font-semibold text-me-charcoal/45" title={error}>
            未获取到 · <button
              type="button"
              onClick={() => void fetchValue(true)}
              className="underline hover:text-me-ochre"
            >
              重试
            </button>
          </div>
        </>
      )}
    </div>
  )
}
