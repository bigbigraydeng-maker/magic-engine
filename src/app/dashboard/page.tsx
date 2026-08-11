import { supabaseAdmin } from '@/lib/supabase';
import { loadClientsWithOutcomes } from '@/lib/flywheel/measure-coverage';
import {
  loadClientsWithDiagnose,
  loadExecutionPhaseClients,
} from '@/lib/flywheel/phase-coverage';
import Link from 'next/link';
import {
  MePanel,
  MePanelHeader,
  MeStatCard,
  MePill,
  MeTrend,
  MeButton,
  MeChip,
} from '@/components/ui/me-primitives';
import { GOLD_GRADIENT } from '@/components/ui/me-theme';

export const dynamic = 'force-dynamic';

interface RecentPost {
  id: string;
  title: string | null;
  status: string | null;
  route: string | null;
  platforms: string[] | null;
  created_at: string;
  client_id: string;
  clients?: { id: string; name: string } | null;
}

interface ClientLite {
  id: string;
  name: string;
  domain: string | null;
}

// AI engine display config — order matters (renders top-to-bottom)
type AiEngineKey = 'openai' | 'anthropic' | 'perplexity' | 'google';
interface EngineConfig {
  key: AiEngineKey;
  id: string;        // short badge code
  name: string;      // display name
}
const AI_ENGINES: EngineConfig[] = [
  { key: 'openai',     id: 'GPT', name: 'ChatGPT' },
  { key: 'anthropic',  id: 'CL',  name: 'Claude' },
  { key: 'perplexity', id: 'PX',  name: 'Perplexity' },
  { key: 'google',     id: 'AIO', name: 'Google AIO' },
];

type Tone = 'track' | 'exec' | 'attn' | 'sched' | 'rej';

interface EngineRow {
  id: string;
  name: string;
  rank: string;       // '#2' or '—'
  dir: 'up' | 'down' | 'flat';
  tone: Tone;
}

interface AiVisibility {
  livePercent: number | null;        // 0–100; null = no data
  monthlyChange: string | null;      // '+23% MoM' or null
  monthlyChangeDir: 'up' | 'down' | 'flat';
  engines: EngineRow[];
}

interface FlywheelPhase {
  key: 'diagnose' | 'prioritise' | 'execute' | 'measure';
  label: string;
  pct: number; // 0–100
}

// Rank → trend direction & status tone heuristic.
function rankToDir(rank: number): { dir: 'up' | 'down' | 'flat'; tone: Tone } {
  if (rank <= 3) return { dir: 'up',   tone: 'track' };
  if (rank <= 5) return { dir: 'flat', tone: 'exec'  };
  return { dir: 'down', tone: 'attn' };
}

async function getOverviewData() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const [
    clientsCountRes,
    activeClientsRes,
    recentPostsRes,
    contentInFlightRes,
    contentThisMonthRes,
    pendingReviewRes,
    flywheelRes,
    keywordRes,
    mentionRateCurrentRes,
    mentionRatePreviousRes,
    aiEngineRunsRes,
    diagnoseRes,
    executionPhasesRes,
    outcomesRes,
  ] = await Promise.all([
    // Onboarding gate uses count-only query — does NOT pull rows
    supabaseAdmin
      .from('clients')
      .select('*', { count: 'exact', head: true }),

    // Top 6 most recently active clients (proxied by created_at desc)
    supabaseAdmin
      .from('clients')
      .select('id, name, domain, created_at')
      .order('created_at', { ascending: false })
      .limit(6),

    supabaseAdmin
      .from('content_posts')
      .select('id, title, status, route, platforms, created_at, client_id, clients(id, name)')
      .order('created_at', { ascending: false })
      .limit(6),

    supabaseAdmin
      .from('content_posts')
      .select('*', { count: 'exact', head: true })
      .in('status', ['draft', 'generating', 'pending_review']),

    supabaseAdmin
      .from('content_posts')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', thirtyDaysAgo),

    supabaseAdmin
      .from('production_packages')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'ready_for_review'),

    supabaseAdmin
      .from('flywheel_actions')
      .select('flywheel, executed_at')
      .gte('executed_at', sevenDaysAgo),

    supabaseAdmin
      .from('keyword_intelligence_runs')
      .select('*', { count: 'exact', head: true }),

    // AI Visibility Index — current 7-day mention_rate values across all clients
    supabaseAdmin
      .from('flywheel_metrics')
      .select('metric_value')
      .eq('flywheel', 'geo')
      .eq('metric_key', 'geo.query.mention_rate')
      .gte('measured_at', sevenDaysAgo),

    // Previous 7-day window (7–14 days ago) for MoM-style delta
    supabaseAdmin
      .from('flywheel_metrics')
      .select('metric_value')
      .eq('flywheel', 'geo')
      .eq('metric_key', 'geo.query.mention_rate')
      .gte('measured_at', fourteenDaysAgo)
      .lt('measured_at', sevenDaysAgo),

    // 4-engine ranking — last 7 days of AI Tracker runs
    supabaseAdmin
      .from('ai_visibility_runs')
      .select('ai_engine, client_brand_rank, ran_at')
      .gte('ran_at', sevenDaysAgo),

    // Flywheel phase 1: Diagnose — clients with a prescription.
    loadClientsWithDiagnose(),

    // Flywheel phases 2 & 3: Prioritise / Execute — by execution item status.
    loadExecutionPhaseClients(),

    // Flywheel phase 4: Measure — clients with at least one outcome.
    loadClientsWithOutcomes(),
  ]);

  const totalClientCount = clientsCountRes.count ?? 0;

  const activeClients: ClientLite[] = ((activeClientsRes.data ?? []) as Array<{
    id: string;
    name: string;
    domain: string | null;
  }>).map(c => ({
    id: c.id,
    name: c.name,
    domain: c.domain ?? null,
  }));

  // ── Per-flywheel action counts (last 7 days) ────────────────────────────────
  const flywheelCounts: Record<string, number> = { seo: 0, geo: 0, ads: 0, social: 0 };
  for (const action of flywheelRes.data ?? []) {
    const key = (action as { flywheel: string }).flywheel;
    if (key in flywheelCounts) flywheelCounts[key] = (flywheelCounts[key] ?? 0) + 1;
  }
  const totalFlywheel = Object.values(flywheelCounts).reduce((a, b) => a + b, 0);

  // ── AI Visibility Index (avg mention_rate × 100) ───────────────────────────
  const currentRates = ((mentionRateCurrentRes.data ?? []) as Array<{ metric_value: number }>)
    .map(r => Number(r.metric_value))
    .filter(v => Number.isFinite(v));
  const previousRates = ((mentionRatePreviousRes.data ?? []) as Array<{ metric_value: number }>)
    .map(r => Number(r.metric_value))
    .filter(v => Number.isFinite(v));

  const avgRate = (xs: number[]): number | null =>
    xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

  const currentAvg = avgRate(currentRates);
  const previousAvg = avgRate(previousRates);

  const livePercent = currentAvg === null ? null : Math.round(currentAvg * 100);

  let monthlyChange: string | null = null;
  let monthlyChangeDir: 'up' | 'down' | 'flat' = 'flat';
  if (currentAvg !== null && previousAvg !== null && previousAvg > 0) {
    const deltaPct = ((currentAvg - previousAvg) / previousAvg) * 100;
    const rounded = Math.round(deltaPct);
    if (rounded > 0) {
      monthlyChange = `+${rounded}% WoW`;
      monthlyChangeDir = 'up';
    } else if (rounded < 0) {
      monthlyChange = `${rounded}% WoW`;
      monthlyChangeDir = 'down';
    } else {
      monthlyChange = `0% WoW`;
      monthlyChangeDir = 'flat';
    }
  }

  // ── Per-engine ranking — average client_brand_rank where mentioned ─────────
  type EngineAgg = { sum: number; count: number };
  const engineAgg: Record<AiEngineKey, EngineAgg> = {
    openai:     { sum: 0, count: 0 },
    anthropic:  { sum: 0, count: 0 },
    perplexity: { sum: 0, count: 0 },
    google:     { sum: 0, count: 0 },
  };
  for (const row of (aiEngineRunsRes.data ?? []) as Array<{
    ai_engine: string;
    client_brand_rank: number | null;
  }>) {
    const engine = row.ai_engine as AiEngineKey;
    if (!(engine in engineAgg)) continue;
    if (row.client_brand_rank === null || !Number.isFinite(row.client_brand_rank)) continue;
    engineAgg[engine].sum += row.client_brand_rank;
    engineAgg[engine].count += 1;
  }

  const engines: EngineRow[] = AI_ENGINES.map(cfg => {
    const agg = engineAgg[cfg.key];
    if (agg.count === 0) {
      return { id: cfg.id, name: cfg.name, rank: '—', dir: 'flat', tone: 'attn' };
    }
    const avg = agg.sum / agg.count;
    const rankNum = Math.round(avg);
    const { dir, tone } = rankToDir(rankNum);
    return { id: cfg.id, name: cfg.name, rank: `#${rankNum}`, dir, tone };
  });

  const aiVisibility: AiVisibility = {
    livePercent,
    monthlyChange,
    monthlyChangeDir,
    engines,
  };

  // ── 4-phase mini-flywheel — per-client coverage ratios ─────────────────────
  const clientsWithDiagnose = diagnoseRes;
  const { prioritise: clientsWithPrioritise, execute: clientsWithExecute } =
    executionPhasesRes;
  const clientsWithMeasure = outcomesRes;

  const phasePct = (n: number): number =>
    totalClientCount === 0 ? 0 : Math.round((n / totalClientCount) * 100);

  const flywheelPhases: FlywheelPhase[] = [
    { key: 'diagnose',   label: 'Diagnose',   pct: phasePct(clientsWithDiagnose.size) },
    { key: 'prioritise', label: 'Prioritise', pct: phasePct(clientsWithPrioritise.size) },
    { key: 'execute',    label: 'Execute',    pct: phasePct(clientsWithExecute.size) },
    { key: 'measure',    label: 'Measure',    pct: phasePct(clientsWithMeasure.size) },
  ];

  const recentPosts: RecentPost[] = ((recentPostsRes.data as unknown) as RecentPost[]) ?? [];

  return {
    activeClientCount: totalClientCount,
    activeClients,
    contentInFlight: contentInFlightRes.count ?? 0,
    contentThisMonth: contentThisMonthRes.count ?? 0,
    pendingReview: pendingReviewRes.count ?? 0,
    keywordCount: keywordRes.count ?? 0,
    flywheelCounts,
    totalFlywheel,
    aiVisibility,
    flywheelPhases,
    recentPosts,
    oneDayAgo,
  };
}

// Status → tone mapping
function statusTone(status: string | null | undefined): Tone {
  switch (status) {
    case 'approved':
    case 'published':
    case 'scheduled':
      return 'track';
    case 'draft':
    case 'generating':
    case 'pending_review':
      return 'exec';
    case 'rejected':
    case 'failed':
      return 'rej';
    default:
      return 'attn';
  }
}

function statusLabel(status: string | null | undefined): string {
  if (!status) return 'unknown';
  return status.replace(/_/g, ' ');
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
}

export default async function OverviewPage() {
  const data = await getOverviewData();
  const {
    activeClientCount,
    activeClients,
    contentInFlight,
    pendingReview,
    keywordCount,
    flywheelCounts,
    totalFlywheel,
    aiVisibility,
    flywheelPhases,
    recentPosts,
  } = data;

  // Loop progress rough estimate: how many flywheels have produced actions this week
  const liveLoops = Object.values(flywheelCounts).filter(n => n > 0).length;

  const livePercentDisplay =
    aiVisibility.livePercent === null ? '—' : `${aiVisibility.livePercent}%`;
  const donutDashArray =
    aiVisibility.livePercent === null ? '0 100' : `${aiVisibility.livePercent} 100`;

  return (
    <div className="font-sans">
      {/* Topbar */}
      <header className="sticky top-0 z-20 flex items-center justify-between gap-5 border-b border-black/10 bg-[#FBF8F3]/80 px-8 py-5 backdrop-blur-md">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-me-charcoal">
            Overview
          </h1>
          <p className="mt-[3px] text-[13px] text-black/55">
            Magic Engine admin · execution &amp; visibility across all clients
          </p>
        </div>
        <div className="hidden items-center gap-3 md:flex">
          <MePill tone="track">{activeClientCount} clients</MePill>
        </div>
      </header>

      <div className="px-8 py-7 space-y-6">
        {/* 4-up StatCards */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MeStatCard
            value={activeClientCount}
            label="Active clients"
            tone="stone"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-[18px] w-[18px]">
                <circle cx="9" cy="8" r="3.2" />
                <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
                <circle cx="17" cy="8" r="2.6" opacity=".5" />
              </svg>
            }
            footer={
              activeClients.length > 0 ? (
                <span className="text-[11.5px] text-black/55">
                  {activeClients.slice(0, 3).map(c => c.name).join(' · ')}
                  {activeClients.length > 3 ? ` · +${activeClients.length - 3}` : ''}
                </span>
              ) : (
                <span className="text-[11.5px] text-black/40">No clients yet</span>
              )
            }
          />
          <MeStatCard
            value={contentInFlight}
            label="Content in flight"
            tone="ochre"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-[18px] w-[18px]">
                <rect x="4" y="3" width="16" height="18" rx="2" />
                <path d="M8 8h8M8 12h8M8 16h5" />
              </svg>
            }
            footer={
              <MeTrend dir="up">
                {pendingReview} awaiting review
              </MeTrend>
            }
          />
          <MeStatCard
            value={livePercentDisplay}
            label="AI-visibility index"
            tone="ochre"
            goldValue
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-[18px] w-[18px]">
                <path d="M3 17l5-5 4 3 6-7" />
                <path d="M3 21h18" />
              </svg>
            }
            footer={
              aiVisibility.monthlyChange ? (
                <MeTrend dir={aiVisibility.monthlyChangeDir}>{aiVisibility.monthlyChange}</MeTrend>
              ) : (
                <span className="text-[11.5px] text-black/40">No tracker data yet</span>
              )
            }
          />
          <MeStatCard
            value={liveLoops > 0 ? `${liveLoops}/4` : '0/4'}
            label="Loop progress"
            tone="track"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-[18px] w-[18px]">
                <path d="M21 12a9 9 0 1 1-3-6.7" />
                <path d="M21 4v5h-5" />
              </svg>
            }
            footer={
              <span className="text-[11.5px] text-black/55">
                {totalFlywheel} actions · last 7 days
              </span>
            }
          />
        </section>

        {/* Recent content + Mini flywheel  /  AI Visibility */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          {/* Recent content + Mini flywheel */}
          <MePanel className="lg:col-span-3 space-y-6">
            <div>
              <MePanelHeader
                title="Recent content"
                right={
                  <Link
                    href="/dashboard/visuals"
                    className="text-[12.5px] font-semibold text-me-ochre hover:underline"
                  >
                    View all →
                  </Link>
                }
              />
              <div className="divide-y divide-black/[.06]">
                {recentPosts.length === 0 ? (
                  <div className="py-8 text-center text-[13px] text-black/40">
                    No content yet. Get started from the{' '}
                    <Link href="/dashboard/clients" className="font-semibold text-me-ochre hover:underline">
                      Clients
                    </Link>{' '}
                    page.
                  </div>
                ) : (
                  recentPosts.slice(0, 5).map(post => {
                    const clientName = post.clients?.name ?? '—';
                    const platforms = (post.platforms ?? []).join(' · ') || 'Multi-channel';
                    return (
                      <div
                        key={post.id}
                        className="flex items-center justify-between gap-4 py-[14px] first:pt-0 last:pb-0"
                      >
                        <div className="min-w-0">
                          <div className="font-display text-[14.5px] font-semibold tracking-tight text-me-charcoal line-clamp-1">
                            {post.title ?? 'Untitled post'}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-black/55">
                            <span>{clientName}</span>
                            <span className="text-black/20">·</span>
                            <span>{post.route ?? 'Free topic'}</span>
                            <span className="text-black/20">·</span>
                            <span>{platforms}</span>
                          </div>
                        </div>
                        <div className="flex flex-none flex-col items-end gap-1.5">
                          <MePill tone={statusTone(post.status)}>{statusLabel(post.status)}</MePill>
                          <span className="text-[11.5px] text-black/40 tabular-nums">
                            {formatDate(post.created_at)}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Mini flywheel */}
            <div className="border-t border-black/[.06] pt-5">
              <MePanelHeader
                title="Execution flywheel"
                right={<MePill tone="exec">{liveLoops || totalFlywheel ? `${liveLoops} active loops` : 'No loops yet'}</MePill>}
              />
              <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                {flywheelPhases.map(phase => (
                  <div key={phase.key} className="space-y-2">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[12.5px] font-semibold text-black/65">{phase.label}</span>
                      <span className="font-display text-[13px] font-bold tabular-nums text-me-charcoal">
                        {phase.pct}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-me-stone">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${phase.pct}%`, background: GOLD_GRADIENT }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11.5px] text-black/40">
                Share of clients reaching each phase ({activeClientCount} total).
              </p>
            </div>
          </MePanel>

          {/* AI Visibility (donut + engine list) */}
          <MePanel className="lg:col-span-2">
            <MePanelHeader
              title="AI visibility"
              right={
                aiVisibility.monthlyChange ? (
                  <MePill tone={aiVisibility.monthlyChangeDir === 'down' ? 'rej' : 'track'}>
                    {aiVisibility.monthlyChange}
                  </MePill>
                ) : (
                  <MePill tone="attn">No baseline yet</MePill>
                )
              }
            />

            {/* Donut */}
            <div className="flex items-center gap-5 pt-1">
              <svg viewBox="0 0 42 42" className="h-[110px] w-[110px] flex-none">
                <defs>
                  <linearGradient id="me-dash-gold" x1="0%" y1="0%" x2="100%" y2="100%">
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
                  stroke="url(#me-dash-gold)"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray={donutDashArray}
                  transform="rotate(-90 21 21)"
                />
              </svg>
              <div>
                <div
                  className="font-display text-4xl font-bold tabular-nums leading-none"
                  style={{
                    backgroundImage: GOLD_GRADIENT,
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  {livePercentDisplay}
                </div>
                <p className="mt-1.5 text-[12px] leading-snug text-black/55">
                  brand mention rate
                  <br />
                  across AI engines
                </p>
              </div>
            </div>

            {/* Engines */}
            <div className="mt-5 divide-y divide-black/[.06]">
              {aiVisibility.engines.map(engine => (
                <div key={engine.id} className="flex items-center justify-between py-[11px]">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-7 w-7 place-items-center rounded-md bg-me-stone text-[10px] font-black text-black/60">
                      {engine.id}
                    </span>
                    <span className="text-[13.5px] font-semibold text-me-charcoal">{engine.name}</span>
                  </div>
                  <MeTrend dir={engine.dir}>{engine.rank}</MeTrend>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11.5px] text-black/40">
              Avg rank across {AI_ENGINES.length} engines · last 7 days
            </p>
          </MePanel>
        </div>

        {/* 3-up Quick Actions */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Link
            href="/dashboard/clients"
            className="group rounded-[24px] p-5 transition hover:-translate-y-[1px]"
            style={{ background: GOLD_GRADIENT, boxShadow: '0 18px 50px rgba(196,145,46,.22)' }}
          >
            <div className="flex items-start gap-4">
              <div className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-black/15 text-[#2A2008]">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
                </svg>
              </div>
              <div className="min-w-0">
                <h4 className="font-display text-[16px] font-bold text-[#2A2008]">Generate content</h4>
                <p className="mt-1 text-[12.5px] text-[#2A2008]/75">
                  Route A / B / C · campaign or free topic
                </p>
              </div>
            </div>
          </Link>

          <Link
            href="/dashboard/clients"
            className="group rounded-[24px] border border-black/10 bg-white p-5 shadow-card transition hover:-translate-y-[1px]"
          >
            <div className="flex items-start gap-4">
              <div className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-me-ochre/12 text-me-ochre">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3-3" />
                </svg>
              </div>
              <div className="min-w-0">
                <h4 className="font-display text-[16px] font-bold text-me-charcoal">Fetch keywords</h4>
                <p className="mt-1 text-[12.5px] text-black/55">
                  Pull fresh AU / NZ keyword data
                  {keywordCount > 0 && (
                    <span className="ml-1 text-black/35">· {keywordCount} runs total</span>
                  )}
                </p>
              </div>
            </div>
          </Link>

          <Link
            href="/dashboard/visuals"
            className="group rounded-[24px] border border-black/10 bg-white p-5 shadow-card transition hover:-translate-y-[1px]"
          >
            <div className="flex items-start gap-4">
              <div className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-me-ochre/12 text-me-ochre">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="9" r="1.8" />
                  <path d="m4 17 5-4 5 3 6-5" />
                </svg>
              </div>
              <div className="min-w-0">
                <h4 className="font-display text-[16px] font-bold text-me-charcoal">Generate visuals</h4>
                <p className="mt-1 text-[12.5px] text-black/55">
                  AI images &amp; video for the next batch
                </p>
              </div>
            </div>
          </Link>
        </section>

        {/* Quick chips footer — top 6 most recently active clients */}
        {activeClientCount > 0 && (
          <section>
            <p className="mb-2 text-[10.5px] font-black uppercase tracking-[.16em] text-black/40">
              Jump to a client
            </p>
            <div className="flex flex-wrap gap-2">
              {activeClients.map(c => (
                <Link key={c.id} href={`/dashboard/clients/${c.id}`}>
                  <MeChip>
                    <span className="font-semibold">{c.name}</span>
                    {c.domain && (
                      <span className="ml-1.5 text-black/40">· {c.domain}</span>
                    )}
                  </MeChip>
                </Link>
              ))}
              <Link href="/dashboard/clients">
                <MeChip gold>All clients →</MeChip>
              </Link>
            </div>
          </section>
        )}

        {/* Bottom CTA when no clients */}
        {activeClientCount === 0 && (
          <MePanel className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-me-stone text-2xl text-me-ochre">
                +
              </span>
              <div>
                <p className="font-display text-[15px] font-semibold text-me-charcoal">
                  Onboard your first client in 5 minutes
                </p>
                <p className="mt-1 text-[12.5px] text-black/55">
                  Paste a website + industry — Magic Engine drafts a brand brief v1.
                </p>
              </div>
            </div>
            <MeButton href="/dashboard/clients" size="sm">Start onboarding</MeButton>
          </MePanel>
        )}
      </div>
    </div>
  );
}
