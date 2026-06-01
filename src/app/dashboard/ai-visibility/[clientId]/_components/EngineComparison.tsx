'use client';

import type { AiVisibilityRun } from '@/types/magic-engine';
import { getEngineDisplayName } from '@/lib/ai-tracker/engine-display-names';

// Tailwind-safe colour maps per engine
const ENGINE_CARD_STYLE: Record<string, string> = {
  openai: 'border-[#5C8A4A]/30 bg-[#5C8A4A]/10 text-[#5C8A4A]',
  google: 'border-me-ochre/30 bg-me-ochre/10 text-me-ochre',
  perplexity: 'border-me-ochre/30 bg-me-ochre/10 text-me-ochre',
  anthropic: 'border-me-ochre/30 bg-me-ochre/10 text-me-ochre',
};

const ENGINE_BADGE_STYLE: Record<string, string> = {
  openai: 'bg-[#5C8A4A]/12 text-[#5C8A4A]',
  google: 'bg-me-ochre/10 text-me-ochre',
  perplexity: 'bg-me-ochre/10 text-me-ochre',
  anthropic: 'bg-me-ochre/10 text-me-ochre',
};

interface Props {
  runs: AiVisibilityRun[];
  brandName: string;
}

/**
 * Tab 2: Engine Comparison
 * Side-by-side performance stats per AI engine (display names per CLAUDE.md §三).
 * Reference: ROADMAP.md P7.1.14
 */
export function EngineComparison({ runs, brandName }: Props) {
  if (runs.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-black/10 py-16 text-center">
        <p className="text-me-charcoal/45 text-sm">No run data yet. Click ▶ Run Now to start.</p>
      </div>
    );
  }

  const engines = Array.from(new Set(runs.map(r => r.ai_engine))).sort();

  const stats = engines.map(engine => {
    const engineRuns = runs.filter(r => r.ai_engine === engine);
    const successful = engineRuns.filter(r => !r.error_message);
    const withMention = successful.filter(r => r.client_brand_rank != null);
    const ranks = withMention.map(r => r.client_brand_rank as number);
    const avgRank = ranks.length > 0
      ? ranks.reduce((a, b) => a + b, 0) / ranks.length
      : null;
    const avgLatency = successful.length > 0
      ? successful.reduce((a, r) => a + (r.latency_ms ?? 0), 0) / successful.length
      : null;
    return {
      engine,
      total: engineRuns.length,
      success: successful.length,
      mentionCount: withMention.length,
      mentionRate: successful.length > 0 ? (withMention.length / successful.length) * 100 : 0,
      avgRank,
      avgLatency,
      errors: engineRuns.filter(r => r.error_message).length,
    };
  });

  void brandName; // displayed via stats, not directly used in JSX

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {stats.map(s => (
          <div
            key={s.engine}
            className={`rounded-xl border p-5 ${ENGINE_CARD_STYLE[s.engine] ?? 'border-black/10 bg-white text-me-charcoal/90'}`}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">{getEngineDisplayName(s.engine)}</h3>
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${ENGINE_BADGE_STYLE[s.engine] ?? 'bg-me-ivory text-me-charcoal/60'}`}>
                {s.total} runs
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs opacity-60 mb-0.5">Success Rate</p>
                <p className="text-2xl font-bold">
                  {s.total > 0 ? `${((s.success / s.total) * 100).toFixed(0)}%` : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs opacity-60 mb-0.5">Brand Mention Rate</p>
                <p className="text-2xl font-bold">
                  {s.mentionRate.toFixed(0)}%
                </p>
                <p className="text-xs opacity-50">{s.mentionCount}/{s.success} queries</p>
              </div>
              <div>
                <p className="text-xs opacity-60 mb-0.5">Avg Brand Rank</p>
                <p className="text-2xl font-bold">
                  {s.avgRank != null ? `#${s.avgRank.toFixed(1)}` : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs opacity-60 mb-0.5">Avg Response Time</p>
                <p className="text-2xl font-bold">
                  {s.avgLatency != null ? `${(s.avgLatency / 1000).toFixed(1)}s` : '—'}
                </p>
              </div>
            </div>
            {s.errors > 0 && (
              <p className="text-xs mt-3 opacity-50">
                {s.errors} error{s.errors > 1 ? 's' : ''} excluded from stats
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Recent run log */}
      <div className="bg-white rounded-xl border border-black/10 overflow-hidden">
        <div className="px-5 py-4 border-b border-black/[.06]">
          <h3 className="text-sm font-semibold text-me-charcoal/90">Recent Run Log</h3>
          <p className="text-xs text-me-charcoal/45 mt-0.5">Last {Math.min(runs.length, 30)} entries</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-me-ivory border-b border-black/[.06]">
                <th className="text-left px-4 py-2 text-me-charcoal/55 font-semibold uppercase tracking-wider">Engine</th>
                <th className="text-left px-4 py-2 text-me-charcoal/55 font-semibold uppercase tracking-wider">Model</th>
                <th className="text-left px-4 py-2 text-me-charcoal/55 font-semibold uppercase tracking-wider">Brand Rank</th>
                <th className="text-left px-4 py-2 text-me-charcoal/55 font-semibold uppercase tracking-wider">Brands Found</th>
                <th className="text-left px-4 py-2 text-me-charcoal/55 font-semibold uppercase tracking-wider">Latency</th>
                <th className="text-left px-4 py-2 text-me-charcoal/55 font-semibold uppercase tracking-wider">Time</th>
                <th className="text-left px-4 py-2 text-me-charcoal/55 font-semibold uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[.06]">
              {runs.slice(0, 30).map(run => (
                <tr key={run.id} className={run.error_message ? 'bg-[#C2453A]/10' : 'hover:bg-me-ivory'}>
                  <td className="px-4 py-2.5">
                    <span className={`font-medium ${ENGINE_BADGE_STYLE[run.ai_engine] ?? ''} px-2 py-0.5 rounded`}>
                      {getEngineDisplayName(run.ai_engine)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-me-charcoal/55">{run.ai_model}</td>
                  <td className="px-4 py-2.5">
                    {run.client_brand_rank != null ? (
                      <span className="text-me-ochre font-bold">#{run.client_brand_rank}</span>
                    ) : (
                      <span className="text-me-charcoal/35">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-me-charcoal/60">
                    {Array.isArray(run.brands_mentioned) ? run.brands_mentioned.length : 0}
                  </td>
                  <td className="px-4 py-2.5 text-me-charcoal/60">
                    {run.latency_ms != null ? `${(run.latency_ms / 1000).toFixed(1)}s` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-me-charcoal/45">
                    {run.ran_at ? new Date(run.ran_at).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    {run.error_message ? (
                      <span className="text-[#C2453A]" title={run.error_message}>❌</span>
                    ) : (
                      <span className="text-[#5C8A4A]">✓</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
