'use client';

import { useState, useEffect, useCallback } from 'react';
import type { ZhugeActionRow } from '@/app/api/clients/[id]/zhuge/latest-actions/route';

const API_KEY = process.env.NEXT_PUBLIC_INTERNAL_API_KEY ?? '';

// ── Colour helpers ────────────────────────────────────────────────────────────

const FLYWHEEL_BADGE: Record<string, { label: string; cls: string }> = {
  seo:    { label: 'SEO',    cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  geo:    { label: 'GEO',    cls: 'bg-purple-100 text-purple-700 border-purple-200' },
  ads:    { label: 'Ads',    cls: 'bg-orange-100 text-orange-700 border-orange-200' },
  social: { label: 'Social', cls: 'bg-green-100 text-green-700 border-green-200' },
};

const IMPACT_CLS: Record<string, string> = {
  high:   'bg-red-50 text-red-700',
  medium: 'bg-amber-50 text-amber-700',
  low:    'bg-gray-50 text-gray-500',
};

const EFFORT_CLS: Record<string, string> = {
  low:    'bg-green-50 text-green-700',
  medium: 'bg-amber-50 text-amber-700',
  high:   'bg-red-50 text-red-700',
};

const IMPACT_ZH: Record<string, string> = { high: '高影响', medium: '中影响', low: '低影响' };
const EFFORT_ZH: Record<string, string> = { high: '高投入', medium: '中投入', low: '低投入' };

const EXEC_MODE_ZH: Record<string, { icon: string; label: string }> = {
  in_house:        { icon: '🤖', label: '鲁班可自动执行' },
  third_party:     { icon: '🔗', label: '第三方平台' },
  external_manual: { icon: '👤', label: 'FDE 人工执行' },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function ActionCard({ action }: { action: ZhugeActionRow }) {
  const fw = FLYWHEEL_BADGE[action.flywheel] ?? { label: action.flywheel, cls: 'bg-gray-100 text-gray-600 border-gray-200' };
  const p = action.payload;
  const execMode = EXEC_MODE_ZH[action.execution_mode] ?? { icon: '❓', label: action.execution_mode };

  return (
    <div className="flex gap-3 p-4 rounded-xl border border-gray-200 bg-white hover:border-indigo-200 hover:shadow-sm transition-all">
      {/* Rank badge */}
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center mt-0.5">
        {p.rank}
      </div>

      <div className="flex-1 min-w-0">
        {/* Header row */}
        <div className="flex items-center gap-2 flex-wrap mb-1.5">
          <span className={`text-xs font-semibold border rounded-full px-2 py-0.5 ${fw.cls}`}>
            {fw.label}
          </span>
          <span className="text-sm font-semibold text-gray-800 font-mono">
            {action.action_type}
          </span>
          <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
            <span className={`text-xs font-medium rounded px-1.5 py-0.5 ${IMPACT_CLS[p.expected_impact] ?? ''}`}>
              {IMPACT_ZH[p.expected_impact] ?? p.expected_impact}
            </span>
            <span className={`text-xs font-medium rounded px-1.5 py-0.5 ${EFFORT_CLS[p.effort] ?? ''}`}>
              {EFFORT_ZH[p.effort] ?? p.effort}
            </span>
          </div>
        </div>

        {/* Why now */}
        <p className="text-sm text-gray-600 leading-relaxed mb-2">{p.why_now}</p>

        {/* Footer: execution mode + tool */}
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <span>{execMode.icon}</span>
          <span>{execMode.label}</span>
          {p.executable_by && (
            <span className="font-mono text-indigo-500">· {p.executable_by}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────

type WidgetState = 'loading' | 'empty' | 'loaded' | 'running';

interface ZhugePriorityWidgetProps {
  clientId: string;
  /** Whether 张骞 discovery is confirmed (gate for "询问诸葛亮" CTA). */
  discoveryConfirmed: boolean;
}

export function ZhugePriorityWidget({ clientId, discoveryConfirmed }: ZhugePriorityWidgetProps) {
  const [state, setState] = useState<WidgetState>('loading');
  const [actions, setActions] = useState<ZhugeActionRow[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const loadLatest = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/zhuge/latest-actions`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      });
      if (!res.ok) { setState('empty'); return; }
      const data = await res.json() as { success: boolean; actions: ZhugeActionRow[]; generated_at: string | null };
      if (data.success && data.actions.length > 0) {
        setActions(data.actions);
        setGeneratedAt(data.generated_at);
        setState('loaded');
      } else {
        setState('empty');
      }
    } catch {
      setState('empty');
    }
  }, [clientId]);

  useEffect(() => { void loadLatest(); }, [loadLatest]);

  const handleRun = async () => {
    setRunError(null);
    setState('running');
    try {
      const res = await fetch(`/api/clients/${clientId}/zhuge/conduct`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        setRunError(body.error ?? `Error ${res.status}`);
        setState(actions.length > 0 ? 'loaded' : 'empty');
        return;
      }
      // Reload from DB after successful conduct
      await loadLatest();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Unknown error');
      setState(actions.length > 0 ? 'loaded' : 'empty');
    }
  };

  // ── Loading skeleton ──
  if (state === 'loading') {
    return (
      <div className="animate-pulse rounded-xl border border-gray-200 bg-white p-4 h-24" />
    );
  }

  // ── Empty (no prior session) ──
  if (state === 'empty') {
    return (
      <div className="rounded-xl border border-dashed border-indigo-200 bg-indigo-50 p-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🧠</span>
          <div>
            <p className="text-sm font-semibold text-indigo-900">诸葛亮 · 优先行动</p>
            <p className="text-xs text-indigo-600 mt-0.5">
              {discoveryConfirmed
                ? '尚无分析结果。点击「询问诸葛亮」生成优先行动清单。'
                : '请先完成张骞品牌扫描，再询问诸葛亮。'}
            </p>
          </div>
        </div>
        {discoveryConfirmed && (
          <button
            onClick={() => void handleRun()}
            className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
          >
            询问诸葛亮 →
          </button>
        )}
      </div>
    );
  }

  // ── Running (calling conduct API) ──
  if (state === 'running') {
    return (
      <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-5 flex items-center gap-3">
        <div className="animate-spin w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full flex-shrink-0" />
        <div>
          <p className="text-sm font-semibold text-indigo-800">诸葛亮运筹中…</p>
          <p className="text-xs text-indigo-500 mt-0.5">正在分析张骞证据 + 华佗诊断，生成优先行动（约 20–40 秒）</p>
        </div>
      </div>
    );
  }

  // ── Loaded ──
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
      {/* Widget header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🧠</span>
          <div>
            <p className="text-sm font-semibold text-gray-900">诸葛亮 · 优先行动清单</p>
            {generatedAt && (
              <p className="text-xs text-gray-400">
                生成于{' '}
                {new Date(generatedAt).toLocaleDateString('zh-CN', {
                  timeZone: 'Pacific/Auckland',
                  year: 'numeric', month: 'short', day: 'numeric',
                })}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={() => void handleRun()}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-indigo-700 border border-gray-200 hover:border-indigo-300 rounded-lg px-3 py-1.5 transition-colors"
        >
          ↻ 重新计算
        </button>
      </div>

      {/* Error banner */}
      {runError && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          ⚠️ {runError}
        </div>
      )}

      {/* Action cards */}
      <div className="space-y-2">
        {actions.map((action) => (
          <ActionCard key={action.id} action={action} />
        ))}
      </div>
    </div>
  );
}
