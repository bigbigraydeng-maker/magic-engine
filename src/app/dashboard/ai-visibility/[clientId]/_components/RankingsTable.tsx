'use client';

import type { AiVisibilitySnapshot } from '@/types/magic-engine';
import { getEngineDisplayName } from '@/lib/ai-tracker/engine-display-names';

interface BrandEntry {
  name: string;
  mentions: number;
  avg_rank: number | null;
  by_engine: Record<string, number[]>;
}

interface Props {
  snapshot: AiVisibilitySnapshot | null;
  brandName: string;
}

/** Loose brand match: handles "CTS Tours" vs "CTS" etc. */
function isClientBrand(rowName: string, clientBrand: string): boolean {
  const a = rowName.toLowerCase().trim();
  const b = clientBrand.toLowerCase().trim();
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * Tab 1: Rankings Table
 * Displays the weekly snapshot ranking_table — all brands mentioned across
 * all queries this week, sorted by mention count.
 * Reference: ROADMAP.md P7.1.13
 */
export function RankingsTable({ snapshot, brandName }: Props) {
  if (!snapshot) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 py-16 text-center space-y-1">
        <p className="text-gray-500 text-sm font-medium">No ranking data yet</p>
        <p className="text-gray-400 text-xs">Click ▶ Run Now above to generate this week&apos;s rankings.</p>
      </div>
    );
  }

  const table = snapshot.ranking_table as { brands?: BrandEntry[] };
  const brands = table?.brands ?? [];

  if (brands.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
        <p className="text-gray-400 text-sm">No brand mentions found in this week&apos;s runs.</p>
      </div>
    );
  }

  // Collect all engines that appear in the data
  const engines = Array.from(
    new Set(brands.flatMap(b => Object.keys(b.by_engine ?? {})))
  ).sort();

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Brand Rankings</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Week of {snapshot.week_of} · {brands.length} brands · {snapshot.total_runs} total runs
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="bg-amber-50 text-amber-700 border border-amber-200 px-2 py-1 rounded-full">
            ⭐ = {brandName}
          </span>
          {snapshot.avg_rank != null && (
            <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-1 rounded-full">
              Avg rank #{snapshot.avg_rank.toFixed(1)}
            </span>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-10">#</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Brand</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Mentions</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Avg Position</th>
              {engines.map(engine => (
                <th
                  key={engine}
                  className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider"
                >
                  {getEngineDisplayName(engine)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {brands.map((brand, i) => {
              const isMe = isClientBrand(brand.name, brandName);
              return (
                <tr
                  key={brand.name}
                  className={isMe ? 'bg-amber-50 hover:bg-amber-100' : 'hover:bg-gray-50'}
                >
                  <td className="px-5 py-3.5 text-sm font-medium text-gray-400">{i + 1}</td>
                  <td className="px-5 py-3.5">
                    <span className={`text-sm font-semibold ${isMe ? 'text-amber-800' : 'text-gray-900'}`}>
                      {isMe && <span className="mr-1">⭐</span>}
                      {brand.name}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="inline-flex items-center gap-1">
                      <span className={`text-sm font-semibold ${isMe ? 'text-amber-700' : 'text-gray-700'}`}>
                        {brand.mentions}
                      </span>
                      <span className="text-xs text-gray-400">
                        /{snapshot.total_runs}
                      </span>
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-gray-700">
                    {brand.avg_rank != null ? (
                      <span className={`font-mono font-semibold ${isMe ? 'text-amber-700' : ''}`}>
                        #{brand.avg_rank.toFixed(1)}
                      </span>
                    ) : '—'}
                  </td>
                  {engines.map(engine => {
                    const ranks = brand.by_engine?.[engine] ?? [];
                    const avg = ranks.length > 0
                      ? ranks.reduce((a: number, b: number) => a + b, 0) / ranks.length
                      : null;
                    return (
                      <td key={engine} className="px-5 py-3.5 text-sm text-gray-600">
                        {avg != null ? (
                          <span className="font-mono">
                            #{avg.toFixed(1)}
                            <span className="text-gray-400 text-xs ml-1">({ranks.length}×)</span>
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
