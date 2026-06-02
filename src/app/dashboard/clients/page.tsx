'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  MePanel,
  MePill,
  MeButton,
  MeChip,
} from '@/components/ui/me-primitives';
import { GOLD_GRADIENT, cx } from '@/components/ui/me-theme';

interface Client {
  id: string;
  name: string;
  domain?: string;
  created_at: string;
  semrush_db?: string;
  plan_tier?: string;
  // B8: active Goal summary (newest active) + count
  active_goal?: {
    title: string;
    intent: string;
    primary_metric_label: string;
    baseline_value: number;
    target_value: number;
    period_end: string;
  } | null;
  active_goals_count?: number;
}

function intentEmoji(intent: string): string {
  return intent === 'acquisition' ? '🎯' : intent === 'sales' ? '💰' : intent === 'awareness' ? '📢' : '·';
}

function daysRemaining(endIso: string): number {
  return Math.max(0, Math.round((new Date(endIso).getTime() - Date.now()) / 86_400_000));
}

type FilterKey = 'all' | 'active' | 'onboarding';

// Onboarding cutoff: anyone created within last 7 days = onboarding
const ONBOARDING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function isOnboarding(client: Client): boolean {
  const ageMs = Date.now() - new Date(client.created_at).getTime();
  return ageMs < ONBOARDING_WINDOW_MS;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(s => s[0]?.toUpperCase() ?? '')
    .join('') || 'C';
}

// Phase tone for a single status pill
function statusPill(client: Client) {
  if (isOnboarding(client)) {
    return { tone: 'exec' as const, label: 'Onboarding' };
  }
  return { tone: 'track' as const, label: 'On track' };
}

// Flywheel mini-progress (4 loops). Demo values until real rollup is wired.
// TODO: replace with per-client `flywheel_actions` rollup once Phase 12 outcomes view is ready
function demoFlywheel(_client: Client) {
  return [
    { key: 'seo',    label: 'SEO',    pct: 78 },
    { key: 'geo',    label: 'GEO',    pct: 62 },
    { key: 'social', label: 'Social', pct: 44 },
    { key: 'ads',    label: 'Ads',    pct: 28 },
  ];
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');

  const fetchClients = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/clients');
      const json = await res.json();
      setClients(json.clients ?? []);
    } catch {
      setError('Failed to load clients');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/clients/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json();
        setError(json.error ?? 'Delete failed');
        return;
      }
      setClients(prev => prev.filter(c => c.id !== id));
    } catch {
      setError('Delete failed');
    } finally {
      setDeleting(false);
      setConfirmDeleteId(null);
    }
  };

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return clients.filter(c => {
      const matchesSearch =
        !term ||
        c.name.toLowerCase().includes(term) ||
        (c.domain ?? '').toLowerCase().includes(term);
      if (!matchesSearch) return false;
      if (filter === 'all') return true;
      const onboarding = isOnboarding(c);
      if (filter === 'onboarding') return onboarding;
      return !onboarding;
    });
  }, [clients, filter, search]);

  const counts = useMemo(() => {
    const onboarding = clients.filter(isOnboarding).length;
    return {
      all: clients.length,
      active: clients.length - onboarding,
      onboarding,
    };
  }, [clients]);

  return (
    <div className="font-sans">
      {/* Topbar */}
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-black/10 bg-[#FBF8F3]/80 px-8 py-5 backdrop-blur-md">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-me-charcoal">
            Clients
          </h1>
          <p className="mt-[3px] text-[13px] text-black/55">
            Brand briefs, onboarding and per-client settings
          </p>
        </div>
        <MeButton href="/dashboard/clients/new" size="sm">
          <span className="text-base leading-none">+</span> Add client
        </MeButton>
      </header>

      <div className="px-8 py-7 space-y-6">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Segmented tabs */}
          <div className="inline-flex items-center gap-1 rounded-xl border border-black/10 bg-white p-1 shadow-[0_1px_2px_rgba(26,26,26,.04)]">
            {[
              { key: 'all',         label: 'All clients' },
              { key: 'active',      label: 'Active' },
              { key: 'onboarding',  label: 'Onboarding' },
            ].map(tab => {
              const active = filter === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setFilter(tab.key as FilterKey)}
                  className={cx(
                    'rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold transition',
                    active
                      ? 'bg-me-charcoal text-[#FBF8F3]'
                      : 'text-black/55 hover:bg-me-stone',
                  )}
                >
                  {tab.label}
                  <span className={cx(
                    'ml-1.5 tabular-nums',
                    active ? 'text-[#FBF8F3]/65' : 'text-black/35',
                  )}>
                    {counts[tab.key as FilterKey]}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Search */}
          <label className="flex flex-1 min-w-[220px] items-center gap-2 rounded-xl border border-black/10 bg-white px-3.5 py-2 text-[13px] shadow-[0_1px_2px_rgba(26,26,26,.04)] focus-within:border-me-ochre/50">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 text-black/40">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3-3" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search clients…"
              className="flex-1 bg-transparent text-me-charcoal outline-none placeholder:text-black/35"
            />
          </label>
        </div>

        {/* Error banner */}
        {error && (
          <div className="flex items-center justify-between rounded-2xl border border-[#C2453A]/30 bg-[#C2453A]/10 px-4 py-3 text-[13px] font-semibold text-[#902F26]">
            <span>{error}</span>
            <button
              onClick={() => setError('')}
              className="text-[#902F26]/65 hover:text-[#902F26]"
              type="button"
            >
              ✕
            </button>
          </div>
        )}

        {/* Loading state */}
        {loading ? (
          <MePanel>
            <div className="py-10 text-center text-[13px] text-black/40">Loading clients…</div>
          </MePanel>
        ) : filtered.length === 0 ? (
          /* Empty state */
          <MePanel>
            <div className="space-y-3 py-10 text-center">
              <p className="text-[13.5px] text-black/55">
                {clients.length === 0
                  ? 'No clients yet.'
                  : 'No clients match your filters.'}
              </p>
              {clients.length === 0 ? (
                <MeButton href="/dashboard/clients/new" size="sm">
                  Add your first client →
                </MeButton>
              ) : (
                <button
                  type="button"
                  onClick={() => { setFilter('all'); setSearch(''); }}
                  className="text-[13px] font-semibold text-me-ochre hover:underline"
                >
                  Reset filters
                </button>
              )}
            </div>
          </MePanel>
        ) : (
          /* Client cards grid */
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {filtered.map(client => {
              const pill = statusPill(client);
              const flywheel = demoFlywheel(client);
              const confirming = confirmDeleteId === client.id;

              return (
                <MePanel
                  key={client.id}
                  className={cx(confirming && 'ring-2 ring-[#C2453A]/30')}
                >
                  {/* Header row: avatar + name + status pill */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3.5">
                      <span
                        className="grid h-12 w-12 flex-none place-items-center rounded-xl font-display text-[15px] font-bold text-[#2A2008]"
                        style={{ background: GOLD_GRADIENT }}
                      >
                        {initials(client.name)}
                      </span>
                      <div className="min-w-0">
                        <div className="font-display text-[17px] font-semibold tracking-tight text-me-charcoal truncate">
                          {client.name}
                        </div>
                        {client.domain ? (
                          <a
                            href={`https://${client.domain}`}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-0.5 inline-block text-[12.5px] text-me-ochre hover:underline truncate"
                          >
                            {client.domain}
                          </a>
                        ) : (
                          <span className="mt-0.5 block text-[12.5px] text-black/40">
                            No domain set
                          </span>
                        )}
                      </div>
                    </div>
                    <MePill tone={pill.tone}>{pill.label}</MePill>
                  </div>

                  {/* B8: Active Goal summary (if any) */}
                  {client.active_goal && (
                    <Link
                      href={`/dashboard/clients/${client.id}`}
                      className="mt-3 block rounded-lg border border-me-ochre/30 bg-me-ochre/[0.06] px-3 py-2 transition-colors hover:bg-me-ochre/10"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-base">{intentEmoji(client.active_goal.intent)}</span>
                        <span className="text-[12.5px] font-black text-me-charcoal truncate">
                          {client.active_goal.title}
                        </span>
                        {(client.active_goals_count ?? 0) > 1 && (
                          <span className="rounded-full bg-me-ochre/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-me-ochre">
                            +{(client.active_goals_count ?? 0) - 1} more
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[10.5px] font-semibold text-me-charcoal/55">
                        <span>{client.active_goal.primary_metric_label}: {client.active_goal.baseline_value.toLocaleString()} → {client.active_goal.target_value.toLocaleString()}</span>
                        <span className="text-me-charcoal/25">·</span>
                        <span className="font-bold text-me-ochre">{daysRemaining(client.active_goal.period_end)}d left</span>
                      </div>
                    </Link>
                  )}

                  {/* Channel chips */}
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    <MeChip gold>SEO</MeChip>
                    <MeChip gold>GEO</MeChip>
                    <MeChip>Social</MeChip>
                    <MeChip>Ads</MeChip>
                  </div>

                  {/* Flywheel mini bars */}
                  <div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4">
                    {flywheel.map(loop => (
                      <div key={loop.key} className="space-y-1.5">
                        <div className="flex items-baseline justify-between">
                          <span className="text-[11.5px] font-semibold text-black/55">{loop.label}</span>
                          <span className="font-display text-[12px] font-bold tabular-nums text-black/70">
                            {loop.pct}%
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-me-stone">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${loop.pct}%`, background: GOLD_GRADIENT }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Footer actions */}
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-black/[.06] pt-4">
                    {confirming ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[12px] font-semibold text-[#C2453A]">
                          Delete &quot;{client.name}&quot;?
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDelete(client.id)}
                          disabled={deleting}
                          className="rounded-lg bg-[#C2453A] px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-[#A53127] disabled:cursor-wait disabled:opacity-60"
                        >
                          {deleting ? 'Deleting…' : 'Yes, delete'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          disabled={deleting}
                          className="rounded-lg border border-black/15 px-3 py-1.5 text-[12px] font-semibold text-black/55 transition hover:bg-me-stone disabled:opacity-60"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap gap-2">
                          <MeButton href={`/dashboard/clients/${client.id}/brief`} size="sm">
                            Open brand brief
                          </MeButton>
                          <MeButton
                            href={`/portal/${client.id}`}
                            size="sm"
                            variant="ghost"
                          >
                            View portal
                          </MeButton>
                        </div>
                        <div className="flex items-center gap-3">
                          <Link
                            href={`/dashboard/clients/${client.id}`}
                            className="text-[12.5px] font-semibold text-me-ochre hover:underline"
                          >
                            Open →
                          </Link>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(client.id)}
                            className="text-[15px] text-black/30 transition hover:text-[#C2453A]"
                            title="Delete client"
                          >
                            🗑
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </MePanel>
              );
            })}
          </div>
        )}

        {/* Onboarding CTA — keeps the design's "5 minutes" hook */}
        {!loading && clients.length > 0 && (
          <MePanel className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-me-stone text-2xl text-me-ochre">
                +
              </span>
              <div>
                <p className="font-display text-[15px] font-semibold text-me-charcoal">
                  Onboard a new client in 5 minutes
                </p>
                <p className="mt-1 text-[12.5px] text-black/55">
                  Paste a website + industry — Magic Engine scans it and drafts a brand brief v1.
                </p>
              </div>
            </div>
            <MeButton href="/dashboard/clients/new" variant="secondary" size="sm">
              Start onboarding
            </MeButton>
          </MePanel>
        )}

        {/* Safety note */}
        {!loading && clients.length > 0 && (
          <p className="text-[11.5px] text-black/40">
            Deleting a client removes all associated data — briefs, content, and visibility runs.
          </p>
        )}
      </div>
    </div>
  );
}
