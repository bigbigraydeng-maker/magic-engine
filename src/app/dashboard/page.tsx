import { supabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface ClientRow {
  id: string;
  name: string;
  diag: {
    overall_score: number | null;
    critical_count: number;
    high_count: number;
    completed_at: string | null;
  } | null;
}

async function getDashboardData() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    reviewCountRes,
    pendingExecRes,
    publishQueueRes,
    pipelineRes,
    flywheelRes,
    clientsRes,
    newLeadsRes,
    latestDiagRes,
  ] = await Promise.all([
    supabaseAdmin
      .from('production_packages')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'ready_for_review'),

    supabaseAdmin
      .from('execution_items')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending'),

    supabaseAdmin
      .from('website_publish_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'draft'),

    supabaseAdmin
      .from('production_packages')
      .select('status')
      .gte('created_at', thirtyDaysAgo),

    supabaseAdmin
      .from('flywheel_actions')
      .select('flywheel')
      .gte('executed_at', sevenDaysAgo),

    supabaseAdmin
      .from('clients')
      .select('id, name')
      .order('name'),

    supabaseAdmin
      .from('discovery_leads')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'new')
      .gte('created_at', thirtyDaysAgo),

    supabaseAdmin
      .from('diagnostic_runs')
      .select('client_id, overall_score, critical_count, high_count, completed_at')
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(200),
  ]);

  const pipelineCounts: Record<string, number> = {};
  for (const pkg of pipelineRes.data ?? []) {
    const s = (pkg as { status: string }).status;
    pipelineCounts[s] = (pipelineCounts[s] ?? 0) + 1;
  }

  const flywheelCounts: Record<string, number> = { seo: 0, geo: 0, ads: 0, social: 0 };
  for (const action of flywheelRes.data ?? []) {
    const k = (action as { flywheel: string }).flywheel;
    flywheelCounts[k] = (flywheelCounts[k] ?? 0) + 1;
  }

  type DiagRow = { client_id: string; overall_score: number | null; critical_count: number; high_count: number; completed_at: string | null };
  const latestDiagByClient = new Map<string, DiagRow>();
  for (const run of (latestDiagRes.data ?? []) as DiagRow[]) {
    if (!latestDiagByClient.has(run.client_id)) {
      latestDiagByClient.set(run.client_id, run);
    }
  }

  type ClientData = { id: string; name: string };
  const clientRoster: ClientRow[] = (clientsRes.data ?? []).map((c: ClientData) => {
    const d = latestDiagByClient.get(c.id) ?? null;
    return {
      id: c.id,
      name: c.name,
      diag: d ? {
        overall_score: d.overall_score,
        critical_count: d.critical_count,
        high_count: d.high_count,
        completed_at: d.completed_at,
      } : null,
    };
  });

  let totalCritical = 0;
  let totalHigh = 0;
  for (const run of latestDiagByClient.values()) {
    totalCritical += run.critical_count;
    totalHigh += run.high_count;
  }

  return {
    reviewCount: reviewCountRes.count ?? 0,
    pendingExec: pendingExecRes.count ?? 0,
    publishQueue: publishQueueRes.count ?? 0,
    pipelineCounts,
    flywheelCounts,
    clientRoster,
    newLeads: newLeadsRes.count ?? 0,
    totalCritical,
    totalHigh,
    totalClients: (clientsRes.data ?? []).length,
  };
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) {
    return <span className="text-xs text-gray-300 font-mono">—</span>;
  }
  const cls =
    score >= 80 ? 'bg-emerald-100 text-emerald-700' :
    score >= 60 ? 'bg-yellow-100 text-yellow-700' :
    score >= 40 ? 'bg-orange-100 text-orange-700' :
    'bg-red-100 text-red-700';
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full tabular-nums ${cls}`}>
      {score}
    </span>
  );
}

const PIPELINE_STAGES = [
  { key: 'draft',            label: 'Draft',           bar: 'bg-gray-300' },
  { key: 'generating',       label: 'Generating',      bar: 'bg-blue-400' },
  { key: 'ready_for_review', label: 'Awaiting Review', bar: 'bg-yellow-400' },
  { key: 'approved',         label: 'Approved',        bar: 'bg-emerald-400' },
  { key: 'published',        label: 'Published',       bar: 'bg-indigo-500' },
  { key: 'failed',           label: 'Failed',          bar: 'bg-red-400' },
];

const FLYWHEELS = [
  { key: 'seo',    label: 'SEO',    bar: 'bg-blue-500' },
  { key: 'geo',    label: 'GEO',    bar: 'bg-violet-500' },
  { key: 'ads',    label: 'Ads',    bar: 'bg-orange-500' },
  { key: 'social', label: 'Social', bar: 'bg-pink-500' },
];

export default async function OverviewPage() {
  const data = await getDashboardData();
  const {
    reviewCount, pendingExec, publishQueue,
    pipelineCounts, flywheelCounts, clientRoster,
    newLeads, totalCritical, totalHigh, totalClients,
  } = data;

  const pipelineTotal = Object.values(pipelineCounts).reduce((a, b) => a + b, 0);
  const maxFlywheel = Math.max(...Object.values(flywheelCounts), 1);
  const today = new Date().toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const attentionCards = [
    {
      value: totalCritical + totalHigh,
      label: 'Open Findings',
      sub: totalCritical > 0 ? `${totalCritical} critical` : `${totalHigh} high`,
      href: '/dashboard/clients',
      urgent: totalCritical > 0,
      activeClass: 'border-red-300 bg-red-50',
      numClass: 'text-red-600',
    },
    {
      value: reviewCount,
      label: 'Awaiting Review',
      sub: 'content packages',
      href: '/dashboard/content',
      urgent: reviewCount > 5,
      activeClass: 'border-yellow-300 bg-yellow-50',
      numClass: 'text-yellow-600',
    },
    {
      value: pendingExec,
      label: 'Pending Executions',
      sub: 'across all clients',
      href: '/dashboard/clients',
      urgent: pendingExec > 10,
      activeClass: 'border-orange-300 bg-orange-50',
      numClass: 'text-orange-600',
    },
    {
      value: newLeads,
      label: 'New Leads',
      sub: 'last 30 days',
      href: '/dashboard/admin/prospects',
      urgent: newLeads > 0,
      activeClass: 'border-blue-300 bg-blue-50',
      numClass: 'text-blue-600',
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Command Center</h1>
          <p className="text-xs text-gray-400 mt-0.5">{today}</p>
        </div>
        <span className="text-xs text-gray-400">{totalClients} clients total</span>
      </div>

      {/* Needs Attention */}
      <section>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Needs Attention</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {attentionCards.map(card => (
            <Link key={card.label} href={card.href}>
              <div className={`rounded-lg border p-4 hover:shadow-sm transition-shadow cursor-pointer ${
                card.urgent ? card.activeClass : 'border-gray-200 bg-white'
              }`}>
                <div className={`text-3xl font-bold tabular-nums ${card.urgent ? card.numClass : 'text-gray-400'}`}>
                  {card.value}
                </div>
                <div className="text-xs font-medium text-gray-700 mt-1.5">{card.label}</div>
                <div className="text-xs text-gray-400 mt-0.5">{card.sub}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Pipeline + Flywheel */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 bg-white border border-gray-200 rounded-lg p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700">Production Pipeline</h2>
            <span className="text-xs text-gray-400">{pipelineTotal} packages · 30 days</span>
          </div>
          <div className="space-y-2.5">
            {PIPELINE_STAGES.map(stage => {
              const count = pipelineCounts[stage.key] ?? 0;
              const pct = pipelineTotal === 0 ? 0 : (count / pipelineTotal) * 100;
              return (
                <div key={stage.key} className="flex items-center gap-3">
                  <div className="w-28 text-right text-xs text-gray-400 shrink-0">{stage.label}</div>
                  <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                    <div
                      className={`${stage.bar} h-2 rounded-full transition-all`}
                      style={{ width: count === 0 ? '0%' : `${Math.max(pct, 3)}%` }}
                    />
                  </div>
                  <div className="w-6 text-right text-xs font-medium text-gray-600 shrink-0 tabular-nums">
                    {count}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-lg p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700">Flywheel Activity</h2>
            <span className="text-xs text-gray-400">last 7 days</span>
          </div>
          <div className="space-y-3.5">
            {FLYWHEELS.map(f => {
              const count = flywheelCounts[f.key] ?? 0;
              const pct = count === 0 ? 0 : Math.max((count / maxFlywheel) * 100, 5);
              return (
                <div key={f.key} className="flex items-center gap-3">
                  <div className="w-10 text-xs text-gray-500 font-medium">{f.label}</div>
                  <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                    <div className={`${f.bar} h-2 rounded-full`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="w-5 text-right text-xs font-medium text-gray-600 tabular-nums">{count}</div>
                </div>
              );
            })}
          </div>
          {publishQueue > 0 && (
            <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
              <span className="text-xs text-gray-500">Publish queue</span>
              <span className="text-xs font-semibold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">
                {publishQueue} queued
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Client Roster */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Client Roster</p>
          <Link href="/dashboard/clients" className="text-xs text-indigo-600 hover:underline">
            All clients →
          </Link>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left text-xs font-medium text-gray-400 px-4 py-2.5">Client</th>
                <th className="text-center text-xs font-medium text-gray-400 px-3 py-2.5">Score</th>
                <th className="text-center text-xs font-medium text-gray-400 px-3 py-2.5">Issues</th>
                <th className="text-left text-xs font-medium text-gray-400 px-3 py-2.5">Last Diagnostic</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {clientRoster.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-xs text-gray-400">
                    No clients yet.{' '}
                    <Link href="/dashboard/clients/new" className="text-indigo-600 hover:underline">
                      Add one
                    </Link>
                  </td>
                </tr>
              ) : (
                clientRoster.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{c.name}</td>
                    <td className="px-3 py-3 text-center">
                      <ScoreBadge score={c.diag?.overall_score ?? null} />
                    </td>
                    <td className="px-3 py-3 text-center">
                      {c.diag ? (
                        <span className="text-xs">
                          {c.diag.critical_count > 0 && (
                            <span className="text-red-600 font-semibold">{c.diag.critical_count}C </span>
                          )}
                          {c.diag.high_count > 0 && (
                            <span className="text-orange-600 font-semibold">{c.diag.high_count}H</span>
                          )}
                          {c.diag.critical_count === 0 && c.diag.high_count === 0 && (
                            <span className="text-gray-300">—</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-400">
                      {c.diag?.completed_at
                        ? new Date(c.diag.completed_at).toLocaleDateString('en-AU', {
                            day: 'numeric', month: 'short', year: 'numeric',
                          })
                        : 'Never run'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/dashboard/clients/${c.id}/diagnostic`}
                        className="text-xs text-indigo-600 hover:underline"
                      >
                        Diagnose →
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
