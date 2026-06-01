'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface Client {
  id: string;
  name: string;
  domain?: string;
}

type Tab = 'tracker' | 'geo';

const TABS: { id: Tab; label: string; desc: string }[] = [
  { id: 'tracker', label: 'AI Tracker',    desc: 'Track how clients rank across AI assistants and search responses.' },
  { id: 'geo',     label: 'GEO Composer',  desc: 'Generate AI recommendation directives and embed them in client websites.' },
];

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

  const badgeLabel = tab === 'tracker' ? 'View Rankings' : 'Open Composer';

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-me-charcoal/90">AI 可见度</h1>
        <p className="text-sm text-me-charcoal/55 mt-1">{active.desc}</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-me-ivory p-1 rounded-lg w-fit">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === t.id
                ? 'bg-white text-me-charcoal/90 shadow-sm'
                : 'text-me-charcoal/55 hover:text-me-charcoal/75'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-[#C2453A]/10 border border-[#C2453A]/30 rounded-lg px-4 py-3 text-sm text-[#C2453A]">
          {error}
        </div>
      )}

      {/* Client Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse bg-white rounded-xl border border-black/10 p-5 h-24" />
          ))}
        </div>
      ) : clients.length === 0 ? (
        <div className="bg-white rounded-xl border border-black/10 py-16 text-center">
          <p className="text-me-charcoal/45 text-sm">No clients found.</p>
          <Link href="/dashboard/clients" className="text-me-ochre hover:underline text-sm mt-2 block">
            → Add a client first
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {clients.map(client => (
            <Link
              key={client.id}
              href={clientHref(client.id)}
              className="bg-white rounded-xl border border-black/10 p-5 hover:border-me-ochre/50 hover:shadow-sm transition-all group"
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-semibold text-me-charcoal/90 group-hover:text-me-ochre truncate">
                    {client.name}
                  </h2>
                  {client.domain && (
                    <p className="text-xs text-me-charcoal/45 mt-0.5 truncate">{client.domain}</p>
                  )}
                </div>
                <span className="text-me-charcoal/35 group-hover:text-me-ochre/80 text-lg ml-2 flex-shrink-0">→</span>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  tab === 'tracker'
                    ? 'bg-me-ochre/10 text-me-ochre'
                    : 'bg-me-ochre/10 text-me-ochre'
                }`}>
                  {badgeLabel}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
