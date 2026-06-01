'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { MePanel, MePill, MeButton } from '@/components/ui/me-primitives';
import { GOLD_GRADIENT } from '@/components/ui/me-theme';

interface ClientRow {
  id: string;
  name: string;
}

export default function ReportsIndexPage() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/clients')
      .then(r => r.json())
      .then(j => setClients(j.clients ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Topbar */}
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-[#1A1A1A]">
          Reports
        </h1>
        <p className="mt-1 text-sm text-black/60">
          Monthly Insight Report — search, AI, local, links and benchmarks
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-[88px] animate-pulse rounded-[24px] bg-[#EAE6DF]" />
          ))}
        </div>
      ) : clients.length === 0 ? (
        <MePanel>
          <p className="py-8 text-center text-sm text-black/40">No clients found.</p>
        </MePanel>
      ) : (
        <div className="space-y-3">
          {clients.map(c => (
            <Link
              key={c.id}
              href={`/dashboard/reports/${c.id}/monthly`}
              className="group flex items-center justify-between rounded-[24px] border border-black/10 bg-white px-6 py-5 shadow-[0_1px_2px_rgba(26,26,26,.04),0_8px_28px_rgba(26,26,26,.06)] transition-shadow hover:shadow-[0_2px_6px_rgba(26,26,26,.06),0_16px_40px_rgba(26,26,26,.10)]"
            >
              <div className="flex items-center gap-4">
                {/* avatar tile */}
                <div
                  className="grid h-[38px] w-[38px] flex-none place-items-center rounded-[10px] font-display text-[13px] font-bold text-[#2A2008]"
                  style={{ background: GOLD_GRADIENT }}
                >
                  {c.name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="font-display text-[15px] font-semibold text-[#1A1A1A]">
                    {c.name}
                  </p>
                  <p className="mt-0.5 text-xs text-black/40">Monthly report</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <MePill tone="track">On track</MePill>
                <span className="text-sm font-semibold text-black/40 transition-colors group-hover:text-[#C4912E]">
                  View report →
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
