'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  MePanel,
  MePanelHeader,
  MePill,
  MeTrend,
  MeButton,
} from '@/components/ui/me-primitives';
import { GOLD_GRADIENT, cx } from '@/components/ui/me-theme';
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

// AI engine display config — order matches design dashboard
type AiEngineKey = 'openai' | 'anthropic' | 'perplexity' | 'google';
interface EngineConfig {
  key: AiEngineKey;
  badge: string;
  name: string;
}
const AI_ENGINES: EngineConfig[] = [
  { key: 'openai',     badge: 'GPT', name: 'ChatGPT' },
  { key: 'anthropic',  badge: 'CL',  name: 'Claude' },
  { key: 'perplexity', badge: 'PX',  name: 'Perplexity' },
  { key: 'google',     badge: 'AIO', name: 'Google AIO' },
];

interface EngineStat {
  cfg: EngineConfig;
  scorePct: number | null;       // 0–100 mention rate
  avgRank: number | null;        // average client_brand_rank where mentioned
  dir: 'up' | 'down' | 'flat';   // trend hint from rank
  trendLabel: string;            // rank shown beside trend arrow
  totalRuns: number;
  mentionRuns: number;
}

/**
 * Aggregate runs by engine into score % + avg rank.
 * Score = (mentioned runs / total successful runs) × 100.
 */
function aggregateByEngine(runs: AiVisibilityRun[]): EngineStat[] {
  return AI_ENGINES.map(cfg => {
    const engineRuns = runs.filter(r => r.ai_engine === cfg.key);
    const successful = engineRuns.filter(r => !r.error_message);
    const mentioned = successful.filter(r => r.client_brand_rank != null);
    const ranks = mentioned
      .map(r => r.client_brand_rank as number)
      .filter(n => Number.isFinite(n));
    const avgRank = ranks.length > 0 ? ranks.reduce((a, b) => a + b, 0) / ranks.length : null;
    const scorePct = successful.length > 0
      ? Math.round((mentioned.length / successful.length) * 100)
      : null;
    // Trend heuristic: low rank → up (improving), mid → flat, high/none → down
    let dir: 'up' | 'down' | 'flat' = 'flat';
    let trendLabel = '—';
    if (avgRank != null) {
      trendLabel = `#${avgRank.toFixed(1)}`;
      if (avgRank <= 3) dir = 'up';
      else if (avgRank <= 5) dir = 'flat';
      else dir = 'down';
    } else {
      dir = 'down';
    }
    return {
      cfg,
      scorePct,
      avgRank,
      dir,
      trendLabel,
      totalRuns: engineRuns.length,
      mentionRuns: mentioned.length,
    };
  });
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
    { id: 'rankings', label: 'Rankings' },
    { id: 'engines',  label: 'Engine comparison' },
    { id: 'models',   label: 'By model' },
    { id: 'queries',  label: queries.length > 0 ? `Queries (${queries.length})` : 'Queries' },
  ];

  const brandName = client?.name ?? '';

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="font-sans px-8 py-7">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-64 rounded bg-me-stone" />
          <div className="h-4 w-40 rounded bg-me-stone" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-32 rounded-[24px] bg-me-stone" />)}
          </div>
        </div>
      </div>
    );
  }

  // ── Not found ─────────────────────────────────────────────────────────────
  if (!client) {
    return (
      <div className="font-sans px-8 py-7 space-y-3">
        <p className="text-[13.5px] text-black/55">Client not found.</p>
        <Link href={`/dashboard/clients/${clientId}`} className="text-[13px] font-semibold text-me-ochre hover:underline">
          ← 返回客户
        </Link>
      </div>
    );
  }

  const engineStats = aggregateByEngine(runs);
  const overallPct = snapshot && snapshot.total_runs > 0
    ? Math.round((snapshot.mentions_count / snapshot.total_runs) * 100)
    : null;
  const overallPctDisplay = overallPct == null ? '—' : `${overallPct}%`;
  const overallDashArray = overallPct == null ? '0 100' : `${overallPct} 100`;

  // ── Main page ─────────────────────────────────────────────────────────────
  return (
    <div className="font-sans">
      {/* Topbar */}
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-black/10 bg-[#FBF8F3]/80 px-8 py-5 backdrop-blur-md">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[12.5px] font-semibold text-black/45">
            <Link href={`/dashboard/clients/${clientId}`} className="hover:text-me-ochre">
              AI Visibility
            </Link>
            <span className="text-black/25">/</span>
            <span className="truncate text-me-charcoal">{client.name}</span>
          </div>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-me-charcoal">
            {client.name}
          </h1>
          <p className="mt-[3px] text-[13px] text-black/55">
            Weekly brand tracking across ChatGPT, Claude, Perplexity &amp; Google AIO
            {client.domain && (
              <>
                {' · '}
                <a
                  href={`https://${client.domain}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-me-ochre hover:underline"
                >
                  {client.domain} ↗
                </a>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {runMsg && (
            <span
              className={cx(
                'text-[12.5px] font-semibold',
                runSuccess === true && 'text-[#5C8A4A]',
                runSuccess === false && 'text-[#C2453A]',
                runSuccess == null && 'text-me-ochre',
              )}
            >
              {runMsg}
            </span>
          )}
          <MeButton
            size="sm"
            onClick={handleRunNow}
            disabled={running}
          >
            {running ? (
              <>
                <span className="inline-block animate-spin">⏳</span> Running…
              </>
            ) : (
              <>▶ Run Now</>
            )}
          </MeButton>
        </div>
      </header>

      <div className="px-8 py-7 space-y-6">
        {/* No data prompt */}
        {!snapshot && runs.length === 0 && (
          <MePanel className="border-me-ochre/30 bg-me-ochre/8">
            <div className="text-[13.5px] text-me-charcoal">
              {queries.length > 0 ? (
                <>
                  <strong className="font-semibold">No data yet.</strong>{' '}
                  Click ▶ Run Now above to run the first AI Visibility pass for this client.
                </>
              ) : (
                <>
                  <strong className="font-semibold">还没有追踪问句。</strong> 追踪问句来源于张骞 Discovery,{' '}
                  <Link
                    href={`/dashboard/clients/${clientId}/zhangqian`}
                    className="font-semibold text-me-ochre underline hover:no-underline"
                  >
                    先给该客户跑一次 discovery
                  </Link>
                  ,问句会自动同步过来。
                </>
              )}
            </div>
          </MePanel>
        )}

        {/* Engine donut row — 4 cards */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {engineStats.map(stat => (
            <EngineDonutCard key={stat.cfg.key} stat={stat} />
          ))}
        </section>

        {/* Overall visibility + Snapshot meta */}
        {snapshot && (
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <MePanel className="lg:col-span-2">
              <MePanelHeader
                title="Overall visibility"
                right={
                  overallPct != null ? (
                    <MePill tone="track">{`${overallPct}% mention rate`}</MePill>
                  ) : (
                    <MePill tone="attn">No baseline yet</MePill>
                  )
                }
              />
              <div className="flex flex-wrap items-center gap-6 pt-1">
                <svg viewBox="0 0 42 42" className="h-[110px] w-[110px] flex-none">
                  <defs>
                    <linearGradient id="me-ai-vis-gold" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#EBCB8B" />
                      <stop offset="55%" stopColor="#C4912E" />
                      <stop offset="100%" stopColor="#A6781F" />
                    </linearGradient>
                  </defs>
                  <circle cx="21" cy="21" r="15.9" fill="none" stroke="#EAE6DF" strokeWidth="5" />
                  <circle
                    cx="21"
                    cy="21"
                    r="15.9"
                    fill="none"
                    stroke="url(#me-ai-vis-gold)"
                    strokeWidth="5"
                    strokeLinecap="round"
                    strokeDasharray={overallDashArray}
                    transform="rotate(-90 21 21)"
                  />
                </svg>
                <div>
                  <div
                    className="font-display text-[42px] font-bold tabular-nums leading-none"
                    style={{
                      backgroundImage: GOLD_GRADIENT,
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                    }}
                  >
                    {overallPctDisplay}
                  </div>
                  <p className="mt-1.5 text-[12.5px] leading-snug text-black/55">
                    brand mention rate
                    <br />
                    across {AI_ENGINES.length} AI engines
                  </p>
                </div>
                <div className="ml-auto grid grid-cols-2 gap-x-8 gap-y-3 text-right">
                  <div>
                    <div className="font-display text-[18px] font-bold tabular-nums text-me-charcoal">
                      {snapshot.avg_rank != null ? `#${snapshot.avg_rank.toFixed(1)}` : '—'}
                    </div>
                    <div className="text-[11.5px] text-black/55">Avg brand rank</div>
                  </div>
                  <div>
                    <div className="font-display text-[18px] font-bold tabular-nums text-me-charcoal">
                      {snapshot.models_covered.length}
                    </div>
                    <div className="text-[11.5px] text-black/55">AI models</div>
                  </div>
                  <div>
                    <div className="font-display text-[18px] font-bold tabular-nums text-me-charcoal">
                      {snapshot.mentions_count}
                      <span className="text-black/35">/{snapshot.total_runs}</span>
                    </div>
                    <div className="text-[11.5px] text-black/55">Mentions / runs</div>
                  </div>
                  <div>
                    <div className="font-display text-[18px] font-bold tabular-nums text-me-charcoal">
                      {snapshot.week_of}
                    </div>
                    <div className="text-[11.5px] text-black/55">Week of</div>
                  </div>
                </div>
              </div>
            </MePanel>

            {/* Snapshot summary side card */}
            <MePanel>
              <MePanelHeader title="This week" right={<MePill tone="exec">{`${runs.length} runs`}</MePill>} />
              <div className="divide-y divide-black/[.06]">
                {engineStats.map(stat => (
                  <div key={stat.cfg.key} className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="grid h-7 w-7 place-items-center rounded-md bg-me-stone text-[10px] font-black text-black/60">
                        {stat.cfg.badge}
                      </span>
                      <span className="text-[13.5px] font-semibold text-me-charcoal">
                        {stat.cfg.name}
                      </span>
                    </div>
                    <MeTrend dir={stat.dir}>{stat.trendLabel}</MeTrend>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11.5px] text-black/40">
                Avg client brand rank · last {runs.length} runs
              </p>
            </MePanel>
          </section>
        )}

        {/* Tabs */}
        <div className="border-b border-black/10">
          <nav className="flex flex-wrap gap-1">
            {tabs.map(tab => {
              const isOn = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cx(
                    '-mb-px border-b-2 px-4 py-2.5 text-[13px] font-semibold transition',
                    isOn
                      ? 'border-me-ochre text-me-ochre'
                      : 'border-transparent text-black/55 hover:text-me-charcoal',
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
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
    </div>
  );
}

// ─── Per-engine donut card ───────────────────────────────────────────────────

function EngineDonutCard({ stat }: { stat: EngineStat }) {
  const pctDisplay = stat.scorePct == null ? '—' : `${stat.scorePct}%`;
  const dashArray = stat.scorePct == null ? '0 100' : `${stat.scorePct} 100`;
  const gradId = `me-engine-gold-${stat.cfg.key}`;

  return (
    <MePanel>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-me-stone text-[11px] font-black text-black/60">
            {stat.cfg.badge}
          </span>
          <div>
            <div className="text-[14px] font-semibold text-me-charcoal">{stat.cfg.name}</div>
            <div className="text-[12px] text-black/55">Mention rate</div>
          </div>
        </div>
        <MeTrend dir={stat.dir}>{stat.trendLabel}</MeTrend>
      </div>

      <div className="mt-4 flex items-center gap-4">
        <svg viewBox="0 0 42 42" className="h-[78px] w-[78px] flex-none">
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#EBCB8B" />
              <stop offset="55%" stopColor="#C4912E" />
              <stop offset="100%" stopColor="#A6781F" />
            </linearGradient>
          </defs>
          <circle cx="21" cy="21" r="15.9" fill="none" stroke="#EAE6DF" strokeWidth="5" />
          <circle
            cx="21"
            cy="21"
            r="15.9"
            fill="none"
            stroke={`url(#${gradId})`}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={dashArray}
            transform="rotate(-90 21 21)"
          />
        </svg>
        <div className="min-w-0">
          <div
            className="font-display text-[28px] font-bold tabular-nums leading-none"
            style={{
              backgroundImage: GOLD_GRADIENT,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {pctDisplay}
          </div>
          <p className="mt-1 text-[11.5px] leading-snug text-black/55">
            {stat.mentionRuns}/{stat.totalRuns} runs
          </p>
        </div>
      </div>
    </MePanel>
  );
}
