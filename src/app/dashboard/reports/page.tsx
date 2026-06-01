'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
<<<<<<< HEAD
import { MePanel, MePill, MeButton } from '@/components/ui/me-primitives';
=======
import { MePanel, MePill, MeChip } from '@/components/ui/me-primitives';
>>>>>>> 5bb7c47 (feat(ui): Reports 月报页按设计稿重做 — 4-up 摘要 + sparkline + benchmark)
import { GOLD_GRADIENT } from '@/components/ui/me-theme';

interface ClientRow {
  id: string;
  name: string;
  domain?: string | null;
}

<<<<<<< HEAD
=======
/**
 * /dashboard/reports
 *
 * Client selector — pick a client to view their monthly insight report.
 * Matches design system topbar + card list pattern (see Magic Engine Dashboard.html
 * `view-reports`).
 *
 * Reference: ROADMAP.md P7.4.1
 */
>>>>>>> 5bb7c47 (feat(ui): Reports 月报页按设计稿重做 — 4-up 摘要 + sparkline + benchmark)
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

<<<<<<< HEAD
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
=======
  // Current month label for the placeholder period badge on each card
  const periodLabel = new Date().toLocaleDateString('en-AU', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="font-sans">
      {/* Topbar — matches design view-reports header */}
      <header className="sticky top-0 z-20 flex items-center justify-between gap-5 border-b border-black/10 bg-[#FBF8F3]/80 px-8 py-5 backdrop-blur-md">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-me-charcoal">
            Reports
          </h1>
          <p className="mt-[3px] text-[13px] text-black/55">
            Monthly Insight Report — search, AI, local, links and benchmarks
          </p>
        </div>
        <div className="hidden items-center gap-3 md:flex">
          <MePill tone="track">{periodLabel}</MePill>
>>>>>>> 5bb7c47 (feat(ui): Reports 月报页按设计稿重做 — 4-up 摘要 + sparkline + benchmark)
        </div>
      </header>

      <div className="px-8 py-7 space-y-6 max-w-5xl">
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[1, 2, 3, 4].map(i => (
              <div
                key={i}
                className="h-[112px] animate-pulse rounded-[24px] border border-black/10 bg-white shadow-card"
              />
            ))}
          </div>
        ) : clients.length === 0 ? (
          <MePanel>
            <p className="text-sm text-black/55">
              No clients yet. Onboard a client from the{' '}
              <Link href="/dashboard/clients" className="font-semibold text-me-ochre hover:underline">
                Clients
              </Link>{' '}
              page to start generating monthly reports.
            </p>
          </MePanel>
        ) : (
          <>
            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {clients.map(c => (
                <Link
                  key={c.id}
                  href={`/dashboard/reports/${c.id}/monthly`}
                  className="group rounded-[24px] border border-black/10 bg-white p-5 shadow-card transition hover:-translate-y-[1px] hover:border-me-ochre/40"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="font-display text-[16px] font-semibold tracking-tight text-me-charcoal">
                        {c.name}
                      </h3>
                      {c.domain && (
                        <p className="mt-1 truncate text-[12.5px] text-black/55">
                          {c.domain}
                        </p>
                      )}
                    </div>
                    <span
                      className="grid h-10 w-10 flex-none place-items-center rounded-xl text-[#2A2008]"
                      style={{ background: GOLD_GRADIENT }}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-4 w-4"
                      >
                        <path d="M7 4h10a1 1 0 0 1 1 1v14l-3-2-3 2-3-2-3 2V5a1 1 0 0 1 1-1z" />
                        <path d="M9 9h6M9 13h4" />
                      </svg>
                    </span>
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <MeChip>Monthly · {periodLabel}</MeChip>
                    <span className="text-[12.5px] font-semibold text-me-ochre group-hover:underline">
                      View report →
                    </span>
                  </div>
                </Link>
              ))}
            </section>

            <p className="text-[11.5px] text-black/40">
              Reports aggregate AI visibility, SEO, local search, links and benchmark
              data into a single monthly view. Pick a client to drill in.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
