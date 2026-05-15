'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import type { AiVisibilityQuery, AiVisibilityRun } from '@/types/magic-engine';

const CATEGORY_LABELS: Record<string, string> = {
  comparison: 'Comparison',
  how_to: 'How-To',
  recommendation: 'Recommendation',
  decision: 'Decision',
  discovery: 'Discovery',
};

const MARKET_LABELS: Record<string, string> = {
  au: '🇦🇺 AU',
  nz: '🇳🇿 NZ',
  'au-nz': '🇦🇺🇳🇿 AU/NZ',
  global: '🌍 Global',
};

interface Props {
  clientId: string;
  queries: AiVisibilityQuery[];
  runs: AiVisibilityRun[];
  onRefresh: () => Promise<void>;
}

/**
 * Tab 4: Queries Manager
 * List + toggle AI Visibility queries. Questions are sourced from the
 * Zhangqian discovery run (P8.12.S1.8) — the legacy "Generate Questions"
 * button was removed in favour of a single source of truth.
 * Reference: ROADMAP.md P7.1.16, P8.12.S1.8
 */
export function QueriesManager({ clientId, queries, runs, onRefresh }: Props) {
  const [toggling, setToggling] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Build quick lookup: query_id → last run result
  const lastRunByQuery = new Map<string, AiVisibilityRun>();
  runs.forEach(run => {
    if (!lastRunByQuery.has(run.query_id)) {
      lastRunByQuery.set(run.query_id, run);
    }
  });

  const handleToggle = useCallback(async (query: AiVisibilityQuery) => {
    setToggling(query.id);
    setError('');
    try {
      const res = await fetch(`/api/ai-tracker/queries/${query.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !query.enabled }),
      });
      if (!res.ok) throw new Error('Failed to update');
      await onRefresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Toggle failed');
    } finally {
      setToggling(null);
    }
  }, [onRefresh]);

  const enabled = queries.filter(q => q.enabled);
  const disabled = queries.filter(q => !q.enabled);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
            {enabled.length} enabled
          </span>
          {disabled.length > 0 && (
            <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">
              {disabled.length} disabled
            </span>
          )}
        </div>
        <span className="text-xs text-gray-400">问句来源于张骞 Discovery,自动同步</span>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Empty state */}
      {queries.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 py-16 text-center space-y-3">
          <p className="text-gray-500 text-sm font-medium">还没有追踪问句</p>
          <p className="text-gray-400 text-xs max-w-md mx-auto leading-relaxed">
            AI Visibility 的追踪问句来源于<strong className="text-gray-600">张骞 Discovery</strong>——
            先去给该客户跑一次 discovery 并确认报告,问句会自动同步过来。
          </p>
          <Link
            href={`/dashboard/clients/${clientId}/zhangqian`}
            className="inline-flex items-center gap-1.5 mt-2 text-xs font-medium text-indigo-600 hover:text-indigo-700"
          >
            前往张骞 Discovery →
          </Link>
        </div>
      )}

      {/* Query list */}
      {queries.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">
              Questions ({queries.length})
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Toggle to include/exclude from the next Run. Last rank shown for enabled queries.
            </p>
          </div>
          <div className="divide-y divide-gray-50">
            {queries.map(query => {
              const lastRun = lastRunByQuery.get(query.id);
              const isToggling = toggling === query.id;
              return (
                <div
                  key={query.id}
                  className={`flex items-start gap-4 px-5 py-3.5 ${!query.enabled ? 'opacity-50' : ''}`}
                >
                  {/* Toggle */}
                  <button
                    onClick={() => handleToggle(query)}
                    disabled={isToggling}
                    title={query.enabled ? 'Disable this question' : 'Enable this question'}
                    className={`flex-shrink-0 mt-0.5 w-9 h-5 rounded-full transition-colors relative ${
                      query.enabled ? 'bg-indigo-600' : 'bg-gray-300'
                    } disabled:opacity-50`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                        query.enabled ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>

                  {/* Question text */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 leading-snug">{query.question}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {query.market_tag && (
                        <span className="text-xs text-gray-400">
                          {MARKET_LABELS[query.market_tag] ?? query.market_tag}
                        </span>
                      )}
                      <span className="text-xs text-gray-300">·</span>
                      <span className="text-xs text-gray-400 capitalize">{query.source}</span>
                      {query.notes && (
                        <>
                          <span className="text-xs text-gray-300">·</span>
                          <span className="text-xs text-gray-400 italic truncate max-w-xs">{query.notes}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Last run result */}
                  <div className="flex-shrink-0 text-right min-w-[80px]">
                    {lastRun ? (
                      lastRun.error_message ? (
                        <span className="text-xs text-red-500" title={lastRun.error_message}>❌ Error</span>
                      ) : lastRun.client_brand_rank != null ? (
                        <div>
                          <span className="text-sm font-bold text-amber-700">#{lastRun.client_brand_rank}</span>
                          <p className="text-xs text-gray-400">
                            {CATEGORY_LABELS[lastRun.ai_engine] ?? lastRun.ai_engine}
                          </p>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">Not ranked</span>
                      )
                    ) : (
                      <span className="text-xs text-gray-300">No data</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
