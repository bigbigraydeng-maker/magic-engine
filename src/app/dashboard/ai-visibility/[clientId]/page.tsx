'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { RankingsTable } from './_components/RankingsTable';
import { EngineComparison } from './_components/EngineComparison';
import { ModelStats } from './_components/ModelStats';
import { QueriesManager } from './_components/QueriesManager';
import type { AiVisibilityRun, AiVisibilitySnapshot, AiVisibilityQuery } from '@/types/magic-engine';

type Tab = 'rankings' | 'engines' | 'models' | 'queries';

interface Client {
  id: string;
  name: string;
  domain?: string;
}

/**
 * /dashboard/ai-visibility/[clientId]
 *
 * Main AI Visibility Tracker page for a single client.
 * Four tabs: Rankings | Engine Comparison | By Model | Queries
 * Reference: ROADMAP.md P7.1.12–P7.1.17
 */
export default function AiVisibilityPage() {
  const params = useParams();
  const clientId = params.clientId as string;

  const [client, setClient] = useState<Client | null>(null);
  const [snapshot, setSnapshot] = useState<AiVisibilitySnapshot | null>(null);
  const [runs, setRuns] = useState<AiVisibilityRun[]>([]);
  const [queries, setQueries] = useState<AiVisibilityQuery[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('rankings');

  // Run Now state
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState('');
  const [runSuccess, setRunSuccess] = useState<boolean | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [clientRes, snapshotRes, runsRes, queriesRes] = await Promise.all([
        fetch(`/api/clients/${clientId}`),
        fetch(`/api/ai-tracker/snapshots?client_id=${clientId}&limit=1`),
        fetch(`/api/ai-tracker/runs?client_id=${clientId}&limit=60`),
        fetch(`/api/ai-tracker/queries?client_id=${clientId}`),
      ]);

      if (clientRes.ok) {
        const json = await clientRes.json();
        setClient(json.client ?? null);
      }
      if (snapshotRes.ok) {
        const json = await snapshotRes.json();
        setSnapshot(json.snapshots?.[0] ?? null);
      }
      if (runsRes.ok) {
        const json = await runsRes.json();
        setRuns(json.runs ?? []);
      }
      if (queriesRes.ok) {
        const json = await queriesRes.json();
        setQueries(json.queries ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleRunNow = async () => {
    setRunning(true);
    setRunMsg('⏳ 正在启动 Tracker，请稍候…');
    setRunSuccess(null);
    try {
      const res = await fetch('/api/ai-tracker/run-dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId }),
      });
      const json = await res.json();
      if (json.success) {
        // Backend fires-and-forgets: run takes ~10 min in background.
        // Schedule an automatic data refresh after 11 minutes.
        setRunMsg('✓ Tracker 已在后台启动（约 10 分钟）。可以离开此页，完成后刷新查看结果。');
        setRunSuccess(true);
        setTimeout(() => fetchAll(), 11 * 60 * 1000);
      } else {
        setRunMsg(`Error: ${json.error ?? 'Unknown error'}`);
        setRunSuccess(false);
      }
    } catch {
      setRunMsg('Error: failed to connect to server');
      setRunSuccess(false);
    } finally {
      setRunning(false);
      setTimeout(() => { setRunMsg(''); setRunSuccess(null); }, 60000); // banner stays 60s
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'rankings', label: '🏆 Rankings' },
    { id: 'engines', label: '⚖️ Engine Comparison' },
    { id: 'models', label: '🤖 By Model' },
    { id: 'queries', label: `❓ Queries${queries.length > 0 ? ` (${queries.length})` : ''}` },
  ];

  const brandName = client?.name ?? '';

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="animate-pulse space-y-3">
          <div className="h-8 bg-me-stone rounded w-64" />
          <div className="h-4 bg-me-stone rounded w-40" />
          <div className="grid grid-cols-4 gap-3">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-20 bg-me-stone rounded-xl" />)}
          </div>
        </div>
      </div>
    );
  }

  // ── Not found ─────────────────────────────────────────────────────────────
  if (!client) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-me-charcoal/55">Client not found.</p>
        <Link href="/dashboard/ai-visibility" className="text-me-ochre hover:underline text-sm">
          ← Back to AI Visibility
        </Link>
      </div>
    );
  }

  // ── Main page ─────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/dashboard/ai-visibility" className="text-me-charcoal/45 hover:text-me-charcoal/60 text-sm flex-shrink-0">
          ← AI Visibility
        </Link>
        <span className="text-me-charcoal/35">/</span>
        <h1 className="font-display text-2xl font-bold tracking-tight text-me-charcoal/90">{client.name}</h1>
        {client.domain && (
          <a
            href={`https://${client.domain}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-me-ochre hover:text-me-ochre font-mono"
          >
            {client.domain} ↗
          </a>
        )}
        <div className="ml-auto flex items-center gap-3 flex-shrink-0">
          {runMsg && (
            <span className={`text-sm ${
              runSuccess === true ? 'text-[#5C8A4A]' :
              runSuccess === false ? 'text-[#C2453A]' :
              'text-me-ochre'
            }`}>
              {runMsg}
            </span>
          )}
          <button
            onClick={handleRunNow}
            disabled={running}
            className="bg-me-ochre hover:bg-me-ochre disabled:bg-me-ochre/70 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5"
          >
            {running ? (
              <><span className="inline-block animate-spin">⏳</span> Running…</>
            ) : (
              <>▶ Run Now</>
            )}
          </button>
        </div>
      </div>

      {/* Stats strip — only shown when snapshot exists */}
      {snapshot && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Week of', value: snapshot.week_of },
            {
              label: 'Avg Brand Rank',
              value: snapshot.avg_rank != null ? `#${snapshot.avg_rank.toFixed(1)}` : '—',
            },
            {
              label: 'Mention Rate',
              value: snapshot.total_runs > 0
                ? `${((snapshot.mentions_count / snapshot.total_runs) * 100).toFixed(0)}%`
                : '—',
              sub: `${snapshot.mentions_count}/${snapshot.total_runs} runs`,
            },
            { label: 'AI Models', value: snapshot.models_covered.length },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-black/10 p-4">
              <p className="text-xs text-me-charcoal/55">{s.label}</p>
              <p className="text-xl font-bold text-me-charcoal/90 mt-1">{s.value}</p>
              {s.sub && <p className="text-xs text-me-charcoal/45 mt-0.5">{s.sub}</p>}
            </div>
          ))}
        </div>
      )}

      {/* No data prompt */}
      {!snapshot && runs.length === 0 && (
        <div className="bg-me-ochre/10 border border-me-ochre/30 rounded-xl px-5 py-4 text-sm text-me-ochre">
          {queries.length > 0 ? (
            <><strong>No data yet.</strong> Click ▶ Run Now above to run the first AI Visibility pass for this client.</>
          ) : (
            <>
              <strong>还没有追踪问句。</strong> 追踪问句来源于张骞 Discovery,
              <Link
                href={`/dashboard/clients/${clientId}/zhangqian`}
                className="underline font-medium hover:text-me-ochre"
              >
                先给该客户跑一次 discovery
              </Link>
              并确认报告,问句会自动同步过来。
            </>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-black/10">
        <nav className="flex gap-1 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-me-ochre text-me-ochre'
                  : 'border-transparent text-me-charcoal/55 hover:text-me-charcoal/75 hover:border-black/15'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'rankings' && (
        <RankingsTable snapshot={snapshot} brandName={brandName} />
      )}
      {activeTab === 'engines' && (
        <EngineComparison runs={runs} brandName={brandName} />
      )}
      {activeTab === 'models' && (
        <ModelStats runs={runs} brandName={brandName} />
      )}
      {activeTab === 'queries' && (
        <QueriesManager
          clientId={clientId}
          queries={queries}
          runs={runs}
          onRefresh={fetchAll}
        />
      )}
    </div>
  );
}
