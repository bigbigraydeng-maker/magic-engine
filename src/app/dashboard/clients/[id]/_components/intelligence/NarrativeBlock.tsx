/**
 * NarrativeBlock — lazy-loads and displays the AI monthly data narrative.
 *
 * Shown at the bottom of IntelligenceSummarySection (full variant only).
 *
 * Behaviour:
 *   - Does NOT auto-load on mount (lazy). FDE clicks "Generate AI Summary" to trigger.
 *   - Once loaded, shows the narrative paragraph with a small "Regenerate" button.
 *   - Calls GET /api/clients/[id]/intelligence/narrative
 *   - Handles loading / error / no-data states gracefully.
 *
 * Phase 22.C.3
 */

'use client'

import { useState, useCallback } from 'react'

interface NarrativeBlockProps {
  clientId: string
}

type NarrativeState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; narrative: string; generatedAt: string }
  | { status: 'no_data' }
  | { status: 'error'; message: string }

export function NarrativeBlock({ clientId }: NarrativeBlockProps) {
  const [state, setState] = useState<NarrativeState>({ status: 'idle' })

  const generate = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/intelligence/narrative`)
      if (!res.ok) throw new Error(`Request failed: ${res.status}`)

      const data = await res.json() as {
        success: boolean
        narrative: string | null
        reason?: string
        generatedAt: string
        error?: string
      }

      if (!data.success) {
        setState({ status: 'error', message: data.error ?? 'Unknown error' })
        return
      }

      if (!data.narrative || data.reason === 'no_data') {
        setState({ status: 'no_data' })
        return
      }

      setState({ status: 'loaded', narrative: data.narrative, generatedAt: data.generatedAt })
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : 'Failed to generate' })
    }
  }, [clientId])

  // ── Idle ──────────────────────────────────────────────────────────────────
  if (state.status === 'idle') {
    return (
      <div className="mt-3 pt-3 border-t border-gray-100">
        <button
          onClick={generate}
          className="flex items-center gap-1.5 text-[11px] font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            />
          </svg>
          Generate AI Monthly Summary
        </button>
      </div>
    )
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (state.status === 'loading') {
    return (
      <div className="mt-3 pt-3 border-t border-gray-100">
        <div className="flex items-center gap-2 text-[11px] text-gray-400">
          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Strategy Engine is analysing 28-day performance…
        </div>
        <div className="mt-2 space-y-1.5">
          {[1, 2, 3].map(i => (
            <div key={i} className={`h-3 bg-gray-100 rounded animate-pulse ${i === 3 ? 'w-2/3' : 'w-full'}`} />
          ))}
        </div>
      </div>
    )
  }

  // ── No data ───────────────────────────────────────────────────────────────
  if (state.status === 'no_data') {
    return (
      <div className="mt-3 pt-3 border-t border-gray-100">
        <p className="text-[11px] text-gray-400 italic">
          Not enough data yet for an AI summary — check back after data pipelines run.
        </p>
      </div>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (state.status === 'error') {
    return (
      <div className="mt-3 pt-3 border-t border-gray-100">
        <p className="text-[11px] text-red-500">Summary unavailable: {state.message}</p>
        <button
          onClick={generate}
          className="mt-1 text-[11px] text-indigo-600 hover:underline"
        >
          Try again
        </button>
      </div>
    )
  }

  // ── Loaded ────────────────────────────────────────────────────────────────
  const generatedDate = new Date(state.generatedAt).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
  })

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[11px] font-semibold text-gray-600 flex items-center gap-1">
          <svg className="w-3 h-3 text-indigo-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
          </svg>
          AI Monthly Summary
        </h4>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400">{generatedDate}</span>
          <button
            onClick={generate}
            className="text-[10px] text-indigo-500 hover:text-indigo-700 hover:underline"
            title="Regenerate summary"
          >
            Regenerate
          </button>
        </div>
      </div>

      {/* Narrative paragraph */}
      <p className="text-[11px] text-gray-700 leading-relaxed">
        {state.narrative}
      </p>

      {/* Strategy Engine badge */}
      <p className="mt-1.5 text-[10px] text-gray-400">
        Generated by Strategy Engine
      </p>
    </div>
  )
}
