'use client';

import type { AiVisibilityRun } from '@/types/magic-engine';
import { getEngineDisplayName } from '@/lib/ai-tracker/engine-display-names';

interface Props {
  runs: AiVisibilityRun[];
  brandName: string;
}

/**
 * Tab 3: By AI Model
 * Technical breakdown per model — token usage, cost, latency, brand detection rate.
 * Reference: ROADMAP.md P7.1.15
 */
export function ModelStats({ runs, brandName }: Props) {
  void brandName;

  const models = Array.from(new Set(runs.map(r => r.ai_model))).sort();

  if (models.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-black/10 py-16 text-center">
        <p className="text-me-charcoal/45 text-sm">No run data yet. Click ▶ Run Now to start.</p>
      </div>
    );
  }

  const stats = models.map(model => {
    const modelRuns = runs.filter(r => r.ai_model === model);
    const successful = modelRuns.filter(r => !r.error_message);
    const withMention = successful.filter(r => r.client_brand_rank != null);
    const ranks = withMention.map(r => r.client_brand_rank as number);
    const avgRank = ranks.length > 0
      ? ranks.reduce((a, b) => a + b, 0) / ranks.length
      : null;
    const avgLatency = successful.length > 0
      ? successful.reduce((a, r) => a + (r.latency_ms ?? 0), 0) / successful.length
      : null;
    const totalCost = successful.reduce((a, r) => a + (r.cost_usd ?? 0), 0);
    const totalTokens = successful.reduce((a, r) => a + (r.tokens_used ?? 0), 0);
    const avgTokens = successful.length > 0 ? totalTokens / successful.length : null;
    const engine = modelRuns[0]?.ai_engine ?? 'unknown';
    return {
      model,
      engine,
      total: modelRuns.length,
      success: successful.length,
      mentionRate: successful.length > 0 ? (withMention.length / successful.length) * 100 : 0,
      avgRank,
      avgLatency,
      totalCost,
      avgTokens,
    };
  });

  return (
    <div className="bg-white rounded-xl border border-black/10 overflow-hidden">
      <div className="px-5 py-4 border-b border-black/[.06]">
        <h2 className="text-base font-semibold text-me-charcoal/90">By AI Model</h2>
        <p className="text-xs text-me-charcoal/45 mt-0.5">
          Performance, cost, and latency breakdown per underlying model
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-me-ivory border-b border-black/[.06]">
              <th className="text-left px-5 py-3 text-xs font-semibold text-me-charcoal/55 uppercase tracking-wider">Model</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-me-charcoal/55 uppercase tracking-wider">Platform</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-me-charcoal/55 uppercase tracking-wider">Runs</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-me-charcoal/55 uppercase tracking-wider">Success</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-me-charcoal/55 uppercase tracking-wider">Brand Rate</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-me-charcoal/55 uppercase tracking-wider">Avg Rank</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-me-charcoal/55 uppercase tracking-wider">Avg Latency</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-me-charcoal/55 uppercase tracking-wider">Avg Tokens</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-me-charcoal/55 uppercase tracking-wider">Total Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[.06]">
            {stats.map(s => (
              <tr key={s.model} className="hover:bg-me-ivory">
                <td className="px-5 py-4">
                  <span className="font-mono text-xs bg-me-ivory text-me-charcoal/75 px-2 py-1 rounded">
                    {s.model}
                  </span>
                </td>
                <td className="px-5 py-4 text-sm text-me-charcoal/75">
                  {getEngineDisplayName(s.engine)}
                </td>
                <td className="px-5 py-4 text-sm text-me-charcoal/75">{s.total}</td>
                <td className="px-5 py-4 text-sm">
                  <span className={s.success === s.total ? 'text-[#5C8A4A] font-medium' : 'text-me-ochre font-medium'}>
                    {s.total > 0 ? `${((s.success / s.total) * 100).toFixed(0)}%` : '—'}
                  </span>
                </td>
                <td className="px-5 py-4 text-sm text-me-charcoal/75">{s.mentionRate.toFixed(0)}%</td>
                <td className="px-5 py-4 text-sm font-semibold text-me-ochre">
                  {s.avgRank != null ? `#${s.avgRank.toFixed(1)}` : '—'}
                </td>
                <td className="px-5 py-4 text-sm text-me-charcoal/60">
                  {s.avgLatency != null ? `${(s.avgLatency / 1000).toFixed(1)}s` : '—'}
                </td>
                <td className="px-5 py-4 text-sm text-me-charcoal/60">
                  {s.avgTokens != null ? s.avgTokens.toFixed(0) : '—'}
                </td>
                <td className="px-5 py-4 text-sm font-mono text-me-charcoal/60">
                  ${s.totalCost.toFixed(4)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
