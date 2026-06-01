'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  MePanel,
  MePill,
  MeChip,
  MeButton,
} from '@/components/ui/me-primitives';
import { GOLD_GRADIENT, cx } from '@/components/ui/me-theme';

interface Client {
  id: string;
  name: string;
  domain?: string;
}

type Tab = 'tracker' | 'geo';

const TABS: { id: Tab; label: string; desc: string }[] = [
  { id: 'tracker', label: 'AI Tracker',    desc: 'Weekly brand tracking across ChatGPT, Claude, Perplexity & Google AIO.' },
  { id: 'geo',     label: 'GEO Composer',  desc: 'Generate AI recommendation directives and embed them in client websites.' },
];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(s => s[0]?.toUpperCase() ?? '')
    .join('') || 'C';
}

export default function AiVisibilityIndexPage() {
  const [tab, setTab] = useState<Tab>('tracker');
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchClients = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/clients');
      if (!res.ok) throw new Error('Failed to load clients');
      const json = await res.json();
      setClients(json.clients ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  const active = TABS.find(t => t.id === tab)!;

  const clientHref = (id: string) =>
    tab === 'tracker'
      ? `/dashboard/ai-visibility/${id}`
      : `/dashboard/geo-composer/${id}`;

  const badgeLabel = tab === 'tracker' ? 'View rankings' : 'Open composer';

  return (
    <div className="font-sans">
      {/* Topbar */}
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-black/10 bg-[#FBF8F3]/80 px-8 py-5 backdrop-blur-md">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-me-charcoal">
            AI Visibility
          </h1>
          <p className="mt-[3px] text-[13px] text-black/55">{active.desc}</p>
        </div>
        <div className="inline-flex items-center gap-1 rounded-xl border border-black/10 bg-white p-1 shadow-[0_1px_2px_rgba(26,26,26,.04)]">
          {TABS.map(t => {
            const isOn = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cx(
                  'rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold transition',
                  isOn
                    ? 'bg-me-charcoal text-[#FBF8F3]'
                    : 'text-black/55 hover:bg-me-stone',
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </header>

      <div className="px-8 py-7 space-y-6">
        {/* Error banner */}
        {error && (
          <div className="flex items-center justify-between rounded-2xl border border-[#C2453A]/30 bg-[#C2453A]/10 px-4 py-3 text-[13px] font-semibold text-[#902F26]">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError('')}
              className="text-[#902F26]/65 hover:text-[#902F26]"
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
        ) : clients.length === 0 ? (
          /* Empty state */
          <MePanel>
            <div className="space-y-3 py-10 text-center">
              <p className="text-[13.5px] text-black/55">No clients yet.</p>
              <MeButton href="/dashboard/clients" size="sm">
                Add your first client →
              </MeButton>
            </div>
          </MePanel>
        ) : (
          /* Client cards grid */
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {clients.map(client => (
              <Link
                key={client.id}
                href={clientHref(client.id)}
                className="group block rounded-[24px] border border-black/10 bg-white p-6 shadow-[0_1px_2px_rgba(26,26,26,.04),0_8px_28px_rgba(26,26,26,.06)] transition hover:-translate-y-[1px] hover:border-me-ochre/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3.5">
                    <span
                      className="grid h-12 w-12 flex-none place-items-center rounded-xl font-display text-[15px] font-bold text-[#2A2008]"
                      style={{ background: GOLD_GRADIENT }}
                    >
                      {initials(client.name)}
                    </span>
                    <div className="min-w-0">
                      <div className="font-display text-[17px] font-semibold tracking-tight text-me-charcoal truncate group-hover:text-me-ochre">
                        {client.name}
                      </div>
                      {client.domain ? (
                        <span className="mt-0.5 block text-[12.5px] text-black/45 truncate">
                          {client.domain}
                        </span>
                      ) : (
                        <span className="mt-0.5 block text-[12.5px] text-black/40">
                          No domain set
                        </span>
                      )}
                    </div>
                  </div>
                  <MePill tone="track">{badgeLabel}</MePill>
                </div>

                <div className="mt-4 flex flex-wrap gap-1.5">
                  <MeChip gold>ChatGPT</MeChip>
                  <MeChip gold>Claude</MeChip>
                  <MeChip gold>Perplexity</MeChip>
                  <MeChip gold>Google AIO</MeChip>
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-black/[.06] pt-4 text-[12.5px]">
                  <span className="text-black/55">Weekly brand tracking</span>
                  <span className="font-semibold text-me-ochre group-hover:underline">Open →</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
